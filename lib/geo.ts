// A street address, as a place the weather can be read for. The US Census
// geocoder (free, no key) finds a street address; when it cannot (a park with
// no number, a town, a ZIP), the address's ZIP or its town goes to Open-Meteo's
// place search, as v4's ZIP box did. Coordinates are rounded to two decimals
// (about 1 km): enough for a forecast, and the games row is public.
import { geocode } from './fx/weather.js';

export type Geo = { label: string; query: string; lat: number; lon: number; tz: string | null };

const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const round2 = (n: number) => Math.round(n * 100) / 100;
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

async function census(address: string): Promise<Geo | null> {
  const url = `${CENSUS}?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const hit = (await res.json())?.result?.addressMatches?.[0];
  if (!hit?.coordinates) return null;
  const c = hit.addressComponents ?? {};
  return {
    label: [c.city ? title(c.city) : null, c.state].filter(Boolean).join(', ') || address,
    query: address, lat: round2(Number(hit.coordinates.y)), lon: round2(Number(hit.coordinates.x)), tz: null,
  };
}

// Where to look when the street is not found: the ZIP, else the town and state.
export function fallbackQuery(address: string) {
  const zip = /\b(\d{5})(?:-\d{4})?\b/.exec(address);
  if (zip) return zip[1];
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(' ') : address;
}

export async function geocodeAddress(address: string): Promise<Geo | null> {
  const a = address.trim();
  if (!a) return null;
  // A bare ZIP or town needs no street lookup.
  if (/\d+\s+\S+/.test(a) && !/^\d{5}$/.test(a)) {
    try { const hit = await census(a); if (hit) return hit; } catch { /* fall through to the town */ }
  }
  const hit = (await geocode(fallbackQuery(a))) as Omit<Geo, 'query'> | null;
  return hit ? { ...hit, query: a } : null;
}

// A link that opens the phone's maps app with directions to the field.
export const directionsUrl = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

// A tournament link as typed: a bare domain gets https://, anything else that
// is not a web address is refused.
export function tournamentUrl(raw: string): string | null | false {
  const v = raw.trim();
  if (!v) return null;
  const url = /^https?:\/\//i.test(v) ? v.replace(/^http:\/\//i, 'https://') : `https://${v}`;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.includes('.') && url.length <= 300 ? u.toString() : false;
  } catch { return false; }
}
