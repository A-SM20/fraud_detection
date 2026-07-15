"""
Configuration module for the scoring worker.
Reads from environment variables with sensible defaults for development.
"""

import os
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env'))


# ─── Redis ────────────────────────────────────────────────
REDIS_URL = os.getenv('REDIS_URL')  # Render provides rediss:// TLS URL
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))

# ─── PostgreSQL ───────────────────────────────────────────
POSTGRES_HOST = os.getenv('POSTGRES_HOST', 'localhost')
POSTGRES_PORT = int(os.getenv('POSTGRES_PORT', '5432'))
POSTGRES_USER = os.getenv('POSTGRES_USER', 'fraud_user')
POSTGRES_PASSWORD = os.getenv('POSTGRES_PASSWORD', 'fraud_pass_dev')
POSTGRES_DB = os.getenv('POSTGRES_DB', 'fraud_pipeline')

# ─── Scoring ──────────────────────────────────────────────
SCORING_THRESHOLD = float(os.getenv('SCORING_THRESHOLD', '0.35'))
MODEL_VERSION = os.getenv('MODEL_VERSION', 'v1.0.0')

# ─── Queue Names ──────────────────────────────────────────
QUEUE_PENDING = 'pending_transactions'
QUEUE_REVIEW = 'review_queue'

# ─── Model Paths ─────────────────────────────────────────
MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', 'models')
ISOLATION_FOREST_PATH = os.path.join(MODELS_DIR, 'isolation_forest.joblib')
LOGISTIC_REGRESSION_PATH = os.path.join(MODELS_DIR, 'logistic_regression.joblib')

# ─── Model Weights ────────────────────────────────────────
# Used in combining IF and LR scores
IF_WEIGHT = 0.4
LR_WEIGHT = 0.6
