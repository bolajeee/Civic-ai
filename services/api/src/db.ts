import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Default to local Supabase database url
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new Pool({
  connectionString,
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
