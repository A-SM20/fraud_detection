const Redis = require('ioredis');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  },
};

const redis = new Redis(redisConfig);

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
 * @param {object} transaction
 * @returns {Promise<number>} queue length after push
 */
async function enqueuePending(transaction) {
  return redis.lpush(QUEUES.PENDING, JSON.stringify(transaction));
}

/**
 * Get current pending queue depth.
 * @returns {Promise<number>}
 */
async function getPendingDepth() {
  return redis.llen(QUEUES.PENDING);
}

/**
 * Get current review queue depth.
 * @returns {Promise<number>}
 */
async function getReviewDepth() {
  return redis.llen(QUEUES.REVIEW);
}

module.exports = {
  redis,
  QUEUES,
  enqueuePending,
  getPendingDepth,
  getReviewDepth,
};
