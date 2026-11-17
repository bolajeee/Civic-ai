/**
 * Pure helpers for SOS: phone normalisation, distance, and the SMS texts sent
 * to trusted contacts. Kept free of I/O so they are unit-testable and shared by
 * the routes (which enqueue) and tests.
 */

export const EMERGENCY_TYPES = ['MEDICAL', 'SECURITY', 'FIRE', 'ACCIDENT'] as const;
export type EmergencyType = (typeof EMERGENCY_TYPES)[number];

/** Two concatenated GSM-7 segments (153 chars each after the UDH). */
export const SMS_MAX_LENGTH = 306;

const TYPE_LABELS: Record<EmergencyType, string> = {
  MEDICAL: 'MEDICAL',
  SECURITY: 'SECURITY',
  FIRE: 'FIRE',
  ACCIDENT: 'ROAD ACCIDENT',
};

/**
 * Normalises a phone number to E.164, treating bare numbers as Nigerian.
 *
 *   0803 123 4567 / 803-123-4567 / 2348031234567 / +234 803 123 4567
 *     -> +2348031234567
 *
 * Other countries must be entered with their `+` prefix. Returns null for
 * anything that is not a plausible number.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(compact)) {
    // A +234 number must still be a full Nigerian number.
    if (compact.startsWith('+234') && !/^\+234[789]\d{9}$/.test(compact)) return null;
    return compact;
  }
  if (/^234[789]\d{9}$/.test(compact)) return `+${compact}`;
  if (/^0[789]\d{9}$/.test(compact)) return `+234${compact.slice(1)}`;
  if (/^[789]\d{9}$/.test(compact)) return `+234${compact}`;
  return null;
}

/** Great-circle distance in metres. */
export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const r = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Reduces free text to plain ASCII. One emoji or accented letter would switch
 * the whole SMS to UCS-2, cutting a segment from 153 to 67 characters — and
 * tripling the cost of every message.
 */
export function toSmsText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function watTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

export function mapLink(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export interface SmsSender {
  name: string | null;
  phone: string | null;
}

export interface SmsLocation {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  address?: string | null;
}

function senderName(sender: SmsSender): string {
  const name = sender.name ? toSmsText(sender.name) : '';
  return name || 'A CivicAI user';
}

/** Trims [value] to [max] characters, marking the cut. */
function clip(value: string, max: number): string {
  if (max <= 0) return '';
  if (value.length <= max) return value;
  return max <= 3 ? value.slice(0, max) : `${value.slice(0, max - 3)}...`;
}

/**
 * Assembles a message from parts, dropping or shortening the optional ones
 * (in the given order of expendability) until it fits [SMS_MAX_LENGTH]. The
 * map link, tracking link and callback number are never cut.
 */
function fit(build: (address: string, note: string) => string, address: string, note: string): string {
  let text = build(address, note);
  if (text.length <= SMS_MAX_LENGTH) return text;
  const withoutNote = build(address, '');
  // Keep as much of the note as fits; drop it entirely if nothing useful does.
  const noteRoom = SMS_MAX_LENGTH - withoutNote.length - ' Note: .'.length;
  if (note && noteRoom >= 20) return build(address, clip(note, noteRoom));
  text = withoutNote;
  if (text.length <= SMS_MAX_LENGTH) return text;
  const addressRoom = address.length - (text.length - SMS_MAX_LENGTH);
  return build(clip(address, addressRoom), '');
}

function locationPhrase(location: SmsLocation | null, address: string): string {
  if (!location) return 'Location: not available, call them.';
  const accuracy = location.accuracy != null && Number.isFinite(location.accuracy)
    ? ` (within ${Math.max(1, Math.round(location.accuracy))} m)`
    : '';
  const place = address ? `${address} ` : '';
  return `Location: ${place}${mapLink(location.latitude, location.longitude)}${accuracy}`;
}

export function buildAlertSms(input: {
  sender: SmsSender;
  type: EmergencyType;
  location: SmsLocation | null;
  note?: string | null;
  updateIntervalMinutes: number;
  /** Live tracking page; replaces the "updates every N min" promise when set. */
  trackingUrl?: string | null;
  at: Date;
}): string {
  const name = senderName(input.sender);
  const callback = input.sender.phone ? ` Call them: ${input.sender.phone}.` : '';
  const updates = input.trackingUrl
    ? ` Live location: ${input.trackingUrl}`
    : input.location ? ` Updates every ${input.updateIntervalMinutes} min if they move.` : '';
  return fit(
    (address, note) =>
      `SOS from ${name} via CivicAI: ${TYPE_LABELS[input.type]} emergency. `
      + `${locationPhrase(input.location, address)} at ${watTime(input.at)} WAT.`
      + `${callback}${note ? ` Note: ${note}.` : ''}${updates}`,
    toSmsText(input.location?.address ?? ''),
    toSmsText(input.note ?? ''),
  );
}

export function buildUpdateSms(input: {
  sender: SmsSender;
  location: SmsLocation;
  at: Date;
}): string {
  const name = senderName(input.sender);
  return fit(
    (address) =>
      `${name} SOS update (${watTime(input.at)} WAT): now at `
      + `${address ? `${address} ` : ''}${mapLink(input.location.latitude, input.location.longitude)}`
      + `${input.location.accuracy != null ? ` (within ${Math.max(1, Math.round(input.location.accuracy))} m)` : ''}.`,
    toSmsText(input.location.address ?? ''),
    '',
  );
}

export function buildUpdatesStoppedSms(sender: SmsSender): string {
  const callback = sender.phone ? ` Call them: ${sender.phone}.` : '';
  return `${senderName(sender)}'s SOS location updates via CivicAI have stopped.${callback}`;
}

export function buildSafeSms(sender: SmsSender): string {
  return `${senderName(sender)} has marked themselves safe via CivicAI. No further SOS updates will be sent.`;
}
