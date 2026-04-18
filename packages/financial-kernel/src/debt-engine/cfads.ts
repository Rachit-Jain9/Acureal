/**
 * CFADS (Cash Flow Available for Debt Service) calculator.
 *   CFADS_m = revenue - opex - taxes - maintenanceCapex - ΔworkingCapital
 */

import { Decimal } from '../decimal';
import { prov } from '../provenance';
import type { ProvenanceEntry } from '../types';
import type { CFADSInputs, CFADSOutputs } from './types';
import { zeros } from './math';

export function computeCFADS(inputs: CFADSInputs): CFADSOutputs {
  const n = Math.max(
    inputs.revenue.length,
    inputs.opex.length,
    inputs.taxes.length,
    inputs.maintenanceCapex.length,
    inputs.workingCapital?.length ?? 0,
  );

  const monthly: Decimal[] = zeros(n);
  for (let i = 0; i < n; i++) {
    const rev = at(inputs.revenue, i);
    const opex = at(inputs.opex, i);
    const taxes = at(inputs.taxes, i);
    const mcx = at(inputs.maintenanceCapex, i);
    const wc = at(inputs.workingCapital ?? [], i);
    monthly[i] = rev.sub(opex).sub(taxes).sub(mcx).sub(wc);
  }

  // Annual buckets (12-month aggregation from month 0).
  const years = Math.ceil(n / 12);
  const annualBuckets: Decimal[] = new Array(years);
  for (let y = 0; y < years; y++) {
    let acc = Decimal.zero();
    for (let k = 0; k < 12; k++) {
      const idx = y * 12 + k;
      if (idx < n) acc = acc.add(monthly[idx]);
    }
    annualBuckets[y] = acc;
  }

  // Rolling 12m series — null until first 12 months complete.
  const rolling12m: (Decimal | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i < 11) {
      rolling12m[i] = null;
      continue;
    }
    let acc = Decimal.zero();
    for (let k = 0; k < 12; k++) acc = acc.add(monthly[i - k]);
    rolling12m[i] = acc;
  }

  const provenance: ProvenanceEntry[] = [
    prov('debt.cfads.monthly', 'kernel.debtEngine.cfads', 'revenue - opex - taxes - maintCapex - ΔWC'),
  ];

  return { monthly, annualBuckets, rolling12m, provenance };
}

function at(series: readonly Decimal[], i: number): Decimal {
  return i >= 0 && i < series.length ? series[i] : Decimal.zero();
}
