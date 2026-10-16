// The request every AI helper sends, in one place, so the app and the eval
// script (scripts/recap-eval.ts) ask Claude exactly the same way.
import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export type Content = string | Anthropic.Beta.BetaContentBlockParam[];

export function aiParams<S extends z.ZodType>(o: { model: string; system: string; schema: S; content: Content; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }) {
  // Sonnet and Opus fall back server-side on a refusal; Haiku has no fallback.
  const fallback = !o.model.includes('haiku');
  return {
    model: o.model,
    max_tokens: o.maxTokens ?? 8000,
    ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    system: [{ type: 'text' as const, text: o.system, cache_control: { type: 'ephemeral' as const } }],
    output_config: { effort: o.effort ?? 'medium', format: betaZodOutputFormat(o.schema) },
    messages: [{ role: 'user' as const, content: o.content }],
  };
}
