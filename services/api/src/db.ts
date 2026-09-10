import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load .env before the Pool is constructed — this file is imported
dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new Pool({ connectionString });

export const query = (text: string, params?: any[]) => pool.query(text, params);
