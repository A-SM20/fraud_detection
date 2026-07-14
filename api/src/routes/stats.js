const express = require('express');
const { getPendingDepth, getReviewDepth } = require('../services/redis');
const { pool } = require('../services/db');

const router = express.Router();

/**
 * GET /api/stats
 * Dashboard analytics: counts by status, queue depths, recent activity.
 */
router.get('/', async (req, res) => {
  try {
    // Transaction counts by status
    const statusCounts = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM transactions
      GROUP BY status
    `);

    // Fraud rate (flagged + rejected vs. total scored)
    const fraudRate = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('flagged', 'rejected')) as flagged_count,
        COUNT(*) FILTER (WHERE status != 'pending') as scored_count
      FROM transactions
    `);

    // Average ML score for flagged vs. approved
    const avgScores = await pool.query(`
      SELECT
        status,
        ROUND(AVG(ml_score)::numeric, 4) as avg_ml_score,
        ROUND(MIN(ml_score)::numeric, 4) as min_ml_score,
        ROUND(MAX(ml_score)::numeric, 4) as max_ml_score
      FROM transactions
      WHERE ml_score IS NOT NULL
      GROUP BY status
    `);

    // Recent scoring throughput (last hour)
    const throughput = await pool.query(`
      SELECT COUNT(*) as scored_last_hour
      FROM transactions
      WHERE scored_at > NOW() - INTERVAL '1 hour'
    `);

    // Average review time for reviewed transactions
    const reviewLatency = await pool.query(`
      SELECT
        ROUND(AVG(EXTRACT(EPOCH FROM (reviewed_at - scored_at)))::numeric, 1) as avg_review_seconds,
        COUNT(*) as reviewed_count
      FROM transactions
      WHERE reviewed_at IS NOT NULL AND scored_at IS NOT NULL
    `);

    // Queue depths
    const [pendingDepth, reviewDepth] = await Promise.all([
      getPendingDepth(),
      getReviewDepth(),
    ]);

    // Most common rules triggered
    const topRules = await pool.query(`
      SELECT unnest(rules_triggered) as rule, COUNT(*) as count
      FROM transactions
      WHERE rules_triggered IS NOT NULL AND array_length(rules_triggered, 1) > 0
      GROUP BY rule
      ORDER BY count DESC
      LIMIT 10
    `);

    // Status counts as a clean object
    const statusMap = {};
    statusCounts.rows.forEach((row) => {
      statusMap[row.status] = parseInt(row.count, 10);
    });

    const fr = fraudRate.rows[0];
    const scoredCount = parseInt(fr.scored_count, 10);
    const flaggedCount = parseInt(fr.flagged_count, 10);

    res.json({
      status_counts: statusMap,
      fraud_rate: scoredCount > 0 ? (flaggedCount / scoredCount).toFixed(4) : null,
      avg_scores: avgScores.rows,
      throughput: {
        scored_last_hour: parseInt(throughput.rows[0].scored_last_hour, 10),
      },
      review: {
        avg_review_seconds: reviewLatency.rows[0]?.avg_review_seconds
          ? parseFloat(reviewLatency.rows[0].avg_review_seconds)
          : null,
        reviewed_count: parseInt(reviewLatency.rows[0]?.reviewed_count || 0, 10),
      },
      queues: {
        pending_depth: pendingDepth,
        review_depth: reviewDepth,
      },
      top_rules_triggered: topRules.rows,
    });
  } catch (err) {
    console.error('[GET /stats] Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
