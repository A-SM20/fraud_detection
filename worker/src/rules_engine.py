"""
Rules engine module.

Deterministic rules that always flag a transaction regardless of ML score.
These act as a safety net for obvious fraud patterns.
"""


# ─── Rule Definitions ────────────────────────────────────────
# Each rule is a tuple of (name, description, predicate function).
# Predicate takes a feature dict and returns True if the rule fires (= suspicious).

RULES = [
    (
        'high_velocity_1h',
        'More than 5 transactions in the last hour',
        lambda f: f['velocity_1h'] > 5
    ),
    (
        'very_high_velocity_24h',
        'More than 30 transactions in the last 24 hours',
        lambda f: f['velocity_24h'] > 30
    ),
    (
        'high_amount',
        'Single transaction exceeds $5,000',
        lambda f: f['amount'] > 5000
    ),
    (
        'very_high_amount',
        'Single transaction exceeds $10,000',
        lambda f: f['amount'] > 10000
    ),
    (
        'geo_mismatch',
        'Location >500km from last transaction within 1 hour',
        lambda f: f['geo_distance_km'] > 500 and f['time_since_last_txn'] < 3600
    ),
    (
        'impossible_travel',
        'Travel speed implies >900 km/h (faster than commercial flights)',
        lambda f: f['speed_kmh'] > 900
    ),
    (
        'rapid_fire',
        'Less than 30 seconds since last transaction',
        lambda f: f['time_since_last_txn'] < 30 and f['velocity_1h'] > 1
    ),
    (
        'late_night_high_amount',
        'Transaction >$1,000 between midnight and 5 AM',
        # hour_sin < -0.5 roughly corresponds to hours 18-6, combined with hour_cos
        # We use a simpler check: if hour_cos > 0.5 (roughly 0-4 AM) and amount > 1000
        lambda f: f['hour_cos'] > 0.5 and f['hour_sin'] < 0 and f['amount'] > 1000
    ),
]


def evaluate_rules(features):
    """
    Run all rules against a feature vector.

    Args:
        features: dict of feature name → value

    Returns:
        tuple of:
            - triggered: list of rule names that fired
            - results: dict of {rule_name: bool} for all rules (for audit)
            - any_triggered: bool, True if at least one rule fired
    """
    triggered = []
    results = {}

    for name, _description, predicate in RULES:
        try:
            fired = predicate(features)
        except Exception:
            fired = False

        results[name] = fired
        if fired:
            triggered.append(name)

    return triggered, results, len(triggered) > 0


def get_rule_descriptions():
    """Return a dict of rule_name → description for documentation/UI."""
    return {name: desc for name, desc, _ in RULES}
