// Debt schedule panel — construction S-curve (residential/plotted) and/or
// backend-computed amortizing schedule (income assets / hospitality).
// Maths in `src/utils/waterfall.js#buildDebtSchedule` and the kernel
// post-process (`packages/financial-kernel/src/postprocess/debtSchedule.ts`).

import { useMemo, useState } from 'react';
import { Layers, ChevronRight } from 'lucide-react';
import { buildDebtSchedule } from '../../utils/waterfall';

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
    <div className="bg-white rounded-xl shadow-sm border border-hairline-strong">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-primary-600" />
          <span className="text-sm font-semibold text-content-primary">Debt Schedule</span>
          {schedule && (
            <span className="text-xs text-content-secondary">
              ₹{schedule.totalDebtCr.toFixed(2)} Cr @ {schedule.debtRatePct}% pa
            </span>
          )}
          {hasAmortizing && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5">
              Amortizing — {amortizingSchedule.termLoan?.amortizationYears || amortizingSchedule.lrd?.amortizationYears}yr
            </span>
          )}
          {debtLTV > 0 && (
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-2 py-0.5">
              {(debtLTV * 100).toFixed(0)}% LTV
            </span>
          )}
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
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-100">
                    <p className="text-xs font-semibold text-emerald-700 mb-2">Term Loan</p>
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
                  <div className="bg-sky-50 rounded-lg p-4 border border-sky-100">
                    <p className="text-xs font-semibold text-sky-700 mb-2">LRD Refinance</p>
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
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-500 mb-0.5">Total Debt Drawn</p>
                <p className="text-base font-bold text-amber-800">₹{schedule.totalDebtCr.toFixed(2)} Cr</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-500 mb-0.5">Interest Cost</p>
                <p className="text-base font-bold text-amber-800">₹{schedule.totalInterestCr.toFixed(2)} Cr</p>
              </div>
              <div className="bg-bg-secondary rounded-lg p-3">
                <p className="text-xs text-content-muted mb-0.5">Interest Rate</p>
                <p className="text-base font-bold text-content-primary">{schedule.debtRatePct}% pa</p>
              </div>
              <div className="bg-bg-secondary rounded-lg p-3">
                <p className="text-xs text-content-muted mb-0.5">Total Debt Service</p>
                <p className="text-base font-bold text-content-primary">
                  ₹{(schedule.totalDebtCr + schedule.totalInterestCr).toFixed(2)} Cr
                </p>
              </div>
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
                        <td className="px-3 py-2 text-right text-green-600">
                          {row.draw > 0 ? `+${fmtCr(row.draw)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-red-600">
                          {row.repayment < 0 ? fmtCr(Math.abs(row.repayment)) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-content-primary">{fmtCr(row.closingBalance)}</td>
                        <td className="px-3 py-2 text-right text-amber-600">{fmtCr(row.interest)}</td>
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
                  className="text-xs text-primary-600 hover:underline"
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
