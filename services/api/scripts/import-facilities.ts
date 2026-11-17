/**
 * Loads curated emergency facilities (paramilitary commands, and any police,
 * fire or hospital entries OpenStreetMap is missing) into emergency_facilities.
 *
 *   npx tsx scripts/import-facilities.ts ../../supabase/seed/emergency_facilities.csv
 *
 * CSV columns (header required):
 *   kind,agency,name,address,phones,state_code,latitude,longitude,source_url,verified_at
 *
 * - kind: POLICE | FIRE | HOSPITAL | PARAMILITARY
 * - phones: separated by `;`
 * - state_code: nigeria_states.code
 * - source_url: the official page the entry was taken from (required)
 * - verified_at: YYYY-MM-DD the details were last checked against the source
 *
 * Lines starting with `#` are ignored. Rows upsert on (agency, name, state).
 * Every row must come from an official source: these appear on an emergency
 * screen, and a wrong number there is worse than a missing one.
 */
import fs from 'node:fs';
import { pool } from '../src/db';

const COLUMNS = ['kind', 'agency', 'name', 'address', 'phones', 'state_code',
  'latitude', 'longitude', 'source_url', 'verified_at'] as const;
const KINDS = new Set(['POLICE', 'FIRE', 'HOSPITAL', 'PARAMILITARY']);

/** Minimal RFC 4180 parsing: quoted fields, escaped quotes, commas in quotes. */
function parseLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: tsx scripts/import-facilities.ts <file.csv>');

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  const header = parseLine(lines.shift() ?? '');
  if (COLUMNS.some((column, i) => header[i] !== column)) {
    throw new Error(`Unexpected header. Expected: ${COLUMNS.join(',')}`);
  }

  let imported = 0;
  for (const [index, line] of lines.entries()) {
    const row = Object.fromEntries(parseLine(line).map((value, i) => [COLUMNS[i], value])) as Record<
      (typeof COLUMNS)[number], string>;
    const where = `row ${index + 2} (${row.name || 'unnamed'})`;
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!KINDS.has(row.kind)) throw new Error(`${where}: kind must be one of ${[...KINDS].join(', ')}`);
    if (!row.agency || !row.name) throw new Error(`${where}: agency and name are required`);
    if (!row.source_url?.startsWith('https://')) throw new Error(`${where}: source_url must be an https link`);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(`${where}: invalid coordinates`);
    // Nigeria's bounding box, roughly: catches swapped lat/lon.
    if (latitude < 4 || latitude > 14 || longitude < 2.5 || longitude > 15) {
      throw new Error(`${where}: coordinates are outside Nigeria (latitude/longitude swapped?)`);
    }

    const result = await pool.query(
      `INSERT INTO emergency_facilities
         (kind, agency, name, address, phones, state_id, geom, source_url, verified_at)
       SELECT $1, $2, $3, NULLIF($4, ''), $5::text[], s.id,
              ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, NULLIF($9, '')::date
       FROM nigeria_states s WHERE s.code = $10
       ON CONFLICT (agency, name, state_id) DO UPDATE SET
         kind = EXCLUDED.kind, address = EXCLUDED.address, phones = EXCLUDED.phones,
         geom = EXCLUDED.geom, source_url = EXCLUDED.source_url, verified_at = EXCLUDED.verified_at`,
      [row.kind, row.agency.toUpperCase(), row.name, row.address ?? '',
        (row.phones ?? '').split(';').map((p) => p.trim()).filter(Boolean),
        latitude, longitude, row.source_url, row.verified_at ?? '', row.state_code],
    );
    if (!result.rowCount) throw new Error(`${where}: unknown state_code "${row.state_code}"`);
    imported += 1;
  }
  console.log(`Imported ${imported} facilities.`);
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => pool.end());
