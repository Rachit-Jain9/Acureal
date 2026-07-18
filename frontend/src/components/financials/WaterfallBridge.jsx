import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * WaterfallBridge — the signature institutional profit-distribution "bridge".
 *
 * A hand-built CSS + inline-SVG floating-bar waterfall. It renders a NORMALIZED
 * `segments` prop and computes ONLY pixel/percent geometry — never a financial
 * value (per CLAUDE.md: the UI never re-derives kernel math). It is deliberately
 * dependency-free: both JV/JDA panels are statically imported and render on the
 * pre-DCF input view, so pulling in the lazy recharts chunk here would drag it
 * onto first paint of every financials page. Inline SVG/CSS also reads more
 * craft-forward.
 *
 * segments: [{
 *   label,                     // x-axis label
 *   amountCr,                  // magnitude of this step (>= 0)
 *   parts: [{ tone, cr }],     // internal vertical split (tones below)
 *   note?,                     // hover title
 *   soft?,                     // returned-capital style (lighter fill)
 *   isTotal?,                  // full-height closing bar drawn from the baseline
 * }]
 *
 * A single rAF drives `p` 0→1 for the draw-in: bars rise from their cumulative
 * baseline left-to-right and their value labels count up. It re-runs only when
 * the segment STRUCTURE changes (a tranche appears/disappears) — a live value
 * tweak just updates heights. `prefers-reduced-motion` snaps to the final state.
 */

const TONE_VAR = {
  landowner: 'var(--color-brand-accent)',
  developer: 'var(--color-data-highlight)',
  cost: 'var(--color-content-muted)',
  capital: 'var(--color-brand-accent-soft)',
};
const TONE_LABEL = {
  landowner: 'Landowner',
  developer: 'Developer',
  cost: 'Costs',
  capital: 'Returned capital',
};

const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

export default function WaterfallBridge({ segments = [], fmtCr = (v) => `₹${(v || 0).toFixed(2)} Cr`, className = '' }) {
  const reduced = useReducedMotion();
  const [p, setP] = useState(reduced ? 1 : 0);
  const rafRef = useRef(null);

  // Structural signature: re-run the draw-in only when the shape changes.
  const structureKey = segments.map((s) => `${s.label}:${s.parts.map((pt) => pt.tone).join('-')}`).join('|');

  useEffect(() => {
    if (reduced) { setP(1); return undefined; }
    setP(0);
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const prog = Math.min(1, (now - start) / dur);
      setP(prog);
      if (prog < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [structureKey, reduced]);

  const { laid, max } = useMemo(() => {
    let cum = 0;
    const l = segments.map((s) => {
      const amount = Math.max(0, Number(s.amountCr) || 0);
      if (s.isTotal) return { ...s, amount, base: 0, top: amount };
      const base = cum;
      cum += amount;
      return { ...s, amount, base, top: cum };
    });
    const m = Math.max(cum, ...l.filter((s) => s.isTotal).map((s) => s.top), 1e-6);
    return { laid: l, max: m };
  }, [segments]);

  const n = laid.length;

  // Per-bar staggered local progress: left-to-right sweep.
  const spread = 0.55;
  const growWin = 1 - spread;
  const lpFor = (i) => {
    const t0 = n > 1 ? (i / (n - 1)) * spread : 0;
    const raw = growWin > 0 ? (p - t0) / growWin : (p >= t0 ? 1 : 0);
    return easeOut(clamp01(raw));
  };

  const tonesPresent = useMemo(
    () => [...new Set(laid.flatMap((s) => s.parts.map((pt) => pt.tone)))],
    [laid],
  );

  if (n === 0 || max <= 1e-6) return null;

  // SVG connector geometry (viewBox 0..100 × 0..100, y down). Columns are
  // equal-width, so a bar's centre is deterministic and lines up with the
  // CSS flex columns beneath.
  const halfVb = (0.52 / n) * 50; // half bar-width in viewBox units
  const cx = (i) => ((i + 0.5) / n) * 100;
  const yTop = (val) => 100 - (val / max) * 100;
  const connectors = [];
  for (let i = 0; i < n - 1; i += 1) {
    if (laid[i].isTotal || laid[i + 1].isTotal) continue;
    connectors.push({ x1: cx(i) + halfVb, x2: cx(i + 1) - halfVb, y: yTop(laid[i].top), i });
  }

  return (
    <div className={className}>
      {/* Chart track */}
      <div className="relative" style={{ height: 208 }}>
        {/* faint top rule (max) + baseline */}
        <div className="absolute inset-x-0 top-0 border-t border-dashed border-hairline" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 border-t border-hairline-strong" aria-hidden="true" />

        {/* bars */}
        <div className="absolute inset-0 flex items-end">
          {laid.map((s, i) => {
            const lp = lpFor(i);
            const baseFrac = s.base / max;
            const amtFrac = s.amount / max;
            const animH = amtFrac * lp;
            const topFrac = baseFrac + animH;
            const title = `${s.label} — ${fmtCr(s.amount)}${s.note ? ` · ${s.note}` : ''}`;
            return (
              <div key={`${s.label}-${i}`} className="relative flex-1 h-full">
                {/* value label, riding just above the (animated) bar top */}
                <div
                  className="absolute left-0 right-0 flex justify-center pointer-events-none"
                  style={{ bottom: `${topFrac * 100}%`, opacity: clamp01((lp - 0.45) * 2.5) }}
                >
                  <span className="mb-1 text-[10px] font-semibold tabular-nums text-content-primary whitespace-nowrap">
                    {fmtCr(s.amount * lp)}
                  </span>
                </div>

                {/* the floating bar */}
                <div
                  title={title}
                  className={[
                    'absolute left-1/2 -translate-x-1/2 rounded-t-[3px] overflow-hidden flex flex-col',
                    s.isTotal ? 'ring-1 ring-inset ring-hairline-strong' : '',
                    s.soft ? 'opacity-80' : '',
                  ].join(' ')}
                  style={{ bottom: `${baseFrac * 100}%`, height: `${animH * 100}%`, width: '52%' }}
                >
                  {s.parts.map((pt, j) => (
                    <div
                      key={pt.tone + j}
                      style={{ flex: Math.max(0.0001, Number(pt.cr) || 0), backgroundColor: TONE_VAR[pt.tone] || 'var(--color-content-muted)' }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* connector step lines (drawn over the bars) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {connectors.map((c) => (
            <line
              key={`c-${c.i}`}
              x1={c.x1}
              y1={c.y}
              x2={c.x2}
              y2={c.y}
              stroke="var(--color-content-muted)"
              strokeWidth="1"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              style={{ opacity: clamp01((lpFor(c.i) - 0.6) * 2.5) }}
            />
          ))}
        </svg>
      </div>

      {/* x-axis labels, aligned to the columns */}
      <div className="flex mt-2">
        {laid.map((s, i) => (
          <div key={`x-${s.label}-${i}`} className="flex-1 min-w-0 px-1 text-center">
            <div className="text-[10px] leading-tight text-content-secondary truncate" title={s.label}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* legend */}
      {tonesPresent.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-3 flex-wrap">
          {tonesPresent.map((tone) => (
            <span key={tone} className="inline-flex items-center gap-1.5 text-[11px] text-content-muted">
              <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: TONE_VAR[tone] }} aria-hidden="true" />
              {TONE_LABEL[tone] || tone}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Normalizers — map each kernel result shape into the shared segments prop.
// These compute NO financial values; they only re-key the numbers the kernel
// already returned into { label, amountCr, parts } for the geometry layer.

/**
 * JV: a cumulative tranche cascade. Return-of-Capital is the soft base; each
 * profit tranche stacks on top; a closing "Total Distributed" bar ties out.
 */
export function jvSegments(result) {
  if (!result || !Array.isArray(result.waterfall)) return [];
  const shortLabel = (tranche) => {
    if (/Return of Capital/i.test(tranche)) return 'Return of Capital';
    if (/Preferred Return/i.test(tranche)) return 'Preferred';
    if (/Catch-Up/i.test(tranche)) return 'GP Catch-Up';
    if (/Promote/i.test(tranche)) return 'Promote';
    if (/Residual/i.test(tranche)) return 'Residual';
    return tranche;
  };
  const segs = result.waterfall.map((row) => ({
    label: shortLabel(row.tranche),
    amountCr: Number(row.totalCr) || 0,
    note: row.note,
    soft: row.fromProfit === false,
    parts: [
      { tone: row.fromProfit === false ? 'capital' : 'landowner', cr: Number(row.landownerCr) || 0 },
      { tone: 'developer', cr: Number(row.developerCr) || 0 },
    ].filter((pt) => pt.cr > 0),
  }));
  const s = result.summary || {};
  const total = (Number(s.landownerTotal) || 0) + (Number(s.developerTotal) || 0);
  if (total > 0) {
    segs.push({
      label: 'Total',
      amountCr: total,
      isTotal: true,
      note: 'Total distribution',
      parts: [
        { tone: 'landowner', cr: Number(s.landownerTotal) || 0 },
        { tone: 'developer', cr: Number(s.developerTotal) || 0 },
      ].filter((pt) => pt.cr > 0),
    });
  }
  return segs;
}

/**
 * JDA: a revenue split — where the project's revenue goes. Landowner allocation
 * + developer costs + developer profit build up to a closing "Total Revenue".
 */
export function jdaSegments(result) {
  if (!result || !result.summary) return [];
  const s = result.summary;
  const landowner = Number(s.landownerNetCr) || 0;
  const cost = Number(s.devCostCr) || 0;
  const devProfit = Number(s.developerNetCr) || 0;
  // The additive "where the revenue goes" story only holds when the developer
  // clears their costs. A loss-making deal (devProfit < 0) is shown in the
  // detail table (red), not the bridge — so the bars always tie out to revenue.
  if (devProfit < 0) return [];
  const revenue = Number(s.totalRevenueCr) || (landowner + cost + devProfit);
  const segs = [];
  if (landowner > 0) segs.push({ label: 'Landowner', amountCr: landowner, note: 'Land-share allocation', parts: [{ tone: 'landowner', cr: landowner }] });
  if (cost > 0) segs.push({ label: 'Dev costs', amountCr: cost, note: 'Construction + statutory + finance', parts: [{ tone: 'cost', cr: cost }] });
  if (devProfit > 0) segs.push({ label: 'Dev profit', amountCr: devProfit, note: 'Developer net, after all costs', parts: [{ tone: 'developer', cr: devProfit }] });
  if (revenue > 0 && segs.length > 0) {
    segs.push({
      label: 'Total revenue',
      amountCr: revenue,
      isTotal: true,
      note: 'Total project revenue',
      parts: [
        { tone: 'landowner', cr: landowner },
        { tone: 'cost', cr: cost },
        { tone: 'developer', cr: devProfit },
      ].filter((pt) => pt.cr > 0),
    });
  }
  return segs;
}
