import 'dotenv/config';
import { Pool } from 'pg';

const inviteHash = process.argv[2];
const role = process.argv[3] || 'ADMIN';
const level = process.argv[4] || 'FEDERAL';
const stateId = process.argv[5] || null;

if (!inviteHash) {
  console.error('Usage: node scripts/insert-invite.js <inviteHash> [role] [level] [stateId]');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(
    `INSERT INTO gov_invite_codes (code_hash, role, government_level, state_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')`,
    [inviteHash, role, level, stateId],
  );
  console.log('Invite inserted.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
