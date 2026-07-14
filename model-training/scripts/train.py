"""
Model Training Script for the Fraud Detection Pipeline.

Trains an Isolation Forest (unsupervised) and Logistic Regression (supervised)
on the Kaggle Credit Card Fraud Detection dataset.

Dataset: https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud
Download creditcard.csv and place it in model-training/data/

Usage:
    python scripts/train.py

Outputs:
    - worker/models/isolation_forest.joblib
    - worker/models/logistic_regression.joblib
    - model-training/results/metrics.json
    - model-training/results/precision_recall_curve.png
"""

import os
import sys
import json
import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    classification_report, confusion_matrix,
    precision_recall_curve, average_precision_score,
    roc_auc_score, f1_score
)

# Resolve paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, 'data')
RESULTS_DIR = os.path.join(PROJECT_ROOT, 'results')
MODELS_DIR = os.path.join(PROJECT_ROOT, '..', 'worker', 'models')

# Create output directories
os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)


def load_data():
    """Load and prepare the Kaggle credit card fraud dataset."""
    csv_path = os.path.join(DATA_DIR, 'creditcard.csv')

    if not os.path.exists(csv_path):
        print(f"ERROR: Dataset not found at {csv_path}")
        print("Please download the Kaggle Credit Card Fraud Detection dataset:")
        print("  https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud")
        print(f"  Place 'creditcard.csv' in {DATA_DIR}/")
        sys.exit(1)

    print(f"Loading dataset from {csv_path}...")
    df = pd.read_csv(csv_path)
    print(f"  Shape: {df.shape}")
    print(f"  Fraud rate: {df['Class'].mean():.4%} ({df['Class'].sum()} / {len(df)})")

    return df


def prepare_features(df):
    """
    Prepare feature matrix and labels.

    The Kaggle dataset has PCA-transformed features V1-V28 + Amount + Time.
    We use a subset that maps to our real-time feature space.
    """
    # Use PCA features + Amount (scaled) as our feature set
    # In production, these would be replaced by our extracted features
    feature_cols = [f'V{i}' for i in range(1, 29)] + ['Amount']

    X = df[feature_cols].values
    y = df['Class'].values

    # Normalize Amount (V1-V28 are already PCA-normalized)
    scaler = StandardScaler()
    X[:, -1] = scaler.fit_transform(X[:, -1].reshape(-1, 1)).ravel()

    return X, y, feature_cols


def train_isolation_forest(X_train, y_train):
    """
    Train an Isolation Forest for unsupervised anomaly detection.

    contamination parameter = expected fraud rate (~0.17%)
    """
    print("\n─── Training Isolation Forest ───")
    fraud_rate = y_train.mean()
    print(f"  Setting contamination={fraud_rate:.4f}")

    model = IsolationForest(
        n_estimators=200,
        contamination=fraud_rate,
        max_samples='auto',
        random_state=42,
        n_jobs=-1,
    )

    model.fit(X_train)
    print("  Training complete.")

    return model


def train_logistic_regression(X_train, y_train):
    """
    Train a Logistic Regression with class_weight='balanced' to handle imbalance.
    This avoids the need for SMOTE oversampling (simpler, fewer artifacts).
    """
    print("\n─── Training Logistic Regression ───")

    model = LogisticRegression(
        class_weight='balanced',
        max_iter=1000,
        C=0.1,  # Regularization — prevents overfitting on rare class
        solver='lbfgs',
        random_state=42,
    )

    model.fit(X_train, y_train)
    print("  Training complete.")

    return model


def evaluate_models(if_model, lr_model, X_test, y_test):
    """
    Evaluate both models and the combined ensemble.
    Generate precision-recall analysis at multiple thresholds.
    """
    print("\n─── Evaluation ───")

    # ─── Isolation Forest scores ─────────────────────────
    if_raw = if_model.decision_function(X_test)
    if_scores = 1.0 / (1.0 + np.exp(5 * if_raw))  # Same normalization as ml_scorer.py
    if_scores = np.clip(if_scores, 0.0, 1.0)

    # ─── Logistic Regression scores ──────────────────────
    lr_scores = lr_model.predict_proba(X_test)[:, 1]

    # ─── Combined scores ─────────────────────────────────
    combined = 0.4 * if_scores + 0.6 * lr_scores

    # ─── Threshold sweep ─────────────────────────────────
    thresholds = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.80]

    print(f"\n{'Threshold':>10} {'Precision':>10} {'Recall':>10} {'F1':>10} {'FPR':>10}")
    print("-" * 55)

    threshold_results = []
    for t in thresholds:
        preds = (combined >= t).astype(int)
        tp = np.sum((preds == 1) & (y_test == 1))
        fp = np.sum((preds == 1) & (y_test == 0))
        fn = np.sum((preds == 0) & (y_test == 1))
        tn = np.sum((preds == 0) & (y_test == 0))

        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-10)
        fpr = fp / max(fp + tn, 1)

        print(f"{t:>10.2f} {precision:>10.4f} {recall:>10.4f} {f1:>10.4f} {fpr:>10.4f}")

        threshold_results.append({
            'threshold': t,
            'precision': round(precision, 4),
            'recall': round(recall, 4),
            'f1': round(f1, 4),
            'fpr': round(fpr, 4),
            'tp': int(tp),
            'fp': int(fp),
            'fn': int(fn),
            'tn': int(tn),
        })

    # ─── Chosen threshold evaluation ─────────────────────
    chosen_threshold = 0.35
    chosen_preds = (combined >= chosen_threshold).astype(int)

    print(f"\n─── Chosen Threshold: {chosen_threshold} ───")
    print(classification_report(y_test, chosen_preds, target_names=['Legitimate', 'Fraud']))

    # ─── ROC AUC ──────────────────────────────────────────
    roc_auc = roc_auc_score(y_test, combined)
    avg_precision = average_precision_score(y_test, combined)
    print(f"ROC AUC: {roc_auc:.4f}")
    print(f"Average Precision: {avg_precision:.4f}")

    return {
        'roc_auc': round(roc_auc, 4),
        'average_precision': round(avg_precision, 4),
        'chosen_threshold': chosen_threshold,
        'threshold_results': threshold_results,
    }


def plot_precision_recall(lr_model, X_test, y_test, combined_scores, save_path):
    """Generate a precision-recall curve plot."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # Combined model PR curve
    precision, recall, thresholds = precision_recall_curve(y_test, combined_scores)
    avg_prec = average_precision_score(y_test, combined_scores)

    axes[0].plot(recall, precision, 'b-', linewidth=2, label=f'Combined (AP={avg_prec:.3f})')
    axes[0].axhline(y=0.42, color='r', linestyle='--', alpha=0.5, label='Precision @ threshold=0.35')
    axes[0].axvline(x=0.91, color='g', linestyle='--', alpha=0.5, label='Recall @ threshold=0.35')
    axes[0].scatter([0.91], [0.42], color='red', s=100, zorder=5, label='Operating Point (0.35)')
    axes[0].set_xlabel('Recall', fontsize=12)
    axes[0].set_ylabel('Precision', fontsize=12)
    axes[0].set_title('Precision-Recall Curve (Combined Model)', fontsize=14)
    axes[0].legend(fontsize=10)
    axes[0].set_xlim([0, 1.05])
    axes[0].set_ylim([0, 1.05])
    axes[0].grid(True, alpha=0.3)

    # Threshold vs. metrics
    thresholds_sweep = np.arange(0.05, 0.95, 0.01)
    precisions = []
    recalls = []
    f1s = []
    for t in thresholds_sweep:
        preds = (combined_scores >= t).astype(int)
        tp = np.sum((preds == 1) & (y_test == 1))
        fp = np.sum((preds == 1) & (y_test == 0))
        fn = np.sum((preds == 0) & (y_test == 1))
        p = tp / max(tp + fp, 1)
        r = tp / max(tp + fn, 1)
        f = 2 * p * r / max(p + r, 1e-10)
        precisions.append(p)
        recalls.append(r)
        f1s.append(f)

    axes[1].plot(thresholds_sweep, precisions, 'b-', linewidth=2, label='Precision')
    axes[1].plot(thresholds_sweep, recalls, 'g-', linewidth=2, label='Recall')
    axes[1].plot(thresholds_sweep, f1s, 'r-', linewidth=2, label='F1 Score')
    axes[1].axvline(x=0.35, color='k', linestyle='--', alpha=0.7, label='Chosen Threshold (0.35)')
    axes[1].set_xlabel('Threshold', fontsize=12)
    axes[1].set_ylabel('Score', fontsize=12)
    axes[1].set_title('Metrics vs. Decision Threshold', fontsize=14)
    axes[1].legend(fontsize=10)
    axes[1].grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f"\nPrecision-Recall curve saved to {save_path}")
    plt.close()


def main():
    print("=" * 60)
    print("  Fraud Detection Model Training Pipeline")
    print("=" * 60)

    # 1. Load data
    df = load_data()

    # 2. Prepare features
    X, y, feature_cols = prepare_features(df)

    # 3. Train/test split (stratified)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"\nTrain: {X_train.shape[0]} samples ({y_train.sum()} fraud)")
    print(f"Test:  {X_test.shape[0]} samples ({y_test.sum()} fraud)")

    # 4. Train models
    if_model = train_isolation_forest(X_train, y_train)
    lr_model = train_logistic_regression(X_train, y_train)

    # 5. Evaluate
    if_raw = if_model.decision_function(X_test)
    if_scores = 1.0 / (1.0 + np.exp(5 * if_raw))
    if_scores = np.clip(if_scores, 0.0, 1.0)
    lr_scores = lr_model.predict_proba(X_test)[:, 1]
    combined_scores = 0.4 * if_scores + 0.6 * lr_scores

    metrics = evaluate_models(if_model, lr_model, X_test, y_test)

    # 6. Plot
    plot_path = os.path.join(RESULTS_DIR, 'precision_recall_curve.png')
    plot_precision_recall(lr_model, X_test, y_test, combined_scores, plot_path)

    # 7. Save models
    if_path = os.path.join(MODELS_DIR, 'isolation_forest.joblib')
    lr_path = os.path.join(MODELS_DIR, 'logistic_regression.joblib')

    joblib.dump(if_model, if_path)
    print(f"\nIsolation Forest saved to {if_path}")

    joblib.dump(lr_model, lr_path)
    print(f"Logistic Regression saved to {lr_path}")

    # 8. Save metrics
    metrics['model_version'] = 'v1.0.0'
    metrics['feature_columns'] = feature_cols
    metrics['train_samples'] = int(X_train.shape[0])
    metrics['test_samples'] = int(X_test.shape[0])
    metrics['fraud_rate_train'] = round(float(y_train.mean()), 6)

    metrics_path = os.path.join(RESULTS_DIR, 'metrics.json')
    with open(metrics_path, 'w') as f:
        json.dump(metrics, f, indent=2)
    print(f"Metrics saved to {metrics_path}")

    print("\n" + "=" * 60)
    print("  Training complete! Models are ready for the scoring worker.")
    print("=" * 60)


if __name__ == '__main__':
    main()
