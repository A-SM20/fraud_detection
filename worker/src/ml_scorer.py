"""
ML Scorer module.

Loads pre-trained Isolation Forest and Logistic Regression models,
performs inference, and combines scores into a single fraud probability.

Falls back to rules-only scoring if models are not available.
"""

import os
import numpy as np
import joblib
from config import (
    ISOLATION_FOREST_PATH,
    LOGISTIC_REGRESSION_PATH,
    IF_WEIGHT,
    LR_WEIGHT,
    SCORING_THRESHOLD,
)


# Feature ordering expected by the ML models
# Must match the order used during training
ML_FEATURE_ORDER = [
    'log_amount',
    'velocity_1h',
    'velocity_24h',
    'time_since_last_txn',
    'geo_distance_km',
    'speed_kmh',
    'hour_sin',
    'hour_cos',
    'is_foreign',
]


class MLScorer:
    """
    Loads and manages the ML models for fraud scoring.
    Provides a single `score()` method that returns individual and combined scores.
    """

    def __init__(self):
        self.isolation_forest = None
        self.logistic_regression = None
        self._load_models()

    def _load_models(self):
        """Load models from disk. Gracefully handles missing models."""
        if os.path.exists(ISOLATION_FOREST_PATH):
            try:
                self.isolation_forest = joblib.load(ISOLATION_FOREST_PATH)
                print(f"[MLScorer] Loaded Isolation Forest from {ISOLATION_FOREST_PATH}")
            except Exception as e:
                print(f"[MLScorer] Failed to load Isolation Forest: {e}")
        else:
            print(f"[MLScorer] Isolation Forest not found at {ISOLATION_FOREST_PATH}")

        if os.path.exists(LOGISTIC_REGRESSION_PATH):
            try:
                self.logistic_regression = joblib.load(LOGISTIC_REGRESSION_PATH)
                print(f"[MLScorer] Loaded Logistic Regression from {LOGISTIC_REGRESSION_PATH}")
            except Exception as e:
                print(f"[MLScorer] Failed to load Logistic Regression: {e}")
        else:
            print(f"[MLScorer] Logistic Regression not found at {LOGISTIC_REGRESSION_PATH}")

        if not self.isolation_forest and not self.logistic_regression:
            print("[MLScorer] WARNING: No ML models loaded! Using rules-only scoring.")

    def _features_to_array(self, features):
        """
        Convert feature dict to a numpy array in the expected order.

        Args:
            features: dict of feature name → value

        Returns:
            numpy array of shape (1, n_features)
        """
        values = [float(features.get(f, 0.0)) for f in ML_FEATURE_ORDER]
        return np.array([values])

    def score(self, features):
        """
        Score a transaction using the loaded ML models.

        Args:
            features: dict of feature name → value

        Returns:
            dict with keys:
                - if_score: float or None (Isolation Forest anomaly score, 0-1)
                - lr_score: float or None (Logistic Regression fraud probability, 0-1)
                - combined_score: float (weighted combination)
                - threshold: float (decision threshold)
                - ml_flagged: bool (True if combined_score >= threshold)
        """
        X = self._features_to_array(features)

        if_score = None
        lr_score = None

        # ─── Isolation Forest ─────────────────────────────
        if self.isolation_forest is not None:
            try:
                # decision_function returns negative scores for anomalies
                # We normalize: more negative = more anomalous → higher fraud score
                raw_score = self.isolation_forest.decision_function(X)[0]
                # Convert to 0-1 range (sigmoid-like normalization)
                # Typical range is [-0.5, 0.5], anomalies are negative
                if_score = 1.0 / (1.0 + np.exp(5 * raw_score))  # steeper sigmoid
                if_score = float(np.clip(if_score, 0.0, 1.0))
            except Exception as e:
                print(f"[MLScorer] IF scoring error: {e}")

        # ─── Logistic Regression ──────────────────────────
        if self.logistic_regression is not None:
            try:
                # predict_proba returns [P(class=0), P(class=1)]
                lr_score = float(self.logistic_regression.predict_proba(X)[0][1])
            except Exception as e:
                print(f"[MLScorer] LR scoring error: {e}")

        # ─── Combine scores ──────────────────────────────
        if if_score is not None and lr_score is not None:
            combined = IF_WEIGHT * if_score + LR_WEIGHT * lr_score
        elif lr_score is not None:
            combined = lr_score
        elif if_score is not None:
            combined = if_score
        else:
            # No models available — return neutral score
            # Rules engine will still catch obvious fraud
            combined = 0.0

        combined = float(np.clip(combined, 0.0, 1.0))

        return {
            'if_score': round(if_score, 4) if if_score is not None else None,
            'lr_score': round(lr_score, 4) if lr_score is not None else None,
            'combined_score': round(combined, 4),
            'threshold': SCORING_THRESHOLD,
            'ml_flagged': combined >= SCORING_THRESHOLD,
        }
