import clsx from 'clsx';
import useCountUp from '../../hooks/useCountUp';
import useReducedMotion from '../../hooks/useReducedMotion';
import { formatCrores, formatPct } from '../../utils/format';

/**
 * DashboardHero — the cinematic "spotlight" band at the top of the dashboard.
 *
 * A deliberate, bolder treatment (the operator asked for a more cinematic feel,
 * overriding the flat-editorial default for this hero): a deep surface with an
 * amber→accent edge and a soft glow, the pipeline value as a hero number that
 * counts up, and a row of KPI tiles that rise in on first paint, each with a
 * coloured signal stripe.
 *
 * Always dark — it reads as a focal spotlight on both themes (text is light
 * because the surface is always dark). All motion collapses under
 * `prefers-reduced-motion`. Numbers are honest: a missing IRR shows "—" with a
 * neutral tone, never a confident 0 (CLAUDE.md data-honesty rule).
 */

const ACCENT_EDGE = 'linear-gradient(90deg, #F5B800 0%, #3B82F6 55%, transparent 100%)';
const GLOW = 'radial-gradient(circle, rgba(245,184,0,0.9) 0%, transparent 70%)';
const intIN = (n) => Math.round(n).toLocaleString('en-IN');

function HeroKpi({ label, value, format, footnote, stripe, valueClass, delay }) {
  const reduced = useReducedMotion();
  const finite = Number.isFinite(value);
  const animated = useCountUp(finite ? value : 0);
  const display = finite ? format(animated) : '—';
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3.5"
      style={reduced ? undefined : { animation: 'fadeInUp 460ms cubic-bezier(0.16,1,0.3,1) both', animationDelay: `${delay}ms` }}
    >
      <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-full" style={{ background: stripe }} aria-hidden="true" />
      <div className="pl-2.5">
        <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-white/45">{label}</div>
        <div className={clsx('mt-1.5 font-display text-2xl font-semibold tabular-nums tracking-tight', valueClass || 'text-white')}>
          {display}
        </div>
        <div className="mt-1 text-[11px] text-white/40">{footnote}</div>
      </div>
    </div>
  );
}

export default function DashboardHero({ stats = {} }) {
  const reduced = useReducedMotion();
  const pipeline = Number(stats.total_pipeline_value_cr) || 0;
  const active = Number(stats.active_deals_count) || 0;
  const icReady = Number(stats.ic_ready_count) || 0;
  const openRisks = Number(stats.deals_with_open_risks) || 0;
  const irr = stats.avg_irr_pct;
  const irrFinite = Number.isFinite(irr);
  const pipelineAnimated = useCountUp(pipeline);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0c0f16] px-6 py-6 shadow-xl"
      style={reduced ? undefined : { animation: 'fadeInUp 500ms cubic-bezier(0.16,1,0.3,1) both' }}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: ACCENT_EDGE }} />
      <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-[0.08]" style={{ background: GLOW }} />

      <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Pipeline · live
          </div>
          <div className="mt-2.5 font-display text-[2.5rem] font-semibold leading-none tracking-tight text-white tabular-nums sm:text-[2.75rem]">
            {formatCrores(reduced ? pipeline : pipelineAnimated)}
          </div>
          <div className="mt-2.5 text-sm text-white/55">
            Cumulative ask across{' '}
            <span className="font-medium text-white/85 tabular-nums">{active}</span>
            {' '}active deal{active === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HeroKpi
          label="Active deals"
          value={active}
          format={intIN}
          footnote="Live in pipeline"
          stripe="#3B82F6"
          delay={60}
        />
        <HeroKpi
          label="Avg IRR"
          value={irrFinite ? irr : NaN}
          format={formatPct}
          footnote={irrFinite ? (irr >= 12 ? 'At or above bench' : 'Below benchmark') : 'No modelled IRR yet'}
          stripe={irrFinite ? (irr >= 12 ? '#22C55E' : '#EF4444') : '#3F3F46'}
          valueClass={irrFinite ? (irr >= 12 ? 'text-emerald-300' : 'text-rose-300') : 'text-white'}
          delay={120}
        />
        <HeroKpi
          label="Open high risks"
          value={openRisks}
          format={intIN}
          footnote="Across portfolio"
          stripe="#F5B800"
          delay={180}
        />
        <HeroKpi
          label="Investor-grade"
          value={icReady}
          format={intIN}
          footnote="IC-ready · vetted"
          stripe="#3F3F46"
          delay={240}
        />
      </div>
    </div>
  );
}
