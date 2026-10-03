import Link from 'next/link';
import { DateTimeField } from '@/components/LocalTime';
import { inkOn } from '@/lib/format';
import type { Game, Season, Team } from '@/lib/types';

// Who, where, when, and whether it counts. `opponent` is a team picked from
// Pressbox; without one, the name is typed.
export function GameFields({ seasons, game, opponent, changeHref }: {
  seasons: Season[]; game?: Game; opponent?: Team | null; changeHref?: string;
}) {
  const current = seasons.find((s) => s.is_current);
  return (
    <>
      {opponent ? (
        <div className="card seat">
          <input type="hidden" name="opponent_team_id" value={opponent.id} />
          <span className="crest" style={{ '--team': opponent.color, '--team-ink': inkOn(opponent.color), fontSize: opponent.abbr.length > 4 ? 13 : 19 } as React.CSSProperties}>{opponent.abbr}</span>
          <span className="row-main">
            <span className="row-title">{opponent.name}{opponent.age_group && <small>{opponent.age_group}</small>}</span>
            <span className="row-meta">On Pressbox · their roster loads into the lineup</span>
          </span>
          {changeHref && <Link href={changeHref} className="link">Change</Link>}
        </div>
      ) : (
        <div className="field-row" style={{ gridTemplateColumns: '1fr 110px' }}>
          <label className="field"><span>Opponent</span>
            <input className="input" name="opponent_name" defaultValue={game?.opponent_team_id ? '' : game?.opponent_name} maxLength={60} required autoComplete="off" />
          </label>
          <label className="field"><span>Scorebug</span>
            <input className="input" name="opponent_abbr" defaultValue={game?.opponent_team_id ? '' : game?.opponent_abbr} maxLength={6} autoComplete="off" autoCapitalize="characters" placeholder="Auto" />
          </label>
          <input type="hidden" name="opponent_color" value={game?.opponent_color ?? '#7a8794'} />
        </div>
      )}
      <fieldset>
        <legend className="legend">We are</legend>
        <div className="pills">
          <label className="pill wide"><input type="radio" name="is_home" value="home" defaultChecked={game ? game.is_home : true} /><span>Home</span></label>
          <label className="pill wide"><input type="radio" name="is_home" value="away" defaultChecked={game ? !game.is_home : false} /><span>Away</span></label>
        </div>
      </fieldset>
      <DateTimeField name="starts_at" value={game?.starts_at ?? null} label="First pitch" />
      <label className="field"><span>Where</span>
        <input className="input" name="venue" defaultValue={game?.venue ?? ''} maxLength={80} placeholder="Railyard Park, Field 3" autoComplete="off" />
      </label>
      {seasons.length > 0 && (
        <label className="field"><span>Season</span>
          <select className="select" name="season_id" defaultValue={game ? game.season_id ?? '' : current?.id ?? ''}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
            <option value="">No season</option>
          </select>
        </label>
      )}
      <label className="switch">
        <span className="switch-text"><b>Counts for season stats</b><small>Turn off for a scrimmage. Still scored, never added.</small></span>
        <input type="checkbox" name="counts_for_stats" defaultChecked={game ? game.counts_for_stats : true} />
      </label>
    </>
  );
}
