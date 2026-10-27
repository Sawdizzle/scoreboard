import { MemberHome } from '@/components/views/MemberHome';
import { TodayView } from '@/components/views/TodayView';
import { calendarItems } from '@/lib/calendar';
import { getLineups, listGameScorers, listGames, listMessages, listPlayers, listSeasons, loadCalendar, loadMember, notifyPrefs, orgAnnouncements, seasonStats } from '@/lib/data';
import { gameDay } from '@/lib/schedule';
import { isStaff } from '@/lib/types';

export default async function Today({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, seat, userId } = await loadMember(slug);
  if (!isStaff(seat)) {
    const fam = seat === 'guardian';
    const [cal, news, league, prefs] = await Promise.all([
      loadCalendar(supabase, team, seat, userId),
      fam ? listMessages(supabase, team.id, 'announcements', 3) : Promise.resolve([]),
      fam && team.org_id ? orgAnnouncements(supabase, team.org_id, 3) : Promise.resolve([]),
      notifyPrefs(supabase, team.id, userId),
    ]);
    const items = calendarItems(cal.games, cal.events);
    const scorers = fam ? await listGameScorers(supabase, items.slice(0, 4).filter((i) => i.kind === 'game').map((i) => i.id)) : {};
    return <MemberHome team={team} seat={seat} items={items} rsvps={cal.rsvps} mine={cal.mine} news={news} league={league} prefs={prefs} scorers={scorers} />;
  }
  const role = seat;
  const [players, opps, seasons] = await Promise.all([
    supabase.from('players').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('active', true),
    supabase.from('opponents').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
    listSeasons(supabase, team.id),
  ]);
  const season = seasons.find((s) => s.is_current);
  const [stats, roster] = season ? await Promise.all([seasonStats(supabase, team.id, season.id), listPlayers(supabase, team.id)]) : [[], []];
  const day = gameDay(await listGames(supabase, team.id));
  const [lineups, prefs, scorers] = await Promise.all([
    Promise.all(day.map((d) => getLineups(supabase, d.game.id))),
    notifyPrefs(supabase, team.id, userId),
    listGameScorers(supabase, day.map((d) => d.game.id)),
  ]);
  return <TodayView team={team} role={role} players={players.count ?? 0} opponents={opps.count ?? 0} season={season} stats={stats} roster={roster}
    day={day.map((d, i) => ({ ...d, lineups: lineups[i], scorers: scorers[d.game.id] ?? [] }))} prefs={prefs} me={userId} />;
}
