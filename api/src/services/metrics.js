/**
 * Prometheus Metrics for the API service.
 * 
 * Exposes /metrics endpoint for Prometheus scraping.
 * Tracks: HTTP request duration, request count, queue depths, active connections.
 */

const client = require('prom-client');

// Create a Registry
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// ─── Custom Metrics ──────────────────────────────────────

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const transactionsIngested = new client.Counter({
  name: 'transactions_ingested_total',
  help: 'Total number of transactions ingested',
  registers: [register],
});

const transactionsReviewed = new client.Counter({
  name: 'transactions_reviewed_total',
  help: 'Total number of transactions reviewed by analysts',
  labelNames: ['decision'],
  registers: [register],
});

const queueDepth = new client.Gauge({
  name: 'queue_depth',
  help: 'Current depth of Redis queues',
  labelNames: ['queue_name'],
  registers: [register],
});

/**
 * Express middleware to record request metrics.
 */
function metricsMiddleware(req, res, next) {
  // Skip metrics endpoint itself
  if (req.path === '/metrics') return next();

  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = req.route?.path || req.path;
    const labels = {
      method: req.method,
      route: route,
      status_code: res.statusCode,
    };
    end(labels);
    httpRequestsTotal.inc(labels);
  });

  next();
}

module.exports = {
  register,
  metricsMiddleware,
  transactionsIngested,
  transactionsReviewed,
  queueDepth,
};
