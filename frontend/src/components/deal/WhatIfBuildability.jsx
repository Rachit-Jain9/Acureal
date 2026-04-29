import { useMemo, useState } from 'react';
import { Sliders, RotateCcw, Info } from 'lucide-react';
import { Card } from '../../design-system';
import {
  selectFarRule,
  computeBuildabilityFromRule,
  SQFT_PER_SQM,
} from '../../utils/parcelBuildability';

const formatInt = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Math.round(Number(n)).toLocaleString('en-IN');
};

const formatFar = (n) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
};

const formatDelta = (whatIf, actual) => {
  if (
    whatIf === null || whatIf === undefined ||
    actual === null || actual === undefined ||
    !Number.isFinite(Number(whatIf)) || !Number.isFinite(Number(actual))
  ) return null;
  const diff = Number(whatIf) - Number(actual);
  if (Math.abs(diff) < 0.001) return null;
  return diff;
};

function DeltaBadge({ delta, suffix = '' }) {
  if (delta === null) return null;
  const positive = delta > 0;
  return (
    <span
      className={
        positive
          ? 'ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums bg-success-50 text-success-700'
          : 'ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums bg-danger-50 text-danger-700'
      }
    >
      {positive ? '+' : ''}{typeof delta === 'number' && Math.abs(delta) < 10 ? delta.toFixed(2) : formatInt(delta)}{suffix}
    </span>
  );
}

export default function WhatIfBuildability({ intelligence }) {
  const buildability = intelligence?.buildability;
  const candidates = buildability?.far_rules_candidates || [];
  const inputs = intelligence?.inputs || {};
  const zone = intelligence?.zoning;
  const landUseFamily = zone?.land_use_family || 'residential';

  const actualLandArea = Number(inputs.land_area_sqft) || null;
  const actualRoadWidth = Number(inputs.road_width_mtrs) || null;

  const [landArea, setLandArea] = useState(actualLandArea || 5000);
  const [roadWidth, setRoadWidth] = useState(actualRoadWidth || 12);

  const whatIf = useMemo(() => {
    const { rule } = selectFarRule(candidates, {
      landAreaSqft: landArea,
      roadWidthMtrs: roadWidth,
      landUseFamily,
    });
    if (!rule) {
      return { rule: null, values: null, status: 'no_match' };
    }
    const property = {
      land_area_sqft: landArea,
      road_width_mtrs: roadWidth,
      frontage_mtrs: inputs.frontage_mtrs ?? null,
      depth_mtrs: inputs.depth_mtrs ?? null,
    };
    const result = computeBuildabilityFromRule({ property, zone, rule });
    return { rule, values: result.values, status: result.status };
  }, [candidates, landArea, roadWidth, landUseFamily, zone, inputs.frontage_mtrs, inputs.depth_mtrs]);

  // Coverage bands: when no rule matches, show analyst what *is* covered so
  // they understand the gap rather than seeing an opaque "no match" message.
  // Aggregates min/max plot-area and road-width across all candidates filtered
  // to the current land-use family.
  const coverageBands = useMemo(() => {
    const matching = candidates.filter(
      (rule) => !landUseFamily || String(rule.land_use_family || '').toLowerCase() === landUseFamily.toLowerCase()
    );
    if (!matching.length) return null;

    const plotMins = matching.map((r) => Number(r.plot_area_min_sqm) || 0);
    const plotMaxes = matching
      .map((r) => (r.plot_area_max_sqm == null ? Number.POSITIVE_INFINITY : Number(r.plot_area_max_sqm)))
      .filter((v) => Number.isFinite(v));
    const roadMins = matching.map((r) => Number(r.road_width_min_m) || 0);
    const roadMaxes = matching
      .map((r) => (r.road_width_max_m == null ? Number.POSITIVE_INFINITY : Number(r.road_width_max_m)))
      .filter((v) => Number.isFinite(v));

    const plotMinSqft = Math.min(...plotMins) * SQFT_PER_SQM;
    const plotMaxSqft = plotMaxes.length ? Math.max(...plotMaxes) * SQFT_PER_SQM : Number.POSITIVE_INFINITY;
    const roadMin = Math.min(...roadMins);
    const roadMax = roadMaxes.length ? Math.max(...roadMaxes) : Number.POSITIVE_INFINITY;

    const landAreaSqm = landArea / SQFT_PER_SQM;
    const reasonsOutOfBand = [];
    if (landAreaSqm < Math.min(...plotMins)) reasonsOutOfBand.push('plot-area below smallest band');
    if (plotMaxes.length && landAreaSqm > Math.max(...plotMaxes)) reasonsOutOfBand.push('plot-area above largest band');
    if (roadWidth < Math.min(...roadMins)) reasonsOutOfBand.push('road-width below smallest band');
    if (roadMaxes.length && roadWidth > Math.max(...roadMaxes)) reasonsOutOfBand.push('road-width above largest band');

    return {
      plot_min_sqft: Math.round(plotMinSqft),
      plot_max_sqft: Number.isFinite(plotMaxSqft) ? Math.round(plotMaxSqft) : null,
      road_min_m: roadMin,
      road_max_m: Number.isFinite(roadMax) ? roadMax : null,
      rule_count: matching.length,
      land_use_family: landUseFamily,
      reasons: reasonsOutOfBand,
    };
  }, [candidates, landUseFamily, landArea, roadWidth]);

  const reset = () => {
    setLandArea(actualLandArea || 5000);
    setRoadWidth(actualRoadWidth || 12);
  };

  const isDirty =
    Math.abs(landArea - (actualLandArea || 5000)) > 0.5 ||
    Math.abs(roadWidth - (actualRoadWidth || 12)) > 0.05;

  // Don't show the panel if the backend didn't ship candidates (older snapshots
  // pre-T1) or there's no zone match to anchor the math.
  if (!candidates.length) return null;

  const actualValues = buildability?.values || {};
  const w = whatIf.values || {};

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-content-primary">
            <Sliders size={15} />
            What-if buildability
          </div>
          <p className="mt-1 text-xs text-content-secondary leading-relaxed">
            Move the sliders to see how road width and land area would shift FAR selection and buildable area. Pure-JS recompute against the same {candidates.length} reviewed FAR rule{candidates.length === 1 ? '' : 's'} the panel uses — no server roundtrip, no fabricated values.
          </p>
        </div>
        {isDirty && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-editorial border border-hairline bg-bg-secondary px-2.5 py-1.5 text-[11px] font-semibold text-content-secondary hover:border-primary-300 hover:text-content-primary transition-colors"
          >
            <RotateCcw size={11} />
            Reset to actual
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-[11px] uppercase tracking-[0.12em] text-content-muted font-semibold">
              Road width
            </label>
            <span className="text-sm font-semibold text-content-primary tabular-nums">
              {roadWidth.toFixed(1)} m
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={30}
            step={0.5}
            value={roadWidth}
            onChange={(e) => setRoadWidth(Number(e.target.value))}
            className="w-full accent-primary-600"
            aria-label="Road width in metres"
          />
          <div className="flex justify-between mt-1 text-[10px] text-content-muted tabular-nums">
            <span>5 m</span>
            {actualRoadWidth ? (
              <span>actual {actualRoadWidth.toFixed(1)} m</span>
            ) : (
              <span className="italic">no actual</span>
            )}
            <span>30 m</span>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className="text-[11px] uppercase tracking-[0.12em] text-content-muted font-semibold">
              Land area
            </label>
            <span className="text-sm font-semibold text-content-primary tabular-nums">
              {formatInt(landArea)} sqft
            </span>
          </div>
          <input
            type="range"
            min={500}
            max={50000}
            step={100}
            value={landArea}
            onChange={(e) => setLandArea(Number(e.target.value))}
            className="w-full accent-primary-600"
            aria-label="Land area in square feet"
          />
          <div className="flex justify-between mt-1 text-[10px] text-content-muted tabular-nums">
            <span>500</span>
            {actualLandArea ? (
              <span>actual {formatInt(actualLandArea)}</span>
            ) : (
              <span className="italic">no actual</span>
            )}
            <span>50,000</span>
          </div>
        </div>
      </div>

      <div className="border-t border-hairline-soft pt-4">
        {whatIf.rule ? (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">Max FAR</div>
              <div className="mt-1 text-2xl font-serif tabular-nums text-content-primary">
                {formatFar(w.max_far)}
                <DeltaBadge delta={formatDelta(w.max_far, actualValues.max_far)} />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">Buildable area</div>
              <div className="mt-1 text-2xl font-serif tabular-nums text-content-primary">
                {formatInt(w.max_buildable_area_sqft)}
                <span className="ml-1 text-xs text-content-muted">sqft</span>
                <DeltaBadge delta={formatDelta(w.max_buildable_area_sqft, actualValues.max_buildable_area_sqft)} suffix=" sqft" />
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-content-muted font-semibold">Ground coverage</div>
              <div className="mt-1 text-2xl font-serif tabular-nums text-content-primary">
                {w.ground_coverage_pct ?? '—'}
                {w.ground_coverage_pct ? <span className="ml-1 text-xs text-content-muted">%</span> : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-editorial border border-hairline bg-bg-secondary px-4 py-3 text-xs text-content-secondary">
            <div className="flex items-start gap-2">
              <Info size={12} className="mt-0.5 shrink-0 text-content-muted" />
              <div className="min-w-0">
                <div className="font-semibold text-content-primary mb-1">
                  No reviewed {coverageBands?.land_use_family || ''} FAR rule matches this combination
                </div>
                {coverageBands ? (
                  <>
                    <div className="leading-relaxed">
                      Available rules ({coverageBands.rule_count}) cover{' '}
                      <span className="font-medium text-content-primary tabular-nums">
                        {coverageBands.plot_min_sqft.toLocaleString('en-IN')}
                        {coverageBands.plot_max_sqft
                          ? `–${coverageBands.plot_max_sqft.toLocaleString('en-IN')}`
                          : '+'} sqft
                      </span>{' '}
                      plots on{' '}
                      <span className="font-medium text-content-primary tabular-nums">
                        {coverageBands.road_min_m}
                        {coverageBands.road_max_m
                          ? `–${coverageBands.road_max_m}`
                          : '+'} m
                      </span>{' '}
                      roads.
                    </div>
                    {coverageBands.reasons.length > 0 && (
                      <div className="mt-1 leading-relaxed text-content-muted">
                        Your input is outside: {coverageBands.reasons.join(' · ')}.
                      </div>
                    )}
                    <div className="mt-1.5 leading-relaxed text-content-muted">
                      Move sliders into the covered band, or upload an FAR rule for this band in the master-plan admin.
                    </div>
                  </>
                ) : (
                  <div className="leading-relaxed">
                    No FAR rules are available for the assigned land-use family. Upload an FAR rule covering this band before relying on what-if buildability.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {whatIf.rule && (
          <div className="mt-3 text-[11px] text-content-muted">
            Selected rule: <span className="font-mono tabular-nums">{whatIf.rule.zone_code || '—'}</span>
            {whatIf.rule.source_section ? ` · ${whatIf.rule.source_section}` : ''}
            {whatIf.rule.source_page ? ` · p.${whatIf.rule.source_page}` : ''}
          </div>
        )}
      </div>
    </Card>
  );
}
