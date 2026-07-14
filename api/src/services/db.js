const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'fraud_user',
  password: process.env.POSTGRES_PASSWORD || 'fraud_pass_dev',
  database: process.env.POSTGRES_DB || 'fraud_pipeline',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  console.log('[Postgres] Client connected');
});

pool.on('error', (err) => {
  console.error('[Postgres] Unexpected error:', err.message);
});

module.exports = { pool };
