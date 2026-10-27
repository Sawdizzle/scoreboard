// A team's calendar as an iCalendar feed (RFC 5545), for /cal/<token>.ics.
// Apple, Google and Outlook calendars subscribe to it and fetch it again on
// their own schedule (Apple and Outlook about hourly when asked, Google every
// several hours whatever it is asked), so a change reaches a phone's calendar
// late; push says it now.

export type FeedGame = {
  id: string; starts_at: string; opponent: string; is_home: boolean; venue: string | null;
  address: string | null; status: string; updated_at: string;
};
export type FeedEvent = {
  id: string; kind: string; title: string; starts_at: string; ends_at: string | null; location: string | null;
  address: string | null; notes: string | null; canceled: boolean; updated_at: string;
};
export type Feed = { team: { name: string; slug: string }; games: FeedGame[]; events: FeedEvent[] };

const GAME_MS = 2 * 3600e3;
const EVENT_MS = 90 * 60e3;

// 20261027T183000Z
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Backslash, semicolon, comma and newline are escaped in TEXT values.
export const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 octets continue on the next line after a space. Cut on
// whole characters, so a name with accents is never split mid-letter.
export function fold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const where = (place: string | null, address: string | null) =>
  [place, address].filter(Boolean).join(', ') || null;

export function buildIcs(feed: Feed, siteUrl: string) {
  const name = `${feed.team.name} (Scoreboard)`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Scoreboard//Team calendar//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const add = (e: { uid: string; start: string; end: string; summary: string; location: string | null; desc: string | null; url: string; updated: string; canceled: boolean }) => {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(e.updated)}`, `LAST-MODIFIED:${stamp(e.updated)}`,
      `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${esc(e.summary)}`, `URL:${e.url}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.desc) lines.push(`DESCRIPTION:${esc(e.desc)}`);
    lines.push(`STATUS:${e.canceled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  };
  for (const g of feed.games) {
    add({
      uid: `game-${g.id}@scoreboard`, start: g.starts_at, end: new Date(Date.parse(g.starts_at) + GAME_MS).toISOString(),
      summary: `${feed.team.name} ${g.is_home ? 'vs' : 'at'} ${g.opponent}`, location: where(g.venue, g.address),
      desc: g.status === 'final' ? 'Final. Scores on the team page.' : null,
      url: `${siteUrl}/team/${feed.team.slug}/game/${g.id}`, updated: g.updated_at, canceled: false,
    });
  }
  for (const e of feed.events) {
    add({
      uid: `event-${e.id}@scoreboard`, start: e.starts_at,
      end: e.ends_at ?? new Date(Date.parse(e.starts_at) + EVENT_MS).toISOString(),
      summary: `${feed.team.name}: ${e.title}`, location: where(e.location, e.address), desc: e.notes,
      url: `${siteUrl}/t/${feed.team.slug}/calendar`, updated: e.updated_at, canceled: e.canceled,
    });
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
