'use server';

// The writes for a team's people, calendar and messages, and for leagues. As
// in app/actions.ts, each runs as the signed-in user and the database's
// policies decide; the checks here turn bad input into a sentence. A write
// others should hear about sends its push after the response (lib/push).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { getUserId, loadMember, loadTeam, requireUserId } from '@/lib/data';
import { notifyTeam } from '@/lib/push';
import { TZ } from '@/lib/schedule-import';
import { CHANNEL_LABEL, EVENT_LABEL, isStaff, type Channel, type EventKind, type FormState, type RsvpStatus } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const isId = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const NOT_CONNECTED: FormState = { error: 'This app is not connected to its database yet.' };

function say(error: { message: string; code?: string }): string {
  if (error.code === 'P0001') return error.message;
  if (error.code === '42501') return 'Your place on this team cannot do that.';
  if (error.code === '23505') return 'That is already taken.';
  if (error.code === '23514' || error.code === '22P02') return 'Something in that form is not valid.';
  return 'That did not save. Try again.';
}

// ---- Joining ----------------------------------------------------------------
export async function followTeam(slug: string, teamId: string, _: FormState): Promise<FormState> {
  await requireUserId(`/team/${slug}`);
  const supabase = await createClient();
  const { error } = await supabase.rpc('follow_team', { p_team: teamId });
  if (error) return { error: say(error) };
  revalidatePath(`/team/${slug}`);
  return { ok: 'Following. Turn on notifications on your team page to hear about games.' };
}

export async function leaveTeam(slug: string, _: FormState): Promise<FormState> {
  const { supabase, team, userId } = await loadMember(slug);
  const { error } = await supabase.from('team_members').delete().eq('team_id', team.id).eq('user_id', userId);
  if (error) return { error: say(error) };
  revalidatePath('/t');
  redirect('/t');
}

export async function joinFamily(token: string, _: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  await requireUserId(`/join/${token}`);
  const players = fd.getAll('player').map(String).filter(isId);
  if (!players.length) return { error: 'Pick your player.' };
  const supabase = await createClient();
  const { data: slug, error } = await supabase.rpc('join_family', { p_token: token, p_players: players });
  if (error) return { error: say(error) };
  const { data: team } = await supabase.from('teams').select('id, name').eq('slug', slug as string).maybeSingle<{ id: string; name: string }>();
  if (team) {
    after(() => notifyTeam(team.id, 'staff', 'chat',
      { title: team.name, body: 'A parent asked to join. Approve them under Team > People.', url: `/t/${slug}/people`, tag: `join-${team.id}` }));
  }
  redirect(`/t/${slug}`);
}

// ---- People (staff) ---------------------------------------------------------
export async function approveMember(slug: string, userId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('team_members').update({ status: 'active' })
    .eq('team_id', team.id).eq('user_id', userId).select('user_id');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only coaches and team admins approve parents.' };
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Approved.' };
}

export async function removeMember(slug: string, userId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('team_members').delete().eq('team_id', team.id).eq('user_id', userId).select('user_id');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only coaches and team admins remove people.' };
  await supabase.from('guardian_players').delete().eq('team_id', team.id).eq('user_id', userId);
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Removed.' };
}

export async function linkGuardian(slug: string, userId: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const player = str(fd, 'player');
  if (!isId(player)) return { error: 'Pick a player.' };
  const { error } = await supabase.from('guardian_players').insert({ team_id: team.id, user_id: userId, player_id: player });
  if (error) return { error: error.code === '23505' ? 'Already linked.' : say(error) };
  revalidatePath(`/t/${slug}/people`);
  return { ok: 'Linked.' };
}

export async function unlinkGuardian(slug: string, userId: string, playerId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('guardian_players').delete().eq('team_id', team.id).eq('user_id', userId).eq('player_id', playerId);
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}/people`);
  return {};
}

export async function saveFamilyApproval(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('team_family_links').update({ require_approval: fd.get('approval') === 'on' }).eq('team_id', team.id);
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}/people`);
  return { ok: 'Saved.' };
}

export async function newFamilyLink(slug: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.rpc('rotate_family_link', { p_team: team.id });
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}/people`);
  return { ok: 'New link made. The old one no longer works.' };
}

export async function assignScorer(slug: string, gameId: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase } = await loadTeam(slug);
  const user = str(fd, 'user');
  if (!isId(user)) return { error: 'Pick a scorer.' };
  const { error } = await supabase.from('game_scorers').insert({ game_id: gameId, user_id: user });
  if (error) return { error: error.code === '23505' ? 'Already scoring this game.' : say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Scorer added.' };
}

export async function unassignScorer(slug: string, gameId: string, userId: string, _: FormState): Promise<FormState> {
  const { supabase } = await loadTeam(slug);
  const { error } = await supabase.from('game_scorers').delete().eq('game_id', gameId).eq('user_id', userId);
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  return {};
}

// ---- Calendar ---------------------------------------------------------------
const KINDS: EventKind[] = ['practice', 'meeting', 'event'];
function eventFields(fd: FormData) {
  const kind = str(fd, 'kind') as EventKind;
  const title = str(fd, 'title') || EVENT_LABEL[kind] || 'Practice';
  const starts = str(fd, 'starts_at'), ends = str(fd, 'ends_at');
  if (!KINDS.includes(kind)) return { error: 'Pick what kind of event it is.' };
  if (title.length > 80) return { error: 'Keep the title to 80 characters.' };
  if (!starts || Number.isNaN(Date.parse(starts))) return { error: 'Set when it starts.' };
  if (ends && (Number.isNaN(Date.parse(ends)) || Date.parse(ends) < Date.parse(starts))) return { error: 'It has to end after it starts.' };
  return {
    kind, title, starts_at: new Date(starts).toISOString(), ends_at: ends ? new Date(ends).toISOString() : null,
    location: str(fd, 'location').slice(0, 80) || null, address: str(fd, 'address').slice(0, 200) || null,
    notes: str(fd, 'notes').slice(0, 1000) || null,
  };
}
// A push is written on the server, which does not know the reader's zone: the league's own.
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

export async function createEvent(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team, userId } = await loadTeam(slug);
  const f = eventFields(fd);
  if ('error' in f) return f;
  const { error } = await supabase.from('team_events').insert({ team_id: team.id, ...f });
  if (error) return { error: error.code === '42501' ? 'Only coaches and team admins add to the calendar.' : say(error) };
  after(() => notifyTeam(team.id, 'family', 'schedule',
    { title: `${team.display_name}: ${f.title}`, body: `${when(f.starts_at)}${f.location ? ` at ${f.location}` : ''}`, url: `/t/${slug}/calendar` }, userId));
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/calendar`);
}

export async function updateEvent(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team, userId } = await loadTeam(slug);
  const f = eventFields(fd);
  if ('error' in f) return f;
  const { data, error } = await supabase.from('team_events').update(f).eq('team_id', team.id).eq('id', id).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only coaches and team admins change the calendar.' };
  if (fd.get('notify') === 'on') {
    after(() => notifyTeam(team.id, 'family', 'schedule',
      { title: `Changed: ${f.title}`, body: `${when(f.starts_at)}${f.location ? ` at ${f.location}` : ''}`, url: `/t/${slug}/calendar`, tag: `event-${id}` }, userId));
  }
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Saved.' };
}

export async function cancelEvent(slug: string, id: string, canceled: boolean, _: FormState): Promise<FormState> {
  const { supabase, team, userId } = await loadTeam(slug);
  const { data, error } = await supabase.from('team_events').update({ canceled }).eq('team_id', team.id).eq('id', id).select('title, starts_at');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only coaches and team admins change the calendar.' };
  const ev = data[0] as { title: string; starts_at: string };
  after(() => notifyTeam(team.id, 'family', 'schedule',
    { title: `${canceled ? 'Canceled' : 'Back on'}: ${ev.title}`, body: when(ev.starts_at), url: `/t/${slug}/calendar`, tag: `event-${id}` }, userId));
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: canceled ? 'Canceled. Families were told.' : 'Back on the calendar.' };
}

export async function deleteEvent(slug: string, id: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('team_events').delete().eq('team_id', team.id).eq('id', id);
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/calendar`);
}

// One tap on Going, Maybe or Can't make it. Tapping the answer already given clears it.
export async function setRsvp(slug: string, item: { game?: string; event?: string }, playerId: string, status: RsvpStatus | null): Promise<FormState> {
  const { supabase } = await loadMember(slug);
  const { error } = await supabase.rpc('set_rsvp', { p_game: item.game ?? null, p_event: item.event ?? null, p_player: playerId, p_status: status });
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  return {};
}

// The private subscription link; `renew` replaces it.
export async function calendarToken(slug: string, renew = false): Promise<string | null> {
  const { supabase, team } = await loadMember(slug);
  const { data } = await supabase.rpc('calendar_token', { p_team: team.id, p_new: renew });
  return (data as string | null) ?? null;
}

// ---- Messages ---------------------------------------------------------------
const CHANNELS: Channel[] = ['announcements', 'families', 'staff'];
export async function postMessage(slug: string, channel: Channel, body: string): Promise<FormState> {
  const { supabase, team, userId, seat } = await loadMember(slug);
  const text = body.trim();
  if (!CHANNELS.includes(channel)) return { error: 'That channel is not on this team.' };
  if (!text) return { error: 'Write something first.' };
  if (text.length > 2000) return { error: 'Keep a message to 2000 characters.' };
  const { error } = await supabase.from('team_messages').insert({ team_id: team.id, channel, body: text });
  if (error) {
    return { error: error.code === '42501'
      ? channel === 'announcements' ? 'Only coaches post announcements.' : 'You cannot post in this channel.'
      : say(error) };
  }
  const { data: me } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle<{ display_name: string }>();
  const who = me?.display_name ?? (isStaff(seat) ? 'Coach' : 'A parent');
  after(() => notifyTeam(team.id, channel === 'staff' ? 'staff' : 'family', channel === 'announcements' ? 'announcements' : 'chat', {
    title: channel === 'announcements' ? `${team.display_name} announcement` : `${team.display_name} · ${CHANNEL_LABEL[channel]}`,
    body: channel === 'announcements' ? text : `${who}: ${text}`,
    url: `/t/${slug}/chat?c=${channel}`, tag: `chat-${team.id}-${channel}`,
  }, userId));
  return { ok: 'Sent.' };
}

export async function removeMessage(slug: string, id: number): Promise<FormState> {
  const { supabase } = await loadMember(slug);
  const { error } = await supabase.rpc('remove_message', { p_id: id });
  if (error) return { error: say(error) };
  return { ok: 'Removed.' };
}

// ---- Notifications ----------------------------------------------------------
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<FormState> {
  if (!(await getUserId())) return { error: 'Sign in first.' };
  if (!/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) return { error: 'That device did not give a push address.' };
  const supabase = await createClient();
  // A device can change hands between accounts: the address is replaced, not added.
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  const { error } = await supabase.from('push_subscriptions').insert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  if (error) return { error: say(error) };
  return { ok: 'Notifications are on for this device.' };
}

export async function deletePushSubscription(endpoint: string): Promise<FormState> {
  const supabase = await createClient();
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return { ok: 'Notifications are off for this device.' };
}

export async function saveNotifySettings(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team } = await loadMember(slug);
  const on = (k: string) => fd.get(k) === 'on';
  const { error } = await supabase.from('notify_settings').upsert(
    { team_id: team.id, announcements: on('announcements'), chat: on('chat'), schedule: on('schedule'), games: on('games') },
    { onConflict: 'user_id,team_id' });
  if (error) return { error: say(error) };
  return { ok: 'Saved.' };
}

// ---- Leagues ----------------------------------------------------------------
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export async function createOrg(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  await requireUserId('/org/new');
  const name = str(fd, 'name');
  const slug = slugify(str(fd, 'slug') || name);
  if (!name) return { error: 'Name the league.' };
  if (name.length > 80) return { error: 'Keep the name to 80 characters.' };
  if (slug.length < 2) return { error: 'The league address needs at least two letters or numbers.' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('create_org', { p_name: name, p_slug: slug });
  if (error) return { error: say(error) };
  redirect(`/org/${slug}`);
}

async function loadOrg(slug: string) {
  await requireUserId(`/org/${slug}`);
  const supabase = await createClient();
  const { data: org } = await supabase.from('organizations').select('id, slug, name').eq('slug', slug).maybeSingle<{ id: string; slug: string; name: string }>();
  return { supabase, org };
}

export async function createOrgInvite(slug: string, kind: 'admin' | 'team', _: FormState): Promise<FormState> {
  const { supabase, org } = await loadOrg(slug);
  if (!org) return { error: 'That league is not here.' };
  const { error } = await supabase.from('org_invites').insert({ org_id: org.id, kind });
  if (error) return { error: error.code === '42501' ? 'Only league admins make links.' : say(error) };
  revalidatePath(`/org/${slug}`);
  return { ok: 'Link made.' };
}

export async function revokeOrgInvite(slug: string, token: string, _: FormState): Promise<FormState> {
  const { supabase } = await loadOrg(slug);
  const { error } = await supabase.from('org_invites').delete().eq('token', token);
  if (error) return { error: say(error) };
  revalidatePath(`/org/${slug}`);
  return {};
}

export async function acceptOrgInvite(token: string, _: FormState, fd: FormData): Promise<FormState> {
  await requireUserId(`/org/join/${token}`);
  const supabase = await createClient();
  const team = str(fd, 'team');
  const { data, error } = await supabase.rpc('accept_org_invite', { p_token: token, p_team: isId(team) ? team : null });
  if (error) return { error: say(error) };
  redirect(`/org/${data as string}`);
}

export async function leaveOrg(slug: string, orgSlug: string | null, teamId: string, _: FormState): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('leave_org', { p_team: teamId });
  if (error) return { error: say(error) };
  revalidatePath(orgSlug ? `/org/${orgSlug}` : `/t/${slug}/people`);
  return { ok: 'The team left the league.' };
}

export async function removeOrgAdmin(slug: string, userId: string, _: FormState): Promise<FormState> {
  const { supabase, org } = await loadOrg(slug);
  if (!org) return { error: 'That league is not here.' };
  const { error } = await supabase.from('org_members').delete().eq('org_id', org.id).eq('user_id', userId);
  if (error) return { error: say(error) };
  revalidatePath(`/org/${slug}`);
  return {};
}

// To every team in the league: shown on each team's Home and Chat, and pushed
// to each team's family.
export async function postOrgAnnouncement(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, org } = await loadOrg(slug);
  if (!org) return { error: 'That league is not here.' };
  const body = str(fd, 'body');
  if (!body) return { error: 'Write the announcement first.' };
  if (body.length > 2000) return { error: 'Keep it to 2000 characters.' };
  const { error } = await supabase.from('org_announcements').insert({ org_id: org.id, body });
  if (error) return { error: error.code === '42501' ? 'Only league admins post to the league.' : say(error) };
  const { data: teams } = await supabase.from('teams').select('id, slug').eq('org_id', org.id);
  const me = await getUserId();
  after(() => Promise.all(((teams ?? []) as { id: string; slug: string }[]).map((t) =>
    notifyTeam(t.id, 'family', 'announcements', { title: org.name, body, url: `/t/${t.slug}`, tag: `org-${org.id}` }, me ?? undefined))));
  revalidatePath(`/org/${slug}`);
  return { ok: `Sent to ${(teams ?? []).length} teams.` };
}

