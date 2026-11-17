import { Pool, type QueryResultRow } from 'pg';
import dotenv from 'dotenv';

// Load .env before the Pool is constructed — this file is imported
dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new Pool({
  connectionString,
  // TCP keepalive stops NATs and the Supabase pooler from silently dropping a
  // connection that is idle between worker polls.
  keepAlive: true,
  // Retire idle connections before the pooler does, so the pool rarely hands
  // out a connection the server has already closed.
  idleTimeoutMillis: 30_000,
});

// A dropped connection (pooler restart, idle timeout, network blip) is emitted
// as an 'error' event. With no listener, Node treats it as unhandled and
// crashes the whole API. Logging is enough: pg removes the dead connection,
// any query that was using it rejects normally, and the next query opens a
// fresh one.
function logConnectionError(err: Error) {
  console.error(`[db] connection error: ${err.message}`);
}

// Idle connections report through the pool...
pool.on('error', logConnectionError);
// ...connections checked out by a route or worker report on the client itself.
pool.on('connect', (client) => {
  client.on('error', logConnectionError);
});

export const query = <Row extends QueryResultRow = any>(text: string, params?: any[]) =>
  pool.query<Row>(text, params);
