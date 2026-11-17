# SOS

SOS lets a citizen find emergency help near them and alert people they trust. It is **citizen-side only**:
- No responder is dispatched.
- Nothing appears on the government dashboard.
- The app always makes **Call 112** the main action.

## What it does

1. **Help nearby.** The citizen picks an emergency type, and the app lists the nearest relevant facilities with distance, a call button and directions.
2. **Alert trusted contacts.** Up to 5 contacts, entered by phone number, get an SMS with:
   - the emergency type
   - a map link and its accuracy
   - the time (WAT)
   - the citizen's callback number
   - an optional note
   - a private **live location link** (see below)
3. **Live location.** While the alert is active, the phone reports its position to the API (every minute while there is a live link). Contacts open the link in any browser and see a map that refreshes every 30 s. No app or account is needed.
   - Sharing stops after **6 hours**, or when the citizen taps **I'm safe**. The page then shows "Marked safe" or "Live location sharing has ended", and no location.

### Who sends the texts

**Default: the citizen's phone.** With no SMS provider configured, the server sends nothing.
- The app opens the citizen's messages app with the alert and the live link filled in, **addressed to one contact at a time**. The citizen taps **Send**. When they come back to the app, it opens the text for the next contact. A **Text <name> (2 of 3)** button does the same if it does not.
  - Never all contacts in one message: a text to several people becomes a group MMS. Group MMS needs mobile data and the carrier's MMS settings, and is often blocked or silently fails.
- **Resend link** starts again from the first contact if they backed out without sending.
- **I'm safe** opens an "I'm safe" text for each contact the same way. It is the only way to stop sharing location; there is no separate stop button.
- The 15/30-minute picker is hidden, because there are no update texts; the live link replaces them.

**The name in the texts** is the citizen's full name or, when they have none (common after social sign-in), a name built from their email (`ada.obi@…` → "Ada Obi"), the same rule the app's home screen uses. The live page shows the first word of it.

**With a provider (Termii or Twilio):** the server texts the alert itself, then update texts at most once every **15 or 30 minutes** (the citizen chooses), **only if the citizen has moved at least 100 m**.
- Update texts stop after **12 updates or 6 hours**, whichever comes first, and contacts are told.
- **I'm safe** texts contacts from the server.

The live link is included in both modes.

| Emergency type | Searched in OpenStreetMap (Geoapify) | Curated facilities |
|---|---|---|
| Medical | hospitals, clinics | hospitals |
| Security | police | police, paramilitary (NSCDC…) |
| Fire | fire stations | fire |
| Road accident | hospitals, police | FRSC |

## API

All routes are under `/api/sos` and need a citizen token.

| Route | Purpose |
|---|---|
| `GET /contacts` | List contacts (`max` = 5), plus `smsEnabled` (false = alerts are sent from the phone) |
| `POST /contacts` | Add `{ name, phone, relationship? }`. Numbers are normalised to E.164 (`0803…` → `+234803…`). Returns 409 at the limit or for a duplicate, and 400 for an invalid number or the citizen's own number. |
| `PATCH /contacts/:id`, `DELETE /contacts/:id` | Edit or remove one of the citizen's own contacts |
| `GET /nearby?type&lat&lon` | `{ facilities, hotlines, partial }`. Curated and OSM results are merged and de-duplicated (same name within 100 m, with the curated entry kept), sorted by distance, top 15 within 25 km. `partial: true` means Geoapify was unavailable and only curated results are included. |
| `GET /alerts/active` | The citizen's active alert, or `null` |
| `POST /alerts` | `{ clientAlertId, type, updateIntervalMinutes: 15\|30, lat?, lon?, accuracy?, address?, note? }`. Idempotent on `clientAlertId`. Returns 409 `ALERT_ALREADY_ACTIVE` (with the active alert) if one already exists. The response includes `contactsQueued`, `smsEnabled`, and `message` (the SMS text, so the app can offer it through the phone's SMS app). `alert.trackingUrl` is the live link. Limited to 5 per 10 min per citizen. |
| `POST /alerts/:publicId/location` | `{ lat, lon, accuracy?, address?, recordedAt? }`. Always recorded, and shown on the live page. With a provider, the server decides whether to send an update SMS (see above). Returns `{ pinged, stopUpdates, nextUpdateAfter }`. |
| `POST /alerts/:publicId/safe` | Resolves the alert, cancels unsent updates, and texts contacts (with a provider). Returns `smsEnabled` and `message` (the safe text, for the phone to send). |

**Public, no login** (the token in the link is the only credential):

| Route | Purpose |
|---|---|
| `GET /t/:token` | The live tracking page: a Leaflet + OpenStreetMap map, "updated X min ago", and Call 112. It polls the route below every 30 s. |
| `GET /api/sos/track/:token` | `{ type, typeLabel, status, firstName, startedAt, resolvedAt, sharingEnded, latest }`. `latest` is the newest reported position, or `null` once the alert is resolved, updates have stopped, or 6 hours have passed. Unknown tokens get 404. |

Both are limited to 60 requests per minute per IP and send `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. The page uses a nonce-based Content Security Policy.

The link is `<PUBLIC_BASE_URL>/t/<token>`, where the token is 16 random bytes in base64url (`sos_alerts.share_token`). **Set `PUBLIC_BASE_URL`** to the API's public https origin in production (for example `https://civic-ai-fq8e.onrender.com`). Without it, the request's own origin is used, which is `http://` behind Render's proxy.

`/nearby` is limited to 30 requests per minute, because Geoapify charges per request.

## SMS delivery

Texts are queued in `sos_sms_deliveries` inside the same transaction that creates the alert or update. `src/notifications/sms_worker.ts` sends them with retries after 30 s, 2 min, 10 min and 1 h, after which the delivery is marked FAILED. Each message is reduced to plain ASCII and kept to **2 SMS segments (306 characters)** or fewer: one emoji would switch the whole message to UCS-2 and roughly triple the cost.

**Provider setup (Termii):**
1. Create a Termii account and **register a sender ID** (for example `CivicAI`). Approval can take days.
2. Use the `dnd` channel so numbers on the do-not-disturb register still receive the alert.
3. Set `SMS_PROVIDER=termii`, `TERMII_API_KEY` and `TERMII_SENDER_ID`. Set `TERMII_BASE_URL` too if your account uses a different base URL.

**Twilio** works without a Nigerian business registration: set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. Trial accounts only reach verified numbers.

**Without a provider** (the default, in development and production alike): nothing is queued, `smsEnabled` is `false`, and the phone sends the texts (see "Who sends the texts").

**Cost bound (with a provider):** worst case, 5 contacts × (1 alert + 12 updates + 1 stopped/safe notice) = 70 SMS per alert. Typically it is far fewer, because no update is sent while the citizen isn't moving.

## Facility data

Nigeria has no single public directory of emergency responders.
- **Geoapify Places** (OpenStreetMap) covers police stations, hospitals and fire stations, with uneven coverage.
- **Curated facilities** fill the gaps, especially paramilitary commands (NSCDC, FRSC and others), which OpenStreetMap rarely has.

To add curated facilities:
1. Copy each entry from an **official source**: the agency's `.gov.ng` site or official account. Examples include the NSCDC command structure page, FRSC state commands, and the NPF station finder.
2. Add it to `supabase/seed/emergency_facilities.csv` with its `source_url` and a `verified_at` date.
3. Load the file:
   ```
   cd services/api
   npx tsx scripts/import-facilities.ts ../../supabase/seed/emergency_facilities.csv
   ```

The import validates kinds, https sources, state codes and Nigerian coordinates, and upserts on (agency, name, state). Open datasets such as GRID3 police stations and the Sambus fire stations could be imported the same way later.

## Hotlines

`src/lib/emergency-hotlines.ts` lists only numbers verified against an official source. Currently that is **112**.

Candidates to verify before adding, each against the agency's own site:
- NPF emergency lines
- FRSC (122)
- NSCDC
- Federal Fire Service
- state emergency numbers such as Lagos 767

A wrong number on an emergency screen is worse than a missing one.

## Privacy and retention

**Who can see the citizen's location:**
- Location is shared only with the contacts the citizen chose, by SMS and through the live link in it.
- Anyone the link is forwarded to can also see it until the alert ends. The page shows only the first name and emergency type: no phone number and no note. It stops showing a location as soon as the alert ends.
- It is never shown to government operators.
- Phone numbers and message text are never written to logs, except the development console fallback.

**What is stored:**
- `sos_alerts`, `sos_location_updates` and `sos_sms_deliveries`
- trusted contacts' names and numbers

**Retention:** all of this is precise personal data. Agree a retention period before release, for example deleting location updates 30 days after an alert is resolved. Deleting a citizen's account removes all of it (`ON DELETE CASCADE`).
