import { Decimal } from '../../src/decimal';
import { evaluateDeal, buildNarrative } from '../../src/intelligence/decisionEngine';
import type { DSCRProfile, IntelligenceKPIs } from '../../src/intelligence/types';

const cr = (n: number) => Decimal.fromNumber(n);

function kpis(overrides: Partial<IntelligenceKPIs> = {}): IntelligenceKPIs {
  const dscr: DSCRProfile = {
    min: cr(1.4),
    max: cr(2.0),
    avg: cr(1.6),
    p5: cr(1.4),
    p25: cr(1.5),
    p50: cr(1.6),
    p75: cr(1.8),
    countBelow1_0: 0,
    countBelow1_25: 0,
    ...overrides.dscrProfile,
  };
  return {
    irrLevered: cr(0.15),
    irrUnlevered: cr(0.12),
    moic: cr(1.8),
    equityMultiple: cr(1.8),
    dscrProfile: dscr,
    llcr: cr(1.4),
    plcr: cr(1.6),
    peakEquityCr: cr(30),
    paybackMonth: 48,
    debtCapacity: { maxDebtCr: cr(80), bindingMonth: 6, achievedMinDSCR: cr(1.25) },
    ...overrides,
  };
}

describe('decisionEngine — IRR bands', () => {
  test('low IRR emits high-severity risk', () => {
    const ins = evaluateDeal({
      kpis: kpis({ irrLevered: cr(0.08) }),
      residualCr: cr(0),
      breachCount: 0,
    });
    const irr = ins.find((i) => i.title === 'Low levered IRR');
    expect(irr).toBeDefined();
    expect(irr!.severity).toBe('high');
  });

  test('acceptable IRR emits observation', () => {
    const ins = evaluateDeal({
      kpis: kpis({ irrLevered: cr(0.15) }),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.title === 'Acceptable IRR')).toBe(true);
  });

  test('strong IRR emits opportunity', () => {
    const ins = evaluateDeal({
      kpis: kpis({ irrLevered: cr(0.22) }),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.kind === 'opportunity' && i.title === 'Strong IRR profile')).toBe(true);
  });

  test('null IRR emits risk', () => {
    const ins = evaluateDeal({
      kpis: kpis({ irrLevered: null }),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.title === 'IRR not computable')).toBe(true);
  });
});

describe('decisionEngine — DSCR bands', () => {
  test('DSCR breach emits critical', () => {
    const p: DSCRProfile = {
      min: cr(0.85), max: cr(1.2), avg: cr(0.95),
      p5: cr(0.85), p25: cr(0.9), p50: cr(0.95), p75: cr(1.1),
      countBelow1_0: 3, countBelow1_25: 10,
    };
    const ins = evaluateDeal({
      kpis: kpis({ dscrProfile: p }),
      residualCr: cr(0),
      breachCount: 0,
    });
    const b = ins.find((i) => i.title === 'DSCR breach');
    expect(b).toBeDefined();
    expect(b!.severity).toBe('critical');
  });

  test('thin DSCR emits high risk', () => {
    const p: DSCRProfile = {
      min: cr(1.15), max: cr(1.6), avg: cr(1.3),
      p5: cr(1.15), p25: cr(1.2), p50: cr(1.3), p75: cr(1.4),
      countBelow1_0: 0, countBelow1_25: 6,
    };
    const ins = evaluateDeal({
      kpis: kpis({ dscrProfile: p }),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.title === 'Thin DSCR cushion')).toBe(true);
  });

  test('strong DSCR emits opportunity', () => {
    const p: DSCRProfile = {
      min: cr(1.8), max: cr(2.5), avg: cr(2.0),
      p5: cr(1.8), p25: cr(1.9), p50: cr(2.0), p75: cr(2.2),
      countBelow1_0: 0, countBelow1_25: 0,
    };
    const ins = evaluateDeal({
      kpis: kpis({ dscrProfile: p }),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.kind === 'opportunity' && i.title === 'Strong DSCR cushion')).toBe(true);
  });
});

describe('decisionEngine — LTC/LTV/LLCR/residual/breaches', () => {
  test('flags high LTC and LTV', () => {
    const ins = evaluateDeal({
      kpis: kpis(),
      ltcPct: cr(80),
      ltvPct: cr(75),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.title === 'High LTC')).toBe(true);
    expect(ins.some((i) => i.title === 'High LTV')).toBe(true);
  });

  test('flags weak LLCR', () => {
    const ins = evaluateDeal({
      kpis: kpis({ llcr: cr(1.05) }),
      residualCr: cr(0),
      breachCount: 0,
    });
    expect(ins.some((i) => i.title === 'Weak LLCR')).toBe(true);
  });

  test('flags negative residual and covenant breaches', () => {
    const ins = evaluateDeal({
      kpis: kpis(),
      residualCr: cr(-1.5),
      breachCount: 3,
    });
    expect(ins.some((i) => i.title === 'Distribution shortfall' && i.severity === 'critical')).toBe(true);
    expect(ins.some((i) => i.title === 'Covenant breaches')).toBe(true);
  });
});

describe('decisionEngine — narrative', () => {
  test('builds a one-line narrative leading with highest severity', () => {
    const ins = evaluateDeal({
      kpis: kpis({
        irrLevered: cr(0.08),
        dscrProfile: {
          min: cr(0.9), max: cr(1.2), avg: cr(1.0),
          p5: cr(0.9), p25: cr(0.95), p50: cr(1.0), p75: cr(1.1),
          countBelow1_0: 2, countBelow1_25: 8,
        },
      }),
      residualCr: cr(0),
      breachCount: 0,
    });
    const n = buildNarrative(ins, kpis({ irrLevered: cr(0.08), dscrProfile: {
      min: cr(0.9), max: cr(1.2), avg: cr(1.0),
      p5: cr(0.9), p25: cr(0.95), p50: cr(1.0), p75: cr(1.1),
      countBelow1_0: 2, countBelow1_25: 8,
    } }));
    expect(n).toContain('Levered IRR');
    expect(n.toLowerCase()).toContain('dscr breach');
  });
});
