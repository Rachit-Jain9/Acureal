require('dotenv').config({ override: process.env.NODE_ENV !== 'production' });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const inputPath = process.argv[2];

if (!inputPath) {
  console.error('Usage: node scripts/run-sql.js <sql-file>');
  process.exit(1);
}

const filePath = path.resolve(process.cwd(), inputPath);

if (!fs.existsSync(filePath)) {
  console.error(`SQL file not found: ${filePath}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('[REDIP] DATABASE_URL is not set. Configure it in backend/.env before running migrations.');
  process.exit(1);
}

const sql = fs.readFileSync(filePath, 'utf8');

async function run() {
  const client = new Client({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    await client.query(sql);
    console.log(`Executed SQL file: ${filePath}`);
  } catch (error) {
    console.error(`Failed to execute SQL file: ${filePath}`);
    console.error(error.message || error.code || error);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

run();
