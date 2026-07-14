-- ============================================
-- Fraud Pipeline — Initial Schema Migration
-- ============================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- Core transaction table
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_hash         VARCHAR(64)    NOT NULL,
    amount            DECIMAL(12,2)  NOT NULL,
    currency          VARCHAR(3)     DEFAULT 'USD',
    merchant_id       VARCHAR(64),
    merchant_category VARCHAR(32),
    latitude          DECIMAL(9,6),
    longitude         DECIMAL(9,6),
    country           VARCHAR(3),
    timestamp         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    
    -- Status lifecycle: pending → approved | flagged → approved_after_review | rejected
    status            VARCHAR(24)    NOT NULL DEFAULT 'pending',
    
    -- Scoring metadata
    rules_triggered   TEXT[],
    ml_score          DECIMAL(5,4),
    scored_at         TIMESTAMPTZ,
    
    -- Review metadata (populated by analyst)
    reviewed_by       VARCHAR(64),
    reviewed_at       TIMESTAMPTZ,
    review_notes      TEXT,

    created_at        TIMESTAMPTZ    DEFAULT NOW(),
    updated_at        TIMESTAMPTZ    DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_txn_status       ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_txn_card_hash    ON transactions(card_hash);
CREATE INDEX IF NOT EXISTS idx_txn_timestamp    ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_txn_flagged      ON transactions(status, scored_at)
    WHERE status = 'flagged';
CREATE INDEX IF NOT EXISTS idx_txn_ml_score     ON transactions(ml_score DESC)
    WHERE status = 'flagged';

-- ============================================
-- Scoring audit log — full reproducibility
-- ============================================
CREATE TABLE IF NOT EXISTS scoring_audit_log (
    id               BIGSERIAL PRIMARY KEY,
    transaction_id   UUID           NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    feature_vector   JSONB          NOT NULL,
    rules_results    JSONB          NOT NULL,
    if_score         DECIMAL(5,4),
    lr_score         DECIMAL(5,4),
    combined_score   DECIMAL(5,4),
    threshold_used   DECIMAL(5,4),
    decision         VARCHAR(16)    NOT NULL,
    model_version    VARCHAR(32)    NOT NULL,
    scoring_time_ms  INTEGER,
    created_at       TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_txn_id ON scoring_audit_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON scoring_audit_log(created_at DESC);

-- ============================================
-- Helper: auto-update updated_at on row change
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
