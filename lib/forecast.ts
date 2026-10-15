// The weather for a game: the forecast for its first pitch, or the weather
// right now once it is under way. Open-Meteo, free and keyless, read from the
// browser (it allows that), up to sixteen days out.
export type Sky = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'storm' | 'snow';
export type Forecast = { sky: Sky; night: boolean; text: string; temp: number; pop: number | null; wind: number; dir: string; now: boolean };

const API = 'https://api.open-meteo.com/v1/forecast';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// WMO weather codes, as a sky to draw and a word.
export function skyOf(code: number): { sky: Sky; text: string } {
  const c = code | 0;
  if (c === 0) return { sky: 'clear', text: 'Clear' };
  if (c === 1) return { sky: 'clear', text: 'Mostly clear' };
  if (c === 2) return { sky: 'partly', text: 'Partly cloudy' };
  if (c === 3) return { sky: 'cloudy', text: 'Overcast' };
  if (c === 45 || c === 48) return { sky: 'fog', text: 'Fog' };
  if (c >= 51 && c <= 57) return { sky: 'drizzle', text: 'Drizzle' };
  if (c >= 61 && c <= 67) return { sky: 'rain', text: c >= 65 ? 'Heavy rain' : 'Rain' };
  if (c >= 80 && c <= 82) return { sky: 'rain', text: 'Showers' };
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { sky: 'snow', text: 'Snow' };
  if (c >= 95) return { sky: 'storm', text: c >= 96 ? 'Storms, hail' : 'Thunderstorms' };
  return { sky: 'cloudy', text: '' };
}

// `at` is first pitch. Before it, the hour it falls in; from then on, now.
// Null when the game is further out than the forecast reaches.
export async function forecastFor(geo: { lat: number; lon: number }, at: string | null, live: boolean): Promise<Forecast | null> {
  const start = at ? Date.parse(at) : NaN;
  const now = live || !Number.isFinite(start) || start <= Date.now();
  if (!now && start - Date.now() > 15.5 * 864e5) return null;
  const url = `${API}?latitude=${geo.lat}&longitude=${geo.lon}&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&timeformat=unixtime&forecast_days=16`
    + '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day'
    + '&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m,wind_direction_10m,is_day';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const d = await res.json();
  const h = d.hourly ?? {};
  const times: number[] = h.time ?? [];
  // The hour first pitch falls in (or this hour, once the game is on).
  const want = Math.floor((now ? Date.now() : start) / 1000);
  let i = times.findIndex((t) => t > want) - 1;
  if (i < 0) i = times.length && want >= times[0] ? times.length - 1 : 0;
  const pick = (k: string) => (now && d.current?.[k] != null ? d.current[k] : h[k]?.[i]);
  const { sky, text } = skyOf(Number(pick('weather_code')));
  const pop = h.precipitation_probability?.[i];
  return {
    sky, text, night: Number(pick('is_day')) === 0, now,
    temp: Math.round(Number(pick('temperature_2m'))),
    pop: Number.isFinite(pop) ? pop : null,
    wind: Math.round(Number(pick('wind_speed_10m'))),
    dir: compass(Number(pick('wind_direction_10m'))),
  };
}
