import { useEffect, useRef, useState } from 'react';
import { FileText, ShieldCheck, CornerDownRight } from 'lucide-react';

const PALETTE = {
  canvas: '#F5F1E8',
  ivory: '#FCFAF4',
  recessed: '#EDE7D9',
  ink: '#1C1A16',
  secondary: '#57514A',
  muted: '#8C8579',
  hairline: '#E2DACB',
  hairlineStrong: '#CFC5B2',
  evergreen: '#1F4A3D',
  brass: '#9C7A3C',
  money: '#2F6B4F',
  oxblood: '#9E3B2E',
};

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

// The four messy inputs and the structured facts each resolves into.
// Every figure is illustrative; the legal lanes are extracted, never concluded.
const SOURCES = [
  {
    id: 'deed',
    type: 'Sale deed · Kannada',
    tag: 'deed · pp.1–4',
    kind: 'deed',
    rows: [
      { label: 'Owner of record', value: 'extracted', mono: false, lane: 'legal' },
      { label: 'Extent', value: '~4.2 ac', mono: true, lane: null },
      { label: 'Consideration', value: '₹18.0 Cr', mono: true, lane: null, note: 'illustrative' },
    ],
  },
  {
    id: 'khata',
    type: 'Khata extract',
    tag: 'khata · p.1',
    kind: 'khata',
    rows: [
      { label: 'Khata grade', value: 'B', mono: true, lane: 'legal', verbatim: true },
    ],
  },
  {
    id: 'ec',
    type: 'Encumbrance cert.',
    tag: 'ec · pp.1–6',
    kind: 'ec',
    rows: [
      { label: 'Coverage period', value: '→ 2019', mono: true, lane: 'legal' },
      { label: 'Present-day gap', value: 'flagged', mono: false, lane: 'legal', greyed: true },
    ],
  },
  {
    id: 'broker',
    type: 'Broker note',
    tag: 'call · unlogged',
    kind: 'broker',
    rows: [
      { label: 'Quoted rate', value: '₹/sqft', mono: true, lane: null, hearsay: true, note: 'illustrative' },
    ],
  },
];

const MICROCOPY = [
  'Sale deed · Kannada · 11 fields extracted · pinned pp. 1–4',
  'Khata: grade recorded as B · not interpreted',
  'EC: coverage ends 2019 · stops short of present · human-verify',
  "Broker quote · ₹/sqft · logged as unverified input",
  'Each fact pinned to its source page',
];

export default function InboundBecomesStructure() {
  const sectionRef = useRef(null);
  const [entered, setEntered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const rafRef = useRef(0);
  const [parallax, setParallax] = useState(0);

  // Honor reduced-motion: render the final, connected state with no choreography.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  // Assemble once on entry, then hold. Never loops.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setEntered(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Shallow parallax — depth, never spectacle. Max ~12px travel.
  useEffect(() => {
    if (reduced) return;
    const el = sectionRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 1;
        const p = 1 - (rect.top + rect.height / 2) / (vh + rect.height / 2);
        setParallax(Math.max(-1, Math.min(1, p)));
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reduced]);

  const on = entered || reduced;
  const cardShift = reduced ? 0 : (parallax * -8).toFixed(2); // cards parallax ~0.85x
  const rowShift = reduced ? 0 : (parallax * -1.5).toFixed(2); // rows settle at ~1.0x

  return (
    <section
      ref={sectionRef}
      aria-label="The inbound becomes structure"
      style={{
        position: 'relative',
        backgroundColor: PALETTE.canvas,
        color: PALETTE.ink,
        fontFamily: "'Source Serif 4', Georgia, serif",
        overflow: 'hidden',
        paddingTop: '7rem',
        paddingBottom: '8rem',
      }}
    >
      {/* Persistent cadastral corner-glyph — redraws to 'pinned facts' on entry. */}
      <CornerGlyph on={on} reduced={reduced} />

      <div
        style={{
          maxWidth: '72rem',
          margin: '0 auto',
          paddingLeft: '1.5rem',
          paddingRight: '1.5rem',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Eyebrow + headline */}
        <div style={{ maxWidth: '46rem' }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: PALETTE.brass,
              fontVariantNumeric: 'tabular-nums',
              opacity: on ? 1 : 0,
              transform: on ? 'none' : 'translateY(8px)',
              transition: reduced ? 'none' : `opacity 520ms ${EASE}, transform 520ms ${EASE}`,
            }}
          >
            № 01 · Intake
          </div>
          <h2
            style={{
              fontSize: 'clamp(1.6rem, 3.1vw, 2.5rem)',
              lineHeight: 1.18,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              margin: '1.1rem 0 0',
              color: PALETTE.ink,
              opacity: on ? 1 : 0,
              transform: on ? 'none' : 'translateY(12px)',
              transition: reduced
                ? 'none'
                : `opacity 640ms ${EASE} 60ms, transform 640ms ${EASE} 60ms`,
            }}
          >
            A deal rarely arrives as a data room. It arrives as a sale deed, a
            B-Khata, and an <em style={{ fontStyle: 'italic' }}>EC that stops short</em>.
          </h2>
          <p
            style={{
              fontSize: '1.02rem',
              lineHeight: 1.62,
              color: PALETTE.secondary,
              margin: '1.4rem 0 0',
              maxWidth: '40rem',
              opacity: on ? 1 : 0,
              transform: on ? 'none' : 'translateY(12px)',
              transition: reduced
                ? 'none'
                : `opacity 700ms ${EASE} 140ms, transform 700ms ${EASE} 140ms`,
            }}
          >
            The first hours of a deal are spent reading, not deciding. REDIP
            ingests what actually shows up — a registered sale deed in Kannada, a
            Khata that turns out to be B-grade, an encumbrance certificate that
            runs current only to 2019, a broker&rsquo;s number on a call. Each
            document is read server-side, Kannada and English, the facts extracted
            and pinned to the exact page they sit on. Nothing is asserted that a
            page can&rsquo;t back. The legal lanes — title chain, encumbrance,
            RERA, approvals — are extracted, never concluded; they wait for a
            human to verify.
          </p>
        </div>

        {/* The infographic: document-to-fact threading */}
        <Infographic on={on} reduced={reduced} cardShift={cardShift} rowShift={rowShift} />

        {/* Footnote ledger of microcopy */}
        <ul
          style={{
            listStyle: 'none',
            margin: '3.5rem 0 0',
            padding: 0,
            display: 'grid',
            gap: '0.55rem',
            maxWidth: '44rem',
          }}
        >
          {MICROCOPY.map((line, i) => (
            <li
              key={line}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.6rem',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '12px',
                color: PALETTE.muted,
                fontVariantNumeric: 'tabular-nums',
                opacity: on ? 1 : 0,
                transform: on ? 'none' : 'translateY(6px)',
                transition: reduced
                  ? 'none'
                  : `opacity 480ms ${EASE} ${360 + i * 70}ms, transform 480ms ${EASE} ${360 + i * 70}ms`,
              }}
            >
              <span style={{ color: PALETTE.hairlineStrong, flex: '0 0 auto' }}>·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------
   The infographic. Left: four faint source-document cards on a recessed panel.
   Right: the same facts as a clean structured ledger. Evergreen connector
   threads draw taut between each card and its rows after the rows land.
---------------------------------------------------------------------------- */
function Infographic({ on, reduced, cardShift, rowShift }) {
  // Layout geometry, in SVG user units. The SVG sits behind both columns and
  // carries the connector threads so they can arc across the gap.
  const VB_W = 1000;
  const VB_H = 520;

  // Vertical anchor for each source card (left) and its row block (right).
  const lanes = [
    { y: 70, ec: false },
    { y: 190, ec: false },
    { y: 290, ec: true },
    { y: 430, ec: false },
  ];

  return (
    <div
      style={{
        position: 'relative',
        marginTop: '3.5rem',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 0.92fr) minmax(0, 1.08fr)',
        gap: 'clamp(1.5rem, 5vw, 4rem)',
        alignItems: 'stretch',
      }}
    >
      {/* Connector layer spanning both columns */}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        {lanes.map((lane, i) => {
          const startX = 372; // right edge of the card column
          const endX = 470; // left edge of the ledger column
          const y1 = lane.y + 28;
          const y2 = lane.y + 28;
          const midX = (startX + endX) / 2;
          const d = `M ${startX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${endX} ${y2}`;
          // Threads draw on after the row lands (staggered), left to right.
          const delay = 620 + i * 180;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={PALETTE.evergreen}
              strokeWidth="1.25"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{
                strokeDasharray: 260,
                strokeDashoffset: reduced ? 0 : on ? 0 : 260,
                opacity: lane.ec ? 0.55 : 0.8,
                transition: reduced ? 'none' : `stroke-dashoffset 520ms ${EASE} ${delay}ms`,
              }}
            />
          );
        })}
      </svg>

      {/* LEFT — recessed panel of faint source cards */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          backgroundColor: PALETTE.recessed,
          borderRadius: '4px',
          border: `0.5px solid ${PALETTE.hairline}`,
          padding: '1.4rem 1.3rem',
          transform: `translg(0) translateY(${cardShift}px)`,
          willChange: 'transform',
        }}
      >
        <PanelLabel>What arrived</PanelLabel>
        <div style={{ display: 'grid', gap: '0.85rem', marginTop: '1rem' }}>
          {SOURCES.map((src, i) => (
            <SourceCard key={src.id} src={src} index={i} on={on} reduced={reduced} />
          ))}
        </div>
      </div>

      {/* RIGHT — the structured ledger */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          padding: '0.2rem 0',
          transform: `translateY(${rowShift}px)`,
          willChange: 'transform',
        }}
      >
        <PanelLabel>What it became</PanelLabel>
        <div
          style={{
            marginTop: '1rem',
            backgroundColor: PALETTE.ivory,
            border: `0.5px solid ${PALETTE.hairline}`,
            borderRadius: '4px',
          }}
        >
          {SOURCES.map((src, si) => (
            <div key={src.id}>
              {src.rows.map((row, ri) => {
                const flatIndex =
                  SOURCES.slice(0, si).reduce((a, s) => a + s.rows.length, 0) + ri;
                return (
                  <LedgerRow
                    key={`${src.id}-${ri}`}
                    row={row}
                    src={src}
                    showTag={ri === 0}
                    index={flatIndex}
                    on={on}
                    reduced={reduced}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <p
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '11px',
            color: PALETTE.muted,
            margin: '0.9rem 0 0',
            fontVariantNumeric: 'tabular-nums',
            opacity: on ? 1 : 0,
            transition: reduced ? 'none' : `opacity 480ms ${EASE} 1100ms`,
          }}
        >
          All figures illustrative · each fact pinned to its source page
        </p>
      </div>
    </div>
  );
}

function PanelLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '10px',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: PALETTE.muted,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </div>
  );
}

/* A single faint source-document card. Translates in from -24px x and docks. */
function SourceCard({ src, index, on, reduced }) {
  const delay = 80 + index * 80;
  return (
    <div
      style={{
        position: 'relative',
        backgroundColor: PALETTE.ivory,
        border: `0.5px solid ${PALETTE.hairline}`,
        borderRadius: '3px',
        padding: '0.7rem 0.8rem 0.75rem',
        opacity: on ? 1 : 0,
        transform: on ? 'none' : 'translateX(-24px)',
        transition: reduced
          ? 'none'
          : `opacity 240ms ${EASE} ${delay}ms, transform 240ms ${EASE} ${delay}ms`,
      }}
    >
      {/* brass/oxblood corner type-tag */}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 0,
          height: 0,
          borderTop: `18px solid ${src.kind === 'broker' ? PALETTE.muted : PALETTE.brass}`,
          borderLeft: '18px solid transparent',
          borderTopRightRadius: '3px',
          opacity: 0.85,
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '11px',
          color: PALETTE.secondary,
          letterSpacing: '0.02em',
        }}
      >
        <FileText size={13} strokeWidth={1.5} color={PALETTE.evergreen} aria-hidden="true" />
        <span>{src.type}</span>
      </div>

      {/* Card body: a small abstract rendition of the actual document. */}
      <div style={{ marginTop: '0.55rem' }}>
        <DocBody kind={src.kind} on={on} reduced={reduced} delay={delay} />
      </div>

      <div
        style={{
          marginTop: '0.55rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '10px',
          color: PALETTE.muted,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {src.tag}
      </div>
    </div>
  );
}

/* Respectful abstract document bodies — never faked text. */
function DocBody({ kind, on, reduced, delay }) {
  if (kind === 'deed') {
    // Kannada script as abstract glyph strokes — evocative, never real characters.
    return (
      <svg viewBox="0 0 220 46" width="100%" height="40" aria-hidden="true">
        {[6, 18, 30].map((y, r) => (
          <g key={r}>
            {Array.from({ length: 9 }).map((_, c) => {
              const x = 6 + c * 23;
              const seed = (r * 9 + c) % 5;
              const paths = [
                `M${x} ${y + 8} q4 -9 9 0 q-3 4 -9 4`,
                `M${x} ${y + 2} v9 m0 -5 q5 -4 8 0`,
                `M${x} ${y + 3} q6 0 6 5 q0 4 -6 4 m6 -9 v9`,
                `M${x} ${y + 9} q3 -8 7 -2 q2 4 -4 5`,
                `M${x} ${y + 4} h7 m-4 0 v6 q3 0 4 -3`,
              ];
              return (
                <path
                  key={c}
                  d={paths[seed]}
                  fill="none"
                  stroke={PALETTE.secondary}
                  strokeWidth="1"
                  strokeLinecap="round"
                  opacity={on ? 0.55 : 0}
                  style={{
                    transition: reduced
                      ? 'none'
                      : `opacity 360ms ${EASE} ${delay + c * 12 + r * 40}ms`,
                  }}
                />
              );
            })}
          </g>
        ))}
      </svg>
    );
  }

  if (kind === 'khata') {
    // A Khata stamp block.
    return (
      <svg viewBox="0 0 220 46" width="100%" height="40" aria-hidden="true">
        <rect
          x="6"
          y="6"
          width="78"
          height="34"
          rx="2"
          fill="none"
          stroke={PALETTE.brass}
          strokeWidth="1"
          strokeDasharray="3 2"
          opacity={on ? 0.8 : 0}
          style={{ transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay}ms` }}
        />
        <text
          x="45"
          y="20"
          textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace"
          fontSize="9"
          fill={PALETTE.brass}
          opacity={on ? 0.9 : 0}
          style={{ transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + 80}ms` }}
        >
          KHATA
        </text>
        <text
          x="45"
          y="32"
          textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace"
          fontSize="13"
          fontWeight="700"
          fill={PALETTE.ink}
          opacity={on ? 1 : 0}
          style={{ transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + 140}ms` }}
        >
          B
        </text>
        {[100, 100, 100].map((_, r) => (
          <line
            key={r}
            x1="98"
            x2={r === 2 ? 150 : 200}
            y1={12 + r * 11}
            y2={12 + r * 11}
            stroke={PALETTE.hairlineStrong}
            strokeWidth="1"
            opacity={on ? 0.7 : 0}
            style={{ transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + 100 + r * 40}ms` }}
          />
        ))}
      </svg>
    );
  }

  if (kind === 'ec') {
    // An EC table trailing off into greyed rows past 2019.
    return (
      <svg viewBox="0 0 220 56" width="100%" height="48" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, r) => {
          const greyed = r >= 4; // post-2019 rows stay greyed
          const y = 6 + r * 8;
          return (
            <g key={r}>
              <line
                x1="6"
                x2={greyed ? 120 : 168}
                y1={y}
                y2={y}
                stroke={greyed ? PALETTE.hairlineStrong : PALETTE.secondary}
                strokeWidth="1"
                strokeDasharray={greyed ? '2 3' : 'none'}
                opacity={on ? (greyed ? 0.45 : 0.7) : 0}
                style={{
                  transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + r * 35}ms`,
                }}
              />
              <line
                x1="178"
                x2="206"
                y1={y}
                y2={y}
                stroke={greyed ? PALETTE.hairlineStrong : PALETTE.secondary}
                strokeWidth="1"
                strokeDasharray={greyed ? '2 3' : 'none'}
                opacity={on ? (greyed ? 0.4 : 0.7) : 0}
                style={{
                  transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + r * 35}ms`,
                }}
              />
            </g>
          );
        })}
        {/* brass bracket: coverage ends before 'today' — last to appear, stated plainly */}
        <path
          d="M150 38 v8 h54"
          fill="none"
          stroke={PALETTE.brass}
          strokeWidth="1"
          strokeLinecap="round"
          opacity={on ? 0.9 : 0}
          style={{ transition: reduced ? 'none' : `opacity 360ms ${EASE} ${delay + 520}ms` }}
        />
        <text
          x="150"
          y="54"
          fontFamily="'JetBrains Mono', monospace"
          fontSize="8"
          fill={PALETTE.brass}
          opacity={on ? 1 : 0}
          style={{ transition: reduced ? 'none' : `opacity 360ms ${EASE} ${delay + 600}ms` }}
        >
          ends 2019
        </text>
      </svg>
    );
  }

  // broker note
  return (
    <svg viewBox="0 0 220 46" width="100%" height="40" aria-hidden="true">
      {[0, 1, 2].map((r) => (
        <line
          key={r}
          x1="6"
          x2={r === 2 ? 110 : 150}
          y1={12 + r * 12}
          y2={12 + r * 12}
          stroke={PALETTE.muted}
          strokeWidth="1"
          strokeLinecap="round"
          opacity={on ? 0.5 : 0}
          style={{ transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + r * 40}ms` }}
        />
      ))}
      <text
        x="162"
        y="16"
        fontFamily="'JetBrains Mono', monospace"
        fontSize="9"
        fill={PALETTE.muted}
        opacity={on ? 0.85 : 0}
        style={{ transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + 120}ms` }}
      >
        ₹/sqft
      </text>
    </svg>
  );
}

/* A single structured ledger row. Writes itself in, top-down. */
function LedgerRow({ row, src, showTag, index, on, reduced }) {
  const [hover, setHover] = useState(false);
  const delay = 360 + index * 110;
  const isLegal = row.lane === 'legal';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.75rem',
        padding: '0.7rem 0.95rem',
        borderTop: index === 0 ? 'none' : `0.5px solid ${PALETTE.hairline}`,
        opacity: on ? (row.greyed ? 0.55 : 1) : 0,
        transform: on ? 'none' : 'translateY(8px)',
        transition: reduced
          ? 'none'
          : `opacity 220ms ${EASE} ${delay}ms, transform 220ms ${EASE} ${delay}ms`,
      }}
    >
      {/* Label */}
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.92rem',
            color: row.greyed ? PALETTE.muted : PALETTE.ink,
            lineHeight: 1.25,
            fontStyle: row.greyed ? 'italic' : 'normal',
          }}
        >
          {row.label}
        </div>
        {showTag && (
          <div
            style={{
              marginTop: '0.2rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '10px',
              color: PALETTE.muted,
              fontVariantNumeric: 'tabular-nums',
              opacity: on ? 1 : 0,
              transition: reduced ? 'none' : `opacity 300ms ${EASE} ${delay + 220}ms`,
            }}
          >
            {src.tag}
          </div>
        )}
      </div>

      {/* Value + lane treatment */}
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          textAlign: 'right',
        }}
      >
        {row.note && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9px',
              letterSpacing: '0.04em',
              color: PALETTE.muted,
              textTransform: 'uppercase',
            }}
          >
            {row.note}
          </span>
        )}

        <span
          style={{
            fontFamily: row.mono
              ? "'JetBrains Mono', monospace"
              : "'Source Serif 4', Georgia, serif",
            fontSize: row.mono ? '0.92rem' : '0.9rem',
            fontStyle: !row.mono && !row.verbatim ? 'italic' : 'normal',
            color: row.hearsay ? PALETTE.muted : row.greyed ? PALETTE.muted : PALETTE.ink,
            fontVariantNumeric: 'tabular-nums',
            borderBottom: row.hearsay ? `1px solid ${PALETTE.brass}` : 'none',
            paddingBottom: row.hearsay ? '1px' : 0,
          }}
        >
          {row.value}
        </span>

        {/* Legal-four lanes carry a brass 'human-verify' chip — never a verdict. */}
        {isLegal && (
          <span
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            tabIndex={0}
            role="note"
            aria-label="Legal lane — extracted, awaiting human verification"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.28rem',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9.5px',
              letterSpacing: '0.03em',
              color: PALETTE.brass,
              border: `0.5px solid ${PALETTE.brass}`,
              borderRadius: '2px',
              padding: '2px 6px',
              whiteSpace: 'nowrap',
              transform: hover && !reduced ? 'translateY(-2px)' : 'none',
              transition: reduced ? 'none' : `transform 120ms ${EASE}`,
              cursor: 'default',
              outline: 'none',
            }}
          >
            <ShieldCheck size={10} strokeWidth={1.75} aria-hidden="true" />
            human-verify
          </span>
        )}

        {/* Hearsay tag for the unverified broker quote */}
        {row.hearsay && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '9.5px',
              letterSpacing: '0.03em',
              color: PALETTE.muted,
              border: `0.5px solid ${PALETTE.brass}`,
              borderRadius: '2px',
              padding: '2px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            hearsay
          </span>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   The persistent cadastral corner-glyph — the parcel off Sarjapur Road.
   Scene 2 state: 'pinned facts'. The boundary holds; small pin marks land
   along the edge as the scene enters, then it holds connected.
---------------------------------------------------------------------------- */
function CornerGlyph({ on, reduced }) {
  // Parcel boundary path (abstract cadastral polygon).
  const boundary = 'M14 40 L46 14 L78 26 L82 60 L52 78 L18 66 Z';
  const pins = [
    { x: 46, y: 14 },
    { x: 82, y: 60 },
    { x: 18, y: 66 },
  ];
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '2.2rem',
        right: '2.2rem',
        width: 64,
        height: 64,
        zIndex: 3,
        opacity: on ? 1 : 0,
        transition: reduced ? 'none' : `opacity 600ms ${EASE} 80ms`,
      }}
    >
      <svg viewBox="0 0 96 92" width="64" height="61" aria-hidden="true">
        <path
          d={boundary}
          fill={PALETTE.evergreen}
          fillOpacity="0.06"
          stroke={PALETTE.evergreen}
          strokeWidth="1"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 320,
            strokeDashoffset: reduced ? 0 : on ? 0 : 320,
            transition: reduced ? 'none' : `stroke-dashoffset 1100ms ${EASE} 120ms`,
          }}
        />
        {/* survey-number tie */}
        <text
          x="48"
          y="48"
          textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace"
          fontSize="9"
          fill={PALETTE.evergreen}
          opacity={on ? 0.8 : 0}
          style={{ transition: reduced ? 'none' : `opacity 400ms ${EASE} 900ms` }}
        >
          ~4.2 ac
        </text>
        {/* pinned-facts marks land along the boundary */}
        {pins.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="2.4"
            fill={PALETTE.brass}
            opacity={on ? 1 : 0}
            style={{
              transition: reduced
                ? 'none'
                : `opacity 280ms ${EASE} ${1000 + i * 120}ms`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}