const Redis = require('ioredis');

// Render provides REDIS_URL as an internal redis:// URL (plain TCP within same region).
// Fall back to host/port for local Docker dev.
let redisConfig;

if (process.env.REDIS_URL) {
  const url = process.env.REDIS_URL;
  const isTls = url.startsWith('rediss://');
  redisConfig = {
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    maxRetriesPerRequest: 3,
    commandTimeout: 5000,
    retryStrategy(times) {
      if (times > 5) return null; // Stop retrying after 5 attempts
      return Math.min(times * 500, 3000);
    },
  };
  // ioredis can parse a Redis URL directly
  var redis = new Redis(url, redisConfig);
} else {
  redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: 3,
    commandTimeout: 5000,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 500, 3000);
    },
  };
  var redis = new Redis(redisConfig);
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
 * Get current pending queue depth. Returns 0 on error so the app never crashes.
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
