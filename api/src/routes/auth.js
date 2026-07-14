/**
 * Authentication routes — login and token management.
 * 
 * For this project, we use a simple in-memory user store.
 * In production, this would connect to a users table in PostgreSQL.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');
const logger = require('../services/logger');

const router = express.Router();

// ─── In-memory user store (replace with DB in production) ──
// Passwords are bcrypt-hashed. Default users for demo:
//   analyst_1 / password123
//   analyst_2 / password123
//   admin / adminpass
const USERS = [
  {
    id: '1',
    username: 'analyst_1',
    password: bcrypt.hashSync('password123', 10),
    role: 'analyst',
  },
  {
    id: '2',
    username: 'analyst_2',
    password: bcrypt.hashSync('password123', 10),
    role: 'analyst',
  },
  {
    id: '3',
    username: 'admin',
    password: bcrypt.hashSync('adminpass', 10),
    role: 'admin',
  },
];

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token.
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = USERS.find(u => u.username === username);

    if (!user) {
      logger.warn('Login attempt with unknown user', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      logger.warn('Login attempt with wrong password', { username, ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    logger.info('User logged in', { username: user.username, role: user.role });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    logger.error('Login error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info from JWT token.
 */
router.get('/me', (req, res) => {
  // This route should be protected by authenticateJWT middleware
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
  });
});

module.exports = router;
