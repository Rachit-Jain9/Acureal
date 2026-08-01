import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';

// Acureal landing — Scene 1 of 6
// "The parcel comes into focus." A single illustrative parcel off Sarjapur Road
// is drawn as cadastral survey linework on warm bone, then docks to a persistent
// 64px corner-glyph as the hero scrolls out. All figures illustrative.

const SERIF = "'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace";
const JOST = "'Jost', 'Inter', 'Segoe UI', sans-serif";

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// Identity palette for the hero lockup (design handoff 2026-07). These sit
// comfortably on the landing's warm bone — the handoff's own parchment is a
// near neighbour of #F5F1E8 — and are the ONLY place the identity colours
// enter this otherwise evergreen/brass page: the logo keeps its own colours.
const NAVY = '#0B2440';
const SIGNAL = '#1E6FD0';
const ROSE = '#C08D7C';

// The measure rule's canonical geometry — copied from the handoff, never
// redrawn. The node sits at 62.5% of the span; off-centre is what makes it
// read as measured rather than decorative.
const RULE_MINOR =
  'M12 20V26M24 20V26M36 20V26M48 20V26M72 20V26M84 20V26M96 20V26M108 20V26'
  + 'M132 20V26M144 20V26M156 20V26M168 20V26M192 20V26M204 20V26M216 20V26M228 20V26'
  + 'M252 20V26M264 20V26M276 20V26M288 20V26M312 20V26M324 20V26M336 20V26M348 20V26'
  + 'M372 20V26M384 20V26M396 20V26M408 20V26M432 20V26M444 20V26M456 20V26M468 20V26';
const RULE_MAJOR =
  'M0 12V26M60 12V26M120 12V26M180 12V26M240 12V26M300 12V26M360 12V26M420 12V26M480 12V26';

// Chip spec from the handoff: mono, 0.22em tracking, square corners.
const HERO_CHIPS = [
  { label: 'Underwriting', color: '#1B5FB8', bg: '#E2EDFA' },
  { label: 'Diligence', color: '#1B5FB8', bg: '#E2EDFA' },
  { label: 'IC Reporting', color: '#8A5C4F', bg: '#F4E1D8' },
];

// Parcel boundary polygon (irregular, surveyor-sketch feel) in the 720x520 viewBox.
const PARCEL_PTS = [
  [232, 96],
  [566, 132],
  [612, 360],
  [528, 452],
  [296, 436],
  [196, 300],
];
const PARCEL_PATH =
  PARCEL_PTS.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';

// Brass corner pins sit on the polygon vertices.
const PINS = PARCEL_PTS;

// Interior bearing ticks — short hairlines stepping along the inside of the boundary.
function buildTicks() {
  const ticks = [];
  for (let s = 0; s < PARCEL_PTS.length; s++) {
    const a = PARCEL_PTS[s];
    const b = PARCEL_PTS[(s + 1) % PARCEL_PTS.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = dx / len;
    const ny = dy / len;
    // inward normal (rough centroid pull)
    const px = -ny;
    const py = nx;
    const count = Math.max(2, Math.round(len / 70));
    for (let k = 1; k <= count; k++) {
      const t = k / (count + 1);
      const ox = a[0] + dx * t;
      const oy = a[1] + dy * t;
      ticks.push({
        x1: ox,
        y1: oy,
        x2: ox + px * 13,
        y2: oy + py * 13,
      });
    }
  }
  return ticks;
}
const TICKS = buildTicks();

export default function HeroParcelResolve() {
  const sectionRef = useRef(null);
  const reduceMotion = useRef(false);
  const rafId = useRef(0);

  const [drawn, setDrawn] = useState(false); // linework draw-on trigger
  const [textIn, setTextIn] = useState(false); // headline/body rise
  const [progress, setProgress] = useState(0); // 0..1 scroll-out progress

  // Detect reduced motion once.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion.current) {
      setDrawn(true);
      setTextIn(true);
    }
  }, []);

  // Kick the draw-on sequence on mount (one shot, never loops).
  useEffect(() => {
    if (reduceMotion.current) return;
    const t1 = setTimeout(() => setDrawn(true), 240);
    // headline rises ~260ms after the parcel settles (~1.4s draw).
    const t2 = setTimeout(() => setTextIn(true), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Scroll-linked parallax + docking progress (rAF-throttled).
  useEffect(() => {
    if (reduceMotion.current) return;
    const el = sectionRef.current;
    if (!el) return;

    let ticking = false;
    const compute = () => {
      ticking = false;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 while hero fills the viewport, → 1 as it scrolls fully above the fold.
      const raw = (-rect.top) / (rect.height * 0.9 || vh);
      const p = Math.min(1, Math.max(0, raw));
      setProgress(p);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      rafId.current = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  // Parallax plane transforms (max ~12px travel). Parcel drifts slowest + docks.
  const p = progress;
  const gridShift = reduceMotion.current ? 0 : -p * 12 * 0.85;
  const typeShift = reduceMotion.current ? 0 : -p * 12 * 1.0;
  // Parcel sits ~12px behind text, drifts at 0.6x, scales down ~6%, eases toward
  // the top-right corner-glyph as the hero leaves the stage.
  const parcelDrift = reduceMotion.current ? 0 : -p * 12 * 0.6;
  const parcelScale = reduceMotion.current ? 1 : 1 - p * 0.06;
  const parcelDockX = reduceMotion.current ? 0 : p * 120; // travel toward top-right
  const parcelDockY = reduceMotion.current ? 0 : -p * 90;
  const parcelOpacity = reduceMotion.current ? 1 : 1 - p * 0.35;

  // The persistent corner-glyph fades in as the parcel docks away.
  const glyphOpacity = reduceMotion.current ? 1 : Math.min(1, p * 1.6);

  const drawStyle = (delayMs, draws = true) => {
    if (reduceMotion.current) {
      return { opacity: 1, strokeDashoffset: 0 };
    }
    return {
      transition: draws
        ? `stroke-dashoffset 1200ms ${EASE} ${delayMs}ms, opacity 600ms ease-out ${delayMs}ms`
        : `opacity 480ms ease-out ${delayMs}ms`,
    };
  };

  return (
    <section
      ref={sectionRef}
      aria-label="Acureal — real estate deal intelligence"
      style={{
        position: 'relative',
        backgroundColor: '#F5F1E8',
        color: '#1C1A16',
        fontFamily: SANS,
        overflow: 'hidden',
        minHeight: '100vh',
      }}
    >
      {/* Barely-there paper grain */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 0.5,
          mixBlendMode: 'multiply',
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.045'/></svg>\")",
        }}
      />

      {/* Hairline survey baseline grid (parallax 0.85x), barely visible */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          transform: `translate3d(0, ${gridShift}px, 0)`,
          willChange: 'transform',
          backgroundImage:
            'linear-gradient(to right, #E2DACB 1px, transparent 1px), linear-gradient(to bottom, #E2DACB 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          opacity: 0.35,
          maskImage:
            'radial-gradient(120% 100% at 75% 45%, rgba(0,0,0,0.9), transparent 78%)',
          WebkitMaskImage:
            'radial-gradient(120% 100% at 75% 45%, rgba(0,0,0,0.9), transparent 78%)',
        }}
      />

      {/* Persistent 64px cadastral corner-glyph (top-right watermark on letterhead) */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 24,
          right: 24,
          width: 64,
          height: 64,
          opacity: glyphOpacity,
          transition: reduceMotion.current ? undefined : 'opacity 220ms ease-out',
          pointerEvents: 'none',
        }}
      >
        <svg viewBox="0 0 720 520" width="64" height="64" aria-hidden>
          <path
            d={PARCEL_PATH}
            fill="rgba(31,74,61,0.08)"
            stroke="#1C1A16"
            strokeWidth="10"
            strokeLinejoin="round"
          />
          {PINS.map((pt, i) => (
            <circle key={i} cx={pt[0]} cy={pt[1]} r="14" fill="#9C7A3C" />
          ))}
        </svg>
      </div>

      <div
        style={{
          position: 'relative',
          maxWidth: 1320,
          margin: '0 auto',
          padding: '120px 32px 132px',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 5fr) minmax(360px, 7fr)',
            gap: 48,
            alignItems: 'center',
          }}
          className="hpr-grid"
        >
          {/* LEFT — type column (foreground plane, 1.0x). A third stays empty bone. */}
          <div
            style={{
              transform: `translate3d(0, ${typeShift}px, 0)`,
              willChange: 'transform',
              maxWidth: 560,
            }}
          >
            {/* The identity lockup, animated with the brand's motion
                signature (timings from the handoff, keyframes in index.css):
                eyebrow rises → letters land one by one → the rule scales out
                from the left → the node slides in and settles at 62.5% → the
                plumb draws down → the halo breathes forever. Every element's
                resting CSS is its final state, so prefers-reduced-motion
                simply presents the finished composition. */}

            {/* Eyebrow */}
            <div
              className="acureal-hero-eyebrow"
              style={{
                fontFamily: MONO,
                fontSize: 11.5,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                color: '#8C8579',
                fontFeatureSettings: "'tnum' 1",
              }}
            >
              Deal Intelligence · India
            </div>

            {/* Wordmark — live text, one letter at a time, the E in signal */}
            <h1
              aria-label="Acureal — the intelligence layer for Indian real estate"
              style={{
                fontFamily: JOST,
                fontWeight: 200,
                fontSize: 'clamp(44px, 6vw, 84px)',
                lineHeight: 0.98,
                letterSpacing: '0.2em',
                color: NAVY,
                whiteSpace: 'nowrap',
                margin: '28px 0 0',
              }}
            >
              {'ACUREAL'.split('').map((ch, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="acureal-hero-letter"
                  style={{
                    animationDelay: `${60 + i * 50}ms`,
                    ...(i === 4 ? { color: SIGNAL } : {}),
                  }}
                >
                  {ch}
                </span>
              ))}
            </h1>

            {/* The measure rule — scale draws out, node arrives, plumb drops */}
            <svg
              viewBox="0 0 480 34"
              aria-hidden="true"
              style={{
                display: 'block',
                width: '100%',
                maxWidth: 520,
                height: 'auto',
                marginTop: 30,
                overflow: 'visible',
              }}
            >
              <defs>
                <linearGradient id="acuHeroRose" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#B9836F" stopOpacity="0.35" />
                  <stop offset="0.28" stopColor="#C08D7C" />
                  <stop offset="0.62" stopColor="#DDB4A4" />
                  <stop offset="1" stopColor="#A6705F" stopOpacity="0.5" />
                </linearGradient>
              </defs>
              <g className="acureal-hero-rule">
                <g stroke={ROSE} strokeOpacity="0.5" strokeWidth="1">
                  <path d={RULE_MINOR} />
                </g>
                <g stroke={ROSE} strokeWidth="1.6">
                  <path d={RULE_MAJOR} />
                </g>
                <path d="M0 26H480" stroke="url(#acuHeroRose)" strokeWidth="1.6" fill="none" />
              </g>
              <g className="acureal-hero-node">
                <circle className="acureal-hero-halo" cx="300" cy="5" r="9" fill={SIGNAL} />
                <path className="acureal-hero-plumb" d="M300 4V26" stroke={SIGNAL} strokeWidth="1.4" fill="none" />
                <rect x="295" y="0" width="10" height="10" fill={SIGNAL} />
              </g>
            </svg>

            {/* Tagline */}
            <p
              className="acureal-hero-after"
              style={{
                animationDelay: '1000ms',
                fontFamily: SERIF,
                fontWeight: 500,
                fontSize: 'clamp(22px, 2.3vw, 30px)',
                lineHeight: 1.3,
                letterSpacing: '-0.008em',
                color: NAVY,
                margin: '34px 0 0',
              }}
            >
              The intelligence layer for Indian real estate.
            </p>

            {/* Supporting line */}
            <p
              className="acureal-hero-after"
              style={{
                animationDelay: '1150ms',
                fontFamily: SANS,
                fontSize: 16.5,
                lineHeight: 1.62,
                color: '#57514A',
                maxWidth: 520,
                margin: '18px 0 0',
              }}
            >
              Underwriting, diligence and IC-ready reporting for GPs, lenders and
              institutional investors — built on evidence, not sentiment.
            </p>

            {/* Discipline chips */}
            <div
              className="acureal-hero-after"
              style={{
                animationDelay: '1300ms',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                marginTop: 26,
              }}
            >
              {HERO_CHIPS.map((chip) => (
                <span
                  key={chip.label}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: chip.color,
                    backgroundColor: chip.bg,
                    padding: '10px 13px',
                  }}
                >
                  {chip.label}
                </span>
              ))}
            </div>

            {/* CTAs */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 28,
                marginTop: 38,
                opacity: textIn ? 1 : 0,
                transform: textIn ? 'translateY(0)' : 'translateY(8px)',
                transition: reduceMotion.current
                  ? undefined
                  : `opacity 260ms ease-out 140ms, transform 260ms ${EASE} 140ms`,
              }}
            >
              <RequestAccess />
              <SignIn />
            </div>

            {/* Audience microcopy */}
            <div
              style={{
                marginTop: 30,
                fontFamily: MONO,
                fontSize: 11.5,
                letterSpacing: '0.04em',
                color: '#8C8579',
                opacity: textIn ? 1 : 0,
                transition: reduceMotion.current
                  ? undefined
                  : 'opacity 260ms ease-out 190ms',
              }}
            >
              Built for GPs, underwriters, and investment committees
            </div>
          </div>

          {/* RIGHT — cadastral parcel (sits ~12px behind text, drifts 0.6x, docks) */}
          <div
            style={{
              position: 'relative',
              transform: `translate3d(${parcelDockX}px, ${parcelDrift + parcelDockY}px, 0) scale(${parcelScale})`,
              transformOrigin: 'top right',
              opacity: parcelOpacity,
              willChange: 'transform, opacity',
              zIndex: 0,
            }}
            className="hpr-parcel"
          >
            <ParcelSVG drawn={drawn} reduce={reduceMotion.current} drawStyle={drawStyle} />
          </div>
        </div>
      </div>

      {/* Bottom-left provenance line — quiet, honest about illustration */}
      <div
        style={{
          position: 'absolute',
          left: 32,
          bottom: 22,
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: '0.04em',
          color: '#8C8579',
          opacity: textIn ? 0.9 : 0,
          transition: reduceMotion.current ? undefined : 'opacity 400ms ease-out 260ms',
        }}
      >
        Parcel: ~4.2 acres (illustrative) · Survey No. 142/3 · Sarjapur Road ·
        Khata grade: B (on file) · all figures illustrative
      </div>

      <style>{`
        @media (max-width: 900px) {
          .hpr-grid { grid-template-columns: 1fr !important; }
          .hpr-parcel { margin-top: 8px; }
        }
        .hpr-cta-rule::after {
          content: '';
          position: absolute;
          left: 0; bottom: -2px;
          height: 1px; width: 100%;
          background: #1F4A3D;
          transform: scaleX(1);
          transform-origin: left;
        }
      `}</style>
    </section>
  );
}

/* ----------------------------- Parcel figure ----------------------------- */

function ParcelSVG({ drawn, reduce, drawStyle }) {
  // pathLength normalized to 1 so dashoffset 1→0 reveals the boundary.
  const boundaryOffset = reduce ? 0 : drawn ? 0 : 1;

  return (
    <svg
      viewBox="0 0 720 520"
      width="100%"
      role="img"
      aria-label="Illustrative cadastral survey of a ~4.2 acre parcel, Survey No. 142/3, off Sarjapur Road"
      style={{ display: 'block', maxWidth: 720, marginLeft: 'auto' }}
    >
      {/* Hairline north arrow, top-right of the sheet */}
      <g
        style={{
          opacity: reduce ? 1 : drawn ? 1 : 0,
          transition: reduce ? undefined : 'opacity 480ms ease-out 700ms',
        }}
      >
        <line x1="648" y1="44" x2="648" y2="96" stroke="#57514A" strokeWidth="0.8" />
        <path d="M 648 40 L 643 54 L 648 50 L 653 54 Z" fill="#1C1A16" />
        <text
          x="648"
          y="112"
          textAnchor="middle"
          fontFamily={MONO}
          fontSize="11"
          fill="#8C8579"
        >
          N
        </text>
      </g>

      {/* Soft evergreen interior fill — fades up as the boundary closes */}
      <path
        d={PARCEL_PATH}
        fill="rgba(31,74,61,0.08)"
        stroke="none"
        style={{
          opacity: reduce ? 1 : drawn ? 1 : 0,
          transition: reduce ? undefined : 'opacity 700ms ease-out 600ms',
        }}
      />

      {/* (1) Boundary polygon — strokes in via dashoffset, hand-inked then crisp */}
      <path
        d={PARCEL_PATH}
        fill="none"
        stroke="#1C1A16"
        strokeWidth="0.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={boundaryOffset}
        style={drawStyle(60)}
      />

      {/* (2) Interior bearing ticks — evergreen, 60ms stagger */}
      <g>
        {TICKS.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="#1F4A3D"
            strokeWidth="0.6"
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={reduce ? 0 : drawn ? 0 : 1}
            style={{
              opacity: reduce ? 1 : drawn ? 1 : 0,
              transition: reduce
                ? undefined
                : `stroke-dashoffset 300ms ${EASE} ${900 + i * 60}ms, opacity 220ms ease-out ${900 + i * 60}ms`,
            }}
          />
        ))}
      </g>

      {/* (3) Brass corner pins — fade up after the boundary settles */}
      <g>
        {PINS.map((pt, i) => (
          <circle
            key={i}
            cx={pt[0]}
            cy={pt[1]}
            r={3}
            fill="#9C7A3C"
            style={{
              opacity: reduce ? 1 : drawn ? 1 : 0,
              transform: reduce ? undefined : drawn ? 'scale(1)' : 'scale(0.4)',
              transformOrigin: `${pt[0]}px ${pt[1]}px`,
              transition: reduce
                ? undefined
                : `opacity 360ms ease-out ${1120 + i * 60}ms, transform 360ms ${EASE} ${1120 + i * 60}ms`,
            }}
          />
        ))}
      </g>

      {/* Corner caption tags floating at lot corners (mono, muted) */}
      <g
        style={{
          opacity: reduce ? 1 : drawn ? 1 : 0,
          transition: reduce ? undefined : 'opacity 480ms ease-out 1300ms',
          fontFamily: MONO,
        }}
      >
        <text x={218} y={86} textAnchor="end" fontSize="9.5" fill="#8C8579">
          A
        </text>
        <text x={582} y={124} textAnchor="start" fontSize="9.5" fill="#8C8579">
          B
        </text>
        <text x={628} y={372} textAnchor="start" fontSize="9.5" fill="#8C8579">
          C
        </text>
      </g>

      {/* (4) Dimension tie line + mono caption '~4.2 ac' */}
      <g>
        {/* tie line spanning across the parcel midriff */}
        <line
          x1={236}
          y1={268}
          x2={580}
          y2={300}
          stroke="#57514A"
          strokeWidth="0.6"
          strokeDasharray="3 3"
          pathLength={1}
          strokeDashoffset={reduce ? 0 : drawn ? 0 : 1}
          style={{
            transition: reduce
              ? undefined
              : `stroke-dashoffset 360ms ${EASE} 1280ms`,
          }}
        />
        {/* end ticks */}
        <line x1={236} y1={261} x2={236} y2={275} stroke="#57514A" strokeWidth="0.6"
          style={{ opacity: reduce ? 1 : drawn ? 1 : 0, transition: reduce ? undefined : 'opacity 220ms ease-out 1480ms' }} />
        <line x1={580} y1={293} x2={580} y2={307} stroke="#57514A" strokeWidth="0.6"
          style={{ opacity: reduce ? 1 : drawn ? 1 : 0, transition: reduce ? undefined : 'opacity 220ms ease-out 1480ms' }} />
        {/* caption chip */}
        <g
          style={{
            opacity: reduce ? 1 : drawn ? 1 : 0,
            transition: reduce ? undefined : 'opacity 320ms ease-out 1520ms',
          }}
        >
          <rect x={368} y={272} width={84} height={22} rx={2} fill="#F5F1E8" stroke="#CFC5B2" strokeWidth="0.6" />
          <text
            x={410}
            y={287}
            textAnchor="middle"
            fontFamily={MONO}
            fontSize="11.5"
            fill="#1C1A16"
            style={{ fontFeatureSettings: "'tnum' 1" }}
          >
            ~4.2 ac
          </text>
        </g>
      </g>

      {/* Guidance-value-zone dot (brass) with mono label */}
      <g
        style={{
          opacity: reduce ? 1 : drawn ? 1 : 0,
          transition: reduce ? undefined : 'opacity 400ms ease-out 1560ms',
        }}
      >
        <circle cx={356} cy={372} r={2.4} fill="#9C7A3C" />
        <text x={366} y={376} fontFamily={MONO} fontSize="9.5" fill="#8C8579">
          guidance-value zone
        </text>
      </g>

      {/* (5) Survey-number callout box — settles last */}
      <g
        style={{
          opacity: reduce ? 1 : drawn ? 1 : 0,
          transform: reduce ? undefined : drawn ? 'translateY(0)' : 'translateY(6px)',
          transition: reduce
            ? undefined
            : `opacity 360ms ease-out 1600ms, transform 360ms ${EASE} 1600ms`,
        }}
      >
        <rect
          x={428}
          y={392}
          width={196}
          height={66}
          rx={2}
          fill="#FCFAF4"
          stroke="#CFC5B2"
          strokeWidth="0.8"
        />
        <text x={444} y={414} fontFamily={MONO} fontSize="12.5" fill="#1C1A16" letterSpacing="0.02em">
          Survey No. 142/3
        </text>
        <text x={444} y={432} fontFamily={MONO} fontSize="10" fill="#57514A">
          B-Khata · on file
        </text>
        <text x={444} y={448} fontFamily={MONO} fontSize="10" fill="#8C8579">
          resolving…
        </text>
        {/* tiny evergreen status mark */}
        <circle cx={610} cy={406} r={2.6} fill="#1F4A3D" />
      </g>

      {/* Illustrative tag, lower-right of the sheet */}
      <text
        x={624}
        y={486}
        textAnchor="end"
        fontFamily={MONO}
        fontSize="9.5"
        fill="#8C8579"
        style={{
          opacity: reduce ? 1 : drawn ? 1 : 0,
          transition: reduce ? undefined : 'opacity 480ms ease-out 1700ms',
        }}
      >
        off Sarjapur Road · illustrative
      </text>
    </svg>
  );
}

/* ------------------------------- CTAs ------------------------------- */

function RequestAccess() {
  const [hover, setHover] = useState(false);
  return (
    <a
      href="/login?mode=register"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 9,
        fontFamily: SANS,
        fontSize: 14.5,
        fontWeight: 500,
        letterSpacing: '0.01em',
        color: hover ? '#FCFAF4' : '#1F4A3D',
        backgroundColor: hover ? '#1F4A3D' : 'transparent',
        border: '1px solid #1F4A3D',
        borderRadius: 2,
        padding: '12px 20px',
        textDecoration: 'none',
        transition: 'background-color 120ms ease-out, color 120ms ease-out',
        outlineOffset: 3,
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '2px solid #1F4A3D';
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none';
      }}
    >
      Get started
      <ArrowRight size={16} strokeWidth={1.75} />
    </a>
  );
}

function SignIn() {
  const [hover, setHover] = useState(false);
  return (
    <a
      href="/login"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: SANS,
        fontSize: 14.5,
        fontWeight: 500,
        color: '#57514A',
        textDecoration: 'underline',
        textUnderlineOffset: 4,
        textDecorationColor: hover ? '#1F4A3D' : '#CFC5B2',
        transition: 'text-decoration-color 120ms ease-out, color 120ms ease-out',
        outlineOffset: 3,
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '2px solid #1F4A3D';
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none';
      }}
    >
      Sign in
      <ArrowUpRight size={14} strokeWidth={1.75} />
    </a>
  );
}
