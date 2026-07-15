"""
Scoring Worker — Main entry point.

Continuously pops transactions from Redis pending queue,
extracts features, runs rules engine + ML models,
and persists decisions to PostgreSQL.

Handles graceful shutdown on SIGTERM/SIGINT.
"""

import json
import signal
import sys
import time
import redis as redis_client

from config import (
    REDIS_URL, REDIS_HOST, REDIS_PORT,
    QUEUE_PENDING, QUEUE_REVIEW,
    SCORING_THRESHOLD, MODEL_VERSION,
)
from feature_extraction import extract_features
from rules_engine import evaluate_rules
from ml_scorer import MLScorer
from db import get_connection, update_transaction_status, insert_audit_log
from logger import log_info, log_warning, log_error, log_scoring
from prometheus_client import start_http_server, Counter, Histogram

# ─── Prometheus Metrics ──────────────────────────────────
TRANSACTIONS_SCORED = Counter('fraud_worker_transactions_scored_total', 'Total transactions scored')
TRANSACTIONS_FLAGGED = Counter('fraud_worker_transactions_flagged_total', 'Total transactions flagged')
SCORING_ERRORS = Counter('fraud_worker_scoring_errors_total', 'Total scoring errors')
SCORING_LATENCY = Histogram('fraud_worker_scoring_latency_seconds', 'Latency of scoring pipeline', buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0])


# ─── Globals ─────────────────────────────────────────────
_running = True
# ─── Connect to Redis (TLS on Render, plain TCP locally) ─────────────────────
if REDIS_URL:
    import ssl
    _redis = redis_client.from_url(
        REDIS_URL,
        decode_responses=True,
        ssl_cert_reqs=ssl.CERT_NONE,  # Render uses self-signed certs
    )
else:
    _redis = redis_client.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
_scorer = MLScorer()
_db_conn = None

# Counters
_stats = {
    'total_scored': 0,
    'total_flagged': 0,
    'total_approved': 0,
    'total_errors': 0,
    'start_time': time.time(),
}


def handle_shutdown(signum, frame):
    """Graceful shutdown handler."""
    global _running
    log_info('shutdown_signal_received', signal=signum)
    _running = False


def get_db():
    """Get or create a database connection with auto-reconnect."""
    global _db_conn
    try:
        if _db_conn is None or _db_conn.closed:
            _db_conn = get_connection()
            log_info('database_connected')
    except Exception as e:
        log_error('database_connection_failed', error=str(e))
        _db_conn = None
        raise
    return _db_conn


def process_transaction(raw_data):
    """
    Score a single transaction through the full pipeline.

    Pipeline: Parse → Extract Features → Rules Engine → ML Model → Decide → Persist

    Args:
        raw_data: JSON string from Redis

    Returns:
        dict with scoring result, or None on error
    """
    start_time = time.time()

    # 1. Parse transaction
    try:
        transaction = json.loads(raw_data)
        txn_id = transaction['id']
    except (json.JSONDecodeError, KeyError) as e:
        log_error('invalid_transaction_data', error=str(e))
        _stats['total_errors'] += 1
        return None

    log_info('scoring_started', transaction_id=txn_id[:8], amount=transaction.get('amount'))

    try:
        conn = get_db()

        # 2. Extract features
        features = extract_features(transaction)

        # 3. Run rules engine
        triggered_rules, rules_results, any_rule_fired = evaluate_rules(features)

        # 4. Run ML models
        ml_result = _scorer.score(features)

        # 5. Decision logic
        # Flag if: any rule fired OR ML combined score >= threshold
        is_flagged = any_rule_fired or ml_result['ml_flagged']
        decision = 'flagged' if is_flagged else 'approved'
        combined_score = ml_result['combined_score']

        # 6. Persist decision
        update_transaction_status(
            conn, txn_id, decision, combined_score, triggered_rules
        )

        # 7. If flagged, push to review queue
        if is_flagged:
            _redis.lpush(QUEUE_REVIEW, json.dumps({
                'transaction_id': txn_id,
                'amount': transaction.get('amount'),
                'card_hash': transaction.get('card_hash'),
                'combined_score': combined_score,
                'rules_triggered': triggered_rules,
                'flagged_at': time.time(),
            }))

        # 8. Audit log
        scoring_time_ms = int((time.time() - start_time) * 1000)
        insert_audit_log(
            conn, txn_id,
            feature_vector=features,
            rules_results=rules_results,
            if_score=ml_result['if_score'],
            lr_score=ml_result['lr_score'],
            combined_score=combined_score,
            threshold=SCORING_THRESHOLD,
            decision=decision,
            model_version=MODEL_VERSION,
            scoring_time_ms=scoring_time_ms,
        )

        # 9. Update stats
        _stats['total_scored'] += 1
        TRANSACTIONS_SCORED.inc()
        if is_flagged:
            _stats['total_flagged'] += 1
            TRANSACTIONS_FLAGGED.inc()
        else:
            _stats['total_approved'] += 1

        SCORING_LATENCY.observe(time.time() - start_time)

        # Structured scoring log
        log_scoring(txn_id[:8], decision, combined_score, triggered_rules, scoring_time_ms)

        return {
            'transaction_id': txn_id,
            'decision': decision,
            'combined_score': combined_score,
            'rules_triggered': triggered_rules,
            'scoring_time_ms': scoring_time_ms,
        }

    except Exception as e:
        log_error('scoring_error', transaction_id=txn_id[:8], error=str(e))
        _stats['total_errors'] += 1
        SCORING_ERRORS.inc()
        # Try to reconnect on next iteration
        global _db_conn
        _db_conn = None
        return None


def log_stats():
    """Log worker statistics as structured JSON."""
    uptime = time.time() - _stats['start_time']
    rate = _stats['total_scored'] / max(uptime, 1)
    flag_rate = _stats['total_flagged'] / max(_stats['total_scored'], 1) * 100

    log_info('worker_stats',
        uptime_seconds=round(uptime, 0),
        rate_per_second=round(rate, 1),
        total_scored=_stats['total_scored'],
        total_flagged=_stats['total_flagged'],
        total_approved=_stats['total_approved'],
        total_errors=_stats['total_errors'],
        flag_rate_pct=round(flag_rate, 1),
    )


def main():
    """Main worker loop — BRPOP from Redis, score, decide, persist."""
    global _running

    # Start Prometheus metrics server on port 8000
    try:
        start_http_server(8000)
        log_info('prometheus_metrics_started', port=8000)
    except Exception as e:
        log_error('prometheus_metrics_failed', error=str(e))

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    log_info('worker_started',
        redis=f"{REDIS_HOST}:{REDIS_PORT}",
        queue=QUEUE_PENDING,
        threshold=SCORING_THRESHOLD,
        model_version=MODEL_VERSION,
    )

    print(f"\n{'='*60}")
    print(f"  Fraud Scoring Worker")
    print(f"  Redis: {REDIS_HOST}:{REDIS_PORT}")
    print(f"  Queue: {QUEUE_PENDING}")
    print(f"  Threshold: {SCORING_THRESHOLD}")
    print(f"  Model Version: {MODEL_VERSION}")
    print(f"{'='*60}\n")
    print("[Worker] Waiting for transactions...\n")

    last_stats_time = time.time()

    while _running:
        try:
            # BRPOP blocks until a message is available (5s timeout for shutdown check)
            result = _redis.brpop(QUEUE_PENDING, timeout=5)

            if result is None:
                # Timeout — no messages, check if we should log stats
                if time.time() - last_stats_time > 60:
                    log_stats()
                    last_stats_time = time.time()
                continue

            _, raw_data = result
            process_transaction(raw_data)

            # Log stats every 100 transactions
            if _stats['total_scored'] % 100 == 0 and _stats['total_scored'] > 0:
                log_stats()

        except redis_client.ConnectionError as e:
            log_error('redis_connection_error', error=str(e))
            time.sleep(5)

        except KeyboardInterrupt:
            log_info('interrupted_by_user')
            break

        except Exception as e:
            log_error('unexpected_error', error=str(e))
            _stats['total_errors'] += 1
            time.sleep(1)

    # Final stats
    log_stats()
    log_info('worker_shutdown_complete')

    # Cleanup
    if _db_conn and not _db_conn.closed:
        _db_conn.close()


if __name__ == '__main__':
    main()
