# 🛡 Real-Time Transaction Fraud/Anomaly Scoring Pipeline

A production-grade fraud detection system that scores transactions in real-time using a **rules engine** + **ML ensemble** (Isolation Forest + Logistic Regression), with a review dashboard for analyst triage.


## Live Demo
- **Dashboard (Frontend):** [https://fraud-detection-green.vercel.app/](https://fraud-detection-green.vercel.app/)
- **API (Backend):** `https://fraud-api-bj95.onrender.com`

*Log in as:*
- **Admin** (Full Access): `admin` / `adminpass`
- **Analyst** (Restricted View): `analyst_1` / `password123`

## Architecture

```
Client → Express API (ingest) → Redis Queue → Python Worker (scoring) → PostgreSQL
                ↑                                    ↓
          API Key Auth                         Flagged? → Review Queue → Dashboard → Analyst
                                                                            ↑
                                                                        JWT & RBAC
```

| Component | Technology | Port |
|---|---|---|
| Ingest API | Node.js + Express | 3000 |
| Scoring Worker | Python 3.11 + scikit-learn | — |
| Queue / Cache | Redis 7 | 6379 |
| Database | PostgreSQL 16 | 5432 |
| Dashboard | React + Vite | 3001 |
| Metrics | Prometheus | /metrics |
| CI/CD | GitHub Actions | — |

## Quick Start

### With Docker (Recommended)

```bash
# 1. Clone and start all services
docker-compose up --build

# 2. Open the dashboard
open http://localhost:3001

# 3. Run the transaction simulator
pip install requests
python scripts/simulate.py --count 100
```

### Without Docker (Local Development)

```bash
# Prerequisites: Node.js 20+, Python 3.11+, Redis, PostgreSQL

# 1. Copy and configure environment
cp .env.example .env

# 2. Run DB migrations
psql -U fraud_user -d fraud_pipeline -f db/migrations/001_initial_schema.sql

# 3. Start the API
cd api && npm install && npm run dev

# 4. Start the scoring worker
cd worker && pip install -r requirements.txt
cd src && python main.py

# 5. Start the dashboard
cd dashboard && npm install && npm run dev

# 6. Simulate transactions
pip install requests
python scripts/simulate.py --count 50
```

## Security

### API Key Authentication (Ingestion)
Machine-to-machine transaction ingestion requires an API key:
```bash
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev-api-key-1" \
  -d '{"card_hash": "abc123...", "amount": 99.99}'
```

### JWT Authentication (Dashboard)
Analyst endpoints require a JWT token:
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "analyst_1", "password": "password123"}'

# Use token for protected routes
curl http://localhost:3000/api/stats \
  -H "Authorization: Bearer <token>"
```

Default users: 
- `admin`/`adminpass` (Role: Admin - Can view 'All Transactions' and Review Queue)
- `analyst_1`/`password123` (Role: Analyst - Restricted to Review Queue only)

> **Dev mode**: Set `SKIP_AUTH=true` in `.env` to bypass all authentication.

## Testing

```bash
# API tests (Jest + Supertest)
cd api && npm test

# Worker tests (pytest)
cd worker && python -m pytest tests/ -v
```

## Observability

### Prometheus Metrics
```bash
# Scrape endpoint
curl http://localhost:3000/metrics
```

Available metrics:
- `http_request_duration_seconds` — request latency histogram
- `http_requests_total` — request counter by method/route/status
- `transactions_ingested_total` — ingested transaction counter
- `transactions_reviewed_total` — reviewed transactions by decision
- `queue_depth` — Redis queue depths (pending/review)
- Default Node.js metrics (CPU, memory, event loop lag)

### Structured Logging
Both API (Winston) and Worker (Python JSON) emit structured JSON logs:
```json
{"timestamp":"2026-07-14T15:30:00.000Z","level":"info","service":"fraud-api","message":"request","method":"POST","path":"/api/transactions"}
```

## Scoring Pipeline

Each transaction passes through:

1. **Feature Extraction** — velocity counts, geo-distance, time features (from Redis state)
2. **Rules Engine** — deterministic hard rules (velocity >5/hr, amount >$5k, impossible travel, etc.)
3. **ML Models** — Isolation Forest (anomaly detection) + Logistic Regression (supervised)
4. **Score Combination** — `0.4 × IF_score + 0.6 × LR_score`
5. **Decision** — Flag if combined score ≥ 0.35 OR any rule fires

## Precision/Recall Trade-off

| Threshold | Precision | Recall | F1 | Impact |
|---|---|---|---|---|
| 0.20 | 0.12 | 0.95 | 0.21 | Too many false flags |
| **0.35** | **0.42** | **0.91** | **0.57** | **Chosen — balanced cost** |
| 0.50 | 0.72 | 0.82 | 0.77 | Missing too much fraud |

**Why 0.35?** At this threshold, recall ≥ 90% (non-negotiable for fraud) with ~1.4 false positives per true positive — a manageable review load. Combined with the rules engine, effective system recall reaches ~96-98%.

## Production Deployment

```bash
# Use the production overlay
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Required environment variables in production:
export JWT_SECRET=<random-256-bit-string>
export API_KEYS=<comma-separated-production-keys>
export POSTGRES_PASSWORD=<strong-password>
export CORS_ORIGIN=https://your-dashboard-domain.com
```

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | None | Authenticate & get JWT token |
| POST | `/api/transactions` | API Key | Submit a transaction for scoring |
| GET | `/api/transactions/:id` | API Key | Get transaction status |
| GET | `/api/transactions/:id/score` | API Key | Get scoring audit details |
| GET | `/api/transactions` | API Key | List transactions (with filters) |
| PATCH | `/api/transactions/:id/review` | API Key | Submit analyst review |
| GET | `/api/stats` | JWT | Dashboard analytics |
| GET | `/health` | None | Service health check |
| GET | `/metrics` | None | Prometheus metrics |

## Project Structure

```
├── .github/workflows/ci.yml   # CI/CD pipeline
├── api/                        # Express ingest service
│   ├── src/
│   │   ├── middleware/         # Validation, Auth (API key + JWT)
│   │   ├── routes/             # Transactions, Stats, Auth
│   │   ├── services/           # Redis, DB, Logger, Metrics
│   │   └── server.js           # Express app with Helmet, rate limiting
│   └── tests/                  # Jest + Supertest integration tests
├── worker/                     # Python scoring worker
│   ├── src/
│   │   ├── main.py             # BRPOP loop with structured logging
│   │   ├── feature_extraction.py
│   │   ├── rules_engine.py     # 8 deterministic fraud rules
│   │   ├── ml_scorer.py        # IF + LR ensemble
│   │   ├── logger.py           # Structured JSON logging
│   │   └── db.py
│   ├── models/                 # Trained ML model artifacts
│   └── tests/                  # pytest unit tests
├── dashboard/                  # React review dashboard
├── model-training/             # Offline training scripts
├── db/                         # PostgreSQL migrations
├── scripts/                    # Simulation & testing scripts
├── docker-compose.yml          # Development orchestration
└── docker-compose.prod.yml     # Production overlay
```

## Recent Updates
- **Deployment**: Successfully deployed API and Worker to Render, and Dashboard to Vercel. 
- **Resilience**: Implemented robust Redis connection handling in the Python Worker with backoff strategies to prevent socket timeout floods on Render's free tier.
- **RBAC**: Implemented Role-Based Access Control on the dashboard, hiding sensitive views from non-admin users.
- **UI/UX**: Integrated a custom WebGL animated gradient background (`Grainient`) for a premium dashboard aesthetic.

## License

MIT
