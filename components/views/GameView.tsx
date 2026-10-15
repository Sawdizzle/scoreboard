import Link from 'next/link';
import { GamePlace } from '@/components/GamePlace';
import { deleteGame, updateGame } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { GameFields } from '@/components/GameFields';
import { Matchup, Readiness } from '@/components/GameBits';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { LocalTime } from '@/components/LocalTime';
import { RecapCard, type RecapRow } from '@/components/RecapCard';
import { SPORT_LABEL } from '@/lib/sports';
import { canEditTeam, canRunGames, canWriteRecaps, type Game, type Lineup, type Role, type Season, type Side, type Team } from '@/lib/types';

export function GameView({ team, role, game, lineups, seasons, recap = null }: {
  team: Team; role: Role; game: Game; lineups: Partial<Record<Side, Lineup>>; seasons: Season[]; recap?: RecapRow | null;
}) {
  const base = `/t/${team.slug}/games/${game.id}`;
  const run = canRunGames(role);
  const season = seasons.find((s) => s.id === game.season_id);
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={`/t/${team.slug}/season`} aria-label="Back to the schedule" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <h1 className="disp h2">{game.is_home ? 'vs' : 'at'} {game.opponent_name}</h1>
      </div>
      <section className="card next-game">
        <div className="next-top">
          <span className="eyebrow gold"><LocalTime iso={game.starts_at} /></span>
          <span className="sub">{game.venue}</span>
        </div>
        <Matchup team={team} game={game} />
        <GamePlace game={game} />
        <div className="next-foot">
          <span className="sub">
            {game.sport !== 'baseball' ? `${SPORT_LABEL[game.sport]} · score only` : game.counts_for_stats ? `Counts for ${season?.name ?? 'no season'}` : 'Scrimmage: scored, not added to stats'}
          </span>
        </div>
      </section>

      {game.sport === 'baseball' && <section className="rows">
        {(['us', 'them'] as const).map((side) => (
          <Link key={side} href={`${base}/lineup?side=${side}`} className="row" style={{ paddingTop: 10, paddingBottom: 10 }}>
            <span className="row-main" style={{ gap: 8 }}>
              <span className="row-title">{side === 'us' ? `${team.name} lineup` : `${game.opponent_name} lineup`}</span>
              <Readiness lineup={lineups[side]} label="Order" />
            </span>
            <span className="chev"><ChevronRight /></span>
          </Link>
        ))}
      </section>}

      {run && (
        <Link href={`/pad/${team.slug}/${game.id}`} className="btn btn-primary btn-big">
          {game.status === 'live' ? 'Back to the pad' : game.status === 'final' ? 'Open the pad · final' : 'Open the pad'}
        </Link>
      )}

      {game.status === 'final' && game.sport === 'baseball' && canWriteRecaps(role) && (
        <RecapCard key={`${recap?.generated_at}|${recap?.status}|${recap?.edited_at}`} slug={team.slug} gameId={game.id} initial={recap} />
      )}

      {run && (
        <details className="fold">
          <summary>Edit game</summary>
          <div className="fold-body">
            <ActionForm action={updateGame.bind(null, team.slug, game.id)} className="form">
              <GameFields seasons={seasons} game={game} />
              <Submit busy="Saving…">Save game</Submit>
            </ActionForm>
          </div>
        </details>
      )}
      {canEditTeam(role) && (
        <details className="fold danger">
          <summary>Delete this game</summary>
          <div className="fold-body">
            <ActionForm action={deleteGame.bind(null, team.slug, game.id)} className="form">
              <p className="hint">The game and both lineups go for good.</p>
              <Submit className="btn btn-danger" busy="Deleting…">Delete game</Submit>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
