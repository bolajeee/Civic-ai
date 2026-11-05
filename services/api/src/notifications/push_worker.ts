import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import { isPushDeliveryEnabled, PushDeliveryError, sendFirebasePush } from '../lib/firebase-push';

const POLL_MS = 3_000;
const RETRIES_MS = [30_000, 120_000, 600_000, 3_600_000];

export function startPushWorker(logger: FastifyBaseLogger): () => void {
  if (!isPushDeliveryEnabled()) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    try { await processOnePush(logger); }
    catch (error) { logger.error({ err: error }, 'Push notification poll failed'); }
    finally { if (!stopped) timer = setTimeout(run, POLL_MS); }
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export async function processOnePush(logger: FastifyBaseLogger): Promise<void> {
  const client = await pool.connect();
  let job: any;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT d.id, d.device_id, d.attempt_count, p.token,
              n.title, n.body, n.data
       FROM citizen_push_deliveries d
       JOIN citizen_push_devices p ON p.id = d.device_id AND p.disabled_at IS NULL
       JOIN citizen_notifications n ON n.id = d.notification_id
         AND n.citizen_id = p.citizen_id
       LEFT JOIN citizen_notification_preferences pref ON pref.citizen_id = n.citizen_id
       WHERE COALESCE(pref.report_updates_enabled, TRUE)
         AND ((d.status = 'PENDING' AND d.next_attempt_at <= NOW())
           OR (d.status = 'PROCESSING' AND d.updated_at < NOW() - INTERVAL '5 minutes'))
       ORDER BY d.next_attempt_at, d.created_at
       LIMIT 1 FOR UPDATE OF d SKIP LOCKED`,
    );
    job = result.rows[0];
    if (!job) { await client.query('COMMIT'); return; }
    await client.query(
      `UPDATE citizen_push_deliveries SET status = 'PROCESSING', attempt_count = attempt_count + 1,
       updated_at = NOW(), error_code = NULL WHERE id = $1`, [job.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  try {
    const messageId = await sendFirebasePush({ token: job.token, title: job.title, body: job.body, data: job.data });
    await query(
      `UPDATE citizen_push_deliveries SET status = 'SENT', provider_message_id = $2,
       sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [job.id, messageId],
    );
  } catch (error) {
    const failure = error instanceof PushDeliveryError ? error : new PushDeliveryError('PUSH_UNKNOWN', true);
    const attempts = Number(job.attempt_count) + 1;
    const retry = failure.retryable && attempts < 5;
    await query(
      `UPDATE citizen_push_deliveries SET status = $2, error_code = $3,
       next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'), updated_at = NOW() WHERE id = $1`,
      [job.id, retry ? 'PENDING' : 'FAILED', failure.code, RETRIES_MS[attempts - 1] ?? 0],
    );
    if (failure.invalidToken) {
      await query(`UPDATE citizen_push_devices SET disabled_at = NOW() WHERE id = $1`, [job.device_id]);
    }
    logger.error({ deliveryId: job.id, errorCode: failure.code, retryScheduled: retry }, 'Push delivery failed');
  }
}
