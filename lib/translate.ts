// A recap in Spanish: the coach's English, as it stands, carried over whole.
// Every number and hashtag must come through unchanged, so the check holds
// the two side by side.
import type { RecapContent } from './recap.ts';

export const TRANSLATE_MODEL = 'claude-sonnet-5-5';

export const TRANSLATE_SYSTEM = `You translate a youth baseball team's post-game content from English into natural Latin American Spanish for the team's families.
- Translate every field; keep the same structure, paragraphs and line breaks.
- Keep every number, score, inning, statistic, name and hashtag exactly as written (scores like "10-2" stay "10-2"). Do not add or drop anything.
- Use common Spanish baseball terms (jonrón, doble, base por bolas, ponche, entrada, carrera impulsada).
- Team and player names are never translated.
- The X post must stay within 280 characters.`;

export const translatePrompt = (c: RecapContent) => `Translate this into Spanish.\n\n<content>\n${JSON.stringify(c)}\n</content>`;

const fields = (c: RecapContent) => ({
  headline: c.headline, recap: c.recap, instagram: c.social.instagram, facebook: c.social.facebook, x: c.social.x,
  title: c.website_post.title, website: c.website_post.body_markdown, reason: c.player_of_the_game.reason,
});
const numbers = (s: string) => (s.replace(/#\w+/g, '').match(/\d+(?:[-.:]\d+)*/g) ?? []).sort();
const tags = (s: string) => (s.match(/#\w+/g) ?? []).sort();

export function checkTranslation(en: RecapContent, es: RecapContent): string[] {
  const out: string[] = [];
  const a = fields(en), b = fields(es);
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    if (numbers(a[k]).join() !== numbers(b[k]).join()) out.push(`The ${k} lost or changed a number (${numbers(a[k]).join(', ') || 'none'} → ${numbers(b[k]).join(', ') || 'none'}).`);
    if (tags(a[k]).join() !== tags(b[k]).join()) out.push(`The ${k} changed its hashtags.`);
    if (a[k].trim() && !b[k].trim()) out.push(`The ${k} came back empty.`);
  }
  if (es.player_of_the_game.name_or_number !== en.player_of_the_game.name_or_number) out.push('The player of the game must keep their name as written.');
  if (es.social.x.length > 280) out.push(`The X post is ${es.social.x.length} characters.`);
  return out;
}
