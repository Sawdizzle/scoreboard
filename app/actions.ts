'use server';

// Every write in the app. Each action runs as the signed-in user against
// Postgres, where the policies and triggers in supabase/migrations decide
// whether it is allowed; the checks here only turn bad input into a sentence
// before it gets that far.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { listOpponents, loadTeam, padScoredGames, safeNext } from '@/lib/data';
import { origin } from '@/lib/origin';
import { parseRoster } from '@/lib/roster-parse';
import { geocodeAddress, tournamentUrl } from '@/lib/geo';
import { abbrFor } from '@/lib/format';
import { emptyCounts, padGamesBlock, type ImportCounts } from '@/lib/gamechanger';
import { cleanLineup } from '@/lib/lineup';
import { RecapContent } from '@/lib/recap';
import { alreadyThere, plausibleStart, TZ } from '@/lib/schedule-import';
import { SPORTS, type Sport } from '@/lib/sports';
import { NAME_FORMATS, POSITIONS, PUBLIC_NAMES, ROLES, type FormState, type NameFormat, type Position, type PublicName, type Role } from '@/lib/types';

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
  // When the project asks for an invite code (signup_gate), the gate in the
  // database checks it, or a staff invite the sign-up is on its way to accept.
  const invite = /^\/invite\/([0-9a-f-]{36})$/i.exec(next)?.[1];
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      data: { display_name: name, invite_code: str(fd, 'code') || undefined, staff_invite: invite },
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) {
    if (/invite code/i.test(error.message)) return { error: 'That invite code is not right. Ask whoever runs this Scoreboard for it.' };
    if (error.code === 'user_already_exists') return { error: 'That email already has an account. Sign in instead.' };
    if (error.code === 'weak_password') return { error: 'That password is too easy to guess. Try a longer one.' };
    if (error.code === 'over_email_send_rate_limit') return { error: 'Too many sign-ups just now. Wait a minute and try again.' };
    return { error: 'Could not create the account. Try again.' };
  }
  // No session means the project wants the address confirmed first.
  if (!data.session) return { ok: `Check ${email} for a link to confirm your account.` };
  redirect(next);
}

// Forgotten password: a link by email that signs the person in and lands on
// /reset to choose a new one. The answer is the same whether or not the
// address has an account, so the form cannot be used to find out.
export async function requestReset(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const email = str(fd, 'email');
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/reset` });
  if (error?.code === 'over_email_send_rate_limit') return { error: 'Too many emails just now. Wait a minute and try again.' };
  return { ok: `If ${email} has an account, a link to reset its password is on its way.` };
}

export async function setPassword(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const password = String(fd.get('password') ?? '');
  if (password.length < 8) return { error: 'Use a password of at least 8 characters.' };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === 'same_password') return { error: 'That is the password you have now. Choose a new one.' };
    if (error.code === 'weak_password') return { error: 'That password is too easy to guess. Try a longer one.' };
    return { error: 'The reset link has expired. Ask for a new one.' };
  }
  redirect('/t');
}

export async function signOut() {
  if (supabaseConfigured) await (await createClient()).auth.signOut();
  redirect('/');
}

// ---- Teams ------------------------------------------------------------------
// A new team needs only a name: the look comes next, on the brand screen,
// where the logo can set it.
export async function createTeam(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const name = str(fd, 'name'), age = str(fd, 'age_group'), season = str(fd, 'season');
  if (!name) return { error: 'Give the team a name.' };
  if (name.length > 60) return { error: 'Keep the team name to 60 characters.' };
  if (age.length > 12) return { error: 'Keep the age group to 12 characters, like 14U.' };
  if (season.length > 40) return { error: 'Keep the season name to 40 characters.' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_team', {
    p_name: name, p_abbr: abbrFor(name) || 'TEAM', p_color: '#2f63cc', p_age_group: age || null, p_season: season || null,
  });
  if (error) return { error: say(error) };
  revalidatePath('/t');
  redirect(`/t/${(data as { slug: string }).slug}/settings?new=1`);
}

const HEX = /^#[0-9a-f]{6}$/i;
const LOGO_TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const LOGO_BUCKET = 'team-logos';

// The brand screen: names, colours, palette, and the logo. The browser has
// already shrunk the logo and read its colours; this checks all of it again,
// stores the file under the team's own folder, and removes the one it replaces.
export async function saveBrand(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'name'), display = str(fd, 'display_name'), age = str(fd, 'age_group');
  const color = str(fd, 'color'), color2 = str(fd, 'color2');
  let abbr = str(fd, 'abbr').toUpperCase();
  if (!name || name.length > 60) return { error: 'The team name is 1 to 60 characters.' };
  if (!display || display.length > 24) return { error: 'The display name is 1 to 24 characters.' };
  if (!abbr) abbr = abbrFor(display) || 'TEAM';
  if (abbr.length > 6) return { error: 'The short code is up to 6 characters.' };
  if (age.length > 12) return { error: 'Keep the age group to 12 characters, like 14U.' };
  if (!HEX.test(color) || !HEX.test(color2)) return { error: 'Pick a primary and an accent colour.' };
  let palette: string[] = [];
  try { const p = JSON.parse(String(fd.get('palette') ?? '[]')); if (Array.isArray(p)) palette = p.filter((x) => typeof x === 'string' && HEX.test(x)).slice(0, 8); } catch { /* keep [] */ }

  const { supabase, team } = await loadTeam(slug);
  let logo_url = team.logo_url;
  const file = fd.get('logo');
  let uploaded: string | null = null;
  if (file instanceof File && file.size > 0) {
    const ext = LOGO_TYPES[file.type];
    if (!ext) return { error: 'A logo is a PNG, WebP or JPEG image.' };
    if (file.size > 1024 * 1024) return { error: 'That logo is over 1 MB even after shrinking. Try a smaller image.' };
    const path = `${team.id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (up.error) return { error: 'The logo did not upload. Only an organizer or head coach can change it.' };
    uploaded = path;
    logo_url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (fd.get('remove_logo') === '1') {
    logo_url = null;
  }

  const { data, error } = await supabase.from('teams')
    .update({ name, display_name: display, abbr, age_group: age || null, color, color2, palette, logo_url })
    .eq('id', team.id).select('id');
  if (error || !data.length) {
    if (uploaded) await supabase.storage.from(LOGO_BUCKET).remove([uploaded]);
    return error ? { error: say(error) } : NO_SEAT;
  }
  // The old file goes once the team points at the new one (or at none).
  const old = team.logo_url && team.logo_url !== logo_url ? logoPath(team.logo_url, team.id) : null;
  if (old) await supabase.storage.from(LOGO_BUCKET).remove([old]);
  revalidatePath(`/t/${slug}`, 'layout');
  revalidatePath('/t');
  return { ok: 'Saved.' };
}
// How the team's players are named everywhere. Each player's public-name
// setting still caps it on the stream and the public pages (in the database).
export async function saveNameFormat(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const fmt = str(fd, 'name_format');
  if (!(NAME_FORMATS as readonly string[]).includes(fmt)) return { error: 'Pick how player names look.' };
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('teams').update({ name_format: fmt as NameFormat }).eq('id', team.id).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  revalidatePath(`/pad/${slug}`, 'layout');
  revalidatePath(`/team/${slug}`, 'layout');
  return { ok: 'Saved. Every screen now names players this way.' };
}

// The storage path inside our bucket, only for this team's own folder.
function logoPath(url: string, teamId: string) {
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + marker.length));
  return path.startsWith(`${teamId}/`) ? path : null;
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
  const game_innings = Number(str(fd, 'game_innings') || 7);
  if (!Number.isInteger(game_innings) || game_innings < 3 || game_innings > 9) return { error: 'A game is 3 to 9 innings.' } as const;
  return { name, starts_on, ends_on, game_innings } as const;
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

// ---- Your account -----------------------------------------------------------
export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  if (!supabaseConfigured) return NOT_CONNECTED;
  const name = str(fd, 'display_name');
  if (!name || name.length > 60) return { error: 'Your name is 1 to 60 characters.' };
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub as string | undefined;
  if (!me) return { error: 'Sign in again to change your name.' };
  const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', me);
  if (error) return { error: say(error) };
  revalidatePath('/t', 'layout');
  return { ok: 'Saved.' };
}

// ---- GameChanger import -------------------------------------------------------
// The browser parses the export and shows who each row is; this receives the
// rows it settled on. Every number is checked again here, because the payload
// is whatever the browser sent: only known columns, whole numbers, in range.
type ImportChoice = { match: string; number: string; first_name: string; last_name: string; counts: Partial<ImportCounts> };
const COUNT_KEYS = Object.keys(emptyCounts()) as (keyof ImportCounts)[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function importStats(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const seasonId = str(fd, 'season_id');
  let choices: ImportChoice[];
  try { choices = JSON.parse(String(fd.get('rows') ?? '[]')); } catch { return { error: 'The import did not come through. Choose the file again.' }; }
  if (!UUID.test(seasonId)) return { error: 'Pick a season to import into.' };
  if (!Array.isArray(choices) || !choices.length) return { error: 'There is nothing to import.' };
  if (choices.length > 60) return { error: 'An import is at most 60 players.' };

  const { supabase, team } = await loadTeam(slug);
  // The page already says so; this holds whatever the browser sent.
  let blocked: string | null;
  try { blocked = padGamesBlock(await padScoredGames(supabase, team.id, seasonId)); } catch { return { error: 'Could not check this season\'s games. Try again.' }; }
  if (blocked) return { error: blocked };
  const kept = choices.filter((c) => c && c.match !== 'skip');
  if (!kept.length) return { error: 'Every row is set to skip.' };

  const clean = (c: ImportChoice) => Object.fromEntries(COUNT_KEYS.map((k) => {
    const v = Number(c.counts?.[k] ?? 0);
    return [k, Number.isInteger(v) && v >= 0 && v <= 100000 ? v : 0];
  }));

  // New players first, so every row has a roster id to hang on.
  const fresh = kept.filter((c) => c.match === 'new');
  const ids = new Map<ImportChoice, string>();
  if (fresh.length) {
    const rows = fresh.map((c) => ({
      team_id: team.id,
      number: /^\d{1,3}$/.test(String(c.number)) ? String(c.number) : '',
      first_name: String(c.first_name ?? '').trim().slice(0, 40),
      last_name: String(c.last_name ?? '').trim().slice(0, 40),
    }));
    if (rows.some((r) => !r.number && !r.first_name && !r.last_name)) return { error: 'A new player needs a name or a number.' };
    const { data, error } = await supabase.from('players').insert(rows).select('id');
    if (error) return { error: say(error) };
    fresh.forEach((c, i) => ids.set(c, (data as { id: string }[])[i].id));
  }
  for (const c of kept) {
    if (c.match === 'new') continue;
    if (!UUID.test(c.match)) return { error: 'One of the rows points at a player that is not on this roster.' };
    ids.set(c, c.match);
  }
  if (new Set(ids.values()).size !== ids.size) return { error: 'Two rows point at the same player. Each player can take one row.' };

  const payload = kept.map((c) => ({ player_id: ids.get(c), ...clean(c) }));
  const { data: n, error } = await supabase.rpc('import_season_stats', { p_season: seasonId, p_rows: payload });
  if (error) return { error: say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/season?s=${seasonId}&imported=${n as number}`);
}

// ---- Games -------------------------------------------------------------------
async function gameFields(fd: FormData, teamId: string, supabase: Awaited<ReturnType<typeof createClient>>) {
  const oppId = str(fd, 'opponent_team_id');
  const savedId = str(fd, 'opponent_id');
  let name = str(fd, 'opponent_name'), abbr = str(fd, 'opponent_abbr').toUpperCase(), color = str(fd, 'opponent_color') || '#7a8794';
  if (oppId) {
    if (!UUID.test(oppId) || oppId === teamId) return { error: 'Pick the other team again.' } as const;
    // The opponent's identity comes from its own row, not from the form.
    const { data: t } = await supabase.from('teams').select('name, abbr, color, age_group').eq('id', oppId).maybeSingle<{ name: string; abbr: string; color: string; age_group: string | null }>();
    if (!t) return { error: 'That team is no longer on Scoreboard. Type its name instead.' } as const;
    name = `${t.name}${t.age_group ? ` ${t.age_group}` : ''}`.slice(0, 60); abbr = t.abbr; color = t.color;
  }
  if (!name) return { error: 'Who are you playing? Pick a team or type a name.' } as const;
  if (name.length > 60) return { error: 'Keep the opponent\'s name to 60 characters.' } as const;
  if (!abbr || abbr.length > 6) abbr = abbrFor(name) || 'OPP';
  if (!/^#[0-9a-f]{6}$/i.test(color)) color = '#7a8794';
  const startsAt = str(fd, 'starts_at');
  if (startsAt && Number.isNaN(Date.parse(startsAt))) return { error: 'Pick the date and time again.' } as const;
  const venue = str(fd, 'venue');
  if (venue.length > 80) return { error: 'Keep the place to 80 characters.' } as const;
  const seasonId = str(fd, 'season_id');
  // The game's rules: whole numbers, blank for none.
  const whole = (k: string, max: number) => { const v = Math.round(Number(str(fd, k))); return v > 0 && v <= max ? v : null; };
  const limit = whole('time_limit_min', 300), runRule = whole('run_rule', 30), period = whole('period_minutes', 60);
  const settings = { time_limit: limit ? limit * 60 : null, run_rule: runRule, period_minutes: period };
  // The field's address: directions for everyone, and where the weather comes
  // from. It is looked up once (lib/geo.ts) and kept on the game as rounded
  // coordinates; unchanged, it is left alone. A ZIP or a town works too.
  const address = str(fd, 'address');
  if (address.length > 160) return { error: 'Keep the address to 160 characters.' } as const;
  let venueGeo: Record<string, unknown> | null | undefined;
  if (address !== str(fd, 'address_was')) {
    if (!address) venueGeo = null;
    else {
      try { venueGeo = await geocodeAddress(address); } catch { venueGeo = undefined; }
      if (venueGeo === null) return { error: `Could not find "${address}" for the weather. Add the city and ZIP.` } as const;
    }
  }
  const tourney = tournamentUrl(str(fd, 'tournament_url'));
  if (tourney === false) return { error: 'The tournament link should be a web address, like https://playtgs.com/…' } as const;
  return {
    settings,
    ...(venueGeo !== undefined ? { venue_geo: venueGeo } : {}),
    opponent_team_id: oppId || null, opponent_name: name, opponent_abbr: abbr, opponent_color: color,
    ...(UUID.test(savedId) && !oppId ? { opponent_id: savedId } : {}),
    is_home: str(fd, 'is_home') !== 'away',
    starts_at: startsAt ? new Date(startsAt).toISOString() : null,
    venue: venue || null,
    address: address || null,
    tournament_url: tourney,
    season_id: UUID.test(seasonId) ? seasonId : null,
    counts_for_stats: fd.get('counts_for_stats') === 'on',
  } as const;
}

export async function createGame(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const f = await gameFields(fd, team.id, supabase);
  if ('error' in f) return f;
  const picked = str(fd, 'sport');
  const sport: Sport = (SPORTS as readonly string[]).includes(picked) ? (picked as Sport) : 'baseball';
  // Only baseball has season stats here.
  const { data, error } = await supabase.from('games')
    .insert({ team_id: team.id, sport, ...f, ...(sport === 'baseball' ? {} : { counts_for_stats: false }) }).select('id').single();
  if (error) return { error: error.code === '42501' ? 'Your seat cannot make games.' : say(error) };
  if (sport !== 'baseball') {
    revalidatePath(`/t/${slug}`, 'layout');
    redirect(`/t/${slug}/games/${data.id}`);
  }
  // An opponent that is not a team here is remembered: a new one is added to
  // the list, and one already on it brings the lineup last typed for it.
  if (!f.opponent_team_id) {
    const list = await listOpponents(supabase, team.id);
    let known = list.find((o) => o.id === (f as { opponent_id?: string }).opponent_id) ?? list.find((o) => o.name.toLowerCase() === f.opponent_name.toLowerCase());
    if (!known) {
      const { data: made } = await supabase.from('opponents').insert({ team_id: team.id, name: f.opponent_name, abbr: f.opponent_abbr, color: f.opponent_color }).select('id, name, abbr, color, color2, logo_url, roster').single();
      known = (made ?? undefined) as typeof known;
    }
    if (known) await supabase.from('games').update({ opponent_id: known.id }).eq('id', data.id);
    // Their roster is their lineup to start from: everyone in it, in its order.
    const lineup = known ? cleanLineup(known.roster) : null;
    if (lineup?.batters.length) await supabase.from('game_lineups').insert({ game_id: data.id, side: 'them', data: lineup });
  }
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/games/${data.id}/lineup`);
}

export async function updateGame(slug: string, gameId: string, _: FormState, fd: FormData): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const f = await gameFields(fd, team.id, supabase);
  if ('error' in f) return f;
  const { data, error } = await supabase.from('games').update(f).eq('team_id', team.id).eq('id', gameId).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Saved.' };
}

export async function deleteGame(slug: string, gameId: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('games').delete().eq('team_id', team.id).eq('id', gameId).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return { error: 'Only an organizer or head coach can delete a game.' };
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/season`);
}

// A whole side's lineup at once. The browser holds the lineup while it is
// edited and sends it back on Save; it is rebuilt here from what a lineup may
// contain before it is stored.
// The stream's sponsor: a name, a line under it and a logo. Leads only (the
// database checks); the logo goes in the team's own folder, like its own.
export async function saveSponsor(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'sponsor_name'), line = str(fd, 'sponsor_line');
  if (name.length > 40) return { error: 'Keep the sponsor\'s name to 40 characters.' };
  if (line.length > 60) return { error: 'Keep the line under it to 60 characters.' };
  const { supabase, team } = await loadTeam(slug);
  const { data: ch } = await supabase.from('channels').select('sponsor_logo').eq('team_id', team.id).maybeSingle<{ sponsor_logo: string | null }>();
  let logo = name ? ch?.sponsor_logo ?? null : null;
  const file = fd.get('sponsor_logo');
  let uploaded: string | null = null;
  if (name && file instanceof File && file.size > 0) {
    const ext = LOGO_TYPES[file.type];
    if (!ext) return { error: 'A logo is a PNG, WebP or JPEG image.' };
    if (file.size > 1024 * 1024) return { error: 'That logo is over 1 MB. Try a smaller image.' };
    const path = `${team.id}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (up.error) return { error: 'The logo did not upload. Only an organizer or head coach can set the sponsor.' };
    uploaded = path;
    logo = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (fd.get('remove_sponsor_logo') === 'on') {
    logo = null;
  }
  const { error } = await supabase.rpc('set_sponsor', { p_team: team.id, p_name: name, p_line: line, p_logo: logo ?? '' });
  if (error) {
    if (uploaded) await supabase.storage.from(LOGO_BUCKET).remove([uploaded]);
    return { error: error.code === '42501' ? 'Only an organizer or head coach can set the sponsor.' : say(error) };
  }
  const old = ch?.sponsor_logo && ch.sponsor_logo !== logo ? logoPath(ch.sponsor_logo, team.id) : null;
  if (old) await supabase.storage.from(LOGO_BUCKET).remove([old]);
  revalidatePath(`/t/${slug}/stream`);
  return { ok: name ? 'Sponsor saved.' : 'Sponsor removed.' };
}

// The channel bug: the line that stays in the corner of the stream, and the
// link On Air can put up as a QR code. Leads only (the database checks).
export async function saveStreamBug(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const text = str(fd, 'bug_text');
  let url = str(fd, 'bug_url');
  if (text.length > 40) return { error: 'Keep the line to 40 characters.' };
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/^http:\/\//i, 'https://');
  if (url.length > 200) return { error: 'Keep the link to 200 characters.' };
  if (url) { try { new URL(url); } catch { return { error: 'That link does not look right. Try it as sawman.app or https://sawman.app.' }; } }
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.rpc('set_stream_bug', { p_team: team.id, p_text: text, p_url: url });
  if (error) return { error: error.code === '42501' ? 'Only an organizer or head coach can set the channel bug.' : say(error) };
  revalidatePath(`/t/${slug}/stream`);
  return { ok: text || url ? 'Channel bug saved.' : 'Channel bug removed.' };
}

// A new Browser Source link. The old one stops working at once.
export async function resetStreamLink(slug: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { error } = await supabase.rpc('reset_stream_link', { p_team: team.id });
  if (error) return { error: error.code === '42501' ? 'Only an organizer or head coach can change the stream link.' : say(error) };
  revalidatePath(`/t/${slug}/stream`);
  return { ok: 'New link made. Copy it into OBS; the old one no longer works.' };
}

// ---- Opponents: the teams you play, kept on your own list ---------------------
// One person runs Scoreboard for their own team, so the other side of a game is
// an opponent here: name, short code, two colours, a logo, and a roster that
// loads into their lineup for each game.
export async function createOpponent(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'name');
  if (!name || name.length > 60) return { error: 'An opponent\'s name is 1 to 60 characters.' };
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('opponents')
    .insert({ team_id: team.id, name, abbr: abbrFor(name) || 'OPP', color: '#7a8794', roster: { batters: [], positions: {} } }).select('id').single();
  if (error) return { error: error.code === '23505' ? 'That opponent is already on your list.' : say(error) };
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/opponents/${data.id}`);
}

export async function saveOpponent(slug: string, id: string, _: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, 'name'), color = str(fd, 'color'), color2 = str(fd, 'color2');
  let abbr = str(fd, 'abbr').toUpperCase();
  if (!name || name.length > 60) return { error: 'The name is 1 to 60 characters.' };
  if (!abbr) abbr = abbrFor(name) || 'OPP';
  if (abbr.length > 6) return { error: 'The short code is up to 6 characters.' };
  if (!HEX.test(color) || !HEX.test(color2)) return { error: 'Pick a primary and an accent colour.' };
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get('roster') ?? '')); } catch { return { error: 'The roster did not come through. Try Save again.' }; }
  const roster = cleanLineup(raw);
  if (!roster) return { error: 'Something in that roster is not valid. Check the numbers (up to three digits).' };

  const { supabase, team } = await loadTeam(slug);
  const { data: before } = await supabase.from('opponents').select('logo_url').eq('team_id', team.id).eq('id', id).maybeSingle<{ logo_url: string | null }>();
  if (!before) return { error: 'That opponent is gone.' };
  let logo_url = before.logo_url;
  let uploaded: string | null = null;
  const file = fd.get('logo');
  if (file instanceof File && file.size > 0) {
    const ext = LOGO_TYPES[file.type];
    if (!ext) return { error: 'A logo is a PNG, WebP or JPEG image.' };
    if (file.size > 1024 * 1024) return { error: 'That logo is over 1 MB even after shrinking. Try a smaller image.' };
    const path = `${team.id}/opp-${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
    if (up.error) return { error: 'The logo did not upload. Try again.' };
    uploaded = path;
    logo_url = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (fd.get('remove_logo') === '1') {
    logo_url = null;
  }
  const { data, error } = await supabase.from('opponents').update({ name, abbr, color, color2, logo_url, roster })
    .eq('team_id', team.id).eq('id', id).select('id');
  if (error || !data.length) {
    if (uploaded) await supabase.storage.from(LOGO_BUCKET).remove([uploaded]);
    return error ? { error: error.code === '23505' ? 'Another opponent already has that name.' : say(error) } : NO_SEAT;
  }
  const old = before.logo_url && before.logo_url !== logo_url ? logoPath(before.logo_url, team.id) : null;
  if (old) await supabase.storage.from(LOGO_BUCKET).remove([old]);
  // Games still to be played against them take the new name, code and colour.
  await supabase.from('games').update({ opponent_name: name, opponent_abbr: abbr, opponent_color: color })
    .eq('team_id', team.id).eq('opponent_id', id).neq('status', 'final');
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Saved.' };
}

// Forget an opponent: its name and saved lineup. Games already played keep theirs.
export async function deleteOpponent(slug: string, id: string, _: FormState): Promise<FormState> {
  const { supabase, team } = await loadTeam(slug);
  const { data, error } = await supabase.from('opponents').delete().eq('team_id', team.id).eq('id', id).select('id');
  if (error) return { error: say(error) };
  if (!data.length) return NO_SEAT;
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Removed.' };
}

export async function saveLineup(slug: string, gameId: string, side: 'us' | 'them', _: FormState, fd: FormData): Promise<FormState> {
  if (side !== 'us' && side !== 'them') return { error: 'Pick a side.' };
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get('lineup') ?? '')); } catch { return { error: 'The lineup did not come through. Try Save again.' }; }
  const lineup = cleanLineup(raw);
  if (!lineup) return { error: 'Something in that lineup is not valid. Reload and try again.' };
  const { supabase, team } = await loadTeam(slug);
  const { data: game } = await supabase.from('games').select('id, opponent_team_id, opponent_id, opponent_name, opponent_abbr, opponent_color')
    .eq('team_id', team.id).eq('id', gameId).maybeSingle<{ id: string; opponent_team_id: string | null; opponent_id: string | null; opponent_name: string; opponent_abbr: string; opponent_color: string }>();
  if (!game) return { error: 'That game is gone.' };
  // Update, else insert: an upsert would also rewrite game_id and side, which
  // the grants keep fixed once a lineup exists.
  const up = await supabase.from('game_lineups').update({ data: lineup }).eq('game_id', gameId).eq('side', side).select('side');
  let error = up.error;
  if (!error && !up.data?.length) error = (await supabase.from('game_lineups').insert({ game_id: gameId, side, data: lineup })).error;
  if (error) return { error: error.code === '42501' ? 'Your seat cannot set lineups.' : say(error) };
  // The other side's lineup is kept for the next time we play them.
  // Anyone new in it joins their roster on the Opponents screen; the roster's
  // own players, names and positions stay as they were set there.
  if (side === 'them' && !game.opponent_team_id) {
    const list = await listOpponents(supabase, team.id);
    const known = list.find((o) => o.id === game.opponent_id) ?? list.find((o) => o.name.toLowerCase() === game.opponent_name.toLowerCase());
    if (known) {
      const have = known.roster?.batters ?? [];
      const seen = new Set(have.map((b) => b.num ? `#${b.num}` : b.name.toLowerCase()));
      const added = lineup.batters.filter((b) => (b.num || b.name) && !seen.has(b.num ? `#${b.num}` : b.name.toLowerCase()));
      if (added.length || !have.length) {
        await supabase.from('opponents').update({ roster: have.length ? { ...known.roster, batters: [...have, ...added] } : lineup }).eq('id', known.id);
      }
      if (!game.opponent_id) await supabase.from('games').update({ opponent_id: known.id }).eq('id', game.id);
    } else {
      const { data: made } = await supabase.from('opponents').insert({ team_id: team.id, name: game.opponent_name, abbr: game.opponent_abbr, color: game.opponent_color, roster: lineup }).select('id').single();
      if (made) await supabase.from('games').update({ opponent_id: made.id }).eq('id', game.id);
    }
  }
  revalidatePath(`/t/${slug}`, 'layout');
  return { ok: 'Lineup saved.' };
}

// ---- Recaps -------------------------------------------------------------------
// Claude writes the draft (app/api/ai/recap); these save the coach's edits and
// publish it to the public game page, or take it back down.
export async function saveRecap(slug: string, gameId: string, _: FormState, fd: FormData): Promise<FormState> {
  let raw: unknown;
  try { raw = JSON.parse(str(fd, 'content')); } catch { return { error: 'The recap did not come through. Try Save again.' }; }
  const parsed = RecapContent.safeParse(raw);
  if (!parsed.success) return { error: 'Something in that recap is not valid. Reload and try again.' };
  if (parsed.data.social.x.length > 280) return { error: `The X post is ${parsed.data.social.x.length} characters; keep it to 280.` };
  const { supabase, team, userId } = await loadTeam(slug);
  const { data, error } = await supabase.from('game_recaps')
    .update({ content: parsed.data, edited_at: new Date().toISOString(), updated_by: userId })
    .eq('team_id', team.id).eq('game_id', gameId).select('status');
  if (error) return { error: say(error) };
  if (!data?.length) return NO_SEAT;
  revalidatePath(`/t/${slug}/games/${gameId}`);
  if (data[0].status === 'published') revalidatePath(`/team/${slug}/game/${gameId}`);
  return { ok: data[0].status === 'published' ? 'Saved. The public page shows the new text.' : 'Saved.' };
}

export async function publishRecap(slug: string, gameId: string, publish: boolean, _: FormState): Promise<FormState> {
  const { supabase, team, userId } = await loadTeam(slug);
  const { data, error } = await supabase.from('game_recaps')
    .update({ status: publish ? 'published' : 'draft', published_at: publish ? new Date().toISOString() : null, updated_by: userId })
    .eq('team_id', team.id).eq('game_id', gameId).select('game_id');
  if (error) return { error: say(error) };
  if (!data?.length) return NO_SEAT;
  revalidatePath(`/t/${slug}/games/${gameId}`);
  revalidatePath(`/team/${slug}/game/${gameId}`);
  return { ok: publish ? 'Published on the public game page.' : 'Taken down. It is a draft again.' };
}

// ---- Schedule import ----------------------------------------------------------
// The games the coach ticked on the import page, added to the current season.
// Opponents are remembered the way New game remembers them.
export async function importGames(slug: string, _: FormState, fd: FormData): Promise<FormState> {
  let raw: unknown;
  try { raw = JSON.parse(str(fd, 'games')); } catch { return { error: 'The games did not come through. Try again.' }; }
  if (!Array.isArray(raw) || !raw.length) return { error: 'Tick at least one game to add.' };
  if (raw.length > 40) return { error: 'Add at most 40 games at a time.' };
  const { supabase, team } = await loadTeam(slug);
  const { data: season } = await supabase.from('seasons').select('id').eq('team_id', team.id).eq('is_current', true).maybeSingle<{ id: string }>();
  const opponents = await listOpponents(supabase, team.id);
  const { data: existing } = await supabase.from('games').select('starts_at, opponent_name').eq('team_id', team.id);
  const have = [...(existing ?? [])] as { starts_at: string | null; opponent_name: string }[];
  // One lookup per address, and at most eight: a tournament repeats its fields.
  const places = new Map<string, Record<string, unknown> | null>();
  let added = 0, skipped = 0;
  for (const g of raw as { starts_at?: string; opponent?: string; home?: string; venue?: string; address?: string }[]) {
    const name = String(g.opponent ?? '').trim().slice(0, 60);
    if (!name || !g.starts_at || !plausibleStart(g.starts_at)) { skipped += 1; continue; }
    const startsAt = new Date(g.starts_at).toISOString();
    const date = new Date(startsAt).toLocaleDateString('en-CA', { timeZone: TZ });
    if (alreadyThere({ date, opponent: name }, have)) { skipped += 1; continue; }
    let known = opponents.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (!known) {
      const { data: made } = await supabase.from('opponents').insert({ team_id: team.id, name, abbr: abbrFor(name) || 'OPP', color: '#7a8794' })
        .select('id, name, abbr, color, color2, logo_url, roster').single();
      if (made) { known = made as unknown as typeof opponents[number]; opponents.push(known); }
    }
    const address = String(g.address ?? '').trim().slice(0, 160);
    if (address && !places.has(address) && places.size < 8) {
      try { places.set(address, (await geocodeAddress(address)) ?? null); } catch { places.set(address, null); }
    }
    const venueGeo = address ? places.get(address) ?? null : null;
    const { error } = await supabase.from('games').insert({
      team_id: team.id, sport: 'baseball', season_id: season?.id ?? null, counts_for_stats: true,
      opponent_name: name, opponent_abbr: known?.abbr ?? (abbrFor(name) || 'OPP'), opponent_color: known?.color ?? '#7a8794',
      opponent_id: known?.id ?? null, is_home: g.home !== 'away', starts_at: startsAt,
      venue: String(g.venue ?? '').trim().slice(0, 80) || null, address: address || null, ...(venueGeo ? { venue_geo: venueGeo } : {}),
    });
    if (error) return { error: added ? `Added ${added}, then: ${say(error)}` : error.code === '42501' ? 'Your seat cannot make games.' : say(error) };
    have.push({ starts_at: startsAt, opponent_name: name });
    added += 1;
  }
  if (!added) return { error: skipped ? 'Those games are already on the schedule, or their dates could not be used.' : 'Tick at least one game to add.' };
  revalidatePath(`/t/${slug}`, 'layout');
  redirect(`/t/${slug}/season?added=${added}`);
}
