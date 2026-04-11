const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

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
  idleTimeoutMillis: isServerless ? 10000 : 30000,
  connectionTimeoutMillis: 5000,
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

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Query executed:', { text: text.substring(0, 100), duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    const message = describeDatabaseError(error);
    console.error('Database query error:', { text: text.substring(0, 100), error: message });
    if (!error.message) {
      error.message = message;
    }
    throw error;
  }
};

const getClient = () => pool.connect();

const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, getClient, transaction };
