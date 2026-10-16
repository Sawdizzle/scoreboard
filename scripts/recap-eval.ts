// The recap test set. Writes a recap for every case in
// tests/fixtures/recap-cases (real games, their facts frozen) several times
// over, exactly as the app asks for one, and grades each with lib/recap-grade.
// Run it before changing the recap prompt or the model:
//
//   ANTHROPIC_API_KEY=... node scripts/recap-eval.ts [runs per case, default 3]
//
// It costs a few cents a run (Sonnet 5.5). Results land in eval-results/.
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { aiParams } from '../lib/ai-params.ts';
import { RECAP_REQUEST, recapPrompt, type RecapContent, type RecapContext } from '../lib/recap.ts';
import { gradeRecap } from '../lib/recap-grade.ts';
import { summarizeGame, type SummaryInput } from '../lib/summarize.ts';

const runs = Math.max(1, Number(process.argv[2]) || 3);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY first: this calls Claude.');
  process.exit(1);
}
const client = new Anthropic();
const dir = new URL('../tests/fixtures/recap-cases/', import.meta.url);
const cases = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { name: string; input: SummaryInput; ctx: RecapContext });

const results: unknown[] = [];
let passed = 0, total = 0, tokensIn = 0, tokensOut = 0;
for (const c of cases) {
  const facts = summarizeGame(c.input);
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    const res = await client.beta.messages.parse(aiParams({ ...RECAP_REQUEST, content: recapPrompt(facts, c.ctx) }));
    tokensIn += res.usage.input_tokens; tokensOut += res.usage.output_tokens;
    const out = res.parsed_output as RecapContent | null;
    const grade = out ? gradeRecap(out, facts) : { pass: false, problems: [`No answer (${res.stop_reason}).`] };
    total += 1; if (grade.pass) passed += 1;
    console.log(`${grade.pass ? 'PASS' : 'FAIL'}  ${c.name} #${i + 1}  ${((Date.now() - t) / 1000).toFixed(1)}s${grade.pass ? '' : `\n      ${grade.problems.join('\n      ')}`}`);
    results.push({ case: c.name, run: i + 1, model: res.model, grade, out });
  }
}
// Sonnet 5.5: $2 in, $10 out per million tokens.
const cost = (tokensIn * 2 + tokensOut * 10) / 1e6;
console.log(`\n${passed}/${total} passed · ${tokensIn + tokensOut} tokens · about $${cost.toFixed(2)}`);
mkdirSync(new URL('../eval-results/', import.meta.url), { recursive: true });
const file = new URL(`../eval-results/recap-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ passed, total, cost, results }, null, 1));
console.log(`Saved ${file.pathname}`);
process.exit(passed === total ? 0 : 1);
