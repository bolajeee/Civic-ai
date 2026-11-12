/**
 * Thin client over Geoapify's autocomplete endpoint. Kept isolated from the
 * route so the Flutter-facing response shape survives a provider swap if
 * Geoapify's Nigerian coverage turns out to be inadequate.
 */

const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';

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
