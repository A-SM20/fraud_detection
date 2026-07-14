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

const fs = require('fs');
const path = require('path');

async function initDb() {
  try {
    const migrationPath = path.resolve(__dirname, '../../../db/migrations/001_initial_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    await pool.query(sql);
    console.log('[Postgres] Initial schema verified/applied successfully');
  } catch (err) {
    console.error('[Postgres] Failed to apply schema migration:', err.message);
  }
}

pool.on('connect', () => {
  console.log('[Postgres] Client connected');
});

pool.on('error', (err) => {
  console.error('[Postgres] Unexpected error:', err.message);
});

module.exports = { pool, initDb };
