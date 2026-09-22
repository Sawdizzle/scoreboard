// Local weather for the venue, from Open-Meteo (free, no key, CORS open).
// The pad geocodes the venue once and stores {label, query, lat, lon, tz} on
// the game; the overlay reads the forecast itself every few minutes. Nothing
// here touches the database.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

// Two decimals is ~1 km: plenty for a forecast, and the games row is public,
// so it should not pinpoint the field.
const round2 = (n) => Math.round(Number(n) * 100) / 100;

const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
  Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC',
};

// "76227", "Aubrey TX", "Aubrey, Texas" → one place. A 5-digit query is a US
// ZIP; a trailing state (name or abbreviation) narrows a town that exists in
// several states, which the search alone would answer with the biggest one.
export async function geocode(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const zip = /^\d{5}$/.test(q);
  const parts = q.split(/[,\s]+/).filter(Boolean);
  let name = q, state = null;
  if (!zip && parts.length > 1) {
    const tail = parts[parts.length - 1];
    const tail2 = parts.slice(-2).join(' ');
    const byName = (s) => Object.keys(STATE_ABBR).find((k) => k.toLowerCase() === s.toLowerCase());
    const abbr = Object.values(STATE_ABBR).find((a) => a === tail.toUpperCase());
    if (byName(tail2)) { state = byName(tail2); name = parts.slice(0, -2).join(' '); }
    else if (byName(tail)) { state = byName(tail); name = parts.slice(0, -1).join(' '); }
    else if (abbr) { state = Object.keys(STATE_ABBR).find((k) => STATE_ABBR[k] === abbr); name = parts.slice(0, -1).join(' '); }
  }
  const url = `${GEO}?name=${encodeURIComponent(name)}&count=10&language=en&format=json${zip || state ? '&countryCode=US' : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const list = (await res.json()).results || [];
  const hit = (state && list.find((r) => r.admin1 === state)) || list[0];
  if (!hit) return null;
  const region = hit.country_code === 'US' ? (STATE_ABBR[hit.admin1] || hit.admin1) : (hit.admin1 || hit.country);
  return {
    label: region ? `${hit.name}, ${region}` : hit.name,
    query: q,
    lat: round2(hit.latitude),
    lon: round2(hit.longitude),
    tz: hit.timezone || null,
  };
}

// WMO weather codes → an icon and a word. Night swaps the sun for a moon.
function describe(code, day) {
  const c = code | 0;
  if (c === 0) return { icon: day ? '☀️' : '🌙', text: 'Clear' };
  if (c === 1) return { icon: day ? '🌤️' : '🌙', text: 'Mostly clear' };
  if (c === 2) return { icon: day ? '⛅' : '☁️', text: 'Partly cloudy' };
  if (c === 3) return { icon: '☁️', text: 'Overcast' };
  if (c === 45 || c === 48) return { icon: '🌫️', text: 'Fog' };
  if (c >= 51 && c <= 57) return { icon: '🌦️', text: 'Drizzle' };
  if (c >= 61 && c <= 67) return { icon: '🌧️', text: c >= 65 ? 'Heavy rain' : 'Rain' };
  if (c >= 71 && c <= 77) return { icon: '🌨️', text: 'Snow' };
  if (c >= 80 && c <= 82) return { icon: '🌧️', text: 'Showers' };
  if (c === 85 || c === 86) return { icon: '🌨️', text: 'Snow showers' };
  if (c >= 95) return { icon: '⛈️', text: c >= 96 ? 'Storms · hail' : 'Thunderstorms' };
  return { icon: '🌡️', text: '' };
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round(((Number(deg) % 360) + 360) % 360 / 45) % 8];

// Now, plus the rain chance for the hour of `at` (first pitch) when it falls in
// the forecast, else for this hour.
export async function fetchWeather(venue, at = null) {
  if (!venue || venue.lat == null || venue.lon == null) return null;
  const url = `${FORECAST}?latitude=${venue.lat}&longitude=${venue.lon}`
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day'
    + '&hourly=precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph'
    + '&timezone=GMT&timeformat=unixtime&forecast_days=2';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const d = await res.json();
  const cur = d.current || {};
  const times = (d.hourly && d.hourly.time) || [];
  const pops = (d.hourly && d.hourly.precipitation_probability) || [];
  // Never an hour already gone: once first pitch has passed, the chance is for now.
  const want = Math.floor(Math.max(at ? new Date(at).getTime() || 0 : 0, Date.now()) / 1000);
  let i = times.findIndex((t) => t > want) - 1;
  if (i < 0) i = times.length && want >= times[0] ? times.length - 1 : 0;
  const pop = pops[i];
  return {
    temp: Math.round(cur.temperature_2m),
    feels: Math.round(cur.apparent_temperature),
    wind: Math.round(cur.wind_speed_10m),
    gust: Math.round(cur.wind_gusts_10m),
    dir: compass(cur.wind_direction_10m),
    pop: Number.isFinite(pop) ? pop : null,
    code: cur.weather_code | 0,
    ...describe(cur.weather_code, cur.is_day !== 0),
    at: Date.now(),
  };
}
