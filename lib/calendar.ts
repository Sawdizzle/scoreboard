import type { EventKind, Game, Rsvp, RsvpStatus, TeamEvent } from './types.ts';

// One list for the calendar: games and the team's own events, soonest first.
// A game with no time yet is left out; it has nowhere to sit on a calendar.
export type CalItem = {
  key: string; kind: 'game' | EventKind; id: string; starts_at: string; ends_at: string | null;
  title: string; place: string | null; address: string | null; canceled: boolean; status?: Game['status'];
};

export function calendarItems(games: Game[], events: TeamEvent[], from = Date.now() - 6 * 3600e3) {
  const items: CalItem[] = [
    ...games.filter((g) => g.starts_at && Date.parse(g.starts_at) >= from).map((g): CalItem => ({
      key: `g-${g.id}`, kind: 'game', id: g.id, starts_at: g.starts_at!, ends_at: null,
      title: `${g.is_home ? 'vs' : 'at'} ${g.opponent_name}`, place: g.venue, address: g.address ?? null, canceled: false, status: g.status,
    })),
    ...events.filter((e) => Date.parse(e.starts_at) >= from).map((e): CalItem => ({
      key: `e-${e.id}`, kind: e.kind, id: e.id, starts_at: e.starts_at, ends_at: e.ends_at,
      title: e.title, place: e.location, address: e.address, canceled: e.canceled,
    })),
  ];
  return items.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}

// The answers for one item, by player.
export function answersFor(item: CalItem, rsvps: Rsvp[]) {
  const out: Record<string, RsvpStatus> = {};
  for (const r of rsvps) {
    if ((item.kind === 'game' ? r.game_id : r.event_id) === item.id) out[r.player_id] = r.status;
  }
  return out;
}

export function headCount(answers: Record<string, RsvpStatus>, roster: number) {
  const v = Object.values(answers);
  const yes = v.filter((s) => s === 'yes').length, maybe = v.filter((s) => s === 'maybe').length, no = v.filter((s) => s === 'no').length;
  return { yes, maybe, no, none: Math.max(roster - v.length, 0) };
}

// Day headings: items on the same local day share one. The key is the date
// in the given zone, so the server and the reader agree on where a day breaks.
export function byDay(items: CalItem[], tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days: { day: string; items: CalItem[] }[] = [];
  for (const it of items) {
    const day = fmt.format(new Date(it.starts_at));
    const last = days.at(-1);
    if (last?.day === day) last.items.push(it); else days.push({ day, items: [it] });
  }
  return days;
}
