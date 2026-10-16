import type { Allowance } from '@/lib/ai-limit';

export type UsageRow = {
  created_at: string; kind: 'recap' | 'blurb' | 'digest'; model: string; input_tokens: number; output_tokens: number; ok: boolean;
  games: { opponent_name: string; starts_at: string | null } | null;
};
const KIND = { recap: 'Recap', blurb: 'Pregame blurb', digest: 'Weekend digest' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

// What the team's AI writing has used this month, and its last calls. The
// limit is the team's plan; staff can see it but not change it.
export function AiUsageCard({ allowance, rows }: { allowance: Allowance | null; rows: UsageRow[] }) {
  const limit = allowance?.limit ?? 0;
  const resets = allowance ? new Date(allowance.resets).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' }) : '';
  return (
    <section className="card pad">
      <h2 className="h-sec">AI writing</h2>
      {limit === 0 ? (
        <p className="hint">AI writing is off for this team. Recaps and pregame blurbs appear once your plan includes them. <a className="link" href="/help/ai" target="_blank" rel="noreferrer">How it works</a></p>
      ) : (
        <>
          <p><b>{allowance!.used} of {limit}</b> AI writes used this month. {allowance!.remaining > 0 ? `${allowance!.remaining} left;` : 'None left;'} they reset {resets}.</p>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={allowance!.used} aria-label="AI writes used this month"
            style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
            <i style={{ display: 'block', height: '100%', width: `${Math.min(100, (allowance!.used / limit) * 100)}%`, background: allowance!.remaining > 0 ? 'var(--steel)' : 'var(--bad-text)' }} />
          </div>
          <p className="hint">A recap or a blurb is one write, its automatic retry included. Calls that fail do not count. <a className="link" href="/help/ai" target="_blank" rel="noreferrer">How it works</a></p>
        </>
      )}
      {rows.length > 0 && (
        <div className="table-box">
          <table className="stat-table">
            <thead><tr><th style={{ textAlign: 'left' }}>When</th><th style={{ textAlign: 'left' }}>What</th><th style={{ textAlign: 'left' }}>Game</th><th>Tokens</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="who"><span>{when(r.created_at)}</span></td>
                  <td style={{ textAlign: 'left' }}>{KIND[r.kind] ?? r.kind}</td>
                  <td style={{ textAlign: 'left' }}>{r.games?.opponent_name ?? '–'}</td>
                  <td>{(r.input_tokens + r.output_tokens).toLocaleString('en-US')}</td>
                  <td>{r.ok ? '' : 'failed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
