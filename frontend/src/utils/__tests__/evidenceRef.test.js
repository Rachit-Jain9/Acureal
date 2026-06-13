import { describe, it, expect } from 'vitest';
import { parseEvidenceRef, isNavigableRef, __INTERNAL } from '../evidenceRef';

describe('parseEvidenceRef — exact mappings', () => {
  it('maps kernel refs to the financial tab', () => {
    expect(parseEvidenceRef('kernel:irr')).toEqual({ tab: 'financial', scrollTo: 'kpi-irr' });
    expect(parseEvidenceRef('kernel:landCr')).toEqual({ tab: 'financial', scrollTo: 'cost-land' });
    expect(parseEvidenceRef('kernel:dscrMonthly')).toEqual({ tab: 'financial', scrollTo: 'dscr-monthly' });
  });

  it('maps comps refs to the comps tab', () => {
    expect(parseEvidenceRef('comps:median')).toEqual({ tab: 'comps', scrollTo: 'comps-median' });
    expect(parseEvidenceRef('comps:absorption_median')).toEqual({ tab: 'comps', scrollTo: 'comps-absorption' });
  });

  it('maps deal-level inputs to overview tab', () => {
    expect(parseEvidenceRef('deal:sales_price_per_sqft')).toEqual({ tab: 'overview', scrollTo: 'deal-sales-price' });
    expect(parseEvidenceRef('deal:saleable_sqft')).toEqual({ tab: 'overview', scrollTo: 'deal-saleable' });
  });

  it('maps the assumed land rate to the land cost on the financial tab', () => {
    expect(parseEvidenceRef('deal:land_price_rate')).toEqual({ tab: 'financial', scrollTo: 'cost-land' });
  });

  it('maps approvals + DD refs to the DD tab', () => {
    expect(parseEvidenceRef('approvals:list')).toEqual({ tab: 'dd', scrollTo: 'approvals-list' });
    expect(parseEvidenceRef('dd:overdue')).toEqual({ tab: 'dd', scrollTo: 'dd-overdue' });
    expect(parseEvidenceRef('dd:deal_breakers')).toEqual({ tab: 'dd', scrollTo: 'dd-deal-breakers' });
  });

  it('maps risk + promoter refs to the risk tab', () => {
    expect(parseEvidenceRef('risk:flags')).toEqual({ tab: 'risk', scrollTo: 'risk-flags' });
    expect(parseEvidenceRef('promoter:profile')).toEqual({ tab: 'risk', scrollTo: 'promoter-profile' });
  });
});

describe('parseEvidenceRef — prefix fallbacks (dynamic ids)', () => {
  it('maps approval:<uuid> to DD tab via prefix fallback', () => {
    expect(parseEvidenceRef('approval:abc-123-def')).toEqual({ tab: 'dd', scrollTo: 'approvals-list' });
  });

  it('maps doc:<id> to documents tab', () => {
    expect(parseEvidenceRef('doc:f7f9720f-9f79-4e5c')).toEqual({ tab: 'documents' });
  });

  it('maps comp:<id> to comps tab', () => {
    expect(parseEvidenceRef('comp:some-comp-id')).toEqual({ tab: 'comps' });
  });

  it('maps guidance:<citation-id> to the parcel tab (circle-rate band)', () => {
    expect(parseEvidenceRef('guidance:guidance-value-gv-1')).toEqual({ tab: 'parcel' });
    expect(parseEvidenceRef('guidance:value')).toEqual({ tab: 'parcel' });
  });
});

describe('parseEvidenceRef — null cases', () => {
  it('returns null for empty / non-string input', () => {
    expect(parseEvidenceRef(null)).toBeNull();
    expect(parseEvidenceRef('')).toBeNull();
    expect(parseEvidenceRef(undefined)).toBeNull();
    expect(parseEvidenceRef(42)).toBeNull();
  });

  it('returns null for unknown refs (no prefix match)', () => {
    expect(parseEvidenceRef('totally-bogus-ref')).toBeNull();
    expect(parseEvidenceRef('unknown:thing')).toBeNull();
  });
});

describe('isNavigableRef', () => {
  it('returns true for routed refs', () => {
    expect(isNavigableRef('kernel:irr')).toBe(true);
    expect(isNavigableRef('approval:abc-123')).toBe(true);
  });

  it('returns false for unrouted refs', () => {
    expect(isNavigableRef('unknown:thing')).toBe(false);
    expect(isNavigableRef(null)).toBe(false);
  });
});

describe('__INTERNAL maps', () => {
  it('every EXACT_MAP entry has tab', () => {
    for (const [ref, target] of Object.entries(__INTERNAL.EXACT_MAP)) {
      expect(target.tab, `${ref} missing tab`).toBeTruthy();
    }
  });

  it('every PREFIX_MAP entry has tab', () => {
    for (const [prefix, target] of Object.entries(__INTERNAL.PREFIX_MAP)) {
      expect(target.tab, `${prefix} missing tab`).toBeTruthy();
    }
  });
});
