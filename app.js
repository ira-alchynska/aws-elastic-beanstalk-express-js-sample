// app.js
const express = require('express');
const { Pool } = require('pg');

const app = express();

// EB exposes PORT; default to 8080 for local
const PORT = process.env.PORT || 8080;

// ---- DB CONFIG VIA ENV ----
// Mandatory:
const DB_HOST = process.env.DB_HOST;
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
// Optional:
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_SSL = (process.env.DB_SSL || 'true').toLowerCase() === 'true';

// Create a single global pool (EB spawns 1 app per instance by default)
const pool = new Pool({
  host: DB_HOST,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  port: DB_PORT,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false,
  // modest connection limits to be nice to free-tier / small RDS
  max: parseInt(process.env.PG_POOL_MAX || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Basic home page
app.get('/', (_req, res) => {
  res.type('text/plain').send(
    'Hello from Elastic Beanstalk + Node.js!\n' +
    'Routes:\n' +
    '  /health    -> 200 OK for ALB health checks\n' +
    '  /db        -> test DB connectivity (SELECT NOW())\n' +
    '  /migrate   -> create demo table and insert a row\n' +
    '  /items     -> list rows from demo table\n'
  );
});

// Health check for ALB/EB
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// Quick DB connectivity test
app.get('/db', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    console.error('DB test error:', err);
    res.status(500).json({ ok: false, error: 'DB connection failed' });
  }
});

// One-click “migration” to show RDS use: creates table and inserts a row
app.get('/migrate', async (_req, res) => {
  const ddl = `
    CREATE TABLE IF NOT EXISTS demo_items (
      id SERIAL PRIMARY KEY,
      label TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  const dml = `INSERT INTO demo_items(label) VALUES ($1) RETURNING id, label, created_at;`;

  try {
    await pool.query('BEGIN');
    await pool.query(ddl);
    const inserted = await pool.query(dml, ['hello-from-eb']);
    await pool.query('COMMIT');
    res.json({ migrated: true, inserted: inserted.rows[0] });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Migration error:', err);
    res.status(500).json({ migrated: false, error: err.message });
  }
});

// List demo data
app.get('/items', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, label, created_at FROM demo_items ORDER BY id DESC LIMIT 50'
    );
    res.json({ count: result.rowCount, items: result.rows });
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: err.message });
  }
});

// graceful shutdown
const shutdown = () => {
  console.log('Shutting down...');
  pool.end().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
