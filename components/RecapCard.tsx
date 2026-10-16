'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { publishRecap, saveRecap } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import type { RecapContent } from '@/lib/recap';

export type RecapRow = {
  status: 'draft' | 'published'; content: RecapContent; warnings: string[];
  model: string | null; generated_at: string; edited_at: string | null; published_at: string | null;
};

// One caption, editable, with its own Copy button.
function CopyField({ label, value, onChange, rows = 4, limit }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; limit?: number;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* no clipboard: the text is selectable */ }
  }
  const over = limit !== undefined && value.length > limit;
  return (
    <label className="field">
      <span>{label}{limit !== undefined && <> · <b style={over ? { color: 'var(--bad-text)' } : undefined}>{value.length}/{limit}</b></>}</span>
      <textarea className="textarea" style={{ fontFamily: 'inherit', minHeight: rows * 24 }} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn" onClick={copy}>{copied ? 'Copied' : `Copy ${label.toLowerCase()}`}</button>
    </label>
  );
}

// The post-game content pack on the staff game page: write it, check it, fix
// it, copy the captions out, and publish the recap to the public game page.
// Nothing here touches the stream.
export function RecapCard({ slug, gameId, initial, canGenerate = true }: { slug: string; gameId: string; initial: RecapRow | null; canGenerate?: boolean }) {
  const router = useRouter();
  const [row, setRow] = useState(initial);
  const [c, setC] = useState<RecapContent | null>(initial?.content ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (row && (row.edited_at || row.status === 'published') &&
      !window.confirm(row.status === 'published' ? 'Write a new recap? The published one comes down until you publish again.' : 'Write a new recap? Your edits will be replaced.')) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/recap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setRow({ status: 'draft', content: body.content, warnings: body.warnings ?? [], model: body.model, generated_at: body.generated_at, edited_at: null, published_at: null });
      setC(body.content);
      router.refresh();
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }

  const set = (f: (x: RecapContent) => RecapContent) => setC((x) => (x ? f(x) : x));

  return (
    <section className="card pad">
      <div className="h-row" style={{ alignItems: 'center' }}>
        <h2 className="h-sec">Recap</h2>
        {row && <span className={`eyebrow${row.status === 'published' ? ' gold' : ''}`}>{row.status === 'published' ? 'Published' : 'Draft'}</span>}
      </div>
      {!row && <p className="hint">Claude writes a recap, social captions and a website post from this game&rsquo;s plays. You check and edit it here; nothing goes public until you publish. <a className="link" href="/help/ai" target="_blank" rel="noreferrer">How it works</a></p>}
      {canGenerate && (
        <button type="button" className={row ? 'btn' : 'btn btn-primary'} onClick={generate} disabled={busy} aria-busy={busy}>
          {busy ? 'Writing… about 15 seconds' : row ? 'Write it again' : 'Write the recap'}
        </button>
      )}
      {error && <p role="alert" className="note note-bad">{error}</p>}

      {row && c && (
        <>
          {row.warnings.length > 0 && (
            <div role="alert" className="note note-bad">
              <b>Check these before publishing.</b> They do not match the game&rsquo;s plays:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{row.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <ActionForm action={saveRecap.bind(null, slug, gameId)} className="form">
            <input type="hidden" name="content" value={JSON.stringify(c)} />
            <label className="field"><span>Headline</span>
              <input className="input" value={c.headline} onChange={(e) => set((x) => ({ ...x, headline: e.target.value }))} />
            </label>
            <label className="field"><span>Recap</span>
              <textarea className="textarea" style={{ fontFamily: 'inherit', minHeight: 260 }} value={c.recap} onChange={(e) => set((x) => ({ ...x, recap: e.target.value }))} />
            </label>
            <CopyField label="Instagram" value={c.social.instagram} onChange={(v) => set((x) => ({ ...x, social: { ...x.social, instagram: v } }))} />
            <CopyField label="Facebook" value={c.social.facebook} onChange={(v) => set((x) => ({ ...x, social: { ...x.social, facebook: v } }))} />
            <CopyField label="X" rows={3} limit={280} value={c.social.x} onChange={(v) => set((x) => ({ ...x, social: { ...x.social, x: v } }))} />
            <label className="field"><span>Website title</span>
              <input className="input" value={c.website_post.title} onChange={(e) => set((x) => ({ ...x, website_post: { ...x.website_post, title: e.target.value } }))} />
            </label>
            <CopyField label="Website post" rows={10} value={c.website_post.body_markdown} onChange={(v) => set((x) => ({ ...x, website_post: { ...x.website_post, body_markdown: v } }))} />
            <div className="field-row">
              <label className="field"><span>Player of the game</span>
                <input className="input" value={c.player_of_the_game.name_or_number} onChange={(e) => set((x) => ({ ...x, player_of_the_game: { ...x.player_of_the_game, name_or_number: e.target.value } }))} />
              </label>
              <label className="field"><span>Why</span>
                <input className="input" value={c.player_of_the_game.reason} onChange={(e) => set((x) => ({ ...x, player_of_the_game: { ...x.player_of_the_game, reason: e.target.value } }))} />
              </label>
            </div>
            <Submit busy="Saving…">Save edits</Submit>
          </ActionForm>
          <ActionForm action={publishRecap.bind(null, slug, gameId, row.status !== 'published')} className="form">
            <p className="hint">{row.status === 'published'
              ? 'The headline and recap show on the public game page. Captions stay here.'
              : 'Publishing puts the headline and recap on the public game page. Save your edits first.'}</p>
            <Submit className={row.status === 'published' ? 'btn' : 'btn btn-primary'} busy="…">
              {row.status === 'published' ? 'Take it down' : 'Publish recap'}
            </Submit>
          </ActionForm>
          <p className="hint">Written by {row.model ?? 'Claude'} from this game&rsquo;s plays{row.edited_at ? ', then edited' : ''}. <a className="link" href="/help/ai" target="_blank" rel="noreferrer">How recaps are written</a></p>
        </>
      )}
    </section>
  );
}
