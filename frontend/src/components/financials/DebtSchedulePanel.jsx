// Debt schedule panel — construction S-curve (residential/plotted) and/or
// backend-computed amortizing schedule (income assets / hospitality).
// Maths in `src/utils/waterfall.js#buildDebtSchedule` and the kernel
// post-process (`packages/financial-kernel/src/postprocess/debtSchedule.ts`).

import { useMemo, useState } from 'react';
import { Layers, ChevronRight } from 'lucide-react';
import { buildDebtSchedule } from '../../utils/waterfall';
import Badge from '../common/Badge';
import { StatTile } from '../../design-system';

export default function DebtSchedulePanel({ financials: rawFinancials }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const capitalStack = rawFinancials?.capital_stack || rawFinancials?.model_params?.capitalStack;
  const inputs = rawFinancials?.model_params?.inputs || {};

  const debtLTV = capitalStack?.debtLTV ?? inputs.debtLTV ?? 0;
  const debtRatePct = capitalStack?.debtRatePct ?? inputs.debtRatePct ?? 0;
  const debtDrawnCr = capitalStack?.debtCr ?? 0;
  const projectDurationMonths =
    (inputs.projectDurationYears != null ? Number(inputs.projectDurationYears) * 12 : null)
    ?? inputs.projectDurationMonths
    ?? rawFinancials?.project_duration_months
    ?? 36;
  const constructionStartMonths =
    (inputs.constructionStartMonths != null && inputs.constructionStartMonths !== '' ? Number(inputs.constructionStartMonths) : null)
    ?? (inputs.constructionStartYears != null ? Number(inputs.constructionStartYears) * 12 : null)
    ?? 0;
  const constructionEndMonths =
    (inputs.constructionEndMonths != null && inputs.constructionEndMonths !== '' ? Number(inputs.constructionEndMonths) : null)
    ?? (inputs.constructionEndYears != null ? Number(inputs.constructionEndYears) * 12 : null)
    ?? projectDurationMonths * 0.85;

  const debtTenorYearsRaw = capitalStack?.debtTenorYears ?? inputs.debtTenorYears;
  const debtTenorMonths = debtTenorYearsRaw != null && debtTenorYearsRaw !== ''
    ? Number(debtTenorYearsRaw) * 12
    : null;

  const schedule = useMemo(() => {
    if (!(debtDrawnCr > 0) || !(debtRatePct > 0)) return null;
    return buildDebtSchedule({
      debtDrawnCr,
      debtRatePct,
      projectDurationMonths,
      constructionStartMonths,
      constructionEndMonths,
      debtTenorMonths,
    });
  }, [debtDrawnCr, debtRatePct, projectDurationMonths, constructionStartMonths, constructionEndMonths, debtTenorMonths]);

  const amortizingSchedule = capitalStack?.debtSchedule;

  if (!capitalStack || (!schedule && !amortizingSchedule?.termLoan && !amortizingSchedule?.lrd)) {
    return null;
  }

  const rows = schedule ? (showAll ? schedule.rows : schedule.rows.slice(0, 10)) : [];
  const fmtCr = (v) => (v != null && v !== 0 ? `₹${v.toFixed(2)} Cr` : '—');
  const hasAmortizing = !!(amortizingSchedule?.termLoan || amortizingSchedule?.lrd);

  return (
    <div className="bg-bg-elevated rounded-xl shadow-sm border border-hairline-strong">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-accent" />
          <span className="text-sm font-semibold text-content-primary">Debt Schedule</span>
          {schedule && (
            <span className="text-xs text-content-secondary">
              ₹{schedule.totalDebtCr.toFixed(2)} Cr @ {schedule.debtRatePct}% pa
            </span>
          )}
          {hasAmortizing && (
            <Badge tone="success">
              Amortizing — {amortizingSchedule.termLoan?.amortizationYears || amortizingSchedule.lrd?.amortizationYears}yr
            </Badge>
          )}
          {debtLTV > 0 && <Badge tone="warn">{(debtLTV * 100).toFixed(0)}% LTV</Badge>}
        </div>
        <ChevronRight
          size={16}
          className={`text-content-muted transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {open && (
        <div className="border-t border-hairline p-5 space-y-4">
          {hasAmortizing && (
            <div>
              <h4 className="text-xs font-semibold text-content-secondary uppercase tracking-wider mb-2">
                Operating-Phase Amortizing Debt
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {amortizingSchedule.termLoan && (
                  <div className="bg-pos-soft rounded-lg p-4 border border-hairline">
                    <p className="text-xs font-semibold text-data-positive mb-2">Term Loan</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-content-secondary">Principal</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.termLoan.principalCr)}</dd>
                      <dt className="text-content-secondary">Rate / Amort</dt>
                      <dd className="text-right text-content-primary font-medium">
                        {amortizingSchedule.termLoan.annualRatePct}% / {amortizingSchedule.termLoan.amortizationYears}yr
                      </dd>
                      <dt className="text-content-secondary">Quarterly P&amp;I</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.termLoan.quarterlyPaymentCr)}</dd>
                      <dt className="text-content-secondary">Annual Debt Service</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.termLoan.annualDebtServiceCr)}</dd>
                      <dt className="text-content-secondary">Total Interest</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.termLoan.totalInterestCr)}</dd>
                      <dt className="text-content-secondary">Balloon at Exit</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.termLoan.balloonRepaymentCr)}</dd>
                    </dl>
                  </div>
                )}
                {amortizingSchedule.lrd && (
                  <div className="bg-accent-soft rounded-lg p-4 border border-hairline">
                    <p className="text-xs font-semibold text-accent mb-2">LRD Refinance</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <dt className="text-content-secondary">Principal</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.lrd.principalCr)}</dd>
                      <dt className="text-content-secondary">Rate / Amort</dt>
                      <dd className="text-right text-content-primary font-medium">
                        {amortizingSchedule.lrd.annualRatePct}% / {amortizingSchedule.lrd.amortizationYears}yr
                      </dd>
                      <dt className="text-content-secondary">Quarterly P&amp;I</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.lrd.quarterlyPaymentCr)}</dd>
                      <dt className="text-content-secondary">Annual Debt Service</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.lrd.annualDebtServiceCr)}</dd>
                      <dt className="text-content-secondary">Refinance Quarter</dt>
                      <dd className="text-right text-content-primary font-medium">Q{amortizingSchedule.lrd.refinanceQuarter}</dd>
                      <dt className="text-content-secondary">Balloon at Exit</dt>
                      <dd className="text-right text-content-primary font-medium">{fmtCr(amortizingSchedule.lrd.balloonRepaymentCr)}</dd>
                    </dl>
                  </div>
                )}
              </div>
              <p className="text-xs text-content-muted mt-2">
                Quarterly P&amp;I based on standard CRE annuity amortization; remaining balance paid as balloon at exit.
              </p>
            </div>
          )}

          {schedule && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile label="Total Debt Drawn" value={`₹${schedule.totalDebtCr.toFixed(2)} Cr`} />
              <StatTile label="Interest Cost" value={`₹${schedule.totalInterestCr.toFixed(2)} Cr`} />
              <StatTile label="Interest Rate" value={`${schedule.debtRatePct}% pa`} />
              <StatTile
                label="Total Debt Service"
                value={`₹${(schedule.totalDebtCr + schedule.totalInterestCr).toFixed(2)} Cr`}
              />
            </div>
          )}

          {schedule && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-bg-secondary">
                      <th className="text-left px-3 py-2 font-medium text-content-secondary border-b">Quarter</th>
                      <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Opening Balance</th>
                      <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Draw</th>
                      <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Repayment</th>
                      <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Closing Balance</th>
                      <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Interest</th>
                      <th className="text-right px-3 py-2 font-medium text-content-secondary border-b">Cum. Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.quarter} className="border-b last:border-0 hover:bg-bg-secondary transition-colors">
                        <td className="px-3 py-2 text-content-secondary">Q{row.quarter}</td>
                        <td className="px-3 py-2 text-right text-content-secondary">{fmtCr(row.openingBalance)}</td>
                        <td className="px-3 py-2 text-right text-data-positive">
                          {row.draw > 0 ? `+${fmtCr(row.draw)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-data-negative">
                          {row.repayment < 0 ? fmtCr(Math.abs(row.repayment)) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-content-primary">{fmtCr(row.closingBalance)}</td>
                        <td className="px-3 py-2 text-right text-premium">{fmtCr(row.interest)}</td>
                        <td className="px-3 py-2 text-right text-content-secondary">{fmtCr(row.cumulativeInterest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {schedule.rows.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="text-xs text-accent hover:underline"
                >
                  {showAll ? 'Show less' : `Show all ${schedule.rows.length} quarters`}
                </button>
              )}

              <p className="text-xs text-content-muted">
                Draw schedule follows construction S-curve. Repayment is a balloon at project completion
                (typical India construction finance). Interest accrues quarterly on outstanding balance.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
