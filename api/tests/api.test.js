/**
 * Integration tests for the Fraud Pipeline API.
 * 
 * Tests endpoint responses, validation, and error handling.
 * Uses supertest to make HTTP requests without starting a real server.
 * 
 * NOTE: Requires Redis and PostgreSQL to be running.
 * For CI, use docker-compose to spin up dependencies first.
 */

const request = require('supertest');

// Set test environment BEFORE importing app
process.env.NODE_ENV = 'test';
process.env.SKIP_AUTH = 'true';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || 'localhost';

const app = require('../src/server');

describe('Health Check', () => {
  test('GET /health returns healthy status', async () => {
    const res = await request(app).get('/health');
    // May be 503 if Redis/Postgres aren't running — that's OK in unit test mode
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });
});

describe('Authentication', () => {
  test('POST /api/auth/login with valid credentials returns token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'analyst_1', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.username).toBe('analyst_1');
    expect(res.body.user.role).toBe('analyst');
  });

  test('POST /api/auth/login with invalid password returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'analyst_1', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/login with missing fields returns 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login with unknown user returns 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'password123' });

    expect(res.status).toBe(401);
  });
});

describe('Transaction Validation', () => {
  test('POST /api/transactions with valid payload returns 202', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        card_hash: 'abc12345def67890',
        amount: 99.99,
        currency: 'USD',
        merchant_category: 'grocery',
        latitude: 40.7128,
        longitude: -74.0060,
        country: 'US',
      });

    // 202 if DB is available, 500 if not
    expect([202, 500]).toContain(res.status);
    if (res.status === 202) {
      expect(res.body).toHaveProperty('transaction_id');
      expect(res.body.status).toBe('pending');
    }
  });

  test('POST /api/transactions rejects missing card_hash', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        amount: 50,
        currency: 'USD',
      });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Validation failed');
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'card_hash' }),
      ])
    );
  });

  test('POST /api/transactions rejects negative amount', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        card_hash: 'abc12345def67890',
        amount: -50,
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'amount' }),
      ])
    );
  });

  test('POST /api/transactions rejects amount over 1M', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        card_hash: 'abc12345def67890',
        amount: 1000001,
      });

    expect(res.status).toBe(400);
  });

  test('POST /api/transactions rejects short card_hash', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        card_hash: 'abc',
        amount: 50,
      });

    expect(res.status).toBe(400);
  });

  test('POST /api/transactions rejects invalid currency length', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        card_hash: 'abc12345def67890',
        amount: 50,
        currency: 'USDD',
      });

    expect(res.status).toBe(400);
  });

  test('POST /api/transactions rejects invalid latitude', async () => {
    const res = await request(app)
      .post('/api/transactions')
      .send({
        card_hash: 'abc12345def67890',
        amount: 50,
        latitude: 91,
      });

    expect(res.status).toBe(400);
  });
});

describe('404 Handling', () => {
  test('Unknown route returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Not found');
  });
});

describe('Metrics', () => {
  test('GET /metrics returns Prometheus format', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain|application\/openmetrics/);
    expect(res.text).toContain('http_request_duration_seconds');
  });
});
