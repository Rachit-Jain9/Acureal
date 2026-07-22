const { Pool } = require('pg');
const { normalizeDatabaseUrl } = require('./databaseUrl');
const { getRequestContext } = require('../lib/requestContext');

const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);

if (!connectionString && process.env.NODE_ENV !== 'test') {
  console.error(
    '[REDIP] DATABASE_URL is not set. Add it to backend/.env (local) or Vercel environment variables (production).'
  );
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const isServerless = !!process.env.VERCEL;

const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: isServerless ? 5 : 20,
  // Keep a warm serverless instance's pooled connection alive across short idle
  // gaps so back-to-back requests reuse a live socket instead of paying a fresh
  // TLS + pooler handshake on every small pause. TCP keepAlive stops network
  // intermediaries silently dropping an idle socket (which otherwise surfaces as
  // an occasional slow request when the next query has to reconnect first).
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('PostgreSQL connected');
  }
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
  if (!isServerless) {
    process.exit(-1);
  }
});

const describeDatabaseError = (error) => {
  if (!error) {
    return 'Database operation failed.';
  }

  if (error.message) {
    return error.message;
  }

  if (Array.isArray(error.errors) && error.errors.length > 0) {
    const nestedMessages = error.errors
      .map((nestedError) => nestedError?.message || nestedError?.code)
      .filter(Boolean);

    if (nestedMessages.length > 0) {
      return nestedMessages.join('; ');
    }
  }

  if (error.code) {
    return `Database connection failed: ${error.code}`;
  }

  return 'Database operation failed.';
};

// Set the per-request tenant context (user + organization) that the RLS helper
// functions `current_user_id()` / `current_organization_id()` read via
// `current_setting('app.current_*', true)`.
//
// CRITICAL: `is_local = true` (the 3rd arg), and this MUST run inside an
// explicit transaction alongside the query it scopes. We connect through
// Supabase's TRANSACTION-mode pooler (:6543), where the unit of backend
// assignment is a transaction, not a session. A session-level `SET` (is_local
// = false) issued as its OWN statement does NOT reliably carry to the next
// statement — the pooler can hand the follow-up query a DIFFERENT backend that
// never saw the SET, so `current_organization_id()` returns NULL and every
// org-scoped query silently returns ZERO rows. That produced the intermittent
// empty dashboard widgets / empty Deals list (worse under load, as pool
// contention makes the mis-route more likely). SET LOCAL inside one
// transaction pins the context + query to a single backend, and the context is
// discarded at COMMIT so it can never leak into the next request that reuses
// that pooled backend.
const setRequestContext = async (client) => {
  const context = getRequestContext();
  await client.query(
    `SELECT
       set_config('app.current_user_id', $1, true),
       set_config('app.current_organization_id', $2, true)`,
    [context.userId || '', context.organizationId || '']
  );
};

const query = async (text, params) => {
  const start = Date.now();
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await setRequestContext(client);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    inTransaction = false;
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Query executed:', { text: text.substring(0, 100), duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    }
    const message = describeDatabaseError(error);
    console.error('Database query error:', { text: text.substring(0, 100), error: message });
    if (!error.message) {
      error.message = message;
    }
    throw error;
  } finally {
    client.release();
  }
};

const getClient = () => pool.connect();

const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setRequestContext(client);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Guard the rollback like query() does — if the callback failed because the
    // connection broke, an unguarded ROLLBACK throws and masks the real cause.
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, getClient, transaction };
