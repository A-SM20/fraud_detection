const Redis = require('ioredis');

// Render provides REDIS_URL in rediss:// format (TLS).
// Fall back to host/port for local Docker dev.
let redis;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    tls: { rejectUnauthorized: false }, // Required for Render's self-signed Redis cert
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
    commandTimeout: 5000, // 5s timeout per command — prevent hanging
  });
} else {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: 3,
    commandTimeout: 5000,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
  });
}

redis.on('connect', () => {
  console.log('[Redis] Connected');
});

redis.on('error', (err) => {
  console.error('[Redis] Connection error:', err.message);
});

// Queue names
const QUEUES = {
  PENDING: 'pending_transactions',
  REVIEW: 'review_queue',
};

/**
 * Push a transaction onto the pending queue.
 */
async function enqueuePending(transaction) {
  return redis.lpush(QUEUES.PENDING, JSON.stringify(transaction));
}

/**
 * Get current pending queue depth. Returns 0 on error.
 */
async function getPendingDepth() {
  try {
    return await redis.llen(QUEUES.PENDING);
  } catch {
    return 0;
  }
}

/**
 * Get current review queue depth. Returns 0 on error.
 */
async function getReviewDepth() {
  try {
    return await redis.llen(QUEUES.REVIEW);
  } catch {
    return 0;
  }
}

module.exports = {
  redis,
  QUEUES,
  enqueuePending,
  getPendingDepth,
  getReviewDepth,
};
