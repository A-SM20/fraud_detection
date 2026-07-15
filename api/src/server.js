require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

// Services
const logger = require('./services/logger');
const { redis, getPendingDepth, getReviewDepth } = require('./services/redis');
const { pool, initDb } = require('./services/db');
const { register, metricsMiddleware, queueDepth } = require('./services/metrics');

// Routes
const transactionsRouter = require('./routes/transactions');
const statsRouter = require('./routes/stats');
const authRouter = require('./routes/auth');

// Middleware
const { authenticateApiKey, authenticateJWT } = require('./middleware/auth');

const app = express();
const PORT = parseInt(process.env.API_PORT || '3000', 10);

// Trust Render's reverse proxy (required for express-rate-limit + correct req.ip)
app.set('trust proxy', 1);

// ─── Security Middleware ─────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Dashboard serves its own CSP
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));
app.use(express.json({ limit: '1mb' }));

// ─── Rate Limiting ───────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
  handler: (req, res, _next, options) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(options.statusCode).json(options.message);
  },
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000, // Higher limit for transaction ingestion
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Ingestion rate limit exceeded' },
});

app.use('/api/', apiLimiter);

// ─── Request ID + Structured Logging ─────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', req.id);

  // Skip health and metrics endpoints from logs
  if (req.path !== '/health' && req.path !== '/metrics') {
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 100),
    });
  }

  next();
});

// ─── Prometheus Metrics ──────────────────────────────────
app.use(metricsMiddleware);

// ─── Routes ──────────────────────────────────────────────

// Public — no auth
app.use('/api/auth', authRouter);

// Transactions — POST uses API key (machine ingestion), all other methods use JWT (dashboard)
function transactionAuth(req, res, next) {
  if (req.method === 'POST') {
    return authenticateApiKey(req, res, next);
  }
  return authenticateJWT(req, res, next);
}
app.use('/api/transactions', transactionAuth, transactionsRouter);

// Stats — JWT auth for dashboard
app.use('/api/stats', authenticateJWT, statsRouter);

// ─── Prometheus Metrics Endpoint ─────────────────────────
app.get('/metrics', async (_req, res) => {
  try {
    // Update queue depths before reporting
    const [pending, review] = await Promise.all([
      getPendingDepth(),
      getReviewDepth(),
    ]);
    queueDepth.set({ queue_name: 'pending' }, pending);
    queueDepth.set({ queue_name: 'review' }, review);

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health Check ────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const redisPing = await redis.ping();
    const pgResult = await pool.query('SELECT 1');
    const [pendingDepth, reviewDepth] = await Promise.all([
      getPendingDepth(),
      getReviewDepth(),
    ]);

    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      services: {
        redis: redisPing === 'PONG' ? 'connected' : 'error',
        postgres: pgResult.rows.length > 0 ? 'connected' : 'error',
      },
      queues: {
        pending: pendingDepth,
        review: reviewDepth,
      },
    });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
    });
  }
});

// ─── 404 Handler ─────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Error Handler ───────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', {
    requestId: req.id,
    error: err.message,
    stack: err.stack,
    path: req.path,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ───────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  initDb().then(() => {
    app.listen(PORT, () => {
      logger.info(`API Server running on port ${PORT}`, { service: 'fraud-api', version: 'v1.0.0' });
    });
  });
}

module.exports = app;
