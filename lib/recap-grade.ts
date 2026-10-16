// How a written recap is graded, for scripts/recap-eval.ts: the same fact
// check the app runs, plus the shape the coach expects. Pure.
import { checkRecap, type RecapContent } from './recap.ts';
import type { GameFacts } from './summarize.ts';

export type Grade = { pass: boolean; problems: string[] };

export function gradeRecap(c: RecapContent, facts: GameFacts): Grade {
  const problems = [...checkRecap(c, facts)];
  const paras = c.recap.split(/\n\s*\n/).filter((p) => p.trim());
  if (paras.length < 2 || paras.length > 6) problems.push(`The recap has ${paras.length} paragraphs; it should have 3 to 5.`);
  if (c.headline.length > 90) problems.push(`The headline is ${c.headline.length} characters.`);
  const finalA = `${Math.max(facts.score.us, facts.score.them)}-${Math.min(facts.score.us, facts.score.them)}`;
  if (!`${c.headline}\n${c.recap}`.includes(finalA)) problems.push(`Neither the headline nor the recap gives the final score (${finalA}).`);
  // A recap must not narrate the runs the log cannot explain: a gap's inning
  // should not be described with a play that scored in it.
  for (const g of facts.gaps) {
    const ord = ['', '1st', '2nd', '3rd'][g.inning] ?? `${g.inning}th`;
    const near = new RegExp(`${ord}[^.]{0,80}(single|double|triple|home run|walk|error|steal|wild pitch)[^.]{0,40}(run|score)`, 'i');
    if (paras.some((p) => near.test(p))) problems.push(`The recap may explain the ${ord}-inning runs the log is missing.`);
  }
  const people = c.player_of_the_game.name_or_number.trim();
  if (!facts.standouts.length && people) problems.push('A player of the game was named for a game with no player stats.');
  return { pass: problems.length === 0, problems };
}
