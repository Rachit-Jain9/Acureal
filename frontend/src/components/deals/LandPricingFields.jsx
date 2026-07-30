import AmountReadout from '../common/AmountReadout';
import { handleNumericPaste } from '../common/numericPaste';
import { buildLandPricingPreview } from '../../utils/landPricing';

/**
 * Land Pricing fieldset — the single source of truth for quoting land cost
 * (total ₹ Cr, ₹/sqft, or ₹/acre) with a normalized live preview.
 *
 * Shared by the New Deal modal (DealsPage) and the Edit deal modal
 * (DealDetailPage) so create and edit can never drift: the backend
 * (utils/landPricing.calculateLandPricing) recomputes land_ask_price_cr from
 * basis + rate + extent whenever the basis is rate-based, so an edit surface
 * without these fields would silently discard the operator's number.
 *
 * Controlled: `values` carries the five land-pricing form fields,
 * `onFieldChange(name, value)` reports edits. The preview is derived — no
 * internal state.
 */
export default function LandPricingFields({
  values,
  onFieldChange,
  fallbackAreaSqft = null,
  hasLinkedProperty = false,
}) {
  const preview = buildLandPricingPreview({
    pricingBasis: values.landPricingBasis,
    totalPriceCr: values.landAskPriceCr,
    rateInr: values.landPriceRateInr,
    extentValue: values.landExtentInputValue,
    extentUnit: values.landExtentInputUnit,
    fallbackAreaSqft,
  });

  const change = (name) => (e) => onFieldChange(name, e.target.value);

  return (
    <div className="rounded-xl border border-hairline-strong bg-bg-secondary p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-content-primary">Land Pricing</h4>
          <p className="text-xs text-content-secondary">Quote land cost in crore, per acre, or per sqft. Acureal will normalize the total.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-content-secondary mb-1">Pricing Basis</label>
          <select
            name="landPricingBasis"
            aria-label="Land pricing basis"
            value={values.landPricingBasis}
            onChange={change('landPricingBasis')}
            className="input w-full"
          >
            <option value="total_cr">Total in Cr</option>
            <option value="per_sqft">INR / sqft</option>
            <option value="per_acre">INR / acre</option>
          </select>
        </div>

        {values.landPricingBasis === 'total_cr' ? (
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">Total Land Price (Cr)</label>
            <input
              type="number"
              name="landAskPriceCr"
              aria-label="Total land price in crore"
              value={values.landAskPriceCr}
              onChange={change('landAskPriceCr')}
              onPaste={(e) => handleNumericPaste(e, 'rupeeCrore', (v) => onFieldChange('landAskPriceCr', v))}
              step="0.01"
              min="0"
              placeholder="e.g. 25.50"
              className="input w-full"
            />
            <AmountReadout value={values.landAskPriceCr} kind="rupeeCrore" />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-content-secondary mb-1">
              {values.landPricingBasis === 'per_acre' ? 'Land Rate (INR / acre)' : 'Land Rate (INR / sqft)'}
            </label>
            <input
              type="number"
              name="landPriceRateInr"
              aria-label="Land rate"
              value={values.landPriceRateInr}
              onChange={change('landPriceRateInr')}
              onPaste={(e) => handleNumericPaste(e, 'rupeePlain', (v) => onFieldChange('landPriceRateInr', v))}
              step="0.01"
              min="0"
              placeholder={values.landPricingBasis === 'per_acre' ? 'e.g. 250000000' : 'e.g. 12000'}
              className="input w-full"
            />
            <AmountReadout
              value={values.landPriceRateInr}
              kind="rupeePlain"
              unitSuffix={values.landPricingBasis === 'per_acre' ? '/acre' : '/sqft'}
            />
          </div>
        )}

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-content-secondary mb-1">Land Extent for Pricing</label>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <input
              type="number"
              name="landExtentInputValue"
              aria-label="Land extent for pricing"
              value={values.landExtentInputValue}
              onChange={change('landExtentInputValue')}
              onPaste={(e) => handleNumericPaste(e, 'count', (v) => onFieldChange('landExtentInputValue', v))}
              step="0.01"
              min="0"
              placeholder={fallbackAreaSqft ? 'Optional override. Blank uses linked property area.' : 'Enter the deal land extent'}
              className="input w-full"
            />
            <select
              name="landExtentInputUnit"
              aria-label="Land extent unit"
              value={values.landExtentInputUnit}
              onChange={change('landExtentInputUnit')}
              className="input w-full"
            >
              <option value="sqft">sq ft</option>
              <option value="acre">acre</option>
            </select>
          </div>
          <AmountReadout
            value={values.landExtentInputValue}
            kind="count"
            unitSuffix={values.landExtentInputUnit === 'acre' ? 'acre' : 'sqft'}
          />
          <p className="mt-2 text-xs text-content-secondary">
            {fallbackAreaSqft
              ? `Linked property fallback area: ${Number(fallbackAreaSqft).toLocaleString('en-IN')} sqft`
              : hasLinkedProperty
                ? 'The linked property has no recorded land area yet — enter the extent here so total pricing can be calculated.'
                : 'If no linked property exists yet, enter the sourcing extent here so total pricing can still be calculated.'}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg bg-bg-elevated px-3 py-2">
          <p className="text-xs text-content-secondary">Normalized area</p>
          <p className="text-sm font-semibold text-content-primary">
            {preview.areaSqft ? `${preview.areaSqft.toLocaleString('en-IN')} sqft` : '-'}
          </p>
        </div>
        <div className="rounded-lg bg-bg-elevated px-3 py-2">
          <p className="text-xs text-content-secondary">Equivalent acres</p>
          <p className="text-sm font-semibold text-content-primary">
            {preview.areaAcres ? preview.areaAcres.toFixed(4) : '-'}
          </p>
        </div>
        {/* The "answer" tile. bg-accent-soft + content tokens stay readable in
            BOTH themes — the previous bg-bg-primary + text-white pairing was
            white-on-white in light mode and looked permanently empty. */}
        <div className="rounded-lg bg-accent-soft px-3 py-2">
          <p className="text-xs text-content-secondary">Computed total land price</p>
          <p className="text-sm font-semibold text-content-primary">
            {preview.totalPriceCr != null ? `${preview.totalPriceCr.toFixed(2)} Cr` : '-'}
          </p>
        </div>
      </div>
    </div>
  );
}
