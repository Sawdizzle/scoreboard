import './comic.css';
import type { Brand } from '@/components/TeamBrand';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';

// Ka-Pow, drawn here: the scorebug as a comic-book panel strip
// (public/bugs/comic.html), rebuilt as part of the page so the stat cards can
// slide out from behind it. Inked panels on newsprint, flat team colours with
// Ben-Day dots, a narrator's caption for the batter, and the plays told in SFX
// lettering: CRACK! for a hit, a K panel for a strikeout (WHIFF! swinging,
// FROZEN! with icicles looking), a shout balloon for a double play, a
// narrator's note for a walk, and a splash panel that tears in two for a home
// run.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts a
// new element and its animation plays once.

// The original's seeded jagged starburst: alternating outer and inner radii with a little wobble.
function burstPts(n: number, ro: number, ri: number, seed = 1, jit = 0.18, ky = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const r = (i % 2 ? ri : ro) * (1 + (rnd() - 0.5) * jit * 2);
    pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r * ky).toFixed(1)}`);
  }
  return pts.join(' ');
}

// A two-layer inked burst: a colour back plate and an inner flat with red dots.
function Burst({ n = 14, seed = 3, back = 'var(--red)', front = 'var(--yel)', ri = 0.62 }: { n?: number; seed?: number; back?: string; front?: string; ri?: number }) {
  const inner = burstPts(n + 3, 78, 78 * ri, seed + 7);
  return (
    <svg viewBox="-100 -100 200 200" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={burstPts(n, 100, 100 * ri, seed)} style={{ fill: back }} stroke="#141414" strokeWidth="5" strokeLinejoin="miter" />
      <polygon points={inner} style={{ fill: front }} stroke="#141414" strokeWidth="4" />
      <polygon points={inner} fill="url(#lkcomic-bd)" opacity=".5" />
    </svg>
  );
}

// The jagged tear down the middle of the home-run splash, as two clip paths.
const ZIG = (() => {
  let s = 7;
  const pts: [number, number][] = [];
  for (let y = 0; y <= 100; y += 4) { s = (s * 9301 + 49297) % 233280; pts.push([+(50 + (s / 233280 - 0.5) * 3.2).toFixed(2), y]); }
  return pts;
})();
const TEAR_L = `polygon(0 0,${ZIG.map(([x, y]) => `${(x + 0.08).toFixed(2)}% ${y}%`).join(',')},0 100%)`;
const TEAR_R = `polygon(100% 0,${ZIG.map(([x, y]) => `${(x - 0.08).toFixed(2)}% ${y}%`).join(',')},100% 100%)`;

// Icicles hanging off the top border of the frozen panel.
const ICICLES = (() => {
  let s = 17, d = 'M0 0 H538 V10';
  for (let x = 538; x > 0;) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280, w = 16 + r * 22, h = 16 + r * 40;
    d += ` L${(x - w / 2).toFixed(0)} ${(10 + h).toFixed(0)} L${Math.max(0, x - w).toFixed(0)} 10`;
    x -= w;
  }
  return `${d} Z`;
})();

// The bat-swing whoosh: three elliptical arcs wrapping around the K.
const SWIRL = [0, 1, 2].map((i) => {
  const cx = 190, cy = 175, rx = 185 - i * 26, ry = 88 - i * 12, a0 = (160 * Math.PI) / 180, a1 = (380 * Math.PI) / 180;
  const P = (a: number) => `${(cx + rx * Math.cos(a)).toFixed(1)} ${(cy + ry * Math.sin(a)).toFixed(1)}`;
  return `M${P(a0)} A${rx} ${ry} 0 1 1 ${P(a1)}`;
});
const SHOUT = burstPts(22, 96, 80, 11, 0.08, 0.62);
const FROZEN = burstPts(9, 100, 74, 13, 0.25);
const HITS: Record<string, [string, number]> = { Single: ['SINGLE', 1], Double: ['DOUBLE!', 2], Triple: ['TRIPLE!!', 3] };
const lastName = (n: string) => n.trim().split(/\s+/).pop() ?? '';
const ballSvg = (
  <svg className="ball" viewBox="-20 -20 40 40" aria-hidden="true">
    <circle r="16" fill="#fff" stroke="#141414" strokeWidth="4" />
    <path d="M-7-13q5 13 0 26M7-13q-5 13 0 26" fill="none" stroke="#E8262B" strokeWidth="2.6" strokeDasharray="3 2" />
  </svg>
);

function Team({ side, brand, abbr, r, h, e, bat, he }: { side: 'away' | 'home'; brand: Brand; abbr: string; r: number; h: number; e: number; bat: boolean; he: boolean }) {
  const name = tabName(brand, abbr);
  return (
    <div className={`panel team ${side}${bat ? ' batting' : ''}`} style={{ '--team': brand.color } as React.CSSProperties}>
      <div className="fill">
        <div className="ab">{ballSvg}</div>
        <div className={`abbr stroke${name.length > 7 ? ' long' : ''}`}>{name}</div>
        {he && <div className="he"><span>H<b key={h}>{h}</b></span><span>E<b key={e}>{e}</b></span></div>}
        {/* A run: the runs box punches and the new numeral is inked in. */}
        <div key={r} className="runs"><span className="v stroke">{r}</span></div>
      </div>
    </div>
  );
}

export function ComicBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const play = ball && live;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const ar = g.away_score | 0, hr2 = g.home_score | 0;
  const half = `${g.inning}${g.half}`;
  const bat = air.batter, pit = air.pitcher;
  const pips = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'pip on' : 'pip'} />);
  const base = (on: boolean | undefined, c: string) => <i key={`${c}${on ? 1 : 0}`} className={`base ${c}${on ? ' on' : ''}`} />;

  const t = moment?.text ?? '', who = moment?.who ?? '', mk = `${t}|${who}`;
  const hr = t === 'Home run';
  const k = t.startsWith('Strikeout'), looking = t.endsWith('looking');
  const hit = HITS[t];
  const walk = t === 'Walk' || t === 'Hit by pitch';
  const dp = t === 'Double play';
  // Anything the original has no drawing for is told by the narrator, in the caption.
  const line = moment && !hr && !k && !hit && !walk && !dp ? moment : null;

  const panels = (
    <>
      <Team side="away" brand={away} abbr={abbrs.away} r={ar} h={Number(g.away_hits) || 0} e={Number(g.away_errors) || 0} bat={play && top} he={ball} />
      <div className="panel situ"><div className="fill">
        {!live ? <div className="word stroke">{status === 'final' ? 'Final' : 'Pregame'}</div>
          : !ball ? <div className="word per stroke">{period}</div> : (
            <>
              <div className="sit-top">
                <div className={top ? 'inn' : 'inn bot'}>
                  <div className="half"><i className="tri" /><span>{top ? 'TOP' : 'BOT'}</span></div>
                  <div key={g.inning} className="v stroke">{g.inning}</div>
                </div>
                <div className="dia"><i className="path" />{base(bases.second, 'b2')}{base(bases.third, 'b3')}{base(bases.first, 'b1')}</div>
              </div>
              <div className="count">
                <div className="grp balls"><b>B</b>{pips(balls, 3)}</div>
                <div className="grp strikes"><b>S</b>{pips(strikes, 2)}</div>
                <div className="grp outs"><b>O</b>{pips(outs, 2)}</div>
              </div>
            </>
          )}
      </div></div>
      <Team side="home" brand={home} abbr={abbrs.home} r={hr2} h={Number(g.home_hits) || 0} e={Number(g.home_errors) || 0} bat={play && !top} he={ball} />
    </>
  );
  const splash = (
    <>
      <div className="bigpanel sp"><div className="fill"><div className="speed" /><div className="dotburst" /></div></div>
      <div className="burst kb"><Burst n={17} seed={42} back="var(--red)" front="#fff" ri={0.7} /><div className="w"><div className="sfxw">KA-BLAMM!</div></div></div>
      <div className="caps"><div className="c1">It&rsquo;s going&hellip; going&hellip;<b>HOME RUN!</b>{who && <span>{who}</span>}</div><div className="xtag">{moment && moment.runs > 0 ? `${homerText(moment.runs, 'plus').replace('+', '')}!` : 'GONE!'}</div></div>
    </>
  );

  return (
    <div className="lk-comic">
      <div className="pkg">
        <svg className="defs" width="0" height="0" aria-hidden="true"><defs>
          <pattern id="lkcomic-bd" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.7" fill="#E8262B" /></pattern>
          <pattern id="lkcomic-bdw" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="2.6" fill="#fff" /></pattern>
        </defs></svg>

        <div className="pwrap">
          <div className="xpage">{panels}</div>
          {/* The half turns: a copy of the strip lifts away like a page. */}
          {play && <div key={half} className="xpage turner" aria-hidden="true">{panels}</div>}
        </div>

        {play && (bat || pit || line) && (
          <div className="cap">
            {line ? <div key={`m${mk}`} className="box"><small>{line.text}!</small><span>{line.who}</span></div>
              : bat && <div key={bat.bid} className="box"><small>Now batting&hellip;</small><span>{bat.name}</span></div>}
            {!line && bat && showLine && (bat.avg || bat.today) && (
              <div key={`s${bat.bid}`} className="st">{bat.avg && <b>{bat.avg}</b>}{bat.today && <span>{bat.today}</span>}</div>
            )}
            {pit && <div className="pc"><small>{pit.last}</small>P <b key={pit.pitches}>{pit.pitches}</b></div>}
          </div>
        )}

        {/* A run: BAM! bursts off the scoring side's runs box. */}
        {ar > 0 && <div key={`a${ar}`} className="burst bam away"><Burst n={11} seed={21} back="var(--yel)" front="var(--red)" /><div className="w"><div className="sfxw">BAM!</div></div></div>}
        {hr2 > 0 && <div key={`h${hr2}`} className="burst bam home"><Burst n={11} seed={21} back="var(--yel)" front="var(--red)" /><div className="w"><div className="sfxw">BAM!</div></div></div>}

        {play && (
          <div key={`n${half}`} className="xnote fxl halfn">
            <small>{g.inning === 1 && top ? 'Our story begins…' : 'Meanwhile…'}</small><b>{top ? 'TOP' : 'BOTTOM'} {g.inning}</b>
          </div>
        )}

        {hit && (
          <div key={mk} className="burst fxl hit">
            <Burst n={13} seed={5 + hit[1]} />
            <div className="w"><div className="sfxw">CRACK!</div><div className="sfxw xsub">{hit[0]}</div></div>
          </div>
        )}
        {walk && (
          <div key={mk} className="xnote fxl walk">
            <small>{t === 'Walk' ? 'Ball four.' : 'Hit by the pitch!'}</small><b>Take your base&hellip; {lastName(who)}</b>
          </div>
        )}
        {dp && (
          <div key={mk} className="burst fxl balloon">
            <svg viewBox="-100 -100 200 200" preserveAspectRatio="none" aria-hidden="true">
              <path d="M40 44 L88 96 L58 40Z" fill="#fff" stroke="#141414" strokeWidth="5" strokeLinejoin="round" />
              <path d="M44 38 L60 36" stroke="#fff" strokeWidth="7" />
              <polygon points={SHOUT} fill="#fff" stroke="#141414" strokeWidth="5" />
            </svg>
            <div className="w"><div className="sfxw">YER OUT!</div><div className="bsub">Double play</div></div>
          </div>
        )}
        {k && (
          <div key={mk} className={looking ? 'kp xlook' : 'kp'}>
            <div className="bigpanel kpan"><div className="fill">
              {looking && (
                <svg className="icicles" viewBox="0 0 538 64" preserveAspectRatio="none" aria-hidden="true">
                  <path d={ICICLES} fill="#fff" stroke="#0B3C5D" strokeWidth="4" strokeLinejoin="round" />
                  <path d={ICICLES} fill="none" stroke="#9FE3FF" strokeWidth="3" transform="translate(4 -3)" opacity=".8" />
                </svg>
              )}
            </div></div>
            {!looking && (
              <svg className="swirl" viewBox="0 0 380 330" aria-hidden="true">
                {SWIRL.map((d, i) => (
                  <g key={i} transform="rotate(-18 190 175)" style={{ '--i': i } as React.CSSProperties}>
                    <path d={d} fill="none" stroke="#141414" strokeWidth={13 - i * 3} strokeLinecap="round" pathLength={100} />
                    <path d={d} fill="none" stroke="#fff" strokeWidth={5 - i} strokeLinecap="round" pathLength={100} />
                  </g>
                ))}
              </svg>
            )}
            <div className="bigk"><span>K</span></div>
            {looking ? (
              <div className="burst kw">
                <svg viewBox="-100 -100 200 200" preserveAspectRatio="none" aria-hidden="true">
                  <polygon points={FROZEN} fill="#DDF6FF" stroke="#0B3C5D" strokeWidth="6" /><polygon points={FROZEN} fill="url(#lkcomic-bdw)" />
                </svg>
                <div className="w sfxw">FROZEN!</div>
              </div>
            ) : (
              <div className="burst kw"><Burst n={12} seed={8} back="var(--mag)" front="#fff" /><div className="w sfxw">WHIFF!</div></div>
            )}
            <div className="kcap">
              {looking ? 'Caught looking…' : 'Strike three!'}
              <b>{who ? `${lastName(who)} ${looking ? 'never moved' : 'goes down swinging'}` : looking ? 'Right down the middle' : 'Swung and missed'}</b>
            </div>
          </div>
        )}
        {hr && (
          <div key={mk} className="hrw">
            <div className="half-l"><i style={{ clipPath: TEAR_L }}>{splash}</i></div>
            <div className="half-r"><i style={{ clipPath: TEAR_R }}>{splash}</i></div>
            <div className="hball">
              <div className="streak" />
              <svg viewBox="-50 -50 100 100" aria-hidden="true">
                <circle r="44" fill="#fff" stroke="#141414" strokeWidth="7" />
                <path d="M-20-38q14 38 0 76M20-38q-14 38 0 76" fill="none" stroke="#E8262B" strokeWidth="5" strokeDasharray="6 5" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
