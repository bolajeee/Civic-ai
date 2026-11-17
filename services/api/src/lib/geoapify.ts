/**
 * Thin client over Geoapify's autocomplete endpoint. Kept isolated from the
 * route so the Flutter-facing response shape survives a provider swap if
 * Geoapify's Nigerian coverage turns out to be inadequate.
 */

const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const GEOAPIFY_PLACES_URL = 'https://api.geoapify.com/v2/places';

export interface LocationSearchParams {
  q: string;
  limit: number;
  lat?: number;
  lon?: number;
}

export interface LocationSuggestion {
  id: string;
  label: string;
  address: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
}

export class GeoapifyConfigError extends Error {}
export class GeoapifyUpstreamError extends Error {}

interface GeoapifyFeature {
  properties: {
    place_id?: string;
    formatted?: string;
    address_line1?: string;
    address_line2?: string;
    lat: number;
    lon: number;
    result_type?: string;
    category?: string;
  };
}

interface GeoapifyResponse {
  features: GeoapifyFeature[];
}

function apiKey(): string {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new GeoapifyConfigError('GEOAPIFY_API_KEY is not configured');
  return key;
}

export async function searchLocations({
  q,
  limit,
  lat,
  lon,
}: LocationSearchParams): Promise<LocationSuggestion[]> {
  const params = new URLSearchParams({
    text: q,
    limit: String(limit),
    filter: 'countrycode:ng',
    apiKey: apiKey(),
  });
  if (lat !== undefined && lon !== undefined) {
    params.set('bias', `proximity:${lon},${lat}`);
  }

  let response: Response;
  try {
    response = await fetch(`${GEOAPIFY_AUTOCOMPLETE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new GeoapifyUpstreamError('Geoapify request failed', { cause: err });
  }

  if (!response.ok) {
    throw new GeoapifyUpstreamError(`Geoapify responded with ${response.status}`);
  }

  const body = (await response.json()) as GeoapifyResponse;
  return (body.features ?? []).map((feature, index) => {
    const props = feature.properties;
    return {
      id: props.place_id ?? `${props.lat},${props.lon},${index}`,
      label: props.formatted ?? props.address_line1 ?? q,
      address: props.address_line2 ?? props.formatted ?? null,
      latitude: props.lat,
      longitude: props.lon,
      category: props.category ?? props.result_type ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Nearby places (SOS)
// ---------------------------------------------------------------------------

export type FacilityKind = 'POLICE' | 'FIRE' | 'HOSPITAL' | 'PARAMILITARY';

export interface NearbyPlace {
  id: string;
  name: string;
  kind: FacilityKind;
  address: string | null;
  phones: string[];
  latitude: number;
  longitude: number;
}

interface GeoapifyPlaceFeature {
  properties: {
    place_id?: string;
    name?: string;
    formatted?: string;
    address_line2?: string;
    lat: number;
    lon: number;
    categories?: string[];
    contact?: { phone?: string };
    datasource?: { raw?: { phone?: string; 'contact:phone'?: string } };
  };
}

const KIND_FALLBACK_NAMES: Record<FacilityKind, string> = {
  POLICE: 'Police station',
  FIRE: 'Fire station',
  HOSPITAL: 'Hospital',
  PARAMILITARY: 'Command office',
};

function kindFor(categories: string[] = []): FacilityKind {
  if (categories.some((c) => c.startsWith('service.police'))) return 'POLICE';
  if (categories.some((c) => c.startsWith('service.fire_station'))) return 'FIRE';
  return 'HOSPITAL';
}

/** Splits OSM's `;`-separated phone values into individual numbers. */
function phonesFrom(props: GeoapifyPlaceFeature['properties']): string[] {
  const raw = props.contact?.phone ?? props.datasource?.raw?.phone ?? props.datasource?.raw?.['contact:phone'];
  if (!raw) return [];
  return raw.split(/[;,]/).map((p) => p.trim()).filter(Boolean).slice(0, 3);
}

/**
 * Emergency-relevant places within [radiusM] metres of a point, from
 * Geoapify's Places API (OpenStreetMap data). Distance is computed by the
 * caller, which also merges in curated facilities.
 */
export async function searchNearbyPlaces(input: {
  lat: number;
  lon: number;
  categories: string[];
  radiusM: number;
  limit: number;
}): Promise<NearbyPlace[]> {
  const params = new URLSearchParams({
    categories: input.categories.join(','),
    filter: `circle:${input.lon},${input.lat},${input.radiusM}`,
    bias: `proximity:${input.lon},${input.lat}`,
    limit: String(input.limit),
    apiKey: apiKey(),
  });

  let response: Response;
  try {
    response = await fetch(`${GEOAPIFY_PLACES_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new GeoapifyUpstreamError('Geoapify places request failed', { cause: err });
  }
  if (!response.ok) {
    throw new GeoapifyUpstreamError(`Geoapify places responded with ${response.status}`);
  }

  const body = (await response.json()) as { features?: GeoapifyPlaceFeature[] };
  return (body.features ?? []).map((feature, index) => {
    const props = feature.properties;
    const kind = kindFor(props.categories);
    return {
      id: props.place_id ?? `osm-${props.lat},${props.lon},${index}`,
      name: props.name?.trim() || KIND_FALLBACK_NAMES[kind],
      kind,
      address: props.address_line2 ?? props.formatted ?? null,
      phones: phonesFrom(props),
      latitude: props.lat,
      longitude: props.lon,
    };
  });
}
