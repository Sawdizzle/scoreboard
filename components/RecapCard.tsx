'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { publishRecap, saveRecap } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import type { RecapContent } from '@/lib/recap';

export type RecapRow = {
  status: 'draft' | 'published'; content: RecapContent; content_es?: RecapContent | null; warnings: string[];
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
// The recap in Spanish: written from the saved English, read-only here (edit
// the English and write it again), each part with its own Copy.
function Spanish({ gameId, initial, canGenerate }: { gameId: string; initial: RecapContent | null; canGenerate: boolean }) {
  const [es, setEs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  async function write() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setEs(body.content);
      if (body.warnings?.length) setError(`Check: ${body.warnings.join(' ')}`);
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }
  const copy = async (k: string, t: string) => { try { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 2000); } catch { /* select by hand */ } };
  const parts: [string, string][] = es ? [['Titular', es.headline], ['Resumen', es.recap], ['Instagram', es.social.instagram], ['Facebook', es.social.facebook], ['X', es.social.x], ['Sitio web', `${es.website_post.title}\n\n${es.website_post.body_markdown}`]] : [];
  return (
    <details className="fold" open={!!es}>
      <summary>En español</summary>
      <div className="fold-body stack">
        {canGenerate && (
          <button type="button" className="btn" onClick={write} disabled={busy} aria-busy={busy}>
            {busy ? 'Traduciendo…' : es ? 'Write the Spanish again' : 'Write it in Spanish'}
          </button>
        )}
        <p className="hint">Written from the saved English. Saving English edits clears it; write it again after. Once published, the public page offers it too.</p>
        {error && <p role="alert" className="note note-bad">{error}</p>}
        {parts.map(([label, text]) => text.trim() && (
          <div key={label} className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">{label}</span>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{text}</p>
            <button type="button" className="btn btn-quiet" onClick={() => copy(label, text)}>{copied === label ? 'Copiado' : `Copy ${label}`}</button>
          </div>
        ))}
      </div>
    </details>
  );
}

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
          <Spanish key={`${row.generated_at}|${row.edited_at}`} gameId={gameId} initial={row.content_es ?? null} canGenerate={canGenerate} />
          <p className="hint">Written by {row.model ?? 'Claude'} from this game&rsquo;s plays{row.edited_at ? ', then edited' : ''}. <a className="link" href="/help/ai" target="_blank" rel="noreferrer">How recaps are written</a></p>
        </>
      )}
    </section>
  );
}
