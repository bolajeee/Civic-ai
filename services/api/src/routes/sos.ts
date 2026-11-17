import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { ZodError } from 'zod';
import { pool, query } from '../db';
import { EMERGENCY_HOTLINES } from '../lib/emergency-hotlines';
import {
  FacilityKind,
  GeoapifyConfigError,
  GeoapifyUpstreamError,
  searchNearbyPlaces,
} from '../lib/geoapify';
import { isSmsEnabled } from '../lib/sms';
import {
  buildAlertSms,
  buildSafeSms,
  buildUpdateSms,
  buildUpdatesStoppedSms,
  distanceMeters,
  EmergencyType,
  normalizePhone,
  SmsSender,
} from '../lib/sos-messages';
import {
  alertPublicIdSchema,
  contactIdSchema,
  createAlertSchema,
  createContactSchema,
  locationUpdateSchema,
  nearbySchema,
  updateContactSchema,
} from '../schemas/sos';

export const MAX_TRUSTED_CONTACTS = 5;
/** Location updates stop after this many SMS pings or hours, whichever first. */
export const MAX_UPDATE_PINGS = 12;
export const MAX_UPDATE_HOURS = 6;
/** Contacts are only re-pinged once the citizen has moved at least this far. */
export const MIN_MOVE_METERS = 100;

const NEARBY_RADIUS_METERS = 25_000;
const NEARBY_LIMIT = 15;
const DUPLICATE_RADIUS_METERS = 100;

/** Which places count as "help nearby" for each emergency type. */
const NEARBY_RULES: Record<EmergencyType, {
  geoapify: string[];
  curated: { kinds: FacilityKind[]; agencies?: string[] };
}> = {
  MEDICAL: {
    geoapify: ['healthcare.hospital', 'healthcare.clinic_or_praxis'],
    curated: { kinds: ['HOSPITAL'] },
  },
  SECURITY: {
    geoapify: ['service.police'],
    curated: { kinds: ['POLICE', 'PARAMILITARY'] },
  },
  FIRE: {
    geoapify: ['service.fire_station'],
    curated: { kinds: ['FIRE'] },
  },
  ACCIDENT: {
    geoapify: ['healthcare.hospital', 'service.police'],
    curated: { kinds: ['PARAMILITARY'], agencies: ['FRSC'] },
  },
};

const ALERT_COLUMNS = `id, public_id, emergency_type, status, latitude, longitude, accuracy,
  address, note, update_interval_minutes, last_pinged_at, last_pinged_lat, last_pinged_lon,
  ping_count, updates_stopped_at, created_at, resolved_at, share_token`;

interface AlertRow {
  id: string;
  public_id: string;
  emergency_type: EmergencyType;
  status: 'ACTIVE' | 'RESOLVED';
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  address: string | null;
  note: string | null;
  update_interval_minutes: number;
  last_pinged_at: Date | string | null;
  last_pinged_lat: number | null;
  last_pinged_lon: number | null;
  ping_count: number;
  updates_stopped_at: Date | string | null;
  created_at: Date | string;
  resolved_at: Date | string | null;
  share_token: string | null;
}

function citizenId(request: FastifyRequest): string {
  return (request.user as { id: string }).id;
}

const iso = (value: Date | string | null) => (value == null ? null : new Date(value).toISOString());

/**
 * Where contacts open the live tracking page. PUBLIC_BASE_URL is the API's
 * public https origin; without it the request's own origin is used, which is
 * right locally but can be http:// behind a proxy.
 */
export function publicBaseUrl(request: FastifyRequest): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
  return configured || `${request.protocol}://${request.host}`;
}

function trackingUrl(request: FastifyRequest, token: string | null): string | null {
  return token ? `${publicBaseUrl(request)}/t/${token}` : null;
}

function serializeAlert(row: AlertRow, request: FastifyRequest) {
  return {
    publicId: row.public_id,
    type: row.emergency_type,
    status: row.status,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    address: row.address,
    note: row.note,
    updateIntervalMinutes: Number(row.update_interval_minutes),
    lastPingedAt: iso(row.last_pinged_at),
    pingCount: Number(row.ping_count),
    updatesStoppedAt: iso(row.updates_stopped_at),
    createdAt: iso(row.created_at),
    resolvedAt: iso(row.resolved_at),
    trackingUrl: trackingUrl(request, row.share_token ?? null),
  };
}

function serializeContact(row: any) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone_e164,
    relationship: row.relationship ?? null,
  };
}

/** Rate-limit key: the citizen when the token decodes, else the address. */
function citizenKey(request: FastifyRequest): string {
  try {
    const decoded = request.server.jwt.decode<{ id?: string }>(
      (request.headers.authorization ?? '').replace(/^Bearer\s+/i, ''),
    );
    if (decoded?.id) return `citizen:${decoded.id}`;
  } catch { /* fall through to the address */ }
  return request.ip;
}

async function loadSender(db: PoolClient | typeof pool, citizen: string): Promise<SmsSender> {
  const result = await db.query(`SELECT full_name, phone FROM users WHERE id = $1`, [citizen]);
  const row = result.rows[0];
  return {
    name: row?.full_name ?? null,
    phone: row?.phone ? normalizePhone(row.phone) ?? row.phone : null,
  };
}

/**
 * Queues one SMS per current trusted contact. Returns how many were queued:
 * none without an SMS provider, when the citizen's phone sends instead.
 */
async function enqueueForContacts(
  client: PoolClient,
  alertId: string,
  citizen: string,
  kind: 'ALERT' | 'UPDATE' | 'SAFE' | 'UPDATES_STOPPED',
  body: string,
): Promise<number> {
  if (!isSmsEnabled()) return 0;
  const result = await client.query(
    `INSERT INTO sos_sms_deliveries (alert_id, contact_id, phone_e164, kind, body)
     SELECT $1, c.id, c.phone_e164, $3, $4
     FROM trusted_contacts c WHERE c.citizen_id = $2`,
    [alertId, citizen, kind, body],
  );
  return result.rowCount ?? 0;
}

function handleError(fastify: FastifyInstance, reply: FastifyReply, err: unknown) {
  if (err instanceof ZodError) return reply.status(400).send({ error: err.issues });
  fastify.log.error(err);
  return reply.status(500).send({ error: 'Internal Server Error' });
}

export default async function sosRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // ---------------------------------------------------------------------------
  // Trusted contacts
  // ---------------------------------------------------------------------------

  fastify.get('/contacts', auth, async (request, reply) => {
    try {
      const result = await query(
        `SELECT id, name, phone_e164, relationship FROM trusted_contacts
         WHERE citizen_id = $1 ORDER BY created_at, id`,
        [citizenId(request)],
      );
      return reply.send({
        contacts: result.rows.map(serializeContact),
        max: MAX_TRUSTED_CONTACTS,
        // False: the app sends alerts from the phone and hides the SMS update interval.
        smsEnabled: isSmsEnabled(),
      });
    } catch (err) {
      return handleError(fastify, reply, err);
    }
  });

  /** Normalises and checks a phone number, or replies with the reason it is unusable. */
  async function checkedPhone(raw: string, citizen: string, reply: FastifyReply): Promise<string | null> {
    const phone = normalizePhone(raw);
    if (!phone) {
      reply.status(400).send({ error: 'Enter a valid phone number, e.g. 0803 123 4567' });
      return null;
    }
    const own = await loadSender(pool, citizen);
    if (own.phone && own.phone === phone) {
      reply.status(400).send({ error: 'A trusted contact cannot be your own number' });
      return null;
    }
    return phone;
  }

  fastify.post('/contacts', auth, async (request, reply) => {
    try {
      const input = createContactSchema.parse(request.body);
      const citizen = citizenId(request);
      const count = await query(`SELECT COUNT(*)::int AS count FROM trusted_contacts WHERE citizen_id = $1`, [citizen]);
      if (Number(count.rows[0]?.count ?? 0) >= MAX_TRUSTED_CONTACTS) {
        return reply.status(409).send({ error: `You can add up to ${MAX_TRUSTED_CONTACTS} trusted contacts` });
      }
      const phone = await checkedPhone(input.phone, citizen, reply);
      if (!phone) return reply;
      const result = await query(
        `INSERT INTO trusted_contacts (citizen_id, name, phone_e164, relationship)
         VALUES ($1, $2, $3, $4) RETURNING id, name, phone_e164, relationship`,
        [citizen, input.name, phone, input.relationship ?? null],
      );
      return reply.status(201).send({ contact: serializeContact(result.rows[0]) });
    } catch (err: any) {
      if (err?.code === '23505') return reply.status(409).send({ error: 'This number is already a trusted contact' });
      return handleError(fastify, reply, err);
    }
  });

  fastify.patch('/contacts/:id', auth, async (request, reply) => {
    try {
      const id = contactIdSchema.parse((request.params as { id: string }).id);
      const input = updateContactSchema.parse(request.body);
      const citizen = citizenId(request);
      let phone: string | null = null;
      if (input.phone !== undefined) {
        phone = await checkedPhone(input.phone, citizen, reply);
        if (!phone) return reply;
      }
      const result = await query(
        `UPDATE trusted_contacts SET
           name = COALESCE($3, name),
           phone_e164 = COALESCE($4, phone_e164),
           relationship = CASE WHEN $5::boolean THEN $6 ELSE relationship END
         WHERE id = $1 AND citizen_id = $2
         RETURNING id, name, phone_e164, relationship`,
        // A relationship key that is present — even blank — is a deliberate
        // change; blank clears it.
        [id, citizen, input.name ?? null, phone,
          typeof (request.body as Record<string, unknown>)?.relationship === 'string', input.relationship ?? null],
      );
      if (!result.rows[0]) return reply.status(404).send({ error: 'Contact not found' });
      return reply.send({ contact: serializeContact(result.rows[0]) });
    } catch (err: any) {
      if (err?.code === '23505') return reply.status(409).send({ error: 'This number is already a trusted contact' });
      return handleError(fastify, reply, err);
    }
  });

  fastify.delete('/contacts/:id', auth, async (request, reply) => {
    try {
      const id = contactIdSchema.parse((request.params as { id: string }).id);
      const result = await query(
        `DELETE FROM trusted_contacts WHERE id = $1 AND citizen_id = $2`,
        [id, citizenId(request)],
      );
      if (!result.rowCount) return reply.status(404).send({ error: 'Contact not found' });
      return reply.status(204).send();
    } catch (err) {
      return handleError(fastify, reply, err);
    }
  });

  // ---------------------------------------------------------------------------
  // Help nearby
  // ---------------------------------------------------------------------------

  fastify.get('/nearby', auth, async (request, reply) => {
    try {
      const { type, lat, lon } = nearbySchema.parse(request.query);
      const rule = NEARBY_RULES[type];
      const here = { lat, lon };

      const [osm, curated] = await Promise.all([
        searchNearbyPlaces({ lat, lon, categories: rule.geoapify, radiusM: NEARBY_RADIUS_METERS, limit: 20 })
          .then((places) => ({ places, failed: false }))
          .catch((err) => {
            if (!(err instanceof GeoapifyUpstreamError) && !(err instanceof GeoapifyConfigError)) throw err;
            fastify.log.warn({ err }, 'Nearby place search unavailable; returning curated facilities only');
            return { places: [], failed: true };
          }),
        query(
          `SELECT id, kind, agency, name, address, phones,
                  ST_Y(geom::geometry) AS latitude, ST_X(geom::geometry) AS longitude
           FROM emergency_facilities
           WHERE kind = ANY($3::text[])
             AND ($4::text[] IS NULL OR agency = ANY($4::text[]))
             AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $5)
           ORDER BY geom <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
           LIMIT $6`,
          [lat, lon, rule.curated.kinds, rule.curated.agencies ?? null, NEARBY_RADIUS_METERS, NEARBY_LIMIT],
        ),
      ]);

      type Facility = {
        id: string; name: string; kind: FacilityKind; agency: string | null; address: string | null;
        phones: string[]; latitude: number; longitude: number; source: 'CURATED' | 'OSM';
      };
      const curatedFacilities: Facility[] = curated.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        kind: row.kind as FacilityKind,
        agency: row.agency as string | null,
        address: row.address as string | null,
        phones: (row.phones ?? []) as string[],
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        source: 'CURATED' as const,
      }));
      const osmFacilities: Facility[] = osm.places.map((place) => ({ ...place, agency: null, source: 'OSM' }));

      // Curated entries win a near-duplicate: their phone numbers are verified.
      const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const merged = [...curatedFacilities];
      for (const place of osmFacilities) {
        const duplicate = merged.some((existing) =>
          sameName(existing.name, place.name)
          && distanceMeters(
            { lat: existing.latitude, lon: existing.longitude },
            { lat: place.latitude, lon: place.longitude },
          ) < DUPLICATE_RADIUS_METERS);
        if (!duplicate) merged.push(place);
      }

      const facilities = merged
        .map((facility) => ({
          ...facility,
          distanceMeters: Math.round(distanceMeters(here, { lat: facility.latitude, lon: facility.longitude })),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, NEARBY_LIMIT);

      return reply.send({ facilities, hotlines: EMERGENCY_HOTLINES, partial: osm.failed });
    } catch (err) {
      return handleError(fastify, reply, err);
    }
  });

  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------

  fastify.get('/alerts/active', auth, async (request, reply) => {
    try {
      const result = await query<AlertRow>(
        `SELECT ${ALERT_COLUMNS} FROM sos_alerts WHERE citizen_id = $1 AND status = 'ACTIVE' LIMIT 1`,
        [citizenId(request)],
      );
      return reply.send({ alert: result.rows[0] ? serializeAlert(result.rows[0], request) : null });
    } catch (err) {
      return handleError(fastify, reply, err);
    }
  });

  fastify.post('/alerts', {
    ...auth,
    config: { rateLimit: { max: 5, timeWindow: '10 minutes', keyGenerator: citizenKey } },
  }, async (request, reply) => {
    let input;
    try {
      input = createAlertSchema.parse(request.body);
    } catch (err) {
      return handleError(fastify, reply, err);
    }
    const citizen = citizenId(request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // A retried request returns the alert it already created.
      const existing = await client.query<AlertRow>(
        `SELECT ${ALERT_COLUMNS} FROM sos_alerts WHERE client_alert_id = $1 AND citizen_id = $2`,
        [input.clientAlertId, citizen],
      );
      if (existing.rows[0]) {
        const queued = await client.query(
          `SELECT COUNT(*)::int AS count FROM sos_sms_deliveries WHERE alert_id = $1 AND kind = 'ALERT'`,
          [existing.rows[0].id],
        );
        await client.query('COMMIT');
        return reply.status(200).send({
          alert: serializeAlert(existing.rows[0], request),
          contactsQueued: Number(queued.rows[0]?.count ?? 0),
          smsEnabled: isSmsEnabled(),
        });
      }

      const active = await client.query<AlertRow>(
        `SELECT ${ALERT_COLUMNS} FROM sos_alerts WHERE citizen_id = $1 AND status = 'ACTIVE' FOR UPDATE`,
        [citizen],
      );
      if (active.rows[0]) {
        await client.query('COMMIT');
        return reply.status(409).send({
          error: 'You already have an active SOS alert',
          code: 'ALERT_ALREADY_ACTIVE',
          alert: serializeAlert(active.rows[0], request),
        });
      }

      const hasLocation = input.lat !== undefined && input.lon !== undefined;
      const created = await client.query<AlertRow>(
        `INSERT INTO sos_alerts (citizen_id, client_alert_id, emergency_type, latitude, longitude,
           accuracy, address, note, update_interval_minutes,
           last_pinged_at, last_pinged_lat, last_pinged_lon, share_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
           CASE WHEN $4::double precision IS NULL THEN NULL ELSE NOW() END, $4, $5, $10)
         RETURNING ${ALERT_COLUMNS}`,
        [citizen, input.clientAlertId, input.type, input.lat ?? null, input.lon ?? null,
          input.accuracy ?? null, input.address ?? null, input.note ?? null, input.updateIntervalMinutes,
          randomBytes(16).toString('base64url')],
      );
      const alert = created.rows[0];

      if (hasLocation) {
        await client.query(
          `INSERT INTO sos_location_updates (alert_id, latitude, longitude, accuracy, recorded_at, pinged)
           VALUES ($1, $2, $3, $4, NOW(), TRUE)`,
          [alert.id, input.lat, input.lon, input.accuracy ?? null],
        );
      }

      const sender = await loadSender(client, citizen);
      const body = buildAlertSms({
        sender,
        type: input.type,
        location: hasLocation
          ? { latitude: input.lat!, longitude: input.lon!, accuracy: input.accuracy, address: input.address }
          : null,
        note: input.note,
        updateIntervalMinutes: input.updateIntervalMinutes,
        trackingUrl: trackingUrl(request, alert.share_token),
        at: new Date(alert.created_at),
      });
      const contactsQueued = await enqueueForContacts(client, alert.id, citizen, 'ALERT', body);

      await client.query('COMMIT');
      return reply.status(201).send({
        alert: serializeAlert(alert, request),
        contactsQueued,
        smsEnabled: isSmsEnabled(),
        // Returned so the app can offer the same text through the phone's own
        // SMS app when server delivery is unavailable.
        message: body,
      });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      // Lost a race with a concurrent retry of the same request, or with a
      // second alert: report the one that won.
      if (err?.code === '23505') {
        const winner = await query<AlertRow>(
          `SELECT ${ALERT_COLUMNS} FROM sos_alerts
           WHERE citizen_id = $1 AND (client_alert_id = $2 OR status = 'ACTIVE')
           ORDER BY created_at DESC LIMIT 1`,
          [citizen, input.clientAlertId],
        );
        if (winner.rows[0]) {
          return reply.status(409).send({
            error: 'You already have an active SOS alert',
            code: 'ALERT_ALREADY_ACTIVE',
            alert: serializeAlert(winner.rows[0], request),
          });
        }
      }
      return handleError(fastify, reply, err);
    } finally {
      client.release();
    }
  });

  /** Loads and locks the citizen's alert, or replies 404. */
  async function lockAlert(client: PoolClient, request: FastifyRequest, reply: FastifyReply) {
    const publicId = alertPublicIdSchema.parse((request.params as { publicId: string }).publicId);
    const result = await client.query<AlertRow>(
      `SELECT ${ALERT_COLUMNS} FROM sos_alerts WHERE public_id = $1 AND citizen_id = $2 FOR UPDATE`,
      [publicId, citizenId(request)],
    );
    if (!result.rows[0]) {
      reply.status(404).send({ error: 'Alert not found' });
      return null;
    }
    return result.rows[0];
  }

  fastify.post('/alerts/:publicId/location', auth, async (request, reply) => {
    let input;
    try {
      input = locationUpdateSchema.parse(request.body);
      alertPublicIdSchema.parse((request.params as { publicId: string }).publicId);
    } catch (err) {
      return handleError(fastify, reply, err);
    }
    const citizen = citizenId(request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const alert = await lockAlert(client, request, reply);
      if (!alert) { await client.query('ROLLBACK'); return reply; }

      if (alert.status !== 'ACTIVE') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'This SOS alert has ended', stopUpdates: true });
      }
      if (alert.updates_stopped_at) {
        await client.query('ROLLBACK');
        return reply.send({ pinged: false, stopUpdates: true, alert: serializeAlert(alert, request) });
      }

      const now = new Date();
      const update = await client.query(
        `INSERT INTO sos_location_updates (alert_id, latitude, longitude, accuracy, recorded_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [alert.id, input.lat, input.lon, input.accuracy ?? null, input.recordedAt ?? now.toISOString()],
      );

      const sender = await loadSender(client, citizen);
      const ageHours = (now.getTime() - new Date(alert.created_at).getTime()) / 3_600_000;
      const intervalMs = Number(alert.update_interval_minutes) * 60_000;
      const due = alert.last_pinged_at == null
        || now.getTime() - new Date(alert.last_pinged_at).getTime() >= intervalMs;
      const moved = alert.last_pinged_lat == null || alert.last_pinged_lon == null
        || distanceMeters(
          { lat: alert.last_pinged_lat, lon: alert.last_pinged_lon },
          { lat: input.lat, lon: input.lon },
        ) >= MIN_MOVE_METERS;

      const stop = async () => {
        await client.query(`UPDATE sos_alerts SET updates_stopped_at = NOW() WHERE id = $1`, [alert.id]);
        await enqueueForContacts(client, alert.id, citizen, 'UPDATES_STOPPED', buildUpdatesStoppedSms(sender));
      };

      // The time cap applies even when the citizen has not moved.
      if (ageHours >= MAX_UPDATE_HOURS || Number(alert.ping_count) >= MAX_UPDATE_PINGS) {
        await stop();
        await client.query('COMMIT');
        return reply.send({ pinged: false, stopUpdates: true });
      }

      // Update texts need the server to send SMS; without a provider the
      // contacts follow the tracking link instead, and only the time cap applies.
      let pinged = false;
      let pingCount = Number(alert.ping_count);
      if (due && moved && isSmsEnabled()) {
        await enqueueForContacts(client, alert.id, citizen, 'UPDATE', buildUpdateSms({
          sender,
          location: { latitude: input.lat, longitude: input.lon, accuracy: input.accuracy, address: input.address },
          at: now,
        }));
        pingCount += 1;
        await client.query(
          `UPDATE sos_alerts SET last_pinged_at = NOW(), last_pinged_lat = $2, last_pinged_lon = $3,
             ping_count = $4 WHERE id = $1`,
          [alert.id, input.lat, input.lon, pingCount],
        );
        await client.query(`UPDATE sos_location_updates SET pinged = TRUE WHERE id = $1`, [update.rows[0].id]);
        pinged = true;
      }

      const stopUpdates = pingCount >= MAX_UPDATE_PINGS;
      if (stopUpdates) await stop();

      await client.query('COMMIT');
      const lastPinged = pinged ? now : alert.last_pinged_at ? new Date(alert.last_pinged_at) : now;
      return reply.send({
        pinged,
        stopUpdates,
        nextUpdateAfter: stopUpdates ? null : new Date(lastPinged.getTime() + intervalMs).toISOString(),
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return handleError(fastify, reply, err);
    } finally {
      client.release();
    }
  });

  fastify.post('/alerts/:publicId/safe', auth, async (request, reply) => {
    try {
      alertPublicIdSchema.parse((request.params as { publicId: string }).publicId);
    } catch (err) {
      return handleError(fastify, reply, err);
    }
    const citizen = citizenId(request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const alert = await lockAlert(client, request, reply);
      if (!alert) { await client.query('ROLLBACK'); return reply; }
      if (alert.status !== 'ACTIVE') {
        await client.query('ROLLBACK');
        return reply.status(409).send({ error: 'This SOS alert has already ended' });
      }

      const resolved = await client.query<AlertRow>(
        `UPDATE sos_alerts SET status = 'RESOLVED', resolved_at = NOW(),
           updates_stopped_at = COALESCE(updates_stopped_at, NOW())
         WHERE id = $1 RETURNING ${ALERT_COLUMNS}`,
        [alert.id],
      );
      // Unsent location updates are now stale; the safe message replaces them.
      await client.query(
        `UPDATE sos_sms_deliveries SET status = 'CANCELLED', updated_at = NOW()
         WHERE alert_id = $1 AND kind IN ('UPDATE', 'UPDATES_STOPPED') AND status = 'PENDING'`,
        [alert.id],
      );
      const sender = await loadSender(client, citizen);
      const message = buildSafeSms(sender);
      await enqueueForContacts(client, alert.id, citizen, 'SAFE', message);
      await client.query('COMMIT');
      return reply.send({
        alert: serializeAlert(resolved.rows[0], request),
        smsEnabled: isSmsEnabled(),
        // For the phone's own messages app when the server cannot send SMS.
        message,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return handleError(fastify, reply, err);
    } finally {
      client.release();
    }
  });
}
