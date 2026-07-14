"""
Unit tests for the rules engine.

Tests each individual rule to ensure it fires correctly
under specific conditions, and verifies the evaluate_rules() function.
"""

import sys
import os
import pytest

# Add worker src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from rules_engine import evaluate_rules, get_rule_descriptions, RULES


# ─── Base Feature Vector (normal transaction) ──────────────
def normal_features():
    """Return a feature vector for a normal, non-suspicious transaction."""
    return {
        'amount': 50.0,
        'log_amount': 3.93,
        'velocity_1h': 1.0,
        'velocity_24h': 3.0,
        'time_since_last_txn': 7200.0,  # 2 hours
        'geo_distance_km': 10.0,
        'speed_kmh': 5.0,
        'hour_sin': 0.0,
        'hour_cos': -1.0,  # noon
        'is_foreign': 0.0,
    }


class TestIndividualRules:
    """Test each rule in isolation."""

    def test_normal_transaction_triggers_no_rules(self):
        features = normal_features()
        triggered, results, any_fired = evaluate_rules(features)
        assert any_fired is False
        assert len(triggered) == 0

    def test_high_velocity_1h(self):
        features = normal_features()
        features['velocity_1h'] = 6  # >5 triggers
        triggered, _, any_fired = evaluate_rules(features)
        assert any_fired is True
        assert 'high_velocity_1h' in triggered

    def test_high_velocity_1h_boundary(self):
        """Exactly 5 should NOT trigger (rule is > 5)."""
        features = normal_features()
        features['velocity_1h'] = 5
        triggered, _, any_fired = evaluate_rules(features)
        assert 'high_velocity_1h' not in triggered

    def test_very_high_velocity_24h(self):
        features = normal_features()
        features['velocity_24h'] = 31  # >30 triggers
        triggered, _, _ = evaluate_rules(features)
        assert 'very_high_velocity_24h' in triggered

    def test_high_amount(self):
        features = normal_features()
        features['amount'] = 5001  # >5000 triggers
        triggered, _, _ = evaluate_rules(features)
        assert 'high_amount' in triggered

    def test_high_amount_boundary(self):
        """Exactly 5000 should NOT trigger."""
        features = normal_features()
        features['amount'] = 5000
        triggered, _, _ = evaluate_rules(features)
        assert 'high_amount' not in triggered

    def test_very_high_amount(self):
        features = normal_features()
        features['amount'] = 15000  # >10000 triggers both rules
        triggered, _, _ = evaluate_rules(features)
        assert 'very_high_amount' in triggered
        assert 'high_amount' in triggered  # Both should fire

    def test_geo_mismatch(self):
        features = normal_features()
        features['geo_distance_km'] = 600  # >500km
        features['time_since_last_txn'] = 1800  # <3600s (within 1 hour)
        triggered, _, _ = evaluate_rules(features)
        assert 'geo_mismatch' in triggered

    def test_geo_mismatch_no_trigger_if_old(self):
        """Distance >500km but >1 hour since last txn — should NOT trigger."""
        features = normal_features()
        features['geo_distance_km'] = 600
        features['time_since_last_txn'] = 7200  # 2 hours
        triggered, _, _ = evaluate_rules(features)
        assert 'geo_mismatch' not in triggered

    def test_impossible_travel(self):
        features = normal_features()
        features['speed_kmh'] = 1000  # >900 km/h
        triggered, _, _ = evaluate_rules(features)
        assert 'impossible_travel' in triggered

    def test_rapid_fire(self):
        features = normal_features()
        features['time_since_last_txn'] = 10  # <30 seconds
        features['velocity_1h'] = 2  # >1
        triggered, _, _ = evaluate_rules(features)
        assert 'rapid_fire' in triggered

    def test_rapid_fire_no_trigger_first_txn(self):
        """Rapid fire should not trigger if it's the first transaction (velocity_1h = 0)."""
        features = normal_features()
        features['time_since_last_txn'] = 10
        features['velocity_1h'] = 0
        triggered, _, _ = evaluate_rules(features)
        assert 'rapid_fire' not in triggered

    def test_late_night_high_amount(self):
        import math
        features = normal_features()
        features['amount'] = 1500  # >1000
        # Simulate 2 AM: hour=2, hour_sin = sin(2*pi*2/24) ≈ 0.5, hour_cos = cos(2*pi*2/24) ≈ 0.87
        features['hour_sin'] = math.sin(2 * math.pi * 2 / 24)  # ~0.5
        features['hour_cos'] = math.cos(2 * math.pi * 2 / 24)  # ~0.87
        # Rule requires hour_cos > 0.5 AND hour_sin < 0 — but at 2 AM, hour_sin > 0
        # Let's use hour 22 (10 PM): hour_sin = sin(2*pi*22/24) ≈ -0.5, hour_cos = cos(2*pi*22/24) ≈ 0.87
        features['hour_sin'] = math.sin(2 * math.pi * 22 / 24)
        features['hour_cos'] = math.cos(2 * math.pi * 22 / 24)
        triggered, _, _ = evaluate_rules(features)
        assert 'late_night_high_amount' in triggered


class TestEvaluateRules:
    """Test the evaluate_rules function behavior."""

    def test_returns_correct_structure(self):
        features = normal_features()
        triggered, results, any_fired = evaluate_rules(features)
        assert isinstance(triggered, list)
        assert isinstance(results, dict)
        assert isinstance(any_fired, bool)

    def test_results_contains_all_rules(self):
        features = normal_features()
        _, results, _ = evaluate_rules(features)
        rule_names = [name for name, _, _ in RULES]
        for name in rule_names:
            assert name in results

    def test_multiple_rules_can_fire(self):
        """A single transaction can trigger multiple rules."""
        features = normal_features()
        features['amount'] = 15000  # triggers high_amount AND very_high_amount
        features['velocity_1h'] = 10  # triggers high_velocity_1h
        triggered, _, any_fired = evaluate_rules(features)
        assert any_fired is True
        assert len(triggered) >= 3

    def test_exception_in_rule_does_not_crash(self):
        """If a feature is missing, rule should not crash."""
        features = {}  # Empty features dict
        triggered, results, any_fired = evaluate_rules(features)
        # Should not raise, all rules should return False due to KeyError
        assert isinstance(triggered, list)


class TestGetRuleDescriptions:
    """Test the get_rule_descriptions helper."""

    def test_returns_all_rules(self):
        descs = get_rule_descriptions()
        assert len(descs) == len(RULES)
        for name, desc in descs.items():
            assert isinstance(name, str)
            assert isinstance(desc, str)
            assert len(desc) > 0
