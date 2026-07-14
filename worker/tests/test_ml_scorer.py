"""
Unit tests for the ML scorer module.

Tests model loading fallback, feature-to-array conversion,
score combination logic, and threshold decisions.
"""

import sys
import os
import pytest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# Override config before importing ml_scorer
os.environ['SCORING_THRESHOLD'] = '0.35'
os.environ['MODEL_VERSION'] = 'v1.0.0-test'

from ml_scorer import MLScorer, ML_FEATURE_ORDER


def sample_features():
    """Return a sample feature dict."""
    return {
        'amount': 150.0,
        'log_amount': 5.017,
        'velocity_1h': 2.0,
        'velocity_24h': 5.0,
        'time_since_last_txn': 3600.0,
        'geo_distance_km': 50.0,
        'speed_kmh': 50.0,
        'hour_sin': 0.0,
        'hour_cos': -1.0,
        'is_foreign': 0.0,
    }


class TestMLScorer:
    """Test the MLScorer class."""

    def test_scorer_initializes_without_models(self):
        """Scorer should initialize gracefully without model files."""
        from unittest.mock import patch
        with patch('os.path.exists', return_value=False):
            scorer = MLScorer()
            assert scorer.isolation_forest is None
            assert scorer.logistic_regression is None

    def test_features_to_array_correct_order(self):
        """Feature dict should be converted to array in ML_FEATURE_ORDER."""
        scorer = MLScorer()
        features = sample_features()
        X = scorer._features_to_array(features)

        assert X.shape == (1, len(ML_FEATURE_ORDER))
        # Verify first element is log_amount
        assert X[0][0] == features['log_amount']
        # Verify last element is is_foreign
        assert X[0][-1] == features['is_foreign']

    def test_features_to_array_handles_missing(self):
        """Missing features should default to 0.0."""
        scorer = MLScorer()
        features = {'log_amount': 5.0}  # Only one feature
        X = scorer._features_to_array(features)
        assert X.shape == (1, len(ML_FEATURE_ORDER))
        assert X[0][0] == 5.0
        assert X[0][1] == 0.0  # Missing velocity_1h → 0.0

    def test_score_without_models_returns_zero(self):
        """Without loaded models, combined score should be 0.0."""
        scorer = MLScorer()
        result = scorer.score(sample_features())
        assert result['if_score'] is None
        assert result['lr_score'] is None
        assert result['combined_score'] == 0.0
        assert result['ml_flagged'] is False
        assert result['threshold'] == 0.35

    def test_score_returns_correct_structure(self):
        """Score result should have all expected keys."""
        scorer = MLScorer()
        result = scorer.score(sample_features())
        assert 'if_score' in result
        assert 'lr_score' in result
        assert 'combined_score' in result
        assert 'threshold' in result
        assert 'ml_flagged' in result

    def test_score_combined_is_bounded(self):
        """Combined score must be between 0 and 1."""
        scorer = MLScorer()
        result = scorer.score(sample_features())
        assert 0.0 <= result['combined_score'] <= 1.0


class TestFeatureOrder:
    """Test that ML_FEATURE_ORDER matches expectations."""

    def test_feature_order_length(self):
        assert len(ML_FEATURE_ORDER) == 9

    def test_feature_order_contents(self):
        expected = [
            'log_amount', 'velocity_1h', 'velocity_24h',
            'time_since_last_txn', 'geo_distance_km', 'speed_kmh',
            'hour_sin', 'hour_cos', 'is_foreign'
        ]
        assert ML_FEATURE_ORDER == expected

    def test_no_duplicate_features(self):
        assert len(ML_FEATURE_ORDER) == len(set(ML_FEATURE_ORDER))
