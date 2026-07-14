"""
Database operations for the scoring worker.
Uses psycopg2 for PostgreSQL access.
"""

import psycopg2
import psycopg2.extras
import json
from config import (
    POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER,
    POSTGRES_PASSWORD, POSTGRES_DB
)


def get_connection():
    """Create a new database connection."""
    return psycopg2.connect(
        host=POSTGRES_HOST,
        port=POSTGRES_PORT,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        database=POSTGRES_DB
    )


def update_transaction_status(conn, txn_id, status, ml_score, rules_triggered):
    """
    Update a transaction's status after scoring.

    Args:
        conn: psycopg2 connection
        txn_id: UUID string
        status: 'approved' or 'flagged'
        ml_score: float, combined model score
        rules_triggered: list of rule names that fired
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE transactions
            SET status = %s,
                ml_score = %s,
                rules_triggered = %s,
                scored_at = NOW()
            WHERE id = %s
            """,
            (status, ml_score, rules_triggered, txn_id)
        )
    conn.commit()


def insert_audit_log(conn, txn_id, feature_vector, rules_results,
                     if_score, lr_score, combined_score, threshold,
                     decision, model_version, scoring_time_ms):
    """
    Insert a scoring audit record for compliance and reproducibility.

    Args:
        conn: psycopg2 connection
        txn_id: UUID string
        feature_vector: dict of all features used
        rules_results: dict of {rule_name: bool}
        if_score: float, isolation forest anomaly score
        lr_score: float, logistic regression probability
        combined_score: float, weighted combination
        threshold: float, decision threshold used
        decision: 'approved' or 'flagged'
        model_version: string, model version identifier
        scoring_time_ms: int, total scoring time in milliseconds
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO scoring_audit_log
                (transaction_id, feature_vector, rules_results,
                 if_score, lr_score, combined_score, threshold_used,
                 decision, model_version, scoring_time_ms)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                txn_id,
                json.dumps(feature_vector),
                json.dumps(rules_results),
                if_score,
                lr_score,
                combined_score,
                threshold,
                decision,
                model_version,
                scoring_time_ms
            )
        )
    conn.commit()


def get_card_history(conn, card_hash, limit=100):
    """
    Fetch recent transaction history for a card (used for feature computation).

    Args:
        conn: psycopg2 connection
        card_hash: string
        limit: max rows to return

    Returns:
        list of dicts with amount, latitude, longitude, timestamp
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT amount, latitude, longitude, timestamp
            FROM transactions
            WHERE card_hash = %s AND status != 'pending'
            ORDER BY timestamp DESC
            LIMIT %s
            """,
            (card_hash, limit)
        )
        return cur.fetchall()
