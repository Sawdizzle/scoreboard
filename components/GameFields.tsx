import Link from 'next/link';
import { DateTimeField } from '@/components/LocalTime';
import { TeamMark, brandOf } from '@/components/TeamBrand';
import { SPORTS, SPORT_LABEL } from '@/lib/sports';
import type { Game, Season, Team } from '@/lib/types';

// Who, where, when, and whether it counts. `opponent` is a team picked from
// Pressbox; without one, the name is typed.
// `saved` is an opponent this team has played before: its name, short code
// and colour fill the fields, and its last lineup comes with the game.
export function GameFields({ seasons, game, opponent, changeHref, saved }: {
  seasons: Season[]; game?: Game; opponent?: Team | null; changeHref?: string; saved?: { name: string; abbr: string; color: string; players: number } | null;
}) {
  const current = seasons.find((s) => s.is_current);
  return (
    <>
      {opponent ? (
        <div className="card seat">
          <input type="hidden" name="opponent_team_id" value={opponent.id} />
          <TeamMark brand={brandOf(opponent)} />
          <span className="row-main">
            <span className="row-title">{opponent.name}{opponent.age_group && <small>{opponent.age_group}</small>}</span>
            <span className="row-meta">On Pressbox · their roster loads into the lineup</span>
          </span>
          {changeHref && <Link href={changeHref} className="link">Change</Link>}
        </div>
      ) : (
        <div className="field-row" style={{ gridTemplateColumns: '1fr 84px' }}>
          <label className="field"><span>Opponent</span>
            <input className="input" name="opponent_name" defaultValue={saved?.name ?? (game?.opponent_team_id ? '' : game?.opponent_name)} maxLength={60} required autoComplete="off" />
          </label>
          <label className="field"><span>Colour</span>
            <input className="input" type="color" name="opponent_color" defaultValue={saved?.color ?? game?.opponent_color ?? '#7a8794'} />
          </label>
          {saved && <input type="hidden" name="opponent_abbr" value={saved.abbr} />}
          {saved && <p className="hint" style={{ gridColumn: '1 / -1', margin: 0 }}>{saved.players ? `Played before: their last lineup (${saved.players} players) loads with the game.` : 'Played before. No lineup saved for them yet.'}</p>}
        </div>
      )}
      {!game && (
        <label className="field"><span>Sport</span>
          <select className="select" name="sport" defaultValue="baseball">
            {SPORTS.map((sp) => <option key={sp} value={sp}>{SPORT_LABEL[sp]}{sp === 'baseball' ? '' : ' (score only)'}</option>)}
          </select>
        </label>
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
