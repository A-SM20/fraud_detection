/**
 * Authentication middleware for the API.
 * 
 * Two modes:
 * 1. API Key auth — for machine-to-machine ingestion (POST /api/transactions)
 * 2. JWT auth — for dashboard analysts (review endpoints, stats)
 */

const jwt = require('jsonwebtoken');
const logger = require('../services/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'fraud-pipeline-dev-secret-change-in-production';
const API_KEYS = (process.env.API_KEYS || 'dev-api-key-1,dev-api-key-2').split(',').map(k => k.trim());
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

/**
 * Validate API key from x-api-key header.
 * Used for ingestion endpoints (machine-to-machine).
 */
function authenticateApiKey(req, res, next) {
  // Skip auth in development or test if configured
  if ((process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') && process.env.SKIP_AUTH === 'true') {
    return next();
  }

  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    logger.warn('Missing API key', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  if (!API_KEYS.includes(apiKey)) {
    logger.warn('Invalid API key', { ip: req.ip, path: req.path, key_prefix: apiKey.substring(0, 8) });
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * Validate JWT token from Authorization header.
 * Used for dashboard/analyst endpoints.
 */
function authenticateJWT(req, res, next) {
  // Skip auth in development or test if configured
  if ((process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') && process.env.SKIP_AUTH === 'true') {
    req.user = { id: 'dev_user', username: 'developer', role: 'admin' };
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    logger.warn('Invalid JWT token', { ip: req.ip, error: err.message });
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/**
 * Generate a JWT token for an authenticated user.
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

module.exports = { authenticateApiKey, authenticateJWT, generateToken, JWT_SECRET };
