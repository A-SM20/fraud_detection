import { useState, useEffect, useCallback, useRef } from 'react';

/* ═══════════════════════════════════════════════════════
   Token Management
   ═══════════════════════════════════════════════════════ */
function getToken() { return localStorage.getItem('fraud_token'); }
function setToken(t) { localStorage.setItem('fraud_token', t); }
function clearToken() { localStorage.removeItem('fraud_token'); localStorage.removeItem('fraud_user'); }
function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('fraud_user')); } catch { return null; }
}
function setStoredUser(u) { localStorage.setItem('fraud_user', JSON.stringify(u)); }

/* ═══════════════════════════════════════════════════════
   API Helpers (with JWT)
   ═══════════════════════════════════════════════════════ */
const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

async function fetchJSON(path) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function patchJSON(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    clearToken();
    window.location.reload();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loginAPI(username, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Login failed');
  }
  return res.json();
}

const PAGE_SIZE = 25;


/* ═══════════════════════════════════════════════════════
   Stat Card Component
   ═══════════════════════════════════════════════════════ */
function StatCard({ label, value, sub, color = 'blue' }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Score Bar Component
   ═══════════════════════════════════════════════════════ */
function ScoreBar({ score }) {
  if (score == null) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>;

  const s = parseFloat(score);
  const level = s >= 0.5 ? 'high' : s >= 0.25 ? 'medium' : 'low';
  const pct = Math.min(s * 100, 100);

  return (
    <div className="score-bar-container">
      <div className="score-bar">
        <div className={`score-bar-fill ${level}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="score-value">{s.toFixed(3)}</span>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Transaction Detail Panel
   ═══════════════════════════════════════════════════════ */
function TransactionDetail({ transaction, onClose, onReview, toast }) {
  const [scoreDetail, setScoreDetail] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (transaction?.id) {
      fetchJSON(`/transactions/${transaction.id}/score`)
        .then(setScoreDetail)
        .catch(() => setScoreDetail(null));
    }
  }, [transaction?.id]);

  const handleReview = async (decision) => {
    setReviewing(true);
    try {
      await patchJSON(`/transactions/${transaction.id}/review`, {
        decision,
        reviewed_by: getStoredUser()?.username || 'unknown',
        notes: reviewNotes,
      });
      toast(`Transaction ${decision === 'approved_after_review' ? 'approved' : 'rejected'}`, 'success');
      onReview();
      onClose();
    } catch (err) {
      toast(`Review failed: ${err.message}`, 'error');
    } finally {
      setReviewing(false);
    }
  };

  if (!transaction) return null;

  const t = transaction;

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <h2>Transaction Detail</h2>
          <button className="detail-close" onClick={onClose}>✕</button>
        </div>

        <div className="detail-body">
          {/* Transaction Info */}
          <div className="detail-section">
            <div className="detail-section-title">Transaction</div>
            <div className="detail-grid">
              <div className="detail-field full-width">
                <span className="detail-field-label">ID</span>
                <span className="detail-field-value mono">{t.id}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Amount</span>
                <span className="detail-field-value">${parseFloat(t.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Currency</span>
                <span className="detail-field-value">{t.currency || 'USD'}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Card Hash</span>
                <span className="detail-field-value mono">{t.card_hash}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Status</span>
                <span className={`status-badge ${t.status}`}>{t.status?.replace(/_/g, ' ')}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Merchant</span>
                <span className="detail-field-value">{t.merchant_category || '—'}</span>
              </div>
              <div className="detail-field">
                <span className="detail-field-label">Timestamp</span>
                <span className="detail-field-value">{t.timestamp ? new Date(t.timestamp).toLocaleString() : '—'}</span>
              </div>
            </div>
          </div>

          {/* Scoring Breakdown */}
          <div className="detail-section">
            <div className="detail-section-title">Scoring Breakdown</div>
            <div className="score-breakdown">
              {scoreDetail ? (
                <>
                  <div className="score-row">
                    <span className="score-row-label">Isolation Forest</span>
                    <span className="score-row-value" style={{ color: 'var(--accent-cyan)' }}>
                      {scoreDetail.if_score != null ? scoreDetail.if_score.toFixed(4) : '—'}
                    </span>
                  </div>
                  <div className="score-row">
                    <span className="score-row-label">Logistic Regression</span>
                    <span className="score-row-value" style={{ color: 'var(--accent-purple)' }}>
                      {scoreDetail.lr_score != null ? scoreDetail.lr_score.toFixed(4) : '—'}
                    </span>
                  </div>
                  <div className="score-row combined">
                    <span className="score-row-label">Combined Score</span>
                    <span className="score-row-value" style={{ color: 'var(--accent-blue)' }}>
                      {scoreDetail.combined_score != null ? scoreDetail.combined_score.toFixed(4) : '—'}
                    </span>
                  </div>
                  <div className="score-row">
                    <span className="score-row-label">Threshold Used</span>
                    <span className="score-row-value" style={{ color: 'var(--text-secondary)' }}>
                      {scoreDetail.threshold_used ?? '—'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="score-row">
                  <span className="score-row-label">ML Score</span>
                  <span className="score-row-value">
                    <ScoreBar score={t.ml_score} />
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Rules Triggered */}
          {t.rules_triggered && t.rules_triggered.length > 0 && (
            <div className="detail-section">
              <div className="detail-section-title">Rules Triggered</div>
              <div className="rule-tags" style={{ gap: '8px' }}>
                {t.rules_triggered.map((rule, i) => (
                  <span key={i} className="rule-tag" style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                    {rule.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Feature Vector */}
          {scoreDetail?.feature_vector && (
            <div className="detail-section">
              <div className="detail-section-title">Feature Vector</div>
              <div style={{
                background: 'var(--bg-primary)',
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                lineHeight: '1.8',
                color: 'var(--text-secondary)',
                maxHeight: '200px',
                overflow: 'auto',
              }}>
                {Object.entries(typeof scoreDetail.feature_vector === 'string'
                  ? JSON.parse(scoreDetail.feature_vector)
                  : scoreDetail.feature_vector
                ).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: 'var(--accent-cyan)' }}>{k}</span>: {typeof v === 'number' ? v.toFixed(4) : String(v)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review Actions (only for flagged transactions) */}
          {t.status === 'flagged' && (
            <div className="review-actions">
              <div className="detail-section-title">Analyst Review</div>
              <textarea
                className="review-textarea"
                placeholder="Add review notes (required for audit trail)..."
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
              />
              <div className="review-buttons">
                <button
                  className="btn btn-success"
                  disabled={reviewing}
                  onClick={() => handleReview('approved_after_review')}
                >
                  ✓ Approve
                </button>
                <button
                  className="btn btn-danger"
                  disabled={reviewing}
                  onClick={() => handleReview('rejected')}
                >
                  ✗ Reject
                </button>
              </div>
            </div>
          )}

          {/* Review Result (for already reviewed) */}
          {t.reviewed_by && (
            <div className="detail-section">
              <div className="detail-section-title">Review Result</div>
              <div className="detail-grid">
                <div className="detail-field">
                  <span className="detail-field-label">Reviewed By</span>
                  <span className="detail-field-value">{t.reviewed_by}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-field-label">Reviewed At</span>
                  <span className="detail-field-value">{t.reviewed_at ? new Date(t.reviewed_at).toLocaleString() : '—'}</span>
                </div>
                {t.review_notes && (
                  <div className="detail-field full-width">
                    <span className="detail-field-label">Notes</span>
                    <span className="detail-field-value">{t.review_notes}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Rules Chart Component
   ═══════════════════════════════════════════════════════ */
function RulesChart({ rules }) {
  if (!rules || rules.length === 0) return null;
  const maxCount = Math.max(...rules.map(r => parseInt(r.count)));

  return (
    <div className="table-container" style={{ padding: '20px 24px' }}>
      <div className="detail-section-title" style={{ marginBottom: '16px' }}>Top Rules Triggered</div>
      <div className="rules-chart">
        {rules.map((rule, i) => (
          <div key={i} className="rule-bar-row">
            <span className="rule-bar-label">{rule.rule.replace(/_/g, ' ')}</span>
            <div className="rule-bar-track">
              <div className="rule-bar-fill" style={{ width: `${(parseInt(rule.count) / maxCount) * 100}%` }} />
            </div>
            <span className="rule-bar-count">{rule.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Login Screen Component
   ═══════════════════════════════════════════════════════ */
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await loginAPI(username, password);
      setToken(data.token);
      setStoredUser(data.user);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)',
    }}>
      <div style={{
        width: '100%', maxWidth: '420px', padding: '40px',
        background: 'var(--gradient-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-card)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div className="header-logo" style={{ width: '56px', height: '56px', fontSize: '28px', margin: '0 auto 16px' }}>🛡</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px' }}>Fraud Detection</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sign in to the review dashboard</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              padding: '10px 14px', marginBottom: '16px', borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-rose-glow)', color: 'var(--accent-rose)',
              fontSize: '0.85rem', border: '1px solid rgba(244,63,94,0.2)',
            }}>{error}</div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '6px' }}>Username</label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="analyst_1"
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-subtle)'}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)', marginBottom: '6px' }}>Password</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%', padding: '10px 14px', background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent-blue)'}
              onBlur={e => e.target.style.borderColor = 'var(--border-subtle)'}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading || !username || !password}
            style={{ width: '100%', padding: '12px' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Demo: analyst_1 / password123
        </p>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Main App Component
   ═══════════════════════════════════════════════════════ */
export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [totalTxns, setTotalTxns] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selectedTxn, setSelectedTxn] = useState(null);
  const [healthy, setHealthy] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const pageSize = PAGE_SIZE;


  const handleLogout = () => {
    clearToken();
    setUser(null);
  };

  // Toast helper
  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // Fetch stats — also used as the online indicator
  const loadStats = useCallback(async () => {
    try {
      const data = await fetchJSON('/stats');
      setStats(data);
      setHealthy(true); // If stats load, API is reachable
    } catch {
      setStats(null);
      setHealthy(false);
    }
  }, []);

  // Fetch transactions
  const loadTransactions = useCallback(async () => {
    try {
      setLoading(true);
      const filterParam = statusFilter ? `&status=${statusFilter}` : '';
      const data = await fetchJSON(`/transactions?limit=${pageSize}&offset=${page * pageSize}${filterParam}`);
      setTransactions(data.transactions || []);
      setTotalTxns(data.total || 0);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  // Health check
  const checkHealth = useCallback(async () => {
    try {
      const healthUrl = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/health` : '/health';
      const res = await fetch(healthUrl);
      setHealthy(res.ok);
    } catch {
      setHealthy(false);
    }
  }, []);

  // Initial load + polling every 10s (reduced from 5s to lower Redis pressure)
  useEffect(() => {
    if (!getToken()) return;
    loadStats();
    loadTransactions();
    const interval = setInterval(() => {
      if (!getToken()) return;
      loadStats();
      loadTransactions();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadStats, loadTransactions]);

  // Reload when filters change
  useEffect(() => {
    setPage(0);
  }, [statusFilter]);

  // If not logged in, show login screen
  if (!user && !getToken()) {
    return <LoginScreen onLogin={setUser} />;
  }

  const totalPages = Math.ceil(totalTxns / pageSize);

  const flaggedCount = stats?.status_counts?.flagged || 0;

  return (
    <div className="app-container">
      {/* ─── Header ─────────────────────────────────── */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="header-logo">🛡</div>
            <div>
              <div className="header-title">Fraud Detection Pipeline</div>
              <div className="header-subtitle">Real-time transaction scoring & review</div>
            </div>
          </div>

          <div className="header-status">
            <div className="status-indicator">
              <div className={`status-dot ${healthy ? '' : 'offline'}`} />
              {healthy ? 'System Online' : 'System Offline'}
            </div>

            <nav className="nav-tabs">
              <button className={`nav-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
                Overview
              </button>
              <button className={`nav-tab ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}>
                Review Queue
                {flaggedCount > 0 && <span className="badge">{flaggedCount}</span>}
              </button>
              {user?.role === 'admin' && (
                <button className={`nav-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
                  All Transactions
                </button>
              )}
            </nav>

            {user && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: '12px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {user.username} ({user.role})
                </span>
                <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: '0.78rem' }} onClick={handleLogout}>
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ─── Main Content ───────────────────────────── */}
      <main className="main-content">
        {tab === 'overview' && (
          <OverviewTab stats={stats} />
        )}

        {tab === 'review' && (
          <ReviewTab
            transactions={transactions}
            totalTxns={totalTxns}
            page={page}
            setPage={setPage}
            totalPages={totalPages}
            selectedTxn={selectedTxn}
            setSelectedTxn={setSelectedTxn}
            loading={loading}
            onReview={() => { loadTransactions(); loadStats(); }}
            toast={showToast}
            statusFilter="flagged"
            setStatusFilter={setStatusFilter}
          />
        )}

        {tab === 'all' && user?.role === 'admin' && (
          <AllTransactionsTab
            transactions={transactions}
            totalTxns={totalTxns}
            page={page}
            setPage={setPage}
            totalPages={totalPages}
            selectedTxn={selectedTxn}
            setSelectedTxn={setSelectedTxn}
            loading={loading}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onReview={() => { loadTransactions(); loadStats(); }}
            toast={showToast}
          />
        )}
      </main>

      {/* ─── Detail Panel ───────────────────────────── */}
      {selectedTxn && (
        <TransactionDetail
          transaction={selectedTxn}
          onClose={() => setSelectedTxn(null)}
          onReview={() => { loadTransactions(); loadStats(); }}
          toast={showToast}
        />
      )}

      {/* ─── Toasts ─────────────────────────────────── */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Overview Tab
   ═══════════════════════════════════════════════════════ */
function OverviewTab({ stats }) {
  if (!stats) {
    return <div className="loading-container"><div className="spinner" /></div>;
  }

  const sc = stats.status_counts || {};
  const total = Object.values(sc).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="stats-grid">
        <StatCard
          label="Total Transactions"
          value={total.toLocaleString()}
          sub="All time"
          color="blue"
        />
        <StatCard
          label="Approved"
          value={(sc.approved || 0).toLocaleString()}
          sub={total > 0 ? `${((sc.approved || 0) / total * 100).toFixed(1)}% of total` : '—'}
          color="emerald"
        />
        <StatCard
          label="Flagged (Pending Review)"
          value={(sc.flagged || 0).toLocaleString()}
          sub="Awaiting analyst decision"
          color="rose"
        />
        <StatCard
          label="Rejected"
          value={(sc.rejected || 0).toLocaleString()}
          sub="Confirmed fraud"
          color="amber"
        />
        <StatCard
          label="Fraud Rate"
          value={stats.fraud_rate ? `${(parseFloat(stats.fraud_rate) * 100).toFixed(2)}%` : '—'}
          sub="Flagged + Rejected / Total scored"
          color="purple"
        />
        <StatCard
          label="Scored Last Hour"
          value={stats.throughput?.scored_last_hour?.toLocaleString() || '0'}
          sub="Processing throughput"
          color="cyan"
        />
        <StatCard
          label="Avg Review Time"
          value={stats.review?.avg_review_seconds ? `${stats.review.avg_review_seconds}s` : '—'}
          sub={`${stats.review?.reviewed_count || 0} reviewed`}
          color="blue"
        />
        <StatCard
          label="Queue Depth"
          value={`${stats.queues?.pending_depth || 0} / ${stats.queues?.review_depth || 0}`}
          sub="Pending / Review"
          color="amber"
        />
      </div>

      {/* Top Rules */}
      <RulesChart rules={stats.top_rules_triggered} />
    </>
  );
}


/* ═══════════════════════════════════════════════════════
   Review Queue Tab
   ═══════════════════════════════════════════════════════ */
function ReviewTab({ transactions, totalTxns, page, setPage, totalPages, setSelectedTxn, loading, onReview, toast }) {
  // Filter to flagged only
  const flagged = transactions.filter(t => t.status === 'flagged');

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: '700' }}>Review Queue</h1>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {flagged.length} flagged transaction{flagged.length !== 1 ? 's' : ''} pending review
        </span>
      </div>

      <TransactionTable
        transactions={flagged}
        totalTxns={totalTxns}
        page={page}
        setPage={setPage}
        totalPages={totalPages}
        onRowClick={setSelectedTxn}
        loading={loading}
        emptyTitle="Queue is empty"
        emptyText="No flagged transactions awaiting review"
        emptyIcon="✅"
      />
    </>
  );
}


/* ═══════════════════════════════════════════════════════
   All Transactions Tab
   ═══════════════════════════════════════════════════════ */
function AllTransactionsTab({
  transactions, totalTxns, page, setPage, totalPages,
  setSelectedTxn, loading, statusFilter, setStatusFilter,
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '1.3rem', fontWeight: '700' }}>All Transactions</h1>
      </div>

      <div className="filter-bar">
        <select
          className="filter-select"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="flagged">Flagged</option>
          <option value="rejected">Rejected</option>
          <option value="approved_after_review">Approved After Review</option>
        </select>
      </div>

      <TransactionTable
        transactions={transactions}
        totalTxns={totalTxns}
        page={page}
        setPage={setPage}
        totalPages={totalPages}
        onRowClick={setSelectedTxn}
        loading={loading}
        emptyTitle="No transactions"
        emptyText="No transactions match the selected filters"
        emptyIcon="📭"
      />
    </>
  );
}


/* ═══════════════════════════════════════════════════════
   Transaction Table Component
   ═══════════════════════════════════════════════════════ */
function TransactionTable({
  transactions, totalTxns, page, setPage, totalPages,
  onRowClick, loading, emptyTitle, emptyText, emptyIcon,
}) {
  if (loading) {
    return <div className="loading-container"><div className="spinner" /></div>;
  }

  if (!transactions || transactions.length === 0) {
    return (
      <div className="table-container">
        <div className="empty-state">
          <div className="empty-state-icon">{emptyIcon || '📭'}</div>
          <div className="empty-state-title">{emptyTitle || 'No data'}</div>
          <div className="empty-state-text">{emptyText || ''}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="table-container">
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Card</th>
              <th>Amount</th>
              <th>Category</th>
              <th>Status</th>
              <th>ML Score</th>
              <th>Rules</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(t => (
              <tr key={t.id} onClick={() => onRowClick(t)}>
                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--accent-cyan)' }}>
                  {t.id?.substring(0, 8)}…
                </td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                  {t.card_hash?.substring(0, 12)}…
                </td>
                <td style={{ fontWeight: 600 }}>
                  ${parseFloat(t.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  {t.merchant_category || '—'}
                </td>
                <td>
                  <span className={`status-badge ${t.status}`}>
                    {t.status?.replace(/_/g, ' ')}
                  </span>
                </td>
                <td>
                  <ScoreBar score={t.ml_score} />
                </td>
                <td>
                  <div className="rule-tags">
                    {t.rules_triggered && t.rules_triggered.length > 0
                      ? t.rules_triggered.slice(0, 2).map((r, i) => (
                          <span key={i} className="rule-tag">{r.replace(/_/g, ' ')}</span>
                        ))
                      : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>
                    }
                    {t.rules_triggered && t.rules_triggered.length > 2 && (
                      <span className="rule-tag" style={{ opacity: 0.7 }}>+{t.rules_triggered.length - 2}</span>
                    )}
                  </div>
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="pagination">
        <span className="pagination-info">
          Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalTxns)} of {totalTxns}
        </span>
        <div className="pagination-buttons">
          <button
            className="pagination-btn"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            ← Prev
          </button>
          <button
            className="pagination-btn"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}


