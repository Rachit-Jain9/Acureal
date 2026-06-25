import { useEffect, useRef, useState, useCallback } from 'react';
import { FileText, CornerDownRight, Lock } from 'lucide-react';

const PALETTE = {
  canvas: '#F5F1E8',
  ivory: '#FCFAF4',
  recessed: '#EDE7D9',
  inkPanel: '#20201C',
  inkPanelText: '#F2EEE4',
  ink: '#1C1A16',
  secondary: '#57514A',
  muted: '#8C8579',
  hairline: '#E2DACB',
  hairlineStrong: '#CFC5B2',
  evergreen: '#1F4A3D',
  evergreenSoft: 'rgba(31,74,61,0.08)',
  brass: '#9C7A3C',
};

// Illustrative provenance traces — each figure threads to a document source.
const TRACES = [
  {
    id: 'consideration',
    label: 'Total consideration',
    value: '₹18 Cr',
    cite: 'p.4 · cl. 3',
    source: 'Sale deed',
    docTitle: 'Sale deed',
    docMeta: 'Registered · Sub-registrar, Varthur',
    // y-coordinate of the highlighted clause within the doc facsimile (SVG units)
    clauseY: 150,
    clauseLines: [
      { text: 'WHEREAS the total consideration for the', hl: false },
      { text: 'said schedule property is fixed at', hl: false },
      { text: 'Rs. 18,00,00,000/- (Rupees Eighteen', hl: true },
      { text: 'Crore only), paid in full as set out', hl: true },
      { text: 'in clause 3 of this deed of conveyance.', hl: false },
    ],
  },
  {
    id: 'saleable',
    label: 'Saleable area',
    value: '2,80,000 sqft',
    cite: 'p.7 · sanctioned plan',
    source: 'Sanctioned plan',
    docTitle: 'Sanctioned plan',
    docMeta: 'BBMP sanction · Sheet 7 of 11',
    clauseY: 240,
    clauseLines: [
      { text: 'Sanctioned built-up statement —', hl: false },
      { text: 'Total saleable area sanctioned:', hl: false },
      { text: '2,80,000 sqft across Blocks A–C,', hl: true },
      { text: 'per approved floor plates at FSI', hl: false },
      { text: 'as endorsed on Sheet 7.', hl: false },
    ],
  },
  {
    id: 'guidance',
    label: 'Guidance value',
    value: '₹6,200 / sqft',
    cite: 'sub-registrar schedule',
    source: 'Sub-registrar schedule',
    docTitle: 'Sub-registrar schedule',
    docMeta: 'Guidance value · Varthur jurisdiction',
    clauseY: 330,
    clauseLines: [
      { text: 'Schedule of guidance values —', hl: false },
      { text: 'Varthur hobli, residential apartment:', hl: false },
      { text: 'Rs. 6,200 per sqft of saleable area,', hl: true },
      { text: 'effective as per the current schedule', hl: false },
      { text: 'on file with the sub-registrar.', hl: false },
    ],
  },
  {
    id: 'fsi',
    label: 'FSI',
    value: '2.75',
    cite: 'p.2 · sanction sheet',
    source: 'Sanction sheet',
    docTitle: 'Sanction sheet',
    docMeta: 'Approval endorsement · Sheet 2',
    clauseY: 420,
    clauseLines: [
      { text: 'Floor Space Index endorsement —', hl: false },
      { text: 'Permissible / availed FSI for the', hl: false },
      { text: 'sanctioned scheme is 2.75, within', hl: true },
      { text: 'the applicable zoning envelope as', hl: false },
      { text: 'endorsed on the sanction sheet.', hl: false },
    ],
  },
];

const AUTO_INTERVAL = 2400;

export default function ProvenanceThread() {
  const sectionRef = useRef(null);
  const memoRefs = useRef({});
  const docRef = useRef(null);
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const rafRef = useRef(null);
  const autoRef = useRef(null);

  const [reduced, setReduced] = useState(false);
  const [inView, setInView] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [userTouched, setUserTouched] = useState(false);
  const [pathD, setPathD] = useState('');
  const [pathLen, setPathLen] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [typedCite, setTypedCite] = useState('');
  const [parallax, setParallax] = useState(0);

  const active = TRACES.find((t) => t.id === activeId) || null;

  // prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, []);

  // reveal-on-scroll
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.25 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // shallow parallax for the document facsimile (depth, not spectacle)
  useEffect(() => {
    if (reduced) return;
    const onScroll = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = sectionRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        const progress = 1 - Math.min(Math.max((r.top + r.height / 2) / (vh + r.height), 0), 1);
        // map 0..1 to a small travel band (~12px), centered
        setParallax((progress - 0.5) * 12);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reduced]);

  // compute the bezier thread from the active figure to its clause
  const computeThread = useCallback((id) => {
    const svg = svgRef.current;
    const numEl = memoRefs.current[id];
    const trace = TRACES.find((t) => t.id === id);
    if (!svg || !numEl || !trace) return;
    const svgRect = svg.getBoundingClientRect();
    const numRect = numEl.getBoundingClientRect();
    const docEl = docRef.current;
    if (!docEl) return;
    const docRect = docEl.getBoundingClientRect();

    // SVG is in user units 0..1000 (width) x matching height; we map px->user units
    const W = 1000;
    const H = svgRect.height === 0 ? 600 : (svgRect.height / svgRect.width) * W;
    const toX = (clientX) => ((clientX - svgRect.left) / svgRect.width) * W;
    const toY = (clientY) => ((clientY - svgRect.top) / svgRect.height) * H;

    // start: right edge of the number
    const sx = toX(numRect.right + 4);
    const sy = toY(numRect.top + numRect.height / 2);

    // end: left edge of the doc, at the clause's vertical position
    // clauseY is in doc-local SVG units (0..600 doc canvas); convert through docRect
    const docTopY = toY(docRect.top);
    const docHeightY = (docRect.height / svgRect.height) * H;
    const ey = docTopY + (trace.clauseY / 600) * docHeightY;
    const ex = toX(docRect.left + 6);

    // control points: ease out of the number to the right, ease into the clause from the left
    const dx = ex - sx;
    const c1x = sx + dx * 0.45;
    const c1y = sy;
    const c2x = ex - dx * 0.45;
    const c2y = ey;
    const d = `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${ex.toFixed(1)} ${ey.toFixed(1)}`;
    setPathD(d);
  }, []);

  // when active changes, recompute the thread and trigger the draw
  useEffect(() => {
    if (!activeId) {
      setDrawn(false);
      setTypedCite('');
      return;
    }
    computeThread(activeId);
  }, [activeId, computeThread, inView]);

  // measure path length once D is set, then animate stroke-dashoffset
  useEffect(() => {
    if (!pathD) return;
    const p = pathRef.current;
    if (!p) return;
    const len = p.getTotalLength();
    setPathLen(len);
    if (reduced) {
      setDrawn(true);
      return;
    }
    // re-route: start retracted, then draw on next frame for smooth transition
    setDrawn(false);
    const r = requestAnimationFrame(() => {
      requestAnimationFrame(() => setDrawn(true));
    });
    return () => cancelAnimationFrame(r);
  }, [pathD, reduced]);

  // type the citation after the thread lands
  useEffect(() => {
    if (!active) return;
    const full = `${active.source} · ${active.cite}`;
    if (reduced) {
      setTypedCite(full);
      return;
    }
    setTypedCite('');
    let i = 0;
    const start = setTimeout(() => {
      const tick = setInterval(() => {
        i += 1;
        setTypedCite(full.slice(0, i));
        if (i >= full.length) clearInterval(tick);
      }, 16);
      // store on ref-less closure; cleared by outer cleanup via active change
    }, 360);
    return () => clearTimeout(start);
  }, [active, reduced]);

  // auto-cycle on scroll-in if untouched
  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      if (!activeId) setActiveId(TRACES[0].id);
      return;
    }
    if (userTouched) return;
    // kick off
    let idx = 0;
    setActiveId(TRACES[0].id);
    autoRef.current = setInterval(() => {
      idx = (idx + 1) % TRACES.length;
      setActiveId(TRACES[idx].id);
    }, AUTO_INTERVAL);
    return () => {
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, [inView, reduced, userTouched]);

  // stop auto-cycle the moment the user engages
  const engage = (id) => {
    if (!userTouched) setUserTouched(true);
    if (autoRef.current) {
      clearInterval(autoRef.current);
      autoRef.current = null;
    }
    setActiveId(id);
  };

  const release = () => {
    // retract on blur/hover-out
    if (userTouched) setActiveId(null);
  };

  // recompute on resize while active
  useEffect(() => {
    const onResize = () => {
      if (activeId) computeThread(activeId);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [activeId, computeThread]);

  const baseFade = (delay = 0) => ({
    opacity: inView ? 1 : 0,
    transform: inView ? 'translateY(0)' : 'translateY(14px)',
    transition: reduced
      ? 'none'
      : `opacity 600ms cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 600ms cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
  });

  return (
    <section
      ref={sectionRef}
      style={{
        position: 'relative',
        backgroundColor: PALETTE.canvas,
        color: PALETTE.ink,
        fontFamily: '"Source Serif 4", Georgia, serif',
        paddingTop: '120px',
        paddingBottom: '120px',
        overflow: 'hidden',
      }}
    >
      {/* corner parcel-glyph — 'source threads' state */}
      <CornerGlyph reduced={reduced} inView={inView} />

      <div
        style={{
          maxWidth: '72rem',
          marginLeft: 'auto',
          marginRight: 'auto',
          paddingLeft: '24px',
          paddingRight: '24px',
          position: 'relative',
        }}
      >
        {/* eyebrow */}
        <div
          style={{
            ...baseFade(0),
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: '12px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: PALETTE.brass,
            marginBottom: '22px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: '26px',
              height: '1px',
              backgroundColor: PALETTE.brass,
            }}
          />
          № 04 · Provenance
        </div>

        {/* headline */}
        <h2
          style={{
            ...baseFade(80),
            fontSize: 'clamp(28px, 4.4vw, 46px)',
            lineHeight: 1.12,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            margin: '0 0 28px 0',
            maxWidth: '21ch',
            color: PALETTE.ink,
          }}
        >
          Every number traces to a page. Hover one, and the thread{' '}
          <em style={{ fontStyle: 'italic', color: PALETTE.evergreen }}>draws back to the deed</em>.
        </h2>

        {/* body */}
        <p
          style={{
            ...baseFade(160),
            fontSize: '17px',
            lineHeight: 1.7,
            color: PALETTE.secondary,
            maxWidth: '62ch',
            margin: '0 0 56px 0',
          }}
        >
          An IC number that can&rsquo;t be sourced is a liability, not an asset. Every figure carries a
          thread back to the exact document and page it was extracted from. Hover the figure and the
          thread draws taut to the source &mdash; a deed clause, a sanction sheet, a Khata extract.{' '}
          <em style={{ fontStyle: 'italic', color: PALETTE.ink }}>
            What the committee sees is precisely what the file supports
          </em>{' '}
          &mdash; no more, and never less. If the thread can&rsquo;t be drawn, the number doesn&rsquo;t
          get to call itself verified.
        </p>

        {/* ---- the figure: memo | ledger spine | sources ---- */}
        <div
          style={{
            ...baseFade(240),
            position: 'relative',
            borderRadius: '4px',
            border: `1px solid ${PALETTE.hairline}`,
            backgroundColor: PALETTE.ivory,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 56px minmax(0, 1.05fr)',
              alignItems: 'stretch',
              position: 'relative',
            }}
          >
            {/* MEMO COLUMN */}
            <div style={{ padding: '34px 30px 34px 34px', position: 'relative', zIndex: 2 }}>
              <div
                style={{
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: '10.5px',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: PALETTE.muted,
                  marginBottom: '4px',
                }}
              >
                IC memo · key figures
              </div>
              <div
                style={{
                  fontSize: '13px',
                  color: PALETTE.muted,
                  fontStyle: 'italic',
                  marginBottom: '26px',
                }}
              >
                Hover a figure to pull its thread (illustrative)
              </div>

              <div role="list" style={{ display: 'flex', flexDirection: 'column' }}>
                {TRACES.map((t) => {
                  const isActive = activeId === t.id;
                  return (
                    <button
                      key={t.id}
                      role="listitem"
                      type="button"
                      onMouseEnter={() => engage(t.id)}
                      onFocus={() => engage(t.id)}
                      onMouseLeave={release}
                      onBlur={release}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        padding: '14px 14px',
                        marginLeft: '-14px',
                        marginRight: '-14px',
                        borderRadius: '3px',
                        position: 'relative',
                        backgroundColor: isActive ? PALETTE.evergreenSoft : 'transparent',
                        transition: reduced
                          ? 'none'
                          : 'background-color 180ms ease-out',
                        outline: 'none',
                      }}
                      className="prov-figure"
                    >
                      <span
                        style={{
                          fontFamily: '"Inter", system-ui, sans-serif',
                          fontSize: '12px',
                          color: isActive ? PALETTE.evergreen : PALETTE.secondary,
                          letterSpacing: '0.01em',
                          transition: reduced ? 'none' : 'color 180ms ease-out',
                        }}
                      >
                        {t.label}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: '12px',
                        }}
                      >
                        <span
                          ref={(el) => (memoRefs.current[t.id] = el)}
                          style={{
                            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                            fontVariantNumeric: 'tabular-nums',
                            fontSize: '24px',
                            fontWeight: 500,
                            letterSpacing: '-0.01em',
                            color: PALETTE.ink,
                            lineHeight: 1,
                          }}
                        >
                          {t.value}
                        </span>
                        <span
                          aria-hidden
                          style={{
                            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                            fontSize: '10.5px',
                            letterSpacing: '0.06em',
                            color: isActive ? PALETTE.evergreen : PALETTE.muted,
                            opacity: isActive ? 1 : 0,
                            transform: isActive ? 'translateX(0)' : 'translateX(-4px)',
                            transition: reduced
                              ? 'none'
                              : 'opacity 200ms ease-out 120ms, transform 200ms ease-out 120ms',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <CornerDownRight size={11} strokeWidth={1.6} />
                          {t.cite}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* immutable audit line */}
              <div
                style={{
                  marginTop: '30px',
                  paddingTop: '18px',
                  borderTop: `1px solid ${PALETTE.hairline}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  fontFamily: '"Inter", system-ui, sans-serif',
                  fontSize: '12px',
                  color: PALETTE.muted,
                }}
              >
                <Lock size={13} strokeWidth={1.6} color={PALETTE.brass} />
                <span>
                  Immutable audit trail on every material change.{' '}
                  <span style={{ color: PALETTE.secondary }}>No source, no claim of verification.</span>
                </span>
              </div>
            </div>

            {/* LEDGER SPINE — the one moment of weight */}
            <div
              style={{
                backgroundColor: PALETTE.inkPanel,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1,
              }}
            >
              <span
                style={{
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: '10px',
                  letterSpacing: '0.32em',
                  textTransform: 'uppercase',
                  color: PALETTE.inkPanelText,
                  opacity: 0.82,
                  userSelect: 'none',
                }}
              >
                Provenance ledger
              </span>
            </div>

            {/* SOURCES — document facsimile on recessed panel */}
            <div
              style={{
                backgroundColor: PALETTE.recessed,
                padding: '34px 34px 34px 30px',
                position: 'relative',
                zIndex: 2,
              }}
            >
              <div
                style={{
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: '10.5px',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: PALETTE.muted,
                  marginBottom: '4px',
                }}
              >
                Source file
              </div>
              <div
                style={{
                  fontFamily: '"Inter", system-ui, sans-serif',
                  fontSize: '13px',
                  color: PALETTE.secondary,
                  marginBottom: '20px',
                  minHeight: '18px',
                  transition: reduced ? 'none' : 'color 200ms ease-out',
                }}
              >
                {active ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                    <FileText size={13} strokeWidth={1.6} color={PALETTE.evergreen} />
                    <span style={{ color: PALETTE.ink }}>{active.docTitle}</span>
                    <span style={{ color: PALETTE.muted }}>— {active.docMeta}</span>
                  </span>
                ) : (
                  <span style={{ fontStyle: 'italic', color: PALETTE.muted }}>
                    Awaiting figure&hellip;
                  </span>
                )}
              </div>

              {/* the page facsimile (parallax) */}
              <div
                ref={docRef}
                style={{
                  transform: reduced ? 'none' : `translateY(${parallax * 0.85}px)`,
                  transition: 'transform 60ms linear',
                  willChange: 'transform',
                }}
              >
                <DocFacsimile active={active} reduced={reduced} parcelInView={inView} />
              </div>

              {/* typed citation caption */}
              <div
                style={{
                  marginTop: '16px',
                  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                  fontSize: '11px',
                  letterSpacing: '0.04em',
                  color: PALETTE.evergreen,
                  minHeight: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {active && (
                  <>
                    <span style={{ color: PALETTE.brass }}>↳</span>
                    <span>{typedCite}</span>
                    {!reduced && typedCite.length < `${active.source} · ${active.cite}`.length && (
                      <span
                        aria-hidden
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '12px',
                          backgroundColor: PALETTE.evergreen,
                          marginLeft: '1px',
                          animation: 'provCaret 700ms steps(1) infinite',
                        }}
                      />
                    )}
                  </>
                )}
              </div>
            </div>

            {/* THE THREAD — single SVG overlay spanning the whole figure */}
            <svg
              ref={svgRef}
              viewBox="0 0 1000 600"
              preserveAspectRatio="none"
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 3,
              }}
            >
              <defs>
                <marker
                  id="provDot"
                  markerWidth="6"
                  markerHeight="6"
                  refX="3"
                  refY="3"
                  markerUnits="userSpaceOnUse"
                >
                  <circle cx="3" cy="3" r="2.4" fill={PALETTE.evergreen} />
                </marker>
              </defs>
              {pathD && (
                <path
                  ref={pathRef}
                  d={pathD}
                  fill="none"
                  stroke={PALETTE.evergreen}
                  strokeWidth="1.4"
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  markerStart="url(#provDot)"
                  markerEnd="url(#provDot)"
                  style={{
                    strokeDasharray: pathLen,
                    strokeDashoffset: reduced ? 0 : drawn ? 0 : pathLen,
                    transition: reduced
                      ? 'none'
                      : drawn
                      ? 'stroke-dashoffset 320ms cubic-bezier(0.16,1,0.3,1)'
                      : 'stroke-dashoffset 220ms ease-in',
                    opacity: activeId ? 1 : 0,
                  }}
                />
              )}
            </svg>
          </div>
        </div>

        {/* footnote / honesty tag */}
        <div
          style={{
            ...baseFade(320),
            marginTop: '20px',
            fontFamily: '"JetBrains Mono", ui-monospace, monospace',
            fontSize: '10.5px',
            letterSpacing: '0.04em',
            color: PALETTE.muted,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px 18px',
          }}
        >
          <span>Traces shown are illustrative.</span>
          <span>Title · encumbrance · RERA · approvals — extracted &amp; surfaced for human verification, never concluded.</span>
        </div>
      </div>

      <style>{`
        @keyframes provCaret { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
        .prov-figure:focus-visible {
          box-shadow: 0 0 0 2px ${PALETTE.evergreen};
        }
        @media (max-width: 760px) {
          section .prov-grid-collapse { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}

/* ---------- Document page facsimile ---------- */
function DocFacsimile({ active, reduced }) {
  // The facsimile is its own SVG so clause highlights animate independently of the thread overlay.
  return (
    <svg
      viewBox="0 0 420 600"
      width="100%"
      style={{
        display: 'block',
        borderRadius: '2px',
        border: `1px solid ${PALETTE.hairlineStrong}`,
        backgroundColor: PALETTE.ivory,
        boxShadow: '0 1px 0 rgba(0,0,0,0.03)',
      }}
      role="img"
      aria-label={active ? `${active.docTitle}, relevant clause highlighted` : 'Source document page'}
    >
      {/* sheet */}
      <rect x="0" y="0" width="420" height="600" fill={PALETTE.ivory} />
      {/* faint header band */}
      <text
        x="34"
        y="46"
        fontFamily='"JetBrains Mono", monospace'
        fontSize="11"
        letterSpacing="2"
        fill={PALETTE.muted}
      >
        {active ? active.docTitle.toUpperCase() : 'DOCUMENT'}
      </text>
      <line x1="34" y1="58" x2="386" y2="58" stroke={PALETTE.hairline} strokeWidth="1" />

      {/* boilerplate hairlines representing body text */}
      {Array.from({ length: 22 }).map((_, i) => {
        const y = 90 + i * 21;
        // width jitter so it reads as prose, deterministic
        const w = 300 - ((i * 37) % 90);
        const isClauseRow =
          active && y >= active.clauseY - 6 && y <= active.clauseY + active.clauseLines.length * 21;
        if (active && isClauseRow) return null; // skip lines under the live clause block
        return (
          <rect
            key={i}
            x="34"
            y={y}
            width={w}
            height="3"
            rx="1.5"
            fill={PALETTE.hairline}
            opacity={0.75}
          />
        );
      })}

      {/* the highlighted clause */}
      {active && (
        <ClauseBlock active={active} reduced={reduced} />
      )}

      {/* footer page tag */}
      <text
        x="386"
        y="576"
        textAnchor="end"
        fontFamily='"JetBrains Mono", monospace'
        fontSize="10"
        fill={PALETTE.muted}
      >
        {active ? active.cite : '—'}
      </text>
    </svg>
  );
}

function ClauseBlock({ active, reduced }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    setShown(false);
    // highlight fades up 200ms AFTER the thread lands (~320ms draw)
    const t = setTimeout(() => setShown(true), 380);
    return () => clearTimeout(t);
  }, [active.id, reduced]);

  const top = active.clauseY - 14;
  const lineH = 21;
  const blockH = active.clauseLines.length * lineH + 16;

  return (
    <g
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(4px)',
        transition: reduced ? 'none' : 'opacity 200ms ease-out, transform 120ms ease-out',
      }}
    >
      {/* soft evergreen highlight fill */}
      <rect
        x="28"
        y={top}
        width="364"
        height={blockH}
        rx="3"
        fill="rgba(31,74,61,0.08)"
      />
      {/* brass bracket left + right (the relevant clause bracketed in brass) */}
      <path
        d={`M 34 ${top + 4} L 30 ${top + 4} L 30 ${top + blockH - 4} L 34 ${top + blockH - 4}`}
        fill="none"
        stroke="#9C7A3C"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d={`M 386 ${top + 4} L 390 ${top + 4} L 390 ${top + blockH - 4} L 386 ${top + blockH - 4}`}
        fill="none"
        stroke="#9C7A3C"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* hairline focus frame that lifts the clause */}
      <rect
        x="28"
        y={top}
        width="364"
        height={blockH}
        rx="3"
        fill="none"
        stroke="rgba(31,74,61,0.35)"
        strokeWidth="1"
      />
      {/* the clause text */}
      {active.clauseLines.map((ln, i) => (
        <text
          key={i}
          x="40"
          y={active.clauseY + i * lineH}
          fontFamily='"Source Serif 4", Georgia, serif'
          fontSize="12.5"
          fill={ln.hl ? '#1F4A3D' : '#1C1A16'}
          fontWeight={ln.hl ? 600 : 400}
        >
          {ln.text}
        </text>
      ))}
    </g>
  );
}

/* ---------- Persistent corner parcel-glyph (source-threads state) ---------- */
function CornerGlyph({ reduced, inView }) {
  const len = 360;
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      aria-hidden
      style={{
        position: 'absolute',
        top: '28px',
        right: '28px',
        opacity: 0.5,
        pointerEvents: 'none',
      }}
    >
      {/* parcel boundary */}
      <path
        d="M 12 18 L 44 12 L 54 40 L 30 54 L 10 42 Z"
        fill="none"
        stroke={PALETTE.evergreen}
        strokeWidth="1.2"
        strokeLinejoin="round"
        style={{
          strokeDasharray: len,
          strokeDashoffset: reduced ? 0 : inView ? 0 : len,
          transition: reduced ? 'none' : 'stroke-dashoffset 1200ms cubic-bezier(0.16,1,0.3,1) 200ms',
        }}
      />
      {/* source threads radiating from the parcel — the scene-5 state */}
      {[
        'M 32 33 L 56 14',
        'M 32 33 L 58 44',
        'M 32 33 L 14 54',
        'M 32 33 L 9 24',
      ].map((d, i) => (
        <path
          key={i}
          d={d}
          stroke={PALETTE.brass}
          strokeWidth="0.9"
          fill="none"
          style={{
            opacity: inView ? 0.85 : 0,
            transition: reduced
              ? 'none'
              : `opacity 320ms ease-out ${600 + i * 90}ms`,
          }}
        />
      ))}
      <circle cx="32" cy="33" r="1.8" fill={PALETTE.evergreen} />
    </svg>
  );
}
