const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { validateTransaction } = require('../middleware/validation');
const { enqueuePending } = require('../services/redis');
const { pool } = require('../services/db');

const router = express.Router();

/**
 * POST /api/transactions
 * Ingest a new transaction: validate → insert into DB as 'pending' → enqueue for scoring.
 * Returns 202 Accepted immediately (async scoring).
 */
router.post('/', validateTransaction, async (req, res) => {
  try {
    const data = req.validatedBody;
    const id = uuidv4();
    const timestamp = data.timestamp || new Date().toISOString();

    // Insert into Postgres with 'pending' status
    await pool.query(
      `INSERT INTO transactions 
        (id, card_hash, amount, currency, merchant_id, merchant_category, 
         latitude, longitude, country, timestamp, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
      [
        id,
        data.card_hash,
        data.amount,
        data.currency,
        data.merchant_id || null,
        data.merchant_category || null,
        data.latitude || null,
        data.longitude || null,
        data.country || null,
        timestamp,
      ]
    );

    // Enqueue for scoring worker
    await enqueuePending({
      id,
      card_hash: data.card_hash,
      amount: parseFloat(data.amount),
      currency: data.currency,
      merchant_id: data.merchant_id || null,
      merchant_category: data.merchant_category || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      country: data.country || null,
      timestamp,
    });

    res.status(202).json({
      message: 'Transaction accepted for scoring',
      transaction_id: id,
      status: 'pending',
    });
  } catch (err) {
    console.error('[POST /transactions] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/transactions/:id
 * Poll for transaction status and scoring result.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, card_hash, amount, currency, merchant_id, merchant_category,
              latitude, longitude, country, timestamp, status,
              rules_triggered, ml_score, scored_at,
              reviewed_by, reviewed_at, review_notes,
              created_at, updated_at
       FROM transactions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /transactions/:id] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/transactions/:id/score
 * Get full scoring audit details for a transaction.
 */
router.get('/:id/score', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT sal.*, t.status as transaction_status, t.amount, t.card_hash
       FROM scoring_audit_log sal
       JOIN transactions t ON t.id = sal.transaction_id
       WHERE sal.transaction_id = $1
       ORDER BY sal.created_at DESC
       LIMIT 1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Scoring record not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[GET /transactions/:id/score] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/transactions
 * List transactions with optional filters.
 */
router.get('/', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT id, card_hash, amount, currency, merchant_category,
             status, ml_score, rules_triggered, scored_at, created_at
      FROM transactions
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` WHERE status = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC`;
    params.push(parseInt(limit, 10));
    query += ` LIMIT $${params.length}`;
    params.push(parseInt(offset, 10));
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM transactions';
    const countParams = [];
    if (status) {
      countParams.push(status);
      countQuery += ` WHERE status = $1`;
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    console.error('[GET /transactions] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/transactions/:id/review
 * Analyst submits a review decision (approve or reject).
 */
router.patch('/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { decision, reviewed_by, notes } = req.body;

    if (!decision || !['approved_after_review', 'rejected'].includes(decision)) {
      return res.status(400).json({
        error: 'decision must be "approved_after_review" or "rejected"',
      });
    }

    if (!reviewed_by) {
      return res.status(400).json({ error: 'reviewed_by is required' });
    }

    const result = await pool.query(
      `UPDATE transactions 
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
       WHERE id = $4 AND status = 'flagged'
       RETURNING *`,
      [decision, reviewed_by, notes || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Transaction not found or not in flagged status',
      });
    }

    res.json({
      message: `Transaction ${decision}`,
      transaction: result.rows[0],
    });
  } catch (err) {
    console.error('[PATCH /transactions/:id/review] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
