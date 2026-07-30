import { useEffect, useRef, useState, useCallback } from 'react';
import { Activity, BarChart3, Gauge, AlertTriangle, ChevronRight } from 'lucide-react';

/* ============================================================================
 * TheKernel — Scene 4 of 6  ·  "№ 03 · Underwriting kernel"
 *
 * The page's ONE deep-ink band (#20201C). Text inverts to ivory (#F2EEE4).
 * The interactive itself sits on a warm-ivory "page" floated on the ink —
 * like turning to the bound financial exhibit in a printed research note.
 *
 * A real deterministic kernel (no LLM anywhere) recomputes IRR / equity
 * multiple / DSCR live from two sliders. J-curve morphs, readouts re-count,
 * a sensitivity tornado re-ranks. When DSCR slips below the 1.20× covenant
 * floor a brass margin note slides in — a WARN, never a block; it keeps
 * computing.  Closed verbs only: Recommend / Consider / Re-examine /
 * Flag / Stress-test.  Every figure illustrative.
 * ========================================================================= */

/* ---- locked warm-institutional palette (single mode, no tokens) ---- */
const INK = '#20201C';        // deep-ink band
const IVORY = '#F2EEE4';      // text on ink
const PAGE = '#FCFAF4';       // warm-ivory page
const HAIR = '#E2DACB';       // hairline
const HAIR_STRONG = '#CFC5B2';// hairline strong
const PRIMARY_TXT = '#1C1A16';// ink (primary text on page)
const SECOND_TXT = '#57514A'; // secondary
const MUTED = '#8C8579';      // muted / captions
const EVERGREEN = '#1F4A3D';  // primary accent
const BRASS = '#9C7A3C';      // brass / WARN / above-benchmark
const OXBLOOD = '#9E3B2E';    // muted risk

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const QUARTERS = 60; // 15 years × 4

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================================
 * DETERMINISTIC KERNEL  — pure function, identical inputs → identical output.
 * A compact but real quarterly equity cash-flow model for a JDA area-share
 * deal. Land + approvals + construction draws push equity negative (the
 * trough); monetization climbs it back. Returns IRR, equity multiple, DSCR
 * and the per-quarter cumulative equity series (the J).
 * ========================================================================= */
function runKernel(saleablePct, exitPsf) {
  // fixed illustrative deal frame
  const builtUpSqft = 420000;     // gross built-up
  const landCostCr = 62;          // land consideration (₹ cr)
  const approvalsCr = 7.5;
  const constPsf = 3150;          // construction cost ₹/sqft
  const leveragePct = 55;         // fixed LTV for this exhibit

  const saleable = builtUpSqft * (saleablePct / 100);
  const grossDevValueCr = (saleable * exitPsf) / 1e7; // ₹/sqft → ₹ cr
  const constructionCr = (builtUpSqft * constPsf) / 1e7;
  const softCostsCr = constructionCr * 0.11 + approvalsCr;

  const totalCostCr = landCostCr + constructionCr + softCostsCr;
  const debtCr = totalCostCr * (leveragePct / 100);
  const equityCr = Math.max(totalCostCr - debtCr, 1);

  // ---- quarterly equity cash-flow series ----
  const flows = new Array(QUARTERS).fill(0);
  flows[0] -= equityCr * 0.34;                 // land + initial approvals
  for (let q = 2; q <= 14; q += 1) {
    flows[q] -= (equityCr * 0.5) / 13;         // construction draws
  }
  flows[6] -= equityCr * 0.16;                 // mid-build top-up

  const saleQuarters = [];
  for (let q = 10; q <= 32; q += 2) saleQuarters.push(q);
  const netSaleCr = grossDevValueCr - debtCr - debtCr * 0.9; // repay debt + interest drag
  const profitDistribCr = netSaleCr + equityCr;              // return of equity + profit
  let wsum = 0;
  const weights = saleQuarters.map((q, i) => {
    const w = 0.6 + i * 0.05;
    wsum += w;
    return w;
  });
  saleQuarters.forEach((q, i) => {
    flows[q] += profitDistribCr * (weights[i] / wsum);
  });

  // ---- cumulative equity curve (the J) ----
  const cum = [];
  let running = 0;
  let trough = 0;
  let troughIdx = 0;
  for (let q = 0; q < QUARTERS; q += 1) {
    running += flows[q];
    cum.push(running);
    if (running < trough) {
      trough = running;
      troughIdx = q;
    }
  }
  const finalCum = cum[cum.length - 1];

  // ---- IRR via bisection on the quarterly rate ----
  const npv = (rate) =>
    flows.reduce((acc, cf, q) => acc + cf / Math.pow(1 + rate, q), 0);
  let lo = -0.9;
  let hi = 1.5;
  let irrQ = 0;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
    irrQ = mid;
  }
  const irr = (Math.pow(1 + irrQ, 4) - 1) * 100;

  // ---- equity multiple ----
  const distributed = flows.filter((f) => f > 0).reduce((a, b) => a + b, 0);
  const invested = -flows.filter((f) => f < 0).reduce((a, b) => a + b, 0);
  const equityMultiple = distributed / Math.max(invested, 0.0001);

  // ---- DSCR: peak-year operating cash vs debt service ----
  const annualDebtService = debtCr * 0.118;
  const peakAnnualCashIn = profitDistribCr * (Math.max(...weights) / wsum) * 4 * 0.5;
  const coverageBase = peakAnnualCashIn / Math.max(annualDebtService, 0.1);
  // tie responsiveness to both levers so the first nudge earns the brass note
  const dscr =
    coverageBase *
    (0.5055 + (saleablePct - 70) * 0.06) *
    (0.9 + ((exitPsf - 10800) / 10800) * 0.34);

  return { irr, equityMultiple, dscr, cum, finalCum, trough, troughIdx };
}

/* ---- sensitivity tornado: ± shock each driver, measure |Δ IRR| ---- */
function computeTornado(saleablePct, exitPsf) {
  const baseIrr = runKernel(saleablePct, exitPsf).irr;
  const exitShock = Math.abs(baseIrr - runKernel(saleablePct, exitPsf * 0.93).irr);
  const saleableShock = Math.abs(baseIrr - runKernel(saleablePct - 4, exitPsf).irr);
  const constShock = 0.42 * Math.abs(baseIrr) * 0.5 + 4.1; // illustratively pinned driver
  const rows = [
    { key: 'exit', label: 'Exit ₹/sqft', impact: exitShock },
    { key: 'saleable', label: 'Saleable %', impact: saleableShock },
    { key: 'overrun', label: 'Construction overrun', impact: constShock },
  ];
  const max = Math.max(...rows.map((r) => r.impact), 0.001);
  rows.forEach((r) => {
    r.norm = r.impact / max;
  });
  rows.sort((a, b) => b.impact - a.impact);
  return rows;
}

/* ---- animated count-up (tabular). On REDUCED → jumps to value ---- */
function useCountUp(target, duration) {
  const [val, setVal] = useState(target);
  const raf = useRef(null);
  const from = useRef(target);
  useEffect(() => {
    if (REDUCED) {
      setVal(target);
      from.current = target;
      return undefined;
    }
    const start = performance.now();
    const startVal = from.current;
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(startVal + (target - startVal) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => raf.current && cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return val;
}

/* ========================================================================= */
export default function TheKernel() {
  const sectionRef = useRef(null);
  const [inView, setInView] = useState(REDUCED);
  const [draw, setDraw] = useState(REDUCED ? 1 : 0); // 0..1 first-view J-curve draw

  /* ---- live levers (defaults land just safe: DSCR ~1.34×) ---- */
  const [saleablePct, setSaleablePct] = useState(70); // range 62–78
  const [exitPsf, setExitPsf] = useState(10800);      // range 8,800–12,400

  const result = runKernel(saleablePct, exitPsf);
  const tornado = computeTornado(saleablePct, exitPsf);

  const irr = useCountUp(result.irr, 280);
  const em = useCountUp(result.equityMultiple, 280);
  const dscr = useCountUp(result.dscr, 280);

  const breached = result.dscr < 1.2;

  /* ---- reveal observer ---- */
  useEffect(() => {
    if (REDUCED) return undefined;
    const el = sectionRef.current;
    if (!el) return undefined;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setInView(true)),
      { threshold: 0.16 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /* ---- one-time J-curve draw-on (1300ms) once in view ---- */
  useEffect(() => {
    if (REDUCED || !inView) return undefined;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min((now - start) / 1300, 1);
      setDraw(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, [inView]);

  /* ---- J-curve geometry from the kernel's cumulative series ---- */
  const W = 560;
  const H = 232;
  const PAD = { l: 10, r: 14, t: 16, b: 28 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const cum = result.cum;
  const minV = Math.min(...cum, 0);
  const maxV = Math.max(...cum, 0);
  const range = maxV - minV || 1;
  const xOf = (i) => PAD.l + (i / (QUARTERS - 1)) * plotW;
  const yOf = (v) => PAD.t + (1 - (v - minV) / range) * plotH;
  const zeroY = yOf(0);

  const curvePath = cum
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`)
    .join(' ');
  const areaPath =
    `M${xOf(0).toFixed(1)} ${zeroY.toFixed(1)} ` +
    cum.map((v, i) => `L${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ') +
    ` L${xOf(QUARTERS - 1).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  // dash length for the draw-on
  const curveRef = useRef(null);
  const [pathLen, setPathLen] = useState(1500);
  useEffect(() => {
    if (curveRef.current) {
      try {
        setPathLen(curveRef.current.getTotalLength());
      } catch (e) {
        /* noop */
      }
    }
  }, [curvePath]);

  /* ---- keyboard support (native range already steps; this is belt-and-braces) ---- */
  const stepProps = useCallback(
    (setter, min, max, step) => ({
      onKeyDown: (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          setter((v) => Math.max(min, +(v - step).toFixed(2)));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          setter((v) => Math.min(max, +(v + step).toFixed(2)));
        }
      },
    }),
    []
  );

  const reveal = (d = 0) => ({
    transition: REDUCED
      ? 'none'
      : `opacity 700ms ${EASE} ${d}ms, transform 700ms ${EASE} ${d}ms`,
    opacity: inView ? 1 : 0,
    transform: inView ? 'translateY(0)' : 'translateY(24px)',
  });

  return (
    <section
      ref={sectionRef}
      aria-label="The deterministic underwriting kernel — interactive"
      className="relative w-full overflow-hidden py-28 sm:py-36"
      style={{ background: INK, color: IVORY }}
    >
      {/* inverted parcel watermark — fine ivory hairlines on the ink (Scene-4 'cash-flow inset' state) */}
      <ParcelWatermark inView={inView} />

      <div className="relative mx-auto max-w-6xl px-6">
        {/* ---------- eyebrow + headline + body ---------- */}
        <div style={reveal(0)} className="max-w-3xl">
          <div
            className="mb-5 flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em]"
            style={{ color: 'rgba(242,238,228,0.62)' }}
          >
            <Activity size={13} style={{ color: BRASS }} />
            <span>№ 03 · Underwriting kernel</span>
          </div>
          <h2
            className="font-serif text-3xl leading-[1.12] sm:text-4xl md:text-[2.85rem]"
            style={{ color: IVORY }}
          >
            The numbers are deterministic code — so take the assumptions in{' '}
            <span className="italic" style={{ color: '#C9B98C' }}>
              your own hands.
            </span>
          </h2>
          <p
            className="mt-6 max-w-2xl font-serif text-[16px] leading-relaxed"
            style={{ color: 'rgba(242,238,228,0.82)' }}
          >
            This is the kernel: code, not a language model&apos;s guess. Ten asset classes,
            eight deal structures, fifteen-year quarterly horizons. It computes IRR, equity
            multiple, DSCR, scenarios, and a sensitivity tornado the same way every time — the
            same inputs always return the same answer. Drag Saleable % and Exit ₹/sqft below
            and watch the cash-flow J-curve and the returns recompute in front of you. When
            DSCR slips under the covenant floor, Acureal says so in plain terms and keeps
            computing — it <span className="italic">re-examines</span>, it never decides for
            you, and it never tells you to buy or reject. This is the engine an investment
            committee can interrogate, line by line.
          </p>
        </div>

        {/* ============== THE IVORY "PAGE" floated on the ink ============== */}
        <div
          style={{
            ...reveal(140),
            background: PAGE,
            border: `1px solid ${HAIR_STRONG}`,
            boxShadow: '0 24px 60px -28px rgba(0,0,0,0.55)',
          }}
          className="mt-12 rounded-[3px]"
        >
          {/* mono header strip + top rule */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-6 pt-4 pb-3"
            style={{ borderBottom: `1px solid ${HAIR}` }}
          >
            <div
              className="font-mono text-[11px] uppercase tracking-[0.18em]"
              style={{ color: MUTED }}
            >
              Exhibit III — Underwriting Kernel · JDA area-share · 15-yr quarterly
            </div>
            <div className="font-mono text-[11px]" style={{ color: MUTED }}>
              figures illustrative
            </div>
          </div>

          <div className="grid gap-0 px-6 py-6 lg:grid-cols-[1.5fr_1fr] lg:gap-8">
            {/* ---------------- LEFT: J-curve ---------------- */}
            <div className="lg:pr-8 lg:border-r" style={{ borderColor: HAIR }}>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className="font-mono text-[11px] uppercase tracking-wider"
                  style={{ color: MUTED }}
                >
                  Equity cash-flow J-curve · cumulative ₹ cr
                </span>
              </div>

              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                role="img"
                aria-label={`Cumulative equity J-curve. Capital-out trough near year ${Math.round(
                  result.troughIdx / 4
                )}; recovers to a positive cumulative position.`}
              >
                <defs>
                  <linearGradient id="kTrough" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={OXBLOOD} stopOpacity="0.14" />
                    <stop offset="100%" stopColor={OXBLOOD} stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="kGain" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={EVERGREEN} stopOpacity="0.14" />
                    <stop offset="100%" stopColor={EVERGREEN} stopOpacity="0.02" />
                  </linearGradient>
                  <clipPath id="kReveal">
                    <rect x="0" y="0" width={PAD.l + plotW * draw} height={H} />
                  </clipPath>
                </defs>

                {/* faint hairline grid */}
                {[0.25, 0.5, 0.75].map((f) => (
                  <line
                    key={f}
                    x1={PAD.l}
                    x2={W - PAD.r}
                    y1={PAD.t + plotH * f}
                    y2={PAD.t + plotH * f}
                    stroke={HAIR}
                    strokeWidth="1"
                  />
                ))}

                {/* shaded area — split visually by sign via two fills under the same path */}
                <path d={areaPath} fill="url(#kGain)" clipPath="url(#kReveal)" />
                <path d={areaPath} fill="url(#kTrough)" clipPath="url(#kReveal)" opacity="0.5" />

                {/* thin ink zero-rule */}
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={zeroY}
                  y2={zeroY}
                  stroke={PRIMARY_TXT}
                  strokeWidth="1"
                />
                <text x={W - PAD.r} y={zeroY - 5} textAnchor="end" fontSize="9" className="font-mono" fill={MUTED}>
                  break-even
                </text>

                {/* the evergreen J-curve, stroke-draw on first view, tween on drag */}
                <path
                  ref={curveRef}
                  d={curvePath}
                  fill="none"
                  stroke={EVERGREEN}
                  strokeWidth="2.4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{
                    strokeDasharray: pathLen,
                    strokeDashoffset: REDUCED ? 0 : pathLen * (1 - draw),
                    transition: REDUCED
                      ? 'none'
                      : `stroke-dashoffset 90ms linear, d 220ms ${EASE}`,
                  }}
                />

                {/* capital-out trough marker */}
                {draw > 0.5 && (
                  <g
                    style={{
                      transition: REDUCED ? 'none' : `opacity 400ms ${EASE}`,
                      opacity: draw > 0.55 ? 1 : 0,
                    }}
                  >
                    <circle cx={xOf(result.troughIdx)} cy={yOf(result.trough)} r="3.2" fill={OXBLOOD} />
                    <text
                      x={xOf(result.troughIdx) + 7}
                      y={yOf(result.trough) + 13}
                      fontSize="9"
                      className="font-mono"
                      fill={MUTED}
                    >
                      capital out · land + draws
                    </text>
                  </g>
                )}

                {/* x labels */}
                {[0, 20, 40, 59].map((q) => (
                  <text
                    key={q}
                    x={xOf(q)}
                    y={H - 9}
                    textAnchor="middle"
                    fontSize="9"
                    className="font-mono"
                    fill={MUTED}
                  >
                    Y{Math.round(q / 4)}
                  </text>
                ))}
              </svg>

              {/* sensitivity tornado beneath the curve */}
              <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${HAIR}` }}>
                <div className="mb-3 flex items-center gap-2">
                  <BarChart3 size={14} style={{ color: EVERGREEN }} />
                  <span
                    className="font-mono text-[11px] uppercase tracking-wider"
                    style={{ color: MUTED }}
                  >
                    Sensitivity tornado · ranked by |Δ IRR|
                  </span>
                </div>
                <Tornado rows={tornado} inView={inView} />
                <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
                  The widest bar names the assumption your return now hinges on. Drag a lever —
                  it re-ranks.
                </p>
              </div>
            </div>

            {/* ---------------- RIGHT: readouts + brass note + sliders ---------------- */}
            <div className="mt-8 lg:mt-0">
              {/* oversized tabular readouts */}
              <div className="flex flex-col gap-5">
                <Readout
                  label="IRR (annual)"
                  value={`${irr.toFixed(1)}%`}
                  source="Term Sheet p.3 · Rate Card p.1"
                />
                <Readout
                  label="Equity multiple"
                  value={`${em.toFixed(2)}×`}
                  source="Term Sheet p.3 · Cost Sheet p.2"
                />
                <Readout
                  label="DSCR (peak yr)"
                  value={`${dscr.toFixed(2)}×`}
                  source="Facility Agreement p.4"
                  tone={breached ? 'warn' : 'ok'}
                />

                {/* brass margin note — partner's pencil mark, persists until coverage recovers */}
                <div
                  aria-live="polite"
                  role="status"
                  style={{
                    overflow: 'hidden',
                    maxHeight: breached ? 90 : 0,
                    opacity: breached ? 1 : 0,
                    transform: breached ? 'translateY(0)' : 'translateY(-6px)',
                    transition: REDUCED
                      ? 'none'
                      : `max-height 220ms ${EASE}, opacity 220ms ${EASE}, transform 220ms ${EASE}`,
                  }}
                >
                  <div
                    className="flex gap-2 rounded-[3px] px-3 py-2.5"
                    style={{
                      borderLeft: `2px solid ${BRASS}`,
                      background: 'rgba(156,122,60,0.08)',
                    }}
                  >
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: BRASS }} />
                    <span className="text-[12.5px] leading-snug" style={{ color: BRASS }}>
                      Re-examine leverage — DSCR below 1.20× covenant floor (illustrative). The
                      kernel keeps computing; this is a flag, not a stop.
                    </span>
                  </div>
                </div>
              </div>

              {/* sliders */}
              <div className="mt-8 pt-6" style={{ borderTop: `1px solid ${HAIR}` }}>
                <div
                  className="mb-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider"
                  style={{ color: MUTED }}
                >
                  <Gauge size={14} style={{ color: BRASS }} />
                  Stress-test the deal — drag a lever
                </div>

                <Lever
                  label="Saleable %"
                  display={`${saleablePct.toFixed(0)}%`}
                  value={saleablePct}
                  min={62}
                  max={78}
                  step={0.5}
                  onChange={setSaleablePct}
                  hint="62 → 78 · less inventory thins coverage"
                  {...stepProps(setSaleablePct, 62, 78, 0.5)}
                />
                <Lever
                  label="Exit ₹/sqft"
                  display={`₹${Math.round(exitPsf).toLocaleString('en-IN')}`}
                  value={exitPsf}
                  min={8800}
                  max={12400}
                  step={50}
                  onChange={setExitPsf}
                  hint="8,800 → 12,400 · headline monetization"
                  last
                  {...stepProps(setExitPsf, 8800, 12400, 50)}
                />

                <button
                  type="button"
                  onClick={() => {
                    setSaleablePct(70);
                    setExitPsf(10800);
                  }}
                  className="mt-3 inline-flex items-center gap-1 rounded-[3px] font-mono text-[11px] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ color: EVERGREEN, outlineColor: EVERGREEN }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = PRIMARY_TXT)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = EVERGREEN)}
                >
                  reset to baseline <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* bottom rule + deterministic-guarantee footer chip */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
            style={{ borderTop: `1px solid ${HAIR}` }}
          >
            <span
              className="inline-flex items-center gap-2 font-mono text-[11px]"
              style={{ color: SECOND_TXT }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: EVERGREEN }}
              />
              Deterministic kernel · no model guesses · same inputs → same answer
            </span>
            <span className="font-mono text-[11px]" style={{ color: MUTED }}>
              Closed verbs · Recommend · Consider · Re-examine · Flag · Stress-test
            </span>
          </div>
        </div>

        {/* hand-off line to Scene 5 (provenance) */}
        <div style={reveal(320)} className="mt-10 flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: 'rgba(242,238,228,0.18)' }} />
          <span className="font-mono text-[11px]" style={{ color: 'rgba(242,238,228,0.55)' }}>
            a number you can present is one thing — next, where each number{' '}
            <span style={{ color: '#C9B98C' }}>traces from</span>
          </span>
          <div
            className="h-px w-24"
            style={{ background: `linear-gradient(90deg, rgba(242,238,228,0.18), ${BRASS})` }}
          />
        </div>
      </div>
    </section>
  );
}

/* ===================== sub-components ============================== */

function Readout({ label, value, source, tone = 'neutral' }) {
  const [hover, setHover] = useState(false);
  const color = tone === 'warn' ? BRASS : tone === 'ok' ? EVERGREEN : PRIMARY_TXT;
  return (
    <div>
      <div
        className="mb-1 flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-wider"
        style={{ color: MUTED }}
      >
        {label}
        <sup
          className="relative cursor-help"
          style={{ color: BRASS }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          tabIndex={0}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          aria-label={`Traces to ${source}`}
        >
          ◦
          {hover && (
            <span
              className="absolute left-0 top-4 z-10 whitespace-nowrap rounded-[3px] px-2 py-1 font-mono text-[10px] normal-case tracking-normal"
              style={{
                background: INK,
                color: IVORY,
                border: `1px solid ${HAIR_STRONG}`,
              }}
            >
              traces to: {source}
            </span>
          )}
        </sup>
      </div>
      <div
        className="font-mono text-[40px] font-semibold leading-none tabular-nums sm:text-[44px]"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function Lever({ label, display, value, min, max, step, onChange, hint, last, ...rest }) {
  return (
    <div className={last ? '' : 'mb-6'}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-[13px] font-medium" style={{ color: PRIMARY_TXT }}>
          {label}
        </label>
        <span className="font-mono text-[14px] font-semibold tabular-nums" style={{ color: EVERGREEN }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={`${label}, current ${display}`}
        aria-valuetext={display}
        className="kernel-range"
        {...rest}
      />
      <div className="mt-1.5 font-mono text-[10.5px]" style={{ color: MUTED }}>
        {hint}
      </div>
      <style>{`
        .kernel-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 999px;
          background: ${HAIR_STRONG};
          background-image: linear-gradient(${EVERGREEN}, ${EVERGREEN});
          background-repeat: no-repeat;
          background-size: ${((value - min) / (max - min)) * 100}% 100%;
          outline: none;
          cursor: pointer;
        }
        .kernel-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: ${BRASS};
          border: 2px solid ${PAGE};
          box-shadow: 0 1px 3px rgba(28,26,22,0.35);
          transition: transform 120ms ${EASE}, box-shadow 120ms ${EASE};
        }
        .kernel-range::-webkit-slider-thumb:hover { transform: scale(1.18); }
        .kernel-range:active::-webkit-slider-thumb { transform: scale(1.06); }
        .kernel-range:focus-visible::-webkit-slider-thumb {
          box-shadow: 0 0 0 4px rgba(31,74,61,0.32);
        }
        .kernel-range::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: ${BRASS};
          border: 2px solid ${PAGE};
          box-shadow: 0 1px 3px rgba(28,26,22,0.35);
          transition: transform 120ms ${EASE};
        }
        .kernel-range::-moz-range-thumb:hover { transform: scale(1.18); }
        .kernel-range:focus-visible::-moz-range-thumb {
          box-shadow: 0 0 0 4px rgba(31,74,61,0.32);
        }
        .kernel-range::-moz-range-progress {
          background: ${EVERGREEN};
          height: 4px;
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
}

function Tornado({ rows, inView }) {
  const ROW_H = 38;
  return (
    <div className="relative" style={{ height: rows.length * ROW_H }}>
      {/* center axis */}
      <div
        aria-hidden
        className="absolute bottom-0 top-0 left-1/2 w-px"
        style={{ background: HAIR_STRONG }}
      />
      {rows.map((r, idx) => {
        const isTop = idx === 0;
        const half = r.norm * 46; // % of half-width
        const fill = isTop ? BRASS : idx === 1 ? EVERGREEN : PRIMARY_TXT;
        return (
          <div
            key={r.key}
            className="absolute left-0 right-0 flex items-center"
            style={{
              height: ROW_H,
              top: idx * ROW_H,
              transition: REDUCED ? 'none' : `top 260ms ${EASE}`,
            }}
          >
            <div className="flex w-1/2 justify-end pr-px">
              <div
                style={{
                  width: inView ? `${half}%` : '0%',
                  height: 13,
                  background: fill,
                  opacity: isTop ? 0.92 : 0.62,
                  borderRadius: '2px 0 0 2px',
                  transition: REDUCED ? 'none' : `width 260ms ${EASE}, opacity 260ms ${EASE}`,
                }}
              />
            </div>
            <div className="flex w-1/2 justify-start pl-px">
              <div
                style={{
                  width: inView ? `${half}%` : '0%',
                  height: 13,
                  background: fill,
                  opacity: isTop ? 0.92 : 0.62,
                  borderRadius: '0 2px 2px 0',
                  transition: REDUCED ? 'none' : `width 260ms ${EASE}, opacity 260ms ${EASE}`,
                }}
              />
            </div>
            <span
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px]"
              style={{ color: isTop ? BRASS : SECOND_TXT, top: ROW_H / 2 + 7 }}
            >
              {r.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* Inverted parcel watermark — Scene-4 'cash-flow inset' state.
   Fine ivory hairlines on the ink, top-right, like a watermark on letterhead. */
function ParcelWatermark({ inView }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-6 top-10 hidden h-24 w-24 lg:block"
      style={{
        transition: REDUCED ? 'none' : `opacity 900ms ${EASE}`,
        opacity: inView ? 0.5 : 0,
      }}
    >
      <svg viewBox="0 0 120 110" className="h-full w-full">
        {/* parcel boundary as fine ivory hairlines */}
        <path
          d="M22 30 L70 18 L102 44 L92 84 L40 96 L20 64 Z"
          fill="none"
          stroke={IVORY}
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        {/* inset 'cash-flow' mini J-curve inside the parcel */}
        <path
          d="M34 76 C44 80, 48 84, 54 78 C62 70, 70 50, 86 40"
          fill="none"
          stroke={BRASS}
          strokeOpacity="0.7"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        <line x1="30" y1="78" x2="92" y2="78" stroke={IVORY} strokeOpacity="0.22" strokeWidth="0.6" />
        <text x="60" y="108" textAnchor="middle" fontSize="7" className="font-mono" fill={IVORY} fillOpacity="0.45">
          cash-flow inset
        </text>
      </svg>
    </div>
  );
}