import { Grid3X3 } from 'lucide-react';
import { Card } from '../../design-system';
import { INCOME_CLASSES, HOSPITALITY_CLASSES, getModelAssetClass } from './fieldDefs';
import { formatINR } from '../../utils/format';

function getIRRColor(irr) {
  if (irr == null) return 'bg-gray-50 text-gray-400';
  if (irr >= 25)  return 'bg-emerald-100 text-emerald-800';
  if (irr >= 18)  return 'bg-green-50 text-green-700';
  if (irr >= 12)  return 'bg-yellow-50 text-yellow-700';
  if (irr >= 5)   return 'bg-orange-50 text-orange-700';
  return 'bg-red-100 text-red-800';
}

export default function SensitivityTable({ sensitivity, assetClass }) {
  if (!sensitivity?.grid?.length) return null;
  const { sellingRates, constructionCosts, grid, axis } = sensitivity;
  const modelAssetClass = getModelAssetClass(assetClass);
  const isIncome      = INCOME_CLASSES.has(modelAssetClass);
  const isHospitality = HOSPITALITY_CLASSES.has(modelAssetClass);
  const rowLabel  = axis?.[0] || (isIncome ? 'Exit Cap Rate (%)' : 'Constr. Cost/sqft');
  const colHeader = axis?.[1] || (isIncome ? 'Base Rent/sqft/mo' : 'Selling Rate/sqft');

  return (
    <Card elevated className="p-6">
      <h3 className="text-sm font-semibold text-content-primary mb-1 flex items-center gap-2">
        <Grid3X3 size={16} className="text-accent" />
        Sensitivity Analysis — IRR (%)
      </h3>
      <p className="text-xs text-content-muted mb-3">Rows: {rowLabel} | Columns: {colHeader}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-content-muted border-b border-hairline whitespace-nowrap">↓ {rowLabel.split(' ')[0]} \ {colHeader.split(' ')[0]} →</th>
              {sellingRates.map((r) => (
                <th key={r} className="px-2 py-1.5 text-center font-medium text-content-muted border-b border-hairline whitespace-nowrap">
                  {isHospitality ? formatINR(r, 0) : isIncome ? r : formatINR(r, 0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {constructionCosts.map((cost, ri) => (
              <tr key={cost}>
                <td className="px-2 py-1.5 font-medium text-content-secondary border-b border-hairline whitespace-nowrap">
                  {isHospitality ? `${cost}%` : isIncome ? `${cost}%` : formatINR(cost, 0)}
                </td>
                {grid[ri]?.map((irr, ci) => (
                  <td key={ci} className={`px-2 py-1.5 text-center font-medium border-b border-hairline ${getIRRColor(irr)}`}>
                    {irr != null ? `${irr.toFixed(1)}%` : '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
