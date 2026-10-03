import Link from 'next/link';
import { deletePlayer, updatePlayer } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { ChevronLeft } from '@/components/icons';
import { PlayerFields } from '@/components/PlayerFields';
import { fullName, publicName, shortDate } from '@/lib/format';
import { batting, hasPitching, innings, pitching, rate2, rate3, type SeasonLine } from '@/lib/stats';
import { canEditTeam, type Player, type PublicName, type Role, type Season, type Team } from '@/lib/types';

const PUBLIC_LABEL: Record<PublicName, string> = { full: 'Full name', first_initial: 'First name, last initial', number: 'Number only' };

export function PlayerView({ team, role, player: p, lines = [], seasons = [], seasonId }: {
  team: Team; role: Role; player: Player; lines?: SeasonLine[]; seasons?: Season[]; seasonId?: string;
}) {
  // Seasons this player has numbers in, plus the current one; newest first.
  const shown = seasons.filter((s) => s.is_current || lines.some((l) => l.season_id === s.id));
  const sel = shown.find((s) => s.id === seasonId) ?? shown.find((s) => lines.some((l) => l.season_id === s.id) && s.is_current)
    ?? shown.find((s) => lines.some((l) => l.season_id === s.id)) ?? shown[0];
  const line = sel ? lines.find((l) => l.season_id === sel.id) : undefined;
  const b = line ? batting(line) : null;
  const pi = line && hasPitching(line) ? pitching(line, sel?.game_innings) : null;
  const edit = canEditTeam(role);
  const facts = [p.number && `No. ${p.number}`, p.positions.join(' · '), p.bats && `Bats ${p.bats}`, p.throws && `Throws ${p.throws}`].filter(Boolean);
  return (
    <>
      <div className="hero slab">
        {p.number && <span className="hero-num" aria-hidden="true">{p.number}</span>}
        <Link href={`/t/${team.slug}/roster`} aria-label="Back to roster" className="back"><ChevronLeft /></Link>
        <span className="eyebrow">{facts.length ? facts.join(' · ') : team.name}{!p.active && ' · Not active'}</span>
        <h1 className="disp">{fullName(p) || `No. ${p.number}`}</h1>
      </div>

      <div className="page" style={{ paddingTop: 18 }}>
        {shown.length > 1 && (
          <nav className="chips" aria-label="Seasons">
            {shown.map((x) => (
              <Link key={x.id} href={`/t/${team.slug}/player/${p.id}?s=${x.id}`} className="chip" aria-current={x.id === sel?.id ? 'page' : undefined}>
                {x.is_current && <span className="dot" title="Current season" />}{x.name}
              </Link>
            ))}
          </nav>
        )}

        <section className="stack">
          <div className="slash" aria-label={`${sel?.name ?? 'Season'} batting line`}>
            {([['AVG', b?.avg], ['OBP', b?.obp], ['SLG', b?.slg], ['OPS', b?.ops]] as const).map(([k, v], i) => (
              <div key={k}><b className={line && line.b_pa ? (i === 3 ? 'gold' : 'live') : ''}>{line && line.b_pa ? rate3(v ?? null) : '–'}</b><span>{k}</span></div>
            ))}
          </div>
          {line && line.b_pa > 0 ? (
            <div className="counts">
              {([['G', line.b_g], ['AB', line.b_ab], ['H', line.b_h], ['2B', line.b_2b], ['HR', line.b_hr],
                ['RBI', line.b_rbi], ['R', line.b_r], ['BB', line.b_bb], ['K', line.b_so], ['SB', line.b_sb]] as const).map(([k, v]) => (
                <div key={k}><b>{v}</b><span>{k}</span></div>
              ))}
            </div>
          ) : (
            <p className="sub" style={{ padding: '0 4px' }}>No {sel?.name ?? 'season'} at-bats yet. Import from GameChanger on the Season tab, or score a game.</p>
          )}
          {line && pi && (
            <>
              <h2 className="h-sec" style={{ padding: '6px 4px 0' }}>Pitching</h2>
              <div className="counts">
                {([['IP', innings(line.p_outs)], ['ERA', rate2(pi.era)], ['K', line.p_so], ['BB', line.p_bb], ['WHIP', rate2(pi.whip)],
                  ['H', line.p_h], ['ER', line.p_er], ['BF', line.p_bf], ['P', line.p_pitches], ['GS', line.p_gs]] as const).map(([k, v]) => (
                  <div key={k}><b>{v}</b><span>{k}</span></div>
                ))}
              </div>
            </>
          )}
          {line?.imported_at && <p className="source">From GameChanger, imported {shortDate(line.imported_at)}.</p>}
        </section>

        {edit ? (
          <>
            <ActionForm action={updatePlayer.bind(null, team.slug, p.id)} className="form">
              <PlayerFields p={p} />
              <fieldset>
                <legend className="legend">On the public page and the stream as</legend>
                <div className="stack" style={{ gap: 6 }}>
                  {(Object.keys(PUBLIC_LABEL) as PublicName[]).map((mode) => (
                    <label key={mode} className="pill wide" style={{ display: 'flex' }}>
                      <input type="radio" name="public_name" value={mode} defaultChecked={p.public_name === mode} />
                      <span style={{ flex: 1, justifyContent: 'space-between', borderRadius: 12, gap: 12 }}>
                        <b>{publicName(p, mode)}</b><small style={{ fontWeight: 500 }}>{PUBLIC_LABEL[mode]}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="switch">
                <span className="switch-text"><b>On the active roster</b><small>Turn off for a player who has left. Their stats stay.</small></span>
                <input type="checkbox" name="active" defaultChecked={p.active} />
              </label>
              <Submit busy="Saving…">Save player</Submit>
            </ActionForm>

            <details className="fold danger">
              <summary>Delete this player</summary>
              <div className="fold-body">
                <ActionForm action={deletePlayer.bind(null, team.slug, p.id)} className="form">
                  <p className="hint">This removes {fullName(p) || 'the player'} from the team for good. For a player who has only left, turn off &ldquo;On the active roster&rdquo; instead.</p>
                  <Submit className="btn btn-danger" busy="Deleting…">Delete for good</Submit>
                </ActionForm>
              </div>
            </details>
          </>
        ) : (
          <p className="note note-plain">Shown publicly as <b>{publicName(p, p.public_name)}</b>. The organizer or head coach edits players.</p>
        )}
      </div>
    </>
  );
}
