import type { Metadata } from 'next';
import Link from 'next/link';
import { CopyLink } from '@/components/CopyLink';
import { loadTeam } from '@/lib/data';
import { origin } from '@/lib/origin';

export const metadata: Metadata = { title: 'OBS and Mevo setup' };

// The broadcaster's manual: the scorebug into OBS as a Browser Source, or into
// a Mevo production, step by step, with the link to paste right at the top.
export default async function StreamGuide({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team } = await loadTeam(slug);
  const { data: channel } = await supabase.from('channels').select('token').eq('team_id', team.id).maybeSingle<{ token: string }>();
  const link = channel ? `${await origin()}/overlay/${channel.token}` : null;
  const base = `/t/${slug}`;
  return (
    <div className="page guide">
      <section className="card pad">
        <div className="row-main">
          <span className="row-title">Your scorebug link</span>
          <span className="row-meta">Paste this into OBS or Mevo once. It always shows the game being scored on the pad, on a clear background, 1920 × 1080. Anyone with it can see the scorebug, so keep it to your streaming computer.</span>
        </div>
        {link ? <CopyLink url={link} label="Scorebug link" /> : <p className="note note-plain">The stream is not set up for this team yet.</p>}
        <p className="hint">Looks, cards, sponsor and position are set on <Link href={`${base}/stream`} className="link">Stream</Link>. During the game, run scenes and cards from On Air (open a game from Today).</p>
      </section>

      <h2 className="h-sec">Your job on game day</h2>
      <ol className="steps">
        <li><b>The night before:</b> open the stream on your streaming device and check the scorebug shows the right teams. On the pad, Fix the situation &gt; Demo plays a game by itself, to see the whole show without a real one.</li>
        <li><b>At the field:</b> start the stream 15 minutes early with the Starting Soon scene up (On Air &gt; Scenes).</li>
        <li><b>During the game:</b> the scorer scores, and the scorebug follows on its own. You run the extras from On Air: stat cards, the mid-inning board, the sponsor, replays and the Game paused scene for a delay.</li>
        <li><b>After the final out:</b> the Final scene goes up. Leave it for a minute, then end the stream.</li>
      </ol>

      <h2 className="h-sec">OBS Studio (Windows or Mac)</h2>
      <details className="fold" open>
        <summary>Add the scorebug as a Browser Source</summary>
        <ol className="steps fold-body">
          <li>Install <a className="link" href="https://obsproject.com" target="_blank" rel="noreferrer">OBS Studio</a> (version 30 or newer).</li>
          <li><b>Settings &gt; Video:</b> Base (Canvas) and Output (Scaled) Resolution both <code>1920x1080</code>. Common FPS Values: <code>30</code> (or <code>60</code> if your camera and computer keep up).</li>
          <li>In <b>Scenes</b>, make a scene for your camera and add the camera to it first (Sources &gt; <b>+</b> &gt; Video Capture Device, or your camera&rsquo;s own source).</li>
          <li>Sources &gt; <b>+</b> &gt; <b>Browser</b>. Name it <code>Scorebug</code>, then OK.</li>
          <li>In its properties: <b>URL</b> = your scorebug link above. <b>Width</b> <code>1920</code>, <b>Height</b> <code>1080</code>.</li>
          <li>Tick <b>Control audio via OBS</b> (the run, home-run and strikeout sounds come through the stream).</li>
          <li>Untick <b>Shutdown source when not visible</b> and untick <b>Refresh browser when scene becomes active</b>, so the scorebug never blanks between scenes.</li>
          <li>Leave <b>Custom CSS</b> as it is: the page is already transparent. OK to save.</li>
          <li>In the Sources list, drag <b>Scorebug</b> above the camera, so it sits on top.</li>
          <li>Do not stretch or crop it in the preview. Move and size the scorebug on the <Link href={`${base}/stream`} className="link">Stream</Link> screen instead (nine positions and a size slider).</li>
        </ol>
      </details>
      <details className="fold">
        <summary>More than one camera</summary>
        <ol className="steps fold-body">
          <li>Make one scene per camera.</li>
          <li>In each, Sources &gt; <b>+</b> &gt; <b>Browser</b> &gt; <b>Add Existing</b> &gt; <b>Scorebug</b>. Never a second copy: two copies play every sound twice and save two clips per replay.</li>
        </ol>
      </details>
      <details className="fold">
        <summary>Let the pad drive OBS (cameras, replays, go live)</summary>
        <ol className="steps fold-body">
          <li>Right-click <b>Scorebug</b> &gt; <b>Properties</b> &gt; <b>Page permissions</b>.</li>
          <li><b>No access:</b> the scorebug, cards, scenes and sound only. <b>Basic:</b> adds Save replay and auto-clips of big moments. <b>Advanced:</b> adds switching cameras (OBS scenes) and the replay buffer. <b>Full:</b> adds Go live and Record.</li>
          <li>For replays: <b>Settings &gt; Output &gt; Replay Buffer</b>, tick Enable, Maximum Replay Time <code>90</code> seconds.</li>
        </ol>
      </details>
      <details className="fold">
        <summary>Something is wrong</summary>
        <ul className="steps fold-body">
          <li><b>Nothing shows:</b> check the link was pasted whole. If the link was changed on Stream, paste the new one.</li>
          <li><b>Old score stuck:</b> right-click Scorebug &gt; <b>Refresh</b>. A dropped connection keeps the last picture and catches up by itself.</li>
          <li><b>No sound:</b> tick Control audio via OBS, then check Scorebug in the Audio Mixer is not muted.</li>
          <li><b>Sounds twice:</b> there are two Scorebug copies. Delete one and use Add Existing.</li>
        </ul>
      </details>

      <h2 className="h-sec">Mevo</h2>
      <details className="fold" open>
        <summary>Mevo Studio, with an HTML (web) source</summary>
        <ol className="steps fold-body">
          <li>Open <b>Mevo Studio</b> and tap the blue <b>+</b> to add an asset.</li>
          <li>Pick the web or HTML source and paste your scorebug link. Set it to <code>1920 × 1080</code> if it asks for a size.</li>
          <li>Make a new scene for it and set the scene type to <b>Overlay</b> (Scene Settings). Overlay scenes have a clear background and sit on top of your camera; Full Screen scenes would cover the camera in black.</li>
          <li>Turn the overlay scene on over your camera shot, and keep it on for the whole game.</li>
          <li>Keep the phone or iPad running Mevo Studio on Wi-Fi or cellular data: the scorebug updates over the internet, play by play.</li>
        </ol>
        <p className="hint fold-body">The names of the source and its settings vary between Mevo Studio versions. If your version has no web or HTML source, use the next option.</p>
      </details>
      <details className="fold">
        <summary>Mevo camera into OBS</summary>
        <ol className="steps fold-body">
          <li>Send the Mevo&rsquo;s picture to the computer: in the Mevo app, output it over <b>NDI</b>, <b>HDMI</b> (with a capture card) or <b>USB webcam (UVC)</b>. Mevo&rsquo;s help article &ldquo;How to output your Mevo Camera via HDMI, SRT, NDI, or UVC&rdquo; has the steps for each model.</li>
          <li>In OBS, add the Mevo as the camera source in your scene (Video Capture Device for USB or HDMI; the NDI source for NDI, with the DistroAV plugin).</li>
          <li>Add the scorebug as a Browser Source above it (the OBS steps above), and stream from OBS.</li>
        </ol>
      </details>
    </div>
  );
}
