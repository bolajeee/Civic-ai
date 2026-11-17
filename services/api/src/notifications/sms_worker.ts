import type { FastifyBaseLogger } from 'fastify';
import { pool, query } from '../db';
import { isSmsEnabled, sendSms, SmsDeliveryError } from '../lib/sms';

const POLL_MS = 2_000;
/** Backoff after each failed attempt; the attempt after the last one is final. */
export const SMS_RETRIES_MS = [30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = SMS_RETRIES_MS.length + 1;

/**
 * Sends queued SOS texts. Same claim-then-send shape as the push worker: a
 * delivery is claimed (PROCESSING) in a short transaction, sent outside it, and
 * a claim stranded by a crash is picked up again after five minutes.
 */
export function startSmsWorker(logger: FastifyBaseLogger): () => void {
  if (!isSmsEnabled()) return () => {};
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const run = async () => {
    let sent = false;
    try { sent = await processOneSms(logger); }
    catch (error) { logger.error({ err: error }, 'SOS SMS poll failed'); }
    // Drain a backlog without waiting a full poll interval between messages.
    finally { if (!stopped) timer = setTimeout(run, sent ? 0 : POLL_MS); }
  };
  void run();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** Sends at most one queued SMS. Returns true if there was one to send. */
export async function processOneSms(logger: FastifyBaseLogger): Promise<boolean> {
  const client = await pool.connect();
  let job: { id: string; phone_e164: string; body: string; kind: string; attempt_count: number } | undefined;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, phone_e164, body, kind, attempt_count
       FROM sos_sms_deliveries
       WHERE (status = 'PENDING' AND next_attempt_at <= NOW())
          OR (status = 'PROCESSING' AND updated_at < NOW() - INTERVAL '5 minutes')
       ORDER BY next_attempt_at, created_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    job = result.rows[0];
    if (!job) { await client.query('COMMIT'); return false; }
    await client.query(
      `UPDATE sos_sms_deliveries SET status = 'PROCESSING', attempt_count = attempt_count + 1,
       updated_at = NOW(), error_code = NULL WHERE id = $1`, [job.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }

  try {
    const messageId = await sendSms({ to: job.phone_e164, body: job.body });
    await query(
      `UPDATE sos_sms_deliveries SET status = 'SENT', provider_message_id = $2,
       sent_at = NOW(), updated_at = NOW() WHERE id = $1`, [job.id, messageId],
    );
  } catch (error) {
    const failure = error instanceof SmsDeliveryError ? error : new SmsDeliveryError('SMS_UNKNOWN', true);
    const attempts = Number(job.attempt_count) + 1;
    const retry = failure.retryable && attempts < MAX_ATTEMPTS;
    await query(
      `UPDATE sos_sms_deliveries SET status = $2, error_code = $3,
       next_attempt_at = NOW() + ($4 * INTERVAL '1 millisecond'), updated_at = NOW() WHERE id = $1`,
      [job.id, retry ? 'PENDING' : 'FAILED', failure.code, retry ? SMS_RETRIES_MS[attempts - 1] : 0],
    );
    // No phone number or message text in the log: both are personal data.
    logger.error({ deliveryId: job.id, kind: job.kind, errorCode: failure.code, retryScheduled: retry },
      'SOS SMS delivery failed');
  }
  return true;
}
