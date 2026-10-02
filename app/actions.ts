'use server';

// Every write in the app. Each action runs as the signed-in user against
// Postgres, where the policies and triggers in supabase/migrations decide
// whether it is allowed; the checks here only turn bad input into a sentence
// before it gets that far.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { loadTeam, safeNext } from '@/lib/data';
import { origin } from '@/lib/origin';
import { parseRoster } from '@/lib/roster-parse';
import { POSITIONS, PUBLIC_NAMES, ROLES, type FormState, type Position, type PublicName, type Role } from '@/lib/types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const NOT_CONNECTED: FormState = { error: 'This app is not connected to its database yet.' };

// A database error as something a coach can act on. P0001 is a message raised
// on purpose by a trigger or function, already written for the person reading it.
function say(error: { message: string; code?: string }): string {
  if (error.code === 'P0001') return error.message;
  if (error.code === '42501') return 'Your seat on this team cannot do that.';
  if (error.code === '23505') return 'That name is already in use.';
  if (error.code === '23514' || error.code === '22P02') return 'Something in that form is not valid.';
  return 'That did not save. Try again.';
}
const NO_SEAT: FormState = { error: 'Your seat on this team cannot do that.' };

// ---- Accounts ---------------------------------------------------------------
export async function signIn(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const email = str(fd, 'email'), password = String(fd.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.code === 'email_not_confirmed'
      ? 'Confirm your email first: open the link we sent you.'
      : 'That email and password do not match an account.' };
  }
  redirect(safeNext(str(fd, 'next')));
}

export async function signUp(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const name = str(fd, 'name'), email = str(fd, 'email'), password = String(fd.get('password') ?? '');
  const next = safeNext(str(fd, 'next'));
  if (!name) return { error: 'Enter your name. It is shown on your team\'s staff list.' };
  if (name.length > 60) return { error: 'Keep your name to 60 characters.' };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' };
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { display_name: name }, emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    if (error.code === 'user_already_exists') return { error: 'That email already has an account. Sign in instead.' };
    if (error.code === 'weak_password') return { error: 'That password is too easy to guess. Try a longer one.' };
    if (error.code === 'over_email_send_rate_limit') return { error: 'Too many sign-ups just now. Wait a minute and try again.' };
    return { error: 'Could not create the account. Try again.' };
  }
  // No session means the project wants the address confirmed first.
  if (!data.session) return { ok: `Check ${email} for a link to confirm your account.` };
  redirect(next);
}

export async function signOut() {
  if (supabaseConfigured) await (await createClient()).auth.signOut();
  redirect('/');
}

// ---- Teams ------------------------------------------------------------------
function teamFields(fd: FormData) {
  const name = str(fd, 'name'), abbr = str(fd, 'abbr').toUpperCase(), color = str(fd, 'color'), age = str(fd, 'age_group');
  if (!name) return { error: 'Give the team a name.' } as const;
  if (name.length > 60) return { error: 'Keep the team name to 60 characters.' } as const;
  if (!abbr || abbr.length > 6) return { error: 'The abbreviation is 1 to 6 characters. It is what the scorebug shows.' } as const;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: 'Pick a team colour.' } as const;
  if (age.length > 12) return { error: 'Keep the age group to 12 characters, like 14U.' } as const;
  return { name, abbr, color, age } as const;
}

export async function createTeam(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const f = teamFields(fd);
  if ('error' in f) return f;
  const season = str(fd, 'season');
  if (season.length > 40) return { error: 'Keep the season name to 40 characters.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_team', {
    p_name: f.name, p_abbr: f.abbr, p_color: f.color, p_age_group: f.age || null, p_season: season || null,
  });
  if (error) return { error: say(error) };
  revalidatePath('/t');
  redirect(`/t/${(data as { slug: string }).slug}`);
}

export async function updateTeam(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const f = teamFields(fd);
  if ('error' in f) return f;
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('teams')
    .update({ name: f.name, abbr: f.abbr, color: f.color, age_group: f.age || null }).eq('id', team.id).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Saved.' };
}

export async function deleteTeam(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  if (str(fd, 'confirm') !== team.name) return { error: `Type the team name, ${team.name}, to delete it.` };
  const { data, error } = await supabase.from('teams').delete().eq('id', team.id).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only an organizer can delete the team.' };
  revalidatePath('/t');
  redirect('/t');
}

// ---- Roster -----------------------------------------------------------------
function playerFields(fd: FormData) {
  const first_name = str(fd, 'first_name'), last_name = str(fd, 'last_name'), number = str(fd, 'number').replace(/^#/, '');
  if (!first_name && !last_name && !number) return { error: 'Enter a name or a jersey number.' } as const;
  if (!/^\d{0,3}$/.test(number)) return { error: 'A jersey number is up to three digits.' } as const;
  if (first_name.length > 40 || last_name.length > 40) return { error: 'Keep each name to 40 characters.' } as const;
  const bats = str(fd, 'bats'), throws_ = str(fd, 'throws'), pub = str(fd, 'public_name');
  return {
    first_name, last_name, number,
    bats: (['R', 'L', 'S'].includes(bats) ? bats : null) as 'R' | 'L' | 'S' | null,
    throws: (['R', 'L'].includes(throws_) ? throws_ : null) as 'R' | 'L' | null,
    positions: fd.getAll('positions').map(String).filter((p): p is Position => (POSITIONS as readonly string[]).includes(p)),
    public_name: ((PUBLIC_NAMES as readonly string[]).includes(pub) ? pub : 'full') as PublicName,
  } as const;
}

export async function addPlayer(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const f = playerFields(fd);
  if ('error' in f) return f;
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('players').insert({ team_id: team.id, ...f });
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: `Added ${[f.number && `#${f.number}`, f.first_name, f.last_name].filter(Boolean).join(' ')}.` };
}

export async function pastePlayers(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const list = parseRoster(String(fd.get('list') ?? ''));
  if (!list.length) return { error: 'Paste one player per line, like "7 Ava Reyes SS".' };
  if (list.length > 40) return { error: 'That is more than 40 lines. Paste the roster in two parts.' };
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('players').insert(list.map((p) => ({ team_id: team.id, ...p })));
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: `Added ${list.length} ${list.length === 1 ? 'player' : 'players'}.` };
}

export async function updatePlayer(slug: string, playerId: string, _: FormState, fd: FormData): Promise<FormState> {
  const f = playerFields(fd);
  if ('error' in f) return f;
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('players')
    .update({ ...f, active: fd.get('active') === 'on' }).eq('team_id', team.id).eq('id', playerId).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Saved.' };
}

export async function deletePlayer(slug: string, playerId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('players').delete().eq('team_id', team.id).eq('id', playerId).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/roster`);
}

// ---- Seasons ----------------------------------------------------------------
function seasonFields(fd: FormData) {
  const name = str(fd, 'name'), starts_on = str(fd, 'starts_on') || null, ends_on = str(fd, 'ends_on') || null;
  if (!name) return { error: 'Name the season, like Fall 2026.' } as const;
  if (name.length > 40) return { error: 'Keep the season name to 40 characters.' } as const;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if ((starts_on && !day.test(starts_on)) || (ends_on && !day.test(ends_on))) return { error: 'Use the date picker for the dates.' } as const;
  if (starts_on && ends_on && ends_on < starts_on) return { error: 'The season ends before it starts.' } as const;
  return { name, starts_on, ends_on } as const;
}

export async function createSeason(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const f = seasonFields(fd);
  if ('error' in f) return f;
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('seasons')
    .insert({ team_id: team.id, ...f, is_current: fd.get('is_current') === 'on' }).select('id').single();
  if (error) return { error: error.code === '23505' ? 'This team already has a season with that name.' : say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/season?s=${data.id}`);
}

export async function updateSeason(slug: string, seasonId: string, _: FormState, fd: FormData): Promise<FormState> {
  const f = seasonFields(fd);
  if ('error' in f) return f;
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('seasons').update(f).eq('team_id', team.id).eq('id', seasonId).select('id');
  if (error) return { error: error.code === '23505' ? 'This team already has a season with that name.' : say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Saved.' };
}

export async function makeSeasonCurrent(slug: string, seasonId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('seasons').update({ is_current: true }).eq('team_id', team.id).eq('id', seasonId).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  return {};
}

export async function deleteSeason(slug: string, seasonId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('seasons').delete().eq('team_id', team.id).eq('id', seasonId).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/season`);
}

// ---- Staff ------------------------------------------------------------------
const asRole = (v: string): Role | null => ((ROLES as readonly string[]).includes(v) ? (v as Role) : null);

export async function createInvite(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const role = asRole(str(fd, 'role'));
  if (!role) return { error: 'Pick a role for the seat.' };
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('staff_invites').insert({ team_id: team.id, role });
  if (error) return { error: error.code === '42501' ? 'Only an organizer can invite staff.' : say(error) };
  revalidatePath(`/t/${slug}/staff`);
  return {};
}

export async function revokeInvite(slug: string, token: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.from('staff_invites').delete().eq('team_id', team.id).eq('token', token);
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}/staff`);
  return {};
}

export async function setStaffRole(slug: string, userId: string, _: FormState, fd: FormData): Promise<FormState> {
  const role = asRole(str(fd, 'role'));
  if (!role) return { error: 'Pick a role.' };
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('team_staff').update({ role }).eq('team_id', team.id).eq('user_id', userId).select('role');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only an organizer can change a role.' };
  revalidatePath(`/t/${slug}`, 'layout');
  return {};
}

// Removes someone else (organizers), or yourself (anyone). Leaving sends you
// back to your teams, because this one is no longer yours to look at.
export async function removeStaff(slug: string, userId: string, _: FormState): Promise<FormState> {
  const { supabase, team, userId: me } = await loadTeam(slug);
  const { data, error } = await supabase.from('team_staff').delete().eq('team_id', team.id).eq('user_id', userId).select('user_id');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only an organizer can remove someone.' };
  revalidatePath(`/t/${slug}`, 'layout');
  if (userId === me) { revalidatePath('/t'); redirect('/t'); }
  return {};
}

export async function acceptInvite(token: string, _: FormState): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token });
  if (error) return { error: error.code === '42501' ? 'Sign in to accept this invite.' : say(error) };
  revalidatePath('/t');
  redirect(`/t/${data as string}`);
}
