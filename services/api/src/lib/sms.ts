/**
 * Outbound SMS for SOS alerts, chosen by SMS_PROVIDER. Termii is the launch
 * provider (Nigeria-focused, with a DND route that reaches numbers on the
 * do-not-disturb register); Twilio works without a Nigerian business
 * registration, which makes it the easy option for testing on real phones.
 * Providers sit behind [SmsProvider] so the worker doesn't care which one runs.
 *
 * Without a configured provider SMS is disabled, in development as in
 * production: nothing is queued, and the app sends the alert from the
 * citizen's own phone (its messages app) with a live tracking link instead.
 */

export class SmsDeliveryError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message?: string) {
    super(message ?? code);
  }
}

interface SmsProvider {
  send(input: { to: string; body: string }): Promise<string>;
}

function configuredProvider(): SmsProvider | null {
  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase();
  if (provider === 'termii') {
    const apiKey = process.env.TERMII_API_KEY?.trim();
    const senderId = process.env.TERMII_SENDER_ID?.trim();
    if (!apiKey || !senderId) return null;
    return termii({
      apiKey,
      senderId,
      channel: process.env.TERMII_CHANNEL?.trim() || 'dnd',
      baseUrl: (process.env.TERMII_BASE_URL?.trim() || 'https://v3.api.termii.com').replace(/\/$/, ''),
    });
  }
  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = process.env.TWILIO_FROM?.trim();
    if (!accountSid || !authToken || !from) return null;
    return twilio({
      accountSid,
      authToken,
      from,
      baseUrl: (process.env.TWILIO_BASE_URL?.trim() || 'https://api.twilio.com').replace(/\/$/, ''),
    });
  }
  return null;
}

/** True when a real provider is configured. */
export function isSmsProviderConfigured(): boolean {
  return configuredProvider() !== null;
}

/** True when the server sends SOS texts itself; otherwise the phone does. */
export function isSmsEnabled(): boolean {
  return isSmsProviderConfigured();
}

/** Sends one SMS and returns the provider's message id. */
export async function sendSms(input: { to: string; body: string }): Promise<string> {
  const provider = configuredProvider();
  if (provider) return provider.send(input);
  // Only reachable for texts queued before the provider was removed.
  throw new SmsDeliveryError('SMS_NOT_CONFIGURED', false);
}

function termii(config: { apiKey: string; senderId: string; channel: string; baseUrl: string }): SmsProvider {
  return {
    async send({ to, body }) {
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/api/sms/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: config.apiKey,
            // Termii expects the number without the leading +.
            to: to.replace(/^\+/, ''),
            from: config.senderId,
            sms: body,
            type: 'plain',
            channel: config.channel,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SmsDeliveryError('SMS_NETWORK', true);
      }

      if (!response.ok) {
        // Rate limiting and provider outages are worth retrying; a rejected
        // number or sender id is not.
        const retryable = response.status === 429 || response.status >= 500;
        throw new SmsDeliveryError(`SMS_HTTP_${response.status}`, retryable);
      }

      const result = (await response.json().catch(() => ({}))) as { message_id?: unknown };
      if (typeof result.message_id !== 'string' && typeof result.message_id !== 'number') {
        throw new SmsDeliveryError('SMS_BAD_RESPONSE', true);
      }
      return String(result.message_id);
    },
  };
}

/**
 * Twilio Programmable Messaging. `from` is a Twilio number (E.164), an
 * alphanumeric sender ID, or a Messaging Service SID (starts with "MG").
 */
function twilio(config: { accountSid: string; authToken: string; from: string; baseUrl: string }): SmsProvider {
  return {
    async send({ to, body }) {
      const form = new URLSearchParams({ To: to, Body: body });
      if (/^MG[0-9a-f]{32}$/i.test(config.from)) form.set('MessagingServiceSid', config.from);
      else form.set('From', config.from);

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
          },
          body: form.toString(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new SmsDeliveryError('SMS_NETWORK', true);
      }

      const result = (await response.json().catch(() => ({}))) as { sid?: unknown; code?: unknown };
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        // Twilio's numeric error code says why (e.g. 21608: trial accounts can
        // only text verified numbers; 21211: invalid "To" number).
        const code = typeof result.code === 'number' ? `SMS_TWILIO_${result.code}` : `SMS_HTTP_${response.status}`;
        throw new SmsDeliveryError(code, retryable);
      }
      if (typeof result.sid !== 'string') throw new SmsDeliveryError('SMS_BAD_RESPONSE', true);
      return result.sid;
    },
  };
}
