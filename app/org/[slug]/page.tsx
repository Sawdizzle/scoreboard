import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createOrgInvite, leaveOrg, postOrgAnnouncement, removeOrgAdmin, revokeOrgInvite } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { CopyLink } from '@/components/CopyLink';
import { ChevronRight, Cross } from '@/components/icons';
import { LocalTime } from '@/components/LocalTime';
import { TeamMark, brandOf } from '@/components/TeamBrand';
import { byDay, calendarItems, type CalItem } from '@/lib/calendar';
import { TEAM_COLS, orgAnnouncements, requireUserId } from '@/lib/data';
import { origin } from '@/lib/origin';
import { TZ } from '@/lib/schedule-import';
import { createClient } from '@/lib/supabase/server';
import { EVENT_LABEL, type Game, type Org, type Team, type TeamEvent } from '@/lib/types';

export const metadata: Metadata = { title: 'League' };

// The league calendar's window: from this morning's games to two weeks out.
const span = (t = Date.now()) => ({
  soon: new Date(t + 14 * 864e5).toISOString(), ago: new Date(t - 6 * 3600e3).toISOString(), now: new Date(t).toISOString(),
});
const dayTitle = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

// A league's own screen, for its admins: every team, the next two weeks of
// games and practices across the league, an announcement to every family,
// and the links that bring in teams and other admins.
export default async function OrgPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const me = await requireUserId(`/org/${slug}`);
  const supabase = await createClient();
  const { data: org } = await supabase.from('organizations').select('id, slug, name, color, logo_url').eq('slug', slug).maybeSingle<Org>();
  if (!org) notFound();
  const { data: admin } = await supabase.rpc('is_org_admin', { p_org: org.id });
  if (!admin) notFound();
  const { soon, ago, now } = span();
  const [{ data: teams }, { data: admins }, { data: invites }, news] = await Promise.all([
    supabase.from('teams').select(TEAM_COLS).eq('org_id', org.id).order('name'),
    supabase.from('org_members').select('user_id, profiles(display_name)').eq('org_id', org.id).order('created_at'),
    supabase.from('org_invites').select('token, kind, expires_at, used_at').eq('org_id', org.id).is('used_at', null).gt('expires_at', now).order('created_at'),
    orgAnnouncements(supabase, org.id, 5),
  ]);
  const list = (teams ?? []) as Team[];
  const ids = list.map((t) => t.id);
  const [{ data: games }, { data: events }] = ids.length ? await Promise.all([
    supabase.from('games').select('id, team_id, starts_at, is_home, opponent_name, venue, status').in('team_id', ids).gte('starts_at', ago).lte('starts_at', soon),
    supabase.from('team_events').select('id, team_id, kind, title, starts_at, ends_at, location, address, notes, canceled').in('team_id', ids).gte('starts_at', ago).lte('starts_at', soon),
  ]) : [{ data: [] }, { data: [] }];
  const teamOf = new Map(list.map((t) => [t.id, t]));
  const owner = new Map<string, Team>();
  for (const g of (games ?? []) as Game[]) owner.set(`g-${g.id}`, teamOf.get(g.team_id)!);
  for (const e of (events ?? []) as TeamEvent[]) owner.set(`e-${e.id}`, teamOf.get(e.team_id)!);
  const items: CalItem[] = calendarItems((games ?? []) as Game[], (events ?? []) as TeamEvent[]);
  const site = await origin();
  const open = (invites ?? []) as { token: string; kind: 'admin' | 'team'; expires_at: string }[];
  return (
    <main className="shell" style={{ '--team': org.color } as React.CSSProperties}>
      <div className="page-top">
        <Link href="/t" className="link">Your teams</Link>
        <h1 className="disp h1">{org.name}</h1>
        <p className="sub">League admin · {list.length} {list.length === 1 ? 'team' : 'teams'}</p>
      </div>
      <div className="page wide">
        <section className="card pad">
          <div className="row-main"><span className="row-title">Announce to the league</span>
            <span className="row-meta">Shows on every team&rsquo;s Home and Announcements, and notifies every family with notifications on.</span></div>
          <ActionForm action={postOrgAnnouncement.bind(null, slug)} className="form" resetOnOk>
            <textarea className="input textarea" name="body" rows={3} maxLength={2000} required placeholder="Fields at Kerman Park are closed Saturday for rain. Games move to Sunday." />
            <Submit busy="Sending…">Send to every team</Submit>
          </ActionForm>
          {news.map((n) => (
            <div key={n.id} className="msg notice" style={{ maxWidth: '100%' }}>
              <span className="msg-meta"><b>{n.author}</b> · <LocalTime iso={n.created_at} /></span>
              <div className="msg-body">{n.body}</div>
            </div>
          ))}
        </section>

        <h2 className="h-sec">Teams</h2>
        {list.length === 0 ? <div className="card empty"><b>No teams yet</b>Make a team link below and send it to each team admin.</div> : (
          <div className="stack">
            {list.map((t) => (
              <div key={t.id} className="card seat">
                <TeamMark brand={brandOf(t)} size={44} />
                <Link href={`/t/${t.slug}`} className="row-main">
                  <span className="row-title">{t.display_name}{t.age_group && <small>{t.age_group}</small>}</span>
                  <span className="row-meta">Open as team admin</span>
                </Link>
                <ActionForm action={leaveOrg.bind(null, t.slug, slug, t.id)}>
                  <button type="submit" className="icon-btn" aria-label={`Remove ${t.display_name} from the league`}><Cross /></button>
                </ActionForm>
                <span className="chev"><ChevronRight /></span>
              </div>
            ))}
          </div>
        )}

        <h2 className="h-sec">Next two weeks</h2>
        {items.length === 0 ? <p className="note note-plain">Nothing on any team&rsquo;s calendar.</p> : byDay(items, TZ).map(({ day, items: dl }) => (
          <section key={day} className="stack" style={{ gap: 6 }}>
            <span className="eyebrow">{dayTitle(day)}</span>
            <div className="card rows" style={{ padding: '4px 12px' }}>
              {dl.map((it) => {
                const t = owner.get(it.key);
                return (
                  <Link key={it.key} href={t ? (it.kind === 'game' ? `/t/${t.slug}/games/${it.id}` : `/t/${t.slug}/calendar/${it.id}`) : '#'} className="row">
                    <span className="row-meta" style={{ minWidth: 64 }}><LocalTime iso={it.starts_at} mode="time" /></span>
                    <span className="row-main">
                      <span className="row-title">{t?.display_name} {it.kind === 'game' ? it.title : `· ${it.title}`}{it.canceled && ' (canceled)'}</span>
                      <span className="row-meta">{[it.kind === 'game' ? 'Game' : EVENT_LABEL[it.kind], it.place].filter(Boolean).join(' · ')}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        <h2 className="h-sec">Links</h2>
        {open.map((i) => (
          <div key={i.token} className="card pad">
            <div className="h-row">
              <span className="row-main"><span className="row-title">{i.kind === 'team' ? 'Team link' : 'League admin link'}</span>
                <span className="row-meta">{i.kind === 'team' ? 'For team admins to put their team in the league. Works for any number of teams' : 'Works once'} until <LocalTime iso={i.expires_at} mode="day" />.</span></span>
              <ActionForm action={revokeOrgInvite.bind(null, slug, i.token)}>
                <button type="submit" className="icon-btn" aria-label="Cancel this link"><Cross /></button>
              </ActionForm>
            </div>
            <CopyLink url={`${site}/org/join/${i.token}`} />
          </div>
        ))}
        <div className="btn-row">
          <ActionForm action={createOrgInvite.bind(null, slug, 'team')}><Submit className="btn btn-quiet btn-block" busy="Making…">New team link</Submit></ActionForm>
          <ActionForm action={createOrgInvite.bind(null, slug, 'admin')}><Submit className="btn btn-quiet btn-block" busy="Making…">New admin link</Submit></ActionForm>
        </div>

        <h2 className="h-sec">League admins</h2>
        <div className="card rows" style={{ padding: '4px 12px' }}>
          {((admins ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[]).map((a) => (
            <div key={a.user_id} className="row">
              <span className="row-main"><span className="row-title">{a.profiles?.display_name ?? 'Admin'}{a.user_id === me && <small>you</small>}</span></span>
              <ActionForm action={removeOrgAdmin.bind(null, slug, a.user_id)}>
                <button type="submit" className="link">{a.user_id === me ? 'Leave' : 'Remove'}</button>
              </ActionForm>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
