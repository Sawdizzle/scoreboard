import { clipText, type ClipView } from '@/lib/clips';
import { stamp } from '@/lib/youtube';

const SAID: Record<ClipView['shown'], string> = { saved: 'Saved', missed: 'Not saved', discarded: 'Play undone', pending: 'Saving' };
const WHY: Record<string, string> = { noperm: 'OBS access is below Basic', nosave: 'OBS never confirmed: is the replay buffer on?', failed: 'OBS refused the save' };

// The replay-buffer saves the stream made this game, in order, each with its
// place in the stream video. The clip files themselves stay on the streaming
// computer, in OBS's recording folder.
export function ClipsCard({ clips, streamStart }: { clips: ClipView[]; streamStart: string | null }) {
  const saved = clips.filter((c) => c.shown === 'saved').length;
  return (
    <section className="card pad">
      <h2 className="h-sec">Clips</h2>
      <p className="hint">
        {saved} of {clips.length} saved to OBS&apos;s recording folder on the streaming computer.
        {streamStart ? ' The time is where each moment sits in the stream video.' : ' OBS did not report the stream going live, so there are no stream times.'}
      </p>
      <ul className="rows">
        {clips.map((c) => (
          <li key={c.id} className="row" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <span className="row-main" style={{ gap: 4 }}>
              <span className="row-title">{c.offset != null ? `${stamp(c.offset)} · ` : ''}{clipText(c)}</span>
              <span className="sub" style={c.shown === 'saved' ? undefined : { color: 'var(--bad-text)' }}>
                {SAID[c.shown]}{c.kinds.length > 1 ? ` · with ${c.kinds.filter((k) => k !== c.kind).length} more` : ''}
                {c.shown === 'missed' && c.code && WHY[c.code] ? ` · ${WHY[c.code]}` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
