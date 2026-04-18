import { FinancialGraph, buildStandardGraph } from '../../src/orchestration/financialGraph';

describe('FinancialGraph', () => {
  test('addInput, addComputation, addOutput wires edges', () => {
    const g = new FinancialGraph();
    g.addInput('revenue', 'Revenue');
    g.addInput('opex', 'OpEx');
    g.addComputation('cfads', 'CFADS', ['revenue', 'opex']);
    g.addOutput('insights', 'Insights', ['cfads']);
    expect(g.hasNode('cfads')).toBe(true);
    expect(g.size()).toBe(4);
  });

  test('upstream traversal returns all ancestors', () => {
    const g = new FinancialGraph();
    g.addInput('a', 'A');
    g.addInput('b', 'B');
    g.addComputation('c', 'C', ['a', 'b']);
    g.addComputation('d', 'D', ['c']);
    expect(g.upstream('d').sort()).toEqual(['a', 'b', 'c']);
    expect(g.upstream('a').sort()).toEqual([]);
  });

  test('downstream traversal returns all descendants', () => {
    const g = new FinancialGraph();
    g.addInput('a', 'A');
    g.addComputation('b', 'B', ['a']);
    g.addComputation('c', 'C', ['b']);
    expect(g.downstream('a').sort()).toEqual(['b', 'c']);
    expect(g.downstream('c').sort()).toEqual([]);
  });

  test('duplicate node ids throw', () => {
    const g = new FinancialGraph();
    g.addInput('x', 'X');
    expect(() => g.addInput('x', 'X2')).toThrow(/duplicate node/);
  });

  test('snapshot produces nodes + edges', () => {
    const g = new FinancialGraph();
    g.addInput('x', 'X');
    g.addComputation('y', 'Y', ['x']);
    const snap = g.snapshot();
    expect(snap.nodes.length).toBe(2);
    expect(snap.edges).toEqual([{ from: 'x', to: 'y' }]);
  });
});

describe('buildStandardGraph', () => {
  test('produces the canonical REDIP deal graph', () => {
    const g = buildStandardGraph({
      facilityIds: ['f1', 'f2'],
      tierIds: ['roc', 'pref', 'catchup', 'promote'],
      hasDSRA: true,
      hasCashTraps: true,
      hasCovenants: true,
    });
    expect(g.hasNode('debt_service')).toBe(true);
    expect(g.hasNode('cfads')).toBe(true);
    expect(g.hasNode('insights')).toBe(true);
    expect(g.hasNode('sensitivity')).toBe(true);
    // Insights depend transitively on assumptions + cfads_inputs.
    const up = g.upstream('insights');
    expect(up).toContain('cfads_inputs');
    expect(up).toContain('debt_service');
    expect(up).toContain('covenants');
  });

  test('omits optional layers when not present', () => {
    const g = buildStandardGraph({
      facilityIds: ['f1'],
      tierIds: [],
      hasDSRA: false,
      hasCashTraps: false,
      hasCovenants: false,
    });
    expect(g.hasNode('dsra')).toBe(false);
    expect(g.hasNode('cash_traps')).toBe(false);
    expect(g.hasNode('covenants')).toBe(false);
  });
});
