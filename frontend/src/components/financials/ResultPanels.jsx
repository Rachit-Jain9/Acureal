// KPI tile grid + three breakdown panels (area, cost, revenue/P&L).
// All are pure display: no internal state, no side effects.

import { TrendingUp, DollarSign, IndianRupee, Percent } from 'lucide-react';
import KPIStatCard from './KPIStatCard';
import { Card } from '../../design-system';
import { INCOME_CLASSES, HOSPITALITY_CLASSES, getModelAssetClass } from './fieldDefs';
import { formatCrores, formatPct, formatINR, formatArea } from '../../utils/format';

export function KPICards({ kpis, assetClass, inputs }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);
  const commonProps = { assetClass, inputs };

  if (isHospitality) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard kpiKey="revPAR"    {...commonProps} title="RevPAR"         value={kpis.revPAR != null ? formatINR(kpis.revPAR, 0) : '-'} subtitle="₹/key/night (stabilized)"    icon={IndianRupee} />
        <KPIStatCard kpiKey="noi"       {...commonProps} title="Stabilized NOI" value={formatCrores(kpis.noi)}                                subtitle="All keys · ₹ Cr / year"       icon={TrendingUp} />
        <KPIStatCard kpiKey="irr"       {...commonProps} title="IRR"            value={formatPct(kpis.irr)}                                  subtitle="Unlevered, through exit"      icon={Percent} />
        <KPIStatCard kpiKey="exitValue" {...commonProps} title="Exit Value"     value={formatCrores(kpis.exitValue)}                         subtitle="NOI / exit cap rate"          icon={DollarSign} />
      </div>
    );
  }

  if (isIncome) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIStatCard kpiKey="noi"          {...commonProps} title="Stabilized NOI" value={formatCrores(kpis.noi)}                                                      subtitle="Net Operating Income / yr" icon={IndianRupee} />
        <KPIStatCard kpiKey="yieldOnCost"  {...commonProps} title="Yield on Cost"  value={kpis.yieldOnCost != null ? `${kpis.yieldOnCost.toFixed(2)}%` : '-'}           subtitle="NOI / Total Dev. Cost"     icon={Percent} />
        <KPIStatCard kpiKey="irr"          {...commonProps} title="IRR"            value={formatPct(kpis.irr)}                                                         subtitle="Unlevered, through exit"   icon={TrendingUp} />
        <KPIStatCard kpiKey="exitValue"    {...commonProps} title="Exit Value"     value={formatCrores(kpis.exitValue)}                                                subtitle="At exit cap rate"          icon={DollarSign} />
      </div>
    );
  }

  const hasDscr = kpis.dscr != null;
  return (
    <div className={`grid grid-cols-2 ${hasDscr ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
      <KPIStatCard kpiKey="irr"            {...commonProps} title="IRR"             value={formatPct(kpis.irr)}                                                subtitle="Internal Rate of Return"     icon={TrendingUp} />
      <KPIStatCard kpiKey="npv"            {...commonProps} title="NPV"             value={formatCrores(kpis.npv)}                                             subtitle="Net Present Value"           icon={IndianRupee} />
      <KPIStatCard kpiKey="equityMultiple" {...commonProps} title="Equity Multiple" value={kpis.equityMultiple != null ? `${kpis.equityMultiple.toFixed(2)}x` : '-'} subtitle="Return on equity invested" icon={DollarSign} />
      <KPIStatCard kpiKey="rlv"            {...commonProps} title="RLV"             value={formatCrores(kpis.rlv)}                                             subtitle="Residual Land Value"         icon={Percent} />
      {hasDscr && (
        <KPIStatCard kpiKey="dscr"         {...commonProps} title="DSCR"            value={`${kpis.dscr.toFixed(2)}x`}                                         subtitle="Revenue / total debt service" icon={Percent} />
      )}
    </div>
  );
}

export function AreaBreakdown({ areas, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const rows = [];
  if (modelAssetClass === 'plotted_development') {
    rows.push({ label: 'Total Land Area', value: formatArea(areas.grossBuiltUp) });
    rows.push({ label: 'Saleable Land', value: formatArea(areas.saleable) });
    if (areas.totalPlots) rows.push({ label: 'Total Plots', value: areas.totalPlots.toLocaleString('en-IN') });
    if (areas.avgPlotSizeSqft) rows.push({ label: 'Avg Plot Size', value: formatArea(areas.avgPlotSizeSqft) });
  } else if (HOSPITALITY_CLASSES.has(modelAssetClass)) {
    if (areas.keys) rows.push({ label: 'Keys (rooms)', value: areas.keys.toLocaleString('en-IN') });
    if (areas.grossBuiltUp) rows.push({ label: 'Est. GFA (incl. common areas)', value: formatArea(areas.grossBuiltUp) });
  } else if (INCOME_CLASSES.has(modelAssetClass)) {
    rows.push({ label: 'Leasable Area', value: formatArea(areas.leasable) });
    rows.push({ label: 'Gross Built-Up (est.)', value: formatArea(areas.grossBuiltUp) });
  } else {
    rows.push({ label: 'Gross Built-Up Area', value: formatArea(areas.grossBuiltUp) });
    rows.push({ label: 'Saleable Area', value: formatArea(areas.saleable) });
    rows.push({ label: 'Carpet Area', value: formatArea(areas.carpet) });
    rows.push({ label: 'Super Built-Up Area', value: formatArea(areas.superBuiltUp) });
    if (areas.numberOfUnits) {
      rows.push({
        label: 'Number of Units',
        value: `${areas.numberOfUnits.toLocaleString('en-IN')}${areas.residentialAvgUnitSize ? ` @ ${formatArea(areas.residentialAvgUnitSize)}` : ''}`,
      });
    }
  }
  return (
    <Card elevated className="p-5">
      <h3 className="text-sm font-semibold text-content-primary mb-3">Area Breakdown</h3>
      <div className="space-y-2">
        {rows.filter((r) => r.value && r.value !== '-').map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-content-muted">{row.label}</span>
            <span className="font-medium text-content-primary">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CostBreakdown({ costs, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const rows = [
    { label: 'Land Cost',              value: costs.land },
    { label: modelAssetClass === 'plotted_development' ? 'Development Cost' : 'Construction Cost', value: costs.construction },
    { label: 'GST',                    value: costs.gst },
    { label: 'Contingency',            value: costs.contingency },
    { label: 'Stamp Duty',             value: costs.stampDuty },
    { label: 'Approval Cost',          value: costs.approval },
    { label: 'Architecture Fees',      value: costs.architecture },
    { label: 'PMC Fees',               value: costs.pmc },
    { label: 'Pre-Opening Costs',      value: costs.preOpening },
    { label: 'Marketing Cost',         value: costs.marketing },
    { label: 'Finance Cost',           value: costs.finance },
    { label: 'Tenant Improvements',    value: costs.tenantImprovements },
    { label: 'Leasing Commissions',    value: costs.leasingCommissions },
  ].filter((r) => r.value != null && r.value > 0);

  return (
    <Card elevated className="p-5">
      <h3 className="text-sm font-semibold text-content-primary mb-3">Cost Breakdown</h3>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-content-muted">{row.label}</span>
            <span className="font-medium text-content-primary">{formatCrores(row.value)}</span>
          </div>
        ))}
        <div className="border-t border-hairline pt-2 flex justify-between text-sm font-semibold">
          <span className="text-content-secondary">Total Cost</span>
          <span className="text-content-primary">{formatCrores(costs.total)}</span>
        </div>
      </div>
    </Card>
  );
}

export function RevenuePanel({ revenue, kpis, assetClass }) {
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);

  let rows, panelTitle;
  if (isHospitality) {
    panelTitle = 'Hotel P&L (Stabilized Year)';
    rows = [
      { label: 'Rooms Revenue',   value: formatCrores(revenue.roomsRevenue) },
      { label: 'F&B Revenue',     value: formatCrores(revenue.fbRevenue) },
      { label: 'Total Revenue',   value: formatCrores(revenue.totalRevenue) },
      { label: 'GOP',             value: formatCrores(revenue.gop) },
      { label: 'EBITDA',          value: formatCrores(revenue.ebitda) },
      ...(kpis.dscr != null ? [{ label: 'DSCR', value: `${kpis.dscr.toFixed(2)}x` }] : []),
    ];
  } else if (isIncome) {
    panelTitle = 'Operating Summary';
    rows = [
      { label: 'Annual NOI (Stabilized)', value: formatCrores(revenue.annualNOI) },
      { label: 'Entry Value',              value: formatCrores(kpis.entryValue) },
      { label: 'Exit Value',               value: formatCrores(kpis.exitValue) },
      ...(kpis.dscr != null ? [{ label: 'DSCR', value: `${kpis.dscr.toFixed(2)}x` }] : []),
    ];
  } else {
    panelTitle = 'Revenue & Profit';
    rows = [
      { label: 'Revenue',  value: formatCrores(revenue.totalRevenue) },
      { label: 'Profit',   value: formatCrores(revenue.profit) },
      { label: 'Margin',   value: formatPct(revenue.margin) },
      ...(kpis.dscr != null ? [{ label: 'DSCR', value: `${kpis.dscr.toFixed(2)}x` }] : []),
    ];
  }

  return (
    <Card elevated className="p-5">
      <h3 className="text-sm font-semibold text-content-primary mb-3">
        {panelTitle}
      </h3>
      <div className="space-y-2">
        {rows.filter((r) => r.value && r.value !== '-').map((row) => (
          <div key={row.label} className="flex justify-between text-sm">
            <span className="text-content-muted">{row.label}</span>
            <span className="font-medium text-content-primary">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
