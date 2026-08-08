import { Grid3X3 } from 'lucide-react';
import { Card } from '../../design-system';
import { INCOME_CLASSES, HOSPITALITY_CLASSES, getModelAssetClass } from './fieldDefs';
import { formatINR } from '../../utils/format';

function getIRRColor(irr) {
  if (irr == null) return 'bg-bg-secondary text-content-muted';
  if (irr >= 25)  return 'bg-pos-soft text-data-positive';
  if (irr >= 18)  return 'bg-pos-soft text-data-positive';
  if (irr >= 12)  return 'bg-premium-soft text-premium';
  if (irr >= 5)   return 'bg-premium-soft text-premium';
  return 'bg-neg-soft text-data-negative';
}

export default function SensitivityTable({ sensitivity, assetClass, headlineIrr = null }) {
  if (!sensitivity?.grid?.length) return null;
  const { sellingRates, constructionCosts, grid, axis } = sensitivity;
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome      = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);
  const rowLabel  = axis?.[0] || (isIncome ? 'Exit Cap Rate (%)' : 'Constr. Cost/sqft');
  const colHeader = axis?.[1] || (isIncome ? 'Base Rent/sqft/mo' : 'Selling Rate/sqft');

  // The kernel centres every grid on the deal — `irrGrid[mid][mid]` is
  // the same IRR as the KPI tile above, by construction and by test.
  // Marking it turns the table from five arbitrary scenarios into a
  // reading of how far the deal sits from trouble in each direction.
  const baseRow = Math.floor(grid.length / 2);
  const baseCol = Math.floor((grid[baseRow]?.length || 0) / 2);
  const baseIrr = grid[baseRow]?.[baseCol] ?? null;

  // A matrix saved before income and hospitality moved onto the kernel
  // will still show its old, rosier centre. Rather than mark a cell that
  // contradicts the KPI above it, say so and point at the fix — the same
  // pattern the legacy loading-factor banner uses on this page. Clears
  // itself the moment the deal is recalculated.
  const stale =
    headlineIrr != null && baseIrr != null && Math.abs(baseIrr - headlineIrr) > 0.05;

  return (
    <Card elevated className="p-6">
      <h3 className="text-sm font-semibold text-content-primary mb-1 flex items-center gap-2">
        <Grid3X3 size={16} className="text-accent" />
        Sensitivity Analysis — IRR (%)
      </h3>
      <p className="text-xs text-content-muted mb-3">
        Rows: {rowLabel} | Columns: {colHeader}
        {!stale && ' · the outlined cell is this deal as underwritten'}
      </p>
      {stale && (
        <p className="text-xs text-data-negative bg-neg-soft border border-hairline rounded px-3 py-2 mb-3">
          This grid was saved under an earlier model and its centre reads{' '}
          {baseIrr.toFixed(1)}% against a headline IRR of {headlineIrr.toFixed(1)}%. Click
          Calculate to rebuild it — every cell will then run the same model as the KPIs above.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-content-muted border-b border-hairline whitespace-nowrap">↓ {rowLabel.split(' ')[0]} \ {colHeader.split(' ')[0]} →</th>
              {sellingRates.map((r, ci) => (
                <th key={r} className={`px-2 py-1.5 text-center font-medium border-b border-hairline whitespace-nowrap ${
                  ci === baseCol ? 'text-content-primary' : 'text-content-muted'
                }`}>
                  {isHospitality ? formatINR(r, 0) : isIncome ? r : formatINR(r, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {constructionCosts.map((cost, ri) => (
              <tr key={cost}>
                <td className={`px-2 py-1.5 font-medium border-b border-hairline whitespace-nowrap ${
                  ri === baseRow ? 'text-content-primary' : 'text-content-secondary'
                }`}>
                  {isHospitality ? `${cost}%` : isIncome ? `${cost}%` : formatINR(cost, 0)}
                </td>
                {grid[ri]?.map((irr, ci) => {
                  const isBase = !stale && ri === baseRow && ci === baseCol;
                  return (
                    <td
                      key={ci}
                      title={isBase ? 'This deal as underwritten — matches the headline IRR' : undefined}
                      className={`px-2 py-1.5 text-center font-medium border-b border-hairline ${getIRRColor(irr)} ${
                        isBase ? 'relative outline outline-1 -outline-offset-1 outline-accent font-semibold' : ''
                      }`}
                    >
                      {irr != null ? `${irr.toFixed(1)}%` : '-'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
