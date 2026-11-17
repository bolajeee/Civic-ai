import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyReply } from 'fastify';
import { query } from '../db';
import { displayName, EmergencyType } from '../lib/sos-messages';
import { shareTokenSchema } from '../schemas/sos';
import { MAX_UPDATE_HOURS } from './sos';

/**
 * Public live-tracking page for an SOS alert. A trusted contact opens the link
 * from the alert text (no app, no account) and sees the citizen's latest
 * reported position while the alert is active.
 *
 * Privacy: the unguessable token in the link is the only credential. The page
 * shows the first name and emergency type, never the phone number or note, and
 * stops showing a location as soon as the alert ends or sharing times out.
 */

const TYPE_LABELS: Record<EmergencyType, string> = {
  MEDICAL: 'Medical',
  SECURITY: 'Security',
  FIRE: 'Fire',
  ACCIDENT: 'Road accident',
};

/** Two viewers polling every 30 s stay well inside this, per IP. */
const rateLimit = { max: 60, timeWindow: '1 minute' };

function privateHeaders(reply: FastifyReply): FastifyReply {
  return reply
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Robots-Tag', 'noindex, nofollow');
}

const iso = (value: Date | string | null) => (value == null ? null : new Date(value).toISOString());

export default async function sosTrackRoutes(fastify: FastifyInstance) {
  fastify.get('/api/sos/track/:token', { config: { rateLimit } }, async (request, reply) => {
    privateHeaders(reply);
    const token = shareTokenSchema.safeParse((request.params as { token: string }).token);
    if (!token.success) return reply.status(404).send({ error: 'Tracking link not found' });

    const alerts = await query(
      `SELECT a.id, a.emergency_type, a.status, a.created_at, a.resolved_at, a.updates_stopped_at,
              u.full_name, u.email
       FROM sos_alerts a JOIN users u ON u.id = a.citizen_id
       WHERE a.share_token = $1`,
      [token.data],
    );
    const alert = alerts.rows[0];
    if (!alert) return reply.status(404).send({ error: 'Tracking link not found' });

    const active = alert.status === 'ACTIVE';
    const timedOut = Date.now() - new Date(alert.created_at).getTime() >= MAX_UPDATE_HOURS * 3_600_000;
    const sharingEnded = !active || alert.updates_stopped_at != null || timedOut;

    let latest = null;
    if (!sharingEnded) {
      const updates = await query(
        `SELECT latitude, longitude, accuracy, recorded_at FROM sos_location_updates
         WHERE alert_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [alert.id],
      );
      const row = updates.rows[0];
      if (row) {
        latest = {
          lat: Number(row.latitude),
          lon: Number(row.longitude),
          accuracy: row.accuracy == null ? null : Number(row.accuracy),
          recordedAt: iso(row.recorded_at),
        };
      }
    }

    const firstName = (displayName(alert.full_name, alert.email) ?? '').split(/\s+/)[0] || null;
    return reply.send({
      type: alert.emergency_type,
      typeLabel: TYPE_LABELS[alert.emergency_type as EmergencyType] ?? 'Emergency',
      status: alert.status,
      firstName,
      startedAt: iso(alert.created_at),
      resolvedAt: iso(alert.resolved_at),
      sharingEnded,
      latest,
    });
  });

  fastify.get('/t/:token', { config: { rateLimit } }, async (request, reply) => {
    privateHeaders(reply);
    const token = shareTokenSchema.safeParse((request.params as { token: string }).token);
    const nonce = randomBytes(16).toString('base64');
    return reply
      .status(token.success ? 200 : 404)
      .header('Content-Security-Policy', [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com`,
        "style-src 'unsafe-inline' https://cdnjs.cloudflare.com",
        'img-src data: https://*.tile.openstreetmap.org https://cdnjs.cloudflare.com',
        "connect-src 'self'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; '))
      .type('text/html; charset=utf-8')
      .send(trackingPage(token.success ? token.data : null, nonce));
  });
}

/** The page. [token] is already validated (URL-safe base64), so it is safe to embed. */
function trackingPage(token: string | null, nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>CivicAI SOS location</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
  :root { --bg:#fff; --fg:#111827; --muted:#4b5563; --card:#f3f4f6; --red:#b91c1c; --green:#15803d; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0f17; --fg:#f3f4f6; --muted:#9ca3af; --card:#1f2937; --red:#f87171; --green:#4ade80; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:16px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .status { color:var(--muted); margin:0; }
  .status.alert { color:var(--red); font-weight:600; }
  .status.safe { color:var(--green); font-weight:600; }
  #map { height:60vh; min-height:280px; background:var(--card); }
  #map[hidden] { display:none; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; padding:16px; }
  .actions a { flex:1 1 140px; text-align:center; padding:12px 16px; border-radius:999px; font-weight:600; text-decoration:none; }
  .call { background:var(--red); color:#fff; }
  .maps { background:var(--card); color:var(--fg); }
  .maps[hidden] { display:none; }
  footer { padding:0 16px 24px; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<header>
  <h1 id="title">SOS location</h1>
  <p id="status" class="status">Loading...</p>
</header>
<div id="map" hidden></div>
<div class="actions">
  <a class="call" href="tel:112">Call 112</a>
  <a class="maps" id="maps" target="_blank" rel="noopener noreferrer" hidden>Open in Google Maps</a>
</div>
<footer>Shared through CivicAI. This page updates by itself; keep it open. Location stops being shown when the SOS ends.</footer>
<script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script nonce="${nonce}">
(function () {
  var token = ${JSON.stringify(token)};
  var title = document.getElementById('title');
  var statusEl = document.getElementById('status');
  var mapEl = document.getElementById('map');
  var mapsLink = document.getElementById('maps');
  var map = null, marker = null, circle = null, timer = null, last = null;

  function setStatus(text, tone) { statusEl.textContent = text; statusEl.className = 'status' + (tone ? ' ' + tone : ''); }
  function ago(iso) {
    var mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    return mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : mins < 60 ? mins + ' minutes ago'
      : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min ago';
  }
  function time(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function stop() { last = null; if (timer) { clearInterval(timer); timer = null; } }
  function hideMap() { mapEl.hidden = true; mapsLink.hidden = true; }

  function show(data) {
    var who = data.firstName || 'Your contact';
    title.textContent = who + ' - ' + data.typeLabel + ' SOS';
    if (data.status === 'RESOLVED') {
      stop(); hideMap();
      setStatus(who + ' marked themselves safe' + (data.resolvedAt ? ' at ' + time(data.resolvedAt) : '') + '.', 'safe');
      return;
    }
    if (data.sharingEnded) {
      stop(); hideMap();
      setStatus('Live location sharing has ended. Call ' + who + ' to check on them.', 'alert');
      return;
    }
    if (!data.latest) { hideMap(); setStatus('SOS active. Waiting for ' + who + "'s location...", 'alert'); return; }
    last = data.latest;
    var here = [last.lat, last.lon];
    mapEl.hidden = false;
    mapsLink.hidden = false;
    mapsLink.href = 'https://maps.google.com/?q=' + last.lat.toFixed(5) + ',' + last.lon.toFixed(5);
    if (window.L) {
      if (!map) {
        map = L.map(mapEl).setView(here, 16);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
        marker = L.marker(here).addTo(map);
        circle = L.circle(here, { radius: last.accuracy || 0, weight: 1 }).addTo(map);
      } else {
        marker.setLatLng(here);
        circle.setLatLng(here).setRadius(last.accuracy || 0);
        if (!map.getBounds().contains(here)) map.panTo(here);
      }
    }
    renderTime();
  }
  function renderTime() {
    if (!last) return;
    var accuracy = last.accuracy ? ' (within ' + Math.max(1, Math.round(last.accuracy)) + ' m)' : '';
    setStatus('SOS active. Location updated ' + ago(last.recordedAt) + accuracy + '.', 'alert');
  }

  function poll() {
    fetch('/api/sos/track/' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 404) { stop(); hideMap(); setStatus('This link is not valid or has expired.'); return null; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) { if (data) show(data); })
      .catch(function () {
        if (last) renderTime();
        else setStatus('Could not load the location. Retrying...');
      });
  }

  if (!token) { setStatus('This link is not valid or has expired.'); return; }
  poll();
  timer = setInterval(poll, 30000);
  setInterval(renderTime, 30000);
})();
</script>
</body>
</html>`;
}
