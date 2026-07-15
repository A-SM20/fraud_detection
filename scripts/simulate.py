"""
Transaction Simulator — End-to-End Test Script.

Generates realistic-looking transactions and submits them to the API.
Includes a mix of normal and suspicious patterns to exercise the scoring pipeline.

Usage:
    python scripts/simulate.py [--count N] [--api-url URL]
"""

import argparse
import json
import random
import time
import hashlib
import requests
from datetime import datetime, timezone

API_URL = "http://localhost:3000/api/transactions"

# Simulated card pool
CARDS = [hashlib.sha256(f"card_{i}".encode()).hexdigest()[:16] for i in range(20)]

# Merchant categories
CATEGORIES = [
    'grocery', 'restaurant', 'gas_station', 'online_retail',
    'electronics', 'travel', 'entertainment', 'healthcare',
    'clothing', 'atm_withdrawal',
]

# Cities with coordinates
CITIES = [
    ('New York', 40.7128, -74.0060, 'US'),
    ('Los Angeles', 34.0522, -118.2437, 'US'),
    ('Chicago', 41.8781, -87.6298, 'US'),
    ('Houston', 29.7604, -95.3698, 'US'),
    ('London', 51.5074, -0.1278, 'GB'),
    ('Tokyo', 35.6762, 139.6503, 'JP'),
    ('Paris', 48.8566, 2.3522, 'FR'),
    ('Sydney', -33.8688, 151.2093, 'AU'),
]


def generate_normal_transaction():
    """Generate a normal, legitimate-looking transaction."""
    city = random.choice(CITIES[:4])  # US cities only
    return {
        'card_hash': random.choice(CARDS),
        'amount': round(random.uniform(5, 500), 2),
        'currency': 'USD',
        'merchant_id': f'merchant_{random.randint(1, 100)}',
        'merchant_category': random.choice(CATEGORIES),
        'latitude': city[1] + random.uniform(-0.5, 0.5),
        'longitude': city[2] + random.uniform(-0.5, 0.5),
        'country': city[3],
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


def generate_high_amount_transaction():
    """Generate a suspiciously high-amount transaction."""
    txn = generate_normal_transaction()
    txn['amount'] = round(random.uniform(5000, 25000), 2)
    return txn


def generate_geo_mismatch_transaction():
    """Generate a transaction with impossible travel (geo mismatch)."""
    card = random.choice(CARDS[:3])
    foreign_city = random.choice(CITIES[4:])  # Non-US cities
    return {
        'card_hash': card,
        'amount': round(random.uniform(100, 2000), 2),
        'currency': 'USD',
        'merchant_id': f'merchant_{random.randint(1, 100)}',
        'merchant_category': random.choice(CATEGORIES),
        'latitude': foreign_city[1],
        'longitude': foreign_city[2],
        'country': foreign_city[3],
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }


def generate_velocity_burst(card_hash, count=8):
    """Generate a burst of rapid transactions from the same card."""
    txns = []
    city = random.choice(CITIES[:4])
    for _ in range(count):
        txns.append({
            'card_hash': card_hash,
            'amount': round(random.uniform(50, 300), 2),
            'currency': 'USD',
            'merchant_id': f'merchant_{random.randint(1, 100)}',
            'merchant_category': random.choice(['online_retail', 'atm_withdrawal']),
            'latitude': city[1] + random.uniform(-0.1, 0.1),
            'longitude': city[2] + random.uniform(-0.1, 0.1),
            'country': city[3],
            'timestamp': datetime.now(timezone.utc).isoformat(),
        })
    return txns


def submit_transaction(txn, api_url, api_key=None):
    """Submit a transaction to the API."""
    try:
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['x-api-key'] = api_key
            
        resp = requests.post(api_url, json=txn, headers=headers, timeout=5)
        data = resp.json()
        status = '✓' if resp.status_code == 202 else '✗'
        print(f"  {status} ${txn['amount']:>10,.2f} | {txn['card_hash'][:10]}… | {txn.get('merchant_category', ''):>15} | {data.get('transaction_id', 'error')[:8]}…")
        return resp.status_code == 202
    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Fraud Pipeline Transaction Simulator')
    parser.add_argument('--count', type=int, default=50, help='Number of transactions to generate')
    parser.add_argument('--api-url', type=str, default=API_URL, help='API endpoint URL')
    parser.add_argument('--api-key', type=str, default=None, help='API key for authentication')
    parser.add_argument('--delay', type=float, default=0.1, help='Delay between transactions (seconds)')
    args = parser.parse_args()

    print("=" * 70)
    print("  Fraud Pipeline — Transaction Simulator")
    print(f"  Target: {args.api_url}")
    print(f"  Count:  {args.count}")
    print("=" * 70)

    success = 0
    failed = 0

    # Phase 1: Normal transactions (70%)
    normal_count = int(args.count * 0.7)
    print(f"\n── Phase 1: {normal_count} Normal Transactions ──")
    for _ in range(normal_count):
        txn = generate_normal_transaction()
        if submit_transaction(txn, args.api_url, args.api_key):
            success += 1
        else:
            failed += 1
        time.sleep(args.delay)

    # Phase 2: High amount (10%)
    high_amt_count = int(args.count * 0.1)
    print(f"\n── Phase 2: {high_amt_count} High-Amount Transactions ──")
    for _ in range(high_amt_count):
        txn = generate_high_amount_transaction()
        if submit_transaction(txn, args.api_url, args.api_key):
            success += 1
        else:
            failed += 1
        time.sleep(args.delay)

    # Phase 3: Geo mismatch (10%)
    geo_count = int(args.count * 0.1)
    print(f"\n── Phase 3: {geo_count} Geo-Mismatch Transactions ──")
    for _ in range(geo_count):
        txn = generate_geo_mismatch_transaction()
        if submit_transaction(txn, args.api_url, args.api_key):
            success += 1
        else:
            failed += 1
        time.sleep(args.delay)

    # Phase 4: Velocity burst (10%)
    burst_count = int(args.count * 0.1)
    print(f"\n── Phase 4: {burst_count} Velocity-Burst Transactions ──")
    burst_card = random.choice(CARDS[:3])
    burst_txns = generate_velocity_burst(burst_card, burst_count)
    for txn in burst_txns:
        if submit_transaction(txn, args.api_url, args.api_key):
            success += 1
        else:
            failed += 1
        time.sleep(0.05)  # Very rapid

    # Summary
    print(f"\n{'=' * 70}")
    print(f"  Results: {success} succeeded, {failed} failed ({success + failed} total)")
    print(f"{'=' * 70}")

    # We don't fetch stats here because the /stats endpoint requires dashboard JWT auth.
    print(f"\n✅ Simulation complete! Check your dashboard to view the incoming transactions.")


if __name__ == '__main__':
    main()
