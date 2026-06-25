import { useEffect, useRef, useState } from 'react';
import { Layers, ShieldCheck, AlertTriangle, Activity, CornerDownRight } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Scene 3 of 6 — DiligenceSevenLayers
// "Seven layers of diligence, each weighted by what it could cost the deal."
// Warm-institutional palette. No app tokens, no dark mode. Motion fires once.
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = {
  canvas: '#F5F1E8',
  ivory: '#FCFAF4',
  recessed: '#EDE7D9',
  ink: '#1C1A16',
  ink2: '#57514A',
  muted: '#8C8579',
  hair: '#E2DACB',
  hairStrong: '#CFC5B2',
  evergreen: '#1F4A3D',
  evergreenSoft: 'rgba(31,74,61,0.08)',
  brass: '#9C7A3C',
  green: '#2F6B4F',
  oxblood: '#9E3B2E',
};

// Seven layers, illustrative. Score 0–100 = "impact weight" the layer carries.
// The four legal lanes carry NO numeric verdict — only 'human-verify'.
const LAYERS = [
  {
    id: 'title',
    name: 'Title chain',
    impact: 'high',
    weight: 94,
    legal: true,
    finding: 'Breaks 3 owners back · human-verify',
    note: 'Highest weight: a broken chain is unrecoverable. We extract, we do not conclude.',
    signal: 'oxblood',
  },
  {
    id: 'encumbrance',
    name: 'Encumbrance',
    impact: 'med',
    weight: 71,
    legal: true,
    finding: 'EC surfaced · two charges open · human-verify',
    note: 'Charges and mortgages alter the consideration. Surfaced from the EC, never asserted clear.',
    signal: 'brass',
  },
  {
    id: 'approvals',
    name: 'Statutory approvals',
    impact: 'high',
    weight: 90,
    legal: true,
    finding: 'BBMP / BDA sanction gap · human-verify',
    note: 'A sanction gap is a build-stop. Weighted high; the verdict stays with counsel.',
    signal: 'oxblood',
  },
  {
    id: 'rera',
    name: 'RERA',
    impact: 'high',
    weight: 88,
    legal: true,
    finding: 'Registered area deviates from plan · human-verify',
    note: 'Deviation between registered and sanctioned area is flagged, not adjudicated.',
    signal: 'oxblood',
  },
  {
    id: 'promoter',
    name: 'Promoter execution',
    impact: 'high',
    weight: 78,
    legal: false,
    finding: '2 of 5 past projects delivered >9 months late · on record',
    note: 'Delivery-vs-promise on record. Re-examine the JDA timeline against this track.',
    signal: 'oxblood',
    sparkline: [
      { promise: 24, actual: 33 },
      { promise: 30, actual: 31 },
      { promise: 18, actual: 29 },
      { promise: 36, actual: 38 },
      { promise: 22, actual: 23 },
    ],
  },
  {
    id: 'market',
    name: 'Market',
    impact: 'med',
    weight: 58,
    legal: false,
    finding: 'Saleable absorption in band · guidance value steady',
    note: 'Absorption sits inside the corridor band. Stress-test the exit pace, not the level.',
    signal: 'green',
  },
  {
    id: 'financial',
    name: 'Financial structure',
    impact: 'med',
    weight: 64,
    legal: false,
    finding: 'JDA share 58% · FSI fully loaded · structure holds',
    note: 'Capital stack and JDA share computed in the kernel. Consider the downside leverage case.',
    signal: 'green',
  },
];

// Radar — 7 axes, 0–100, illustrative. Higher = more exposure on that axis.
const RADAR = [
  { label: 'Title', value: 82, live: true },
  { label: 'Encumb.', value: 54, live: false },
  { label: 'Approvals', value: 76, live: true },
  { label: 'RERA', value: 70, live: true },
  { label: 'Promoter', value: 63, live: true },
  { label: 'Market', value: 38, live: false },
  { label: 'Finance', value: 45, live: false },
];

function signalColor(sig) {
  if (sig === 'oxblood') return PALETTE.oxblood;
  if (sig === 'brass') return PALETTE.brass;
  return PALETTE.green;
}

// ── Inline delivery-vs-promise sparkline for the promoter row ────────────────
function Sparkline({ data, drawn }) {
  const w = 84;
  const h = 22;
  const pad = 2;
  const maxV = Math.max(...data.flatMap((d) => [d.promise, d.actual]));
  const stepX = (w - pad * 2) / (data.length - 1);
  const y = (v) => h - pad - (v / maxV) * (h - pad * 2);
  const promisePts = data.map((d, i) => `${pad + i * stepX},${y(d.promise)}`).join(' ');
  const actualPts = data.map((d, i) => `${pad + i * stepX},${y(d.actual)}`).join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline
        points={promisePts}
        fill="none"
        stroke={PALETTE.hairStrong}
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <polyline
        points={actualPts}
        fill="none"
        stroke={PALETTE.oxblood}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{
          strokeDasharray: 200,
          strokeDashoffset: drawn ? 0 : 200,
          transition: 'stroke-dashoffset 600ms cubic-bezier(0.16,1,0.3,1) 220ms',
        }}
      />
      {data.map((d, i) => (
        <circle
          key={i}
          cx={pad + i * stepX}
          cy={y(d.actual)}
          r={d.actual - d.promise > 8 ? 1.8 : 1.1}
          fill={d.actual - d.promise > 8 ? PALETTE.oxblood : PALETTE.muted}
          style={{ opacity: drawn ? 1 : 0, transition: `opacity 200ms ease-out ${300 + i * 40}ms` }}
        />
      ))}
    </svg>
  );
}

// ── Animated count-up for the mono impact score ──────────────────────────────
function useCountUp(target, run, reduced, delay = 0, dur = 600) {
  const [val, setVal] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setVal(target);
      return;
    }
    if (!run) return;
    let raf;
    let start;
    const tick = (t) => {
      if (start == null) start = t;
      const elapsed = t - start - delay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, reduced, delay, dur]);
  return val;
}

// ── A single layer-bar row ───────────────────────────────────────────────────
function LayerRow({ layer, index, started, reduced, onHover, hovered }) {
  const score = useCountUp(layer.weight, started, reduced, 150 + index * 70);
  const revealDelay = index * 70;
  const fillColor = signalColor(layer.signal);

  const barStyle = reduced
    ? { opacity: 1, filter: 'none', transform: 'none' }
    : {
        opacity: started ? 1 : 0,
        filter: started ? 'blur(0px)' : 'blur(6px)',
        transform: started ? 'translateY(0)' : 'translateY(6px)',
        transition: `opacity 200ms ease-out ${revealDelay}ms, filter 320ms cubic-bezier(0.16,1,0.3,1) ${revealDelay}ms, transform 200ms ease-out ${revealDelay}ms`,
      };

  const fillWidth = reduced ? `${layer.weight}%` : started ? `${layer.weight}%` : '0%';

  return (
    <div
      tabIndex={0}
      onMouseEnter={() => onHover(layer.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(layer.id)}
      onBlur={() => onHover(null)}
      className="group relative outline-none"
      style={{
        ...barStyle,
        padding: '10px 14px',
        borderRadius: 6,
        background: hovered ? PALETTE.ivory : 'transparent',
        boxShadow: hovered ? `inset 0 0 0 1px ${PALETTE.hair}` : 'inset 0 0 0 1px transparent',
        transition: `${barStyle.transition || ''}${barStyle.transition ? ', ' : ''}background 120ms ease-out, box-shadow 120ms ease-out`,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Layer name */}
        <div className="flex-shrink-0" style={{ width: 158 }}>
          <div className="flex items-center gap-1.5">
            <span
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 13.5,
                fontWeight: 500,
                color: PALETTE.ink,
                letterSpacing: '-0.01em',
              }}
            >
              {layer.name}
            </span>
          </div>
          <span
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 10.5,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: PALETTE.muted,
            }}
          >
            {layer.impact === 'high' ? 'High impact' : 'Med impact'}
          </span>
        </div>

        {/* Bar track + fill */}
        <div className="flex-1 min-w-0">
          <div
            style={{
              position: 'relative',
              height: 9,
              borderRadius: 5,
              background: PALETTE.recessed,
              overflow: 'hidden',
              boxShadow: `inset 0 0 0 1px ${PALETTE.hair}`,
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: fillWidth,
                background: layer.legal
                  ? `repeating-linear-gradient(90deg, ${PALETTE.brass}26 0 6px, ${PALETTE.brass}14 6px 12px)`
                  : fillColor,
                borderRadius: 5,
                transition: reduced
                  ? 'none'
                  : `width 500ms cubic-bezier(0.16,1,0.3,1) ${revealDelay + 80}ms`,
              }}
            />
          </div>
        </div>

        {/* Score cell OR the deliberate absence (human-verify) */}
        <div className="flex-shrink-0 flex items-center justify-end" style={{ width: 150 }}>
          {layer.legal ? (
            <LegalChip started={started} reduced={reduced} index={index} />
          ) : (
            <div className="flex items-center gap-2.5">
              {layer.id === 'promoter' && (
                <Sparkline data={layer.sparkline} drawn={reduced ? true : started} />
              )}
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 14,
                  fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                  color: PALETTE.ink,
                  minWidth: 34,
                  textAlign: 'right',
                }}
              >
                {score}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Finding line */}
      <div className="flex items-start gap-1.5" style={{ marginTop: 6, paddingLeft: 0 }}>
        <span
          style={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 11.5,
            color: layer.signal === 'oxblood' ? PALETTE.oxblood : PALETTE.ink2,
            lineHeight: 1.4,
          }}
        >
          {layer.finding}
        </span>
      </div>

      {/* Margin note — cross-fades on hover ('why this weight') */}
      <div
        aria-hidden={!hovered}
        style={{
          marginTop: hovered ? 6 : 0,
          maxHeight: hovered ? 40 : 0,
          opacity: hovered ? 1 : 0,
          overflow: 'hidden',
          transition: 'opacity 120ms ease-out, max-height 160ms ease-out, margin-top 160ms ease-out',
        }}
      >
        <div className="flex items-start gap-1.5">
          <CornerDownRight size={12} color={PALETTE.brass} style={{ marginTop: 2, flexShrink: 0 }} />
          <span
            style={{
              fontFamily: '"Source Serif 4", Georgia, serif',
              fontStyle: 'italic',
              fontSize: 12.5,
              color: PALETTE.ink2,
              lineHeight: 1.45,
            }}
          >
            {layer.note}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Brass 'human-verify' chip — open circle, NO green tick, holds back ────────
function LegalChip({ started, reduced, index }) {
  const delay = reduced ? 0 : 600 + index * 80;
  return (
    <div className="flex items-center gap-2 justify-end">
      {/* empty status cell — the absence is visible and intentional */}
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 9,
          borderRadius: 3,
          border: `1px dashed ${PALETTE.hairStrong}`,
          background: 'transparent',
        }}
      />
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 9px',
          borderRadius: 999,
          border: `1px solid ${PALETTE.brass}`,
          color: PALETTE.brass,
          background: 'rgba(156,122,60,0.06)',
          fontFamily: 'Inter, sans-serif',
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          opacity: reduced ? 1 : started ? 1 : 0,
          transition: reduced ? 'none' : `opacity 360ms ease-out ${delay}ms`,
        }}
      >
        {/* open-circle mark, deliberately not a tick */}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.4" fill="none" stroke={PALETTE.brass} strokeWidth="1.3" />
        </svg>
        human-verify
      </span>
    </div>
  );
}

// ── 7-axis radar / spider chart ──────────────────────────────────────────────
function Radar({ started, reduced }) {
  const size = 300;
  const cx = size / 2;
  const cy = size / 2 + 4;
  const R = 104;
  const n = RADAR.length;

  const angleFor = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pointAt = (i, frac) => {
    const a = angleFor(i);
    return [cx + Math.cos(a) * R * frac, cy + Math.sin(a) * R * frac];
  };

  const [progress, setProgress] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }
    if (!started) return;
    let raf;
    let start;
    const dur = 600;
    const startDelay = 120;
    const tick = (t) => {
      if (start == null) start = t;
      const elapsed = t - start - startDelay;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, elapsed / dur);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, reduced]);

  const rings = [0.25, 0.5, 0.75, 1];

  const polyPoints = RADAR.map((ax, i) => {
    const frac = (ax.value / 100) * progress;
    const [x, y] = pointAt(i, frac);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size + 30}`}
      role="img"
      aria-label="Risk radar, seven axes, weighted by impact and sourced from extracted facts"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* concentric reference rings — research-note hairlines */}
      {rings.map((r, ri) => (
        <polygon
          key={ri}
          points={RADAR.map((_, i) => {
            const [x, y] = pointAt(i, r);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ')}
          fill="none"
          stroke={ri === rings.length - 1 ? PALETTE.hairStrong : PALETTE.hair}
          strokeWidth={ri === rings.length - 1 ? 1 : 0.75}
        />
      ))}

      {/* spokes */}
      {RADAR.map((_, i) => {
        const [x, y] = pointAt(i, 1);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke={PALETTE.hair} strokeWidth="0.75" />
        );
      })}

      {/* the filled exposure polygon */}
      <polygon
        points={polyPoints}
        fill={PALETTE.evergreenSoft}
        stroke={PALETTE.evergreen}
        strokeWidth="1.4"
        strokeLinejoin="round"
        style={{ opacity: progress > 0 ? 1 : 0 }}
      />

      {/* vertices — live risks get sparing oxblood spikes */}
      {RADAR.map((ax, i) => {
        const frac = (ax.value / 100) * progress;
        const [x, y] = pointAt(i, frac);
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={ax.live ? 3 : 2}
            fill={ax.live ? PALETTE.oxblood : PALETTE.evergreen}
            stroke={PALETTE.ivory}
            strokeWidth="1"
          />
        );
      })}

      {/* axis labels */}
      {RADAR.map((ax, i) => {
        const [x, y] = pointAt(i, 1.2);
        const a = angleFor(i);
        const anchor = Math.abs(Math.cos(a)) < 0.3 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.02em',
              fill: ax.live ? PALETTE.oxblood : PALETTE.ink2,
              opacity: reduced ? 1 : progress > 0.6 ? 1 : 0,
              transition: 'opacity 300ms ease-out',
            }}
          >
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}

// ── Persistent 64px cadastral corner-glyph (scored-overlay register) ─────────
function ParcelGlyph({ scoredOverlay }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 20,
        right: 20,
        width: 64,
        height: 64,
        opacity: 0.5,
        transition: 'opacity 220ms ease-out',
      }}
    >
      <svg width="64" height="64" viewBox="0 0 64 64">
        {/* parcel boundary off Sarjapur Road */}
        <path
          d="M10 16 L46 10 L56 34 L40 56 L14 50 Z"
          fill={scoredOverlay ? PALETTE.evergreenSoft : 'none'}
          stroke={PALETTE.ink}
          strokeWidth="1.1"
          strokeLinejoin="round"
          style={{ transition: 'fill 220ms ease-out' }}
        />
        {/* scored-overlay hatch crossbars appear in this register */}
        <line
          x1="10"
          y1="16"
          x2="40"
          y2="56"
          stroke={PALETTE.brass}
          strokeWidth="0.7"
          strokeDasharray="2 2"
          style={{ opacity: scoredOverlay ? 0.9 : 0.4, transition: 'opacity 220ms ease-out' }}
        />
        <line
          x1="46"
          y1="10"
          x2="14"
          y2="50"
          stroke={PALETTE.brass}
          strokeWidth="0.7"
          strokeDasharray="2 2"
          style={{ opacity: scoredOverlay ? 0.9 : 0.4, transition: 'opacity 220ms ease-out' }}
        />
        {/* survey tick */}
        <circle cx="46" cy="10" r="1.6" fill={PALETTE.ink} />
        <text
          x="32"
          y="62"
          textAnchor="middle"
          style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 5.5, fill: PALETTE.muted }}
        >
          ~4.2 ac
        </text>
      </svg>
    </div>
  );
}

export default function DiligenceSevenLayers() {
  const sectionRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [hovered, setHovered] = useState(null);
  const [parallax, setParallax] = useState(0);
  const rafRef = useRef(null);

  // reduced-motion check
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // assemble once on entry
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (reduced) {
      setStarted(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setStarted(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.28 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduced]);

  // shallow parallax (depth, never spectacle)
  useEffect(() => {
    if (reduced) return;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = sectionRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const center = rect.top + rect.height / 2;
        const p = (center - vh / 2) / vh; // ~ -1..1
        setParallax(Math.max(-1, Math.min(1, p)));
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reduced]);

  const figTravel = reduced ? 0 : parallax * -8; // hairline plane 0.92x
  const fgTravel = reduced ? 0 : parallax * -3; // foreground 1.0x-ish

  return (
    <section
      ref={sectionRef}
      style={{
        position: 'relative',
        background: PALETTE.canvas,
        color: PALETTE.ink,
        paddingTop: 120,
        paddingBottom: 120,
        overflow: 'hidden',
      }}
    >
      <ParcelGlyph scoredOverlay={started && (hovered != null || true)} />

      <div className="max-w-6xl mx-auto px-6">
        {/* Eyebrow */}
        <div
          style={{
            opacity: started || reduced ? 1 : 0,
            transform: started || reduced ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 400ms ease-out, transform 400ms ease-out',
          }}
        >
          <div className="flex items-center gap-2.5" style={{ marginBottom: 22 }}>
            <Layers size={15} color={PALETTE.evergreen} />
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 11.5,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: PALETTE.evergreen,
                fontWeight: 500,
              }}
            >
              № 02 · Diligence
            </span>
          </div>
        </div>

        {/* Headline */}
        <h2
          style={{
            fontFamily: '"Source Serif 4", Georgia, serif',
            fontWeight: 400,
            fontSize: 'clamp(28px, 4vw, 46px)',
            lineHeight: 1.12,
            letterSpacing: '-0.015em',
            color: PALETTE.ink,
            maxWidth: 880,
            margin: 0,
            opacity: started || reduced ? 1 : 0,
            transform: started || reduced ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 500ms ease-out 60ms, transform 500ms ease-out 60ms',
          }}
        >
          Seven layers of diligence, each{' '}
          <em style={{ fontStyle: 'italic', color: PALETTE.evergreen }}>weighted by what it could cost</em>{' '}
          the deal.
        </h2>

        {/* Body */}
        <p
          style={{
            fontFamily: '"Source Serif 4", Georgia, serif',
            fontSize: 17,
            lineHeight: 1.62,
            color: PALETTE.ink2,
            maxWidth: 760,
            marginTop: 26,
            marginBottom: 0,
            opacity: started || reduced ? 1 : 0,
            transform: started || reduced ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 520ms ease-out 140ms, transform 520ms ease-out 140ms',
          }}
        >
          Diligence is not a checklist; it is a weighting of consequences. REDIP scores seven layers —
          title chain, encumbrance, statutory approvals, RERA, promoter execution, market, and financial
          structure — by deal impact, and assembles them into a single stack you can read at a glance.
          The risk radar fills from extracted facts, not opinion. And on the four lanes where a wrong
          word is a liability — title, encumbrance, RERA status, statutory approval — REDIP does not render
          a verdict. It surfaces what the documents show and marks the lane{' '}
          <em style={{ fontStyle: 'italic' }}>human-verify</em>. The restraint is the point — it is what
          keeps the work defensible.
        </p>

        {/* Figure: stack + radar, like a printed research-note exhibit */}
        <div
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.55fr) minmax(0, 1fr)',
            gap: 28,
            alignItems: 'stretch',
            transform: `translateY(${figTravel}px)`,
          }}
          className="diligence-figure-grid"
        >
          {/* Left: the scored stack of transparencies */}
          <div
            style={{
              position: 'relative',
              background: PALETTE.canvas,
              border: `1px solid ${PALETTE.hair}`,
              borderRadius: 10,
              padding: '20px 18px 22px',
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 14, paddingLeft: 14, paddingRight: 14 }}>
              <span
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: PALETTE.muted,
                }}
              >
                Layer stack · impact-weighted
              </span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  color: PALETTE.muted,
                  border: `1px solid ${PALETTE.hair}`,
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              >
                illustrative
              </span>
            </div>

            <div style={{ borderTop: `1px solid ${PALETTE.hair}`, paddingTop: 4 }}>
              {LAYERS.map((layer, i) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  index={i}
                  started={started}
                  reduced={reduced}
                  onHover={setHovered}
                  hovered={hovered === layer.id}
                />
              ))}
            </div>

            {/* legend strip */}
            <div
              className="flex flex-wrap items-center gap-x-5 gap-y-2"
              style={{
                marginTop: 14,
                paddingTop: 14,
                paddingLeft: 14,
                paddingRight: 14,
                borderTop: `1px solid ${PALETTE.hair}`,
              }}
            >
              <LegendDot color={PALETTE.green} label="Scored · sourced" />
              <LegendDot color={PALETTE.oxblood} label="Live risk on record" />
              <span className="flex items-center gap-1.5">
                <svg width="11" height="11" viewBox="0 0 11 11">
                  <circle cx="5.5" cy="5.5" r="3.6" fill="none" stroke={PALETTE.brass} strokeWidth="1.3" />
                </svg>
                <span
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    color: PALETTE.ink2,
                  }}
                >
                  Legal four · no verdict rendered
                </span>
              </span>
            </div>
          </div>

          {/* Right: risk radar on bone */}
          <div
            style={{
              position: 'relative',
              background: PALETTE.ivory,
              border: `1px solid ${PALETTE.hair}`,
              borderRadius: 10,
              padding: '20px 18px 18px',
              display: 'flex',
              flexDirection: 'column',
              transform: `translateY(${fgTravel}px)`,
            }}
          >
            <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
              <Activity size={14} color={PALETTE.evergreen} />
              <span
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 11,
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: PALETTE.muted,
                }}
              >
                Risk radar
              </span>
            </div>
            <span
              style={{
                fontFamily: '"Source Serif 4", Georgia, serif',
                fontStyle: 'italic',
                fontSize: 12.5,
                color: PALETTE.ink2,
                marginBottom: 8,
              }}
            >
              7 axes · weighted by impact, sourced not opined
            </span>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
              <Radar started={started} reduced={reduced} />
            </div>

            <div
              className="flex items-center justify-between"
              style={{ marginTop: 6, paddingTop: 12, borderTop: `1px solid ${PALETTE.hair}` }}
            >
              <span className="flex items-center gap-1.5">
                <span style={{ width: 8, height: 8, borderRadius: 999, background: PALETTE.oxblood, display: 'inline-block' }} />
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: PALETTE.ink2 }}>
                  Live risk
                </span>
              </span>
              <span
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 10,
                  color: PALETTE.muted,
                  border: `1px solid ${PALETTE.hair}`,
                  borderRadius: 4,
                  padding: '2px 6px',
                }}
              >
                illustrative
              </span>
            </div>
          </div>
        </div>

        {/* The discipline, stated plainly as a trust signal */}
        <div
          style={{
            marginTop: 30,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            maxWidth: 760,
            opacity: started || reduced ? 1 : 0,
            transition: 'opacity 500ms ease-out 700ms',
          }}
        >
          <ShieldCheck size={18} color={PALETTE.brass} style={{ flexShrink: 0, marginTop: 2 }} />
          <p
            style={{
              fontFamily: '"Source Serif 4", Georgia, serif',
              fontSize: 14.5,
              lineHeight: 1.55,
              color: PALETTE.ink2,
              margin: 0,
            }}
          >
            On the legal four, the empty cell is the feature. Where a brochure would print a green tick,
            REDIP prints an open circle and the word <em style={{ fontStyle: 'italic' }}>human-verify</em>.
            Confidence, here, is shown by what we decline to claim.
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 880px) {
          .diligence-figure-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
        section :focus-visible {
          outline: 2px solid ${PALETTE.evergreen};
          outline-offset: 2px;
        }
      `}</style>
    </section>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1.5">
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: PALETTE.ink2 }}>{label}</span>
    </span>
  );
}
