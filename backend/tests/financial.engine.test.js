const {
  calculateNPV,
  calculateIRR,
  calculateResidualLandValue,
  calculateFullFinancials,
  buildCashFlows,
  buildSensitivityMatrix,
} = require('../src/engines/financial.engine');

describe('Financial Engine', () => {
  describe('calculateNPV', () => {
    test('should return 0 for empty cash flows', () => {
      expect(calculateNPV([], 0.12)).toBe(0);
    });

    test('should return 0 for null cash flows', () => {
      expect(calculateNPV(null, 0.12)).toBe(0);
    });

    test('should calculate NPV correctly for simple cash flows', () => {
      const cashFlows = [-100, 30, 40, 50, 60];
      const npv = calculateNPV(cashFlows, 0.12);
      expect(npv).toBeGreaterThan(0);
    });

    test('should return negative NPV for bad investment', () => {
      const cashFlows = [-1000, 10, 10, 10, 10];
      const npv = calculateNPV(cashFlows, 0.12);
      expect(npv).toBeLessThan(0);
    });

    test('should throw for discount rate outside valid range', () => {
      expect(() => calculateNPV([-100, 200], 15)).toThrow('Discount rate must be between 0 and 1000%');
    });

    test('should handle zero discount rate', () => {
      const cashFlows = [-100, 50, 50, 50];
      const npv = calculateNPV(cashFlows, 0);
      expect(npv).toBe(50); // -100 + 50 + 50 + 50
    });
  });

  describe('calculateIRR', () => {
    test('should throw for fewer than 2 cash flows', () => {
      expect(() => calculateIRR([-100])).toThrow('At least 2 cash flows');
    });

    test('should throw for all positive cash flows', () => {
      expect(() => calculateIRR([100, 200, 300])).toThrow('both negative and positive');
    });

    test('should throw for all negative cash flows', () => {
      expect(() => calculateIRR([-100, -200, -300])).toThrow('both negative and positive');
    });

    test('should calculate IRR for simple investment', () => {
      // Invest 100, get 110 next quarter → quarterly rate ~10%
      const irr = calculateIRR([-100, 110]);
      expect(irr).toBeGreaterThan(0);
    });

    test('should calculate reasonable IRR for real estate project', () => {
      const cashFlows = [-50, -20, -10, 15, 30, 45, 60, 40];
      const irr = calculateIRR(cashFlows);
      expect(irr).toBeGreaterThan(0);
      expect(irr).toBeLessThan(500);
    });

    test('should handle large returns', () => {
      const irr = calculateIRR([-100, 0, 0, 0, 500]);
      expect(irr).toBeGreaterThan(50);
    });
  });

  describe('calculateResidualLandValue', () => {
    test('should compute RLV correctly', () => {
      const rlv = calculateResidualLandValue({
        totalRevenueCr: 200,
        totalConstructionCostCr: 50,
        gstCostCr: 9,
        approvalCostCr: 5,
        marketingCostCr: 7,
        financeCostCr: 10,
        developerMarginPct: 20,
      });
      // (200 - 50 - 9 - 5 - 7 - 10) / 1.2 = 119 / 1.2 = 99.1667
      expect(rlv).toBeCloseTo(99.1667, 2);
    });

    test('should use default 20% margin when not provided', () => {
      const rlv = calculateResidualLandValue({
        totalRevenueCr: 100,
        totalConstructionCostCr: 30,
        gstCostCr: 5,
        approvalCostCr: 3,
        marketingCostCr: 2,
        financeCostCr: 5,
      });
      expect(rlv).toBeCloseTo((100 - 30 - 5 - 3 - 2 - 5) / 1.2, 2);
    });
  });

  describe('buildCashFlows', () => {
    test('should build cash flows array of correct length', () => {
      const cfs = buildCashFlows({
        landCostCr: 50,
        totalConstructionCostCr: 30,
        gstCostCr: 5,
        stampDutyCr: 2.5,
        approvalCostCr: 3,
        marketingCostCr: 4,
        financeParams: { financeCostPct: 12 },
        totalRevenueCr: 150,
        projectDurationMonths: 36,
      });
      expect(cfs.length).toBe(13); // 36/3 + 1 = 13
    });

    test('should have negative first quarter (land cost outflow)', () => {
      const cfs = buildCashFlows({
        landCostCr: 100,
        totalConstructionCostCr: 50,
        gstCostCr: 9,
        stampDutyCr: 5,
        approvalCostCr: 10,
        marketingCostCr: 5,
        financeParams: { financeCostPct: 12 },
        totalRevenueCr: 300,
        projectDurationMonths: 48,
      });
      expect(cfs[0]).toBeLessThan(0);
    });

    test('should have positive cash flows in later quarters (revenue inflows)', () => {
      const cfs = buildCashFlows({
        landCostCr: 20,
        totalConstructionCostCr: 15,
        gstCostCr: 2.7,
        stampDutyCr: 1,
        approvalCostCr: 2,
        marketingCostCr: 3,
        financeParams: { financeCostPct: 12 },
        totalRevenueCr: 200,
        projectDurationMonths: 36,
      });
      const lastQuarter = cfs[cfs.length - 1];
      expect(lastQuarter).toBeGreaterThan(0);
    });
  });

  describe('calculateFullFinancials', () => {
    const baseInput = {
      plotAreaSqft: 25000,
      fsi: 3.0,
      constructionCostPerSqft: 4500,
      sellingRatePerSqft: 42000,
      landCostCr: 155,
      approvalCostCr: 8.5,
      marketingCostPct: 3.5,
      financeCostPct: 12,
      developerMarginPct: 20,
      projectDurationMonths: 42,
      discountRatePct: 12,
    };

    test('should compute all required output fields', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result).toHaveProperty('grossAreaSqft');
      expect(result).toHaveProperty('saleableAreaSqft');
      expect(result).toHaveProperty('totalRevenueCr');
      expect(result).toHaveProperty('totalCostCr');
      expect(result).toHaveProperty('grossProfitCr');
      expect(result).toHaveProperty('irrPct');
      expect(result).toHaveProperty('npvCr');
      expect(result).toHaveProperty('residualLandValueCr');
      expect(result).toHaveProperty('equityMultiple');
      expect(result).toHaveProperty('cashFlows');
      expect(result).toHaveProperty('sensitivityMatrix');
    });

    test('should compute correct gross area', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result.grossAreaSqft).toBe(75000); // 25000 * 3
    });

    test('should compute correct saleable area with default loading', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result.saleableAreaSqft).toBe(86250); // 75000 * (1 + 0.15)
    });

    test('should treat loading factor as an additive uplift on gross area', () => {
      const result = calculateFullFinancials({ ...baseInput, loadingFactor: 0.15 });
      expect(result.saleableAreaSqft).toBe(86250); // 75000 * (1 + 0.15)
    });

    test('should throw for missing required fields', () => {
      expect(() => calculateFullFinancials({})).toThrow('Required field missing');
      expect(() => calculateFullFinancials({ plotAreaSqft: 1000 })).toThrow('Required field missing');
    });

    test('should throw for invalid plot area', () => {
      expect(() => calculateFullFinancials({ ...baseInput, plotAreaSqft: -1 })).toThrow('Plot area must be greater than 0');
    });

    test('should throw for invalid FSI', () => {
      expect(() => calculateFullFinancials({ ...baseInput, fsi: 25 })).toThrow('FSI must be between 0 and 20');
    });

    test('should throw for invalid project duration', () => {
      expect(() => calculateFullFinancials({ ...baseInput, projectDurationYears: 0.5 })).toThrow('Project duration must be between 1 and 15 years');
    });

    test('saleable area should be gross FAR area * (1 + loading factor)', () => {
      const result = calculateFullFinancials({
        ...baseInput, plotAreaSqft: 100, fsi: 2.5, loadingFactor: 0.15,
      });
      const saleable = result.saleableAreaSqft ?? result._legacy?.saleable_area_sqft ?? result.areas?.saleable;
      expect(saleable).toBeCloseTo(100 * 2.5 * 1.15, 2);
    });

    test('should include GST at 18% of construction cost', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result.gstCostCr).toBeCloseTo(result.totalConstructionCostCr * 0.18, 2);
    });

    test('should include stamp duty at 5% of land cost', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result.stampDutyCr).toBeCloseTo(155 * 0.05, 2);
    });

    test('should include inputs in output', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result.inputs.plotAreaSqft).toBe(25000);
      expect(result.inputs.fsi).toBe(3.0);
    });

    test('should generate cash flow summary', () => {
      const result = calculateFullFinancials(baseInput);
      expect(result.cashFlows.summary.totalInflow).toBeGreaterThan(0);
      expect(result.cashFlows.summary.totalOutflow).toBeGreaterThan(0);
    });
  });

  describe('buildSensitivityMatrix', () => {
    test('should generate a 9x9 IRR grid', () => {
      const matrix = buildSensitivityMatrix({
        plotAreaSqft: 25000,
        fsi: 3.0,
        loadingFactor: 0.15,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 155,
        approvalCostCr: 8.5,
        marketingCostPct: 3.5,
        financeCostPct: 12,
        projectDurationMonths: 42,
        discountRatePct: 12,
        developerMarginPct: 20,
      });
      expect(matrix.irrGrid.length).toBe(9);
      expect(matrix.irrGrid[0].length).toBe(9);
      expect(matrix.sellingRates.length).toBe(9);
      expect(matrix.constructionCosts.length).toBe(9);
      expect(matrix.variations.length).toBe(9);
    });

    test('should have base case IRR in center of grid', () => {
      const matrix = buildSensitivityMatrix({
        plotAreaSqft: 25000,
        fsi: 3.0,
        loadingFactor: 0.15,
        constructionCostPerSqft: 4500,
        sellingRatePerSqft: 42000,
        landCostCr: 155,
        approvalCostCr: 8.5,
        marketingCostPct: 3.5,
        financeCostPct: 12,
        projectDurationMonths: 42,
        discountRatePct: 12,
        developerMarginPct: 20,
      });
      // Center cell [4][4] should be the base case
      const centerIRR = matrix.irrGrid[4][4];
      expect(centerIRR).not.toBeNull();
      expect(typeof centerIRR).toBe('number');
    });
  });

  describe('income and hospitality exit strategies', () => {
    const officeInput = {
      assetClass: 'commercial_office',
      leasableAreaSqft: 100000,
      constructionCostPerSqft: 6000,
      landCostCr: 40,
      approvalCostPerSqft: 150,
      gstPct: 18,
      baseRentPerSqftMonth: 85,
      rentEscalationPct: 5,
      vacancyPct: 10,
      opexPct: 20,
      tiPerSqft: 500,
      lcMonths: 2,
      entryCapRate: 7,
      exitCapRate: 7.5,
      holdPeriodYears: 5,
      projectDurationYears: 3,
      debtCoverage: 0.65,
      interestRatePct: 10,
      discountRatePct: 14,
    };

    const hospitalityInput = {
      assetClass: 'hospitality',
      keys: 120,
      constructionCostPerKey: 8500000,
      preOpeningCostPerKey: 300000,
      landCostCr: 35,
      approvalCostPerSqft: 150,
      gstPct: 18,
      adr: 7000,
      stabilizedOccPct: 68,
      adrGrowthPct: 5,
      fbRevPct: 25,
      otherRevPct: 10,
      gopMarginPct: 35,
      ebitdaMarginPct: 28,
      exitCapRate: 9,
      holdPeriodYears: 8,
      projectDurationYears: 2.5,
      debtCoverage: 0.55,
      interestRatePct: 10.5,
      contingencyPct: 5,
      discountRatePct: 15,
    };

    test('should honor user-configured GST for income assets', () => {
      const result = calculateFullFinancials({ ...officeInput, gstPct: 5 });
      expect(result.gstCostCr).toBeCloseTo(result.totalConstructionCostCr * 0.05, 2);
      expect(result.inputs.gstPct).toBe(5);
    });

    test('should use forward purchase pricing for income-asset exit value', () => {
      const result = calculateFullFinancials({
        ...officeInput,
        exitStrategy: 'forward_purchase',
        forwardPurchasePriceCr: 220,
      });

      expect(result.inputs.exitStrategy).toBe('forward_purchase');
      expect(result.kpis.exitValue).toBeCloseTo(220, 2);
      expect(result.revenue.exitValue).toBeCloseTo(220, 2);
    });

    test('should retain LRD settings for income assets within the supported 0 to 1 range', () => {
      const result = calculateFullFinancials({
        ...officeInput,
        exitStrategy: 'lrd',
        lrdLTV: 0.6,
        lrdInterestRatePct: 9.25,
        lrdRefinanceYear: 2,
      });

      expect(result.inputs.exitStrategy).toBe('lrd');
      expect(result.inputs.lrdLTV).toBeCloseTo(0.6, 2);
      expect(result.inputs.lrdInterestRatePct).toBeCloseTo(9.25, 2);
      expect(result.inputs.lrdRefinanceYear).toBe(2);
    });

    test('should use forward purchase pricing for hospitality exit value', () => {
      const result = calculateFullFinancials({
        ...hospitalityInput,
        exitStrategy: 'forward_purchase',
        forwardPurchasePriceCr: 260,
      });

      expect(result.inputs.exitStrategy).toBe('forward_purchase');
      expect(result.kpis.exitValue).toBeCloseTo(260, 2);
      expect(result.revenue.exitValue).toBeCloseTo(260, 2);
    });
  });

  describe('terminal value methodologies', () => {
    const officeTvInput = {
      assetClass: 'commercial_office',
      leasableAreaSqft: 100000,
      constructionCostPerSqft: 6000,
      landCostCr: 40,
      approvalCostPerSqft: 150,
      gstPct: 18,
      baseRentPerSqftMonth: 85,
      rentEscalationPct: 5,
      vacancyPct: 10,
      opexPct: 20,
      tiPerSqft: 500,
      lcMonths: 2,
      entryCapRate: 7,
      exitCapRate: 7.5,
      holdPeriodYears: 5,
      projectDurationYears: 3,
      debtCoverage: 0.65,
      interestRatePct: 10,
      discountRatePct: 14,
    };

    test('default method is exit_cap_rate with dynamic linkage to NOI_exit and cap rate', () => {
      const result = calculateFullFinancials(officeTvInput);
      expect(result.kpis.terminalValueMethod).toBe('exit_cap_rate');
      // Terminal value ≈ NOI_exit / exitCapRate
      const expected = result.kpis.noiAtExit / (result.kpis.exitCapRate / 100);
      expect(result.kpis.terminalValue).toBeCloseTo(expected, 1);
      // PV discount factor = (1+r)^-holdPeriodYears
      const pvFactor = Math.pow(1 + result.inputs.discountRatePct / 100, result.inputs.holdPeriodYears);
      expect(result.kpis.terminalValuePV).toBeCloseTo(result.kpis.terminalValue / pvFactor, 1);
    });

    test('exit_multiple method: TV = stabilized NOI × multiple', () => {
      const result = calculateFullFinancials({
        ...officeTvInput,
        terminalValueMethod: 'exit_multiple',
        exitMultiple: 15,
      });
      expect(result.kpis.terminalValueMethod).toBe('exit_multiple');
      expect(result.inputs.exitMultiple).toBeCloseTo(15, 2);
      // Applied exit value equals stabilized NOI * 15
      const expected = result.kpis.noi * 15;
      expect(result.kpis.terminalValue).toBeCloseTo(expected, 1);
      expect(result.kpis.exitValue).toBeCloseTo(expected, 1);
    });

    test('perpetuity_growth: TV = NOI_exit * (1+g) / (r - g) and must be finite for r > g', () => {
      const result = calculateFullFinancials({
        ...officeTvInput,
        terminalValueMethod: 'perpetuity_growth',
        perpetuityGrowthPct: 3,
      });
      expect(result.kpis.terminalValueMethod).toBe('perpetuity_growth');
      const r = result.inputs.discountRatePct / 100;
      const g = 0.03;
      const expected = result.kpis.noiAtExit * (1 + g) / (r - g);
      expect(result.kpis.terminalValue).toBeCloseTo(expected, 0);
    });

    test('perpetuity_growth falls back to cap rate when r <= g (guards invalid spread)', () => {
      const result = calculateFullFinancials({
        ...officeTvInput,
        terminalValueMethod: 'perpetuity_growth',
        perpetuityGrowthPct: 25, // > discount rate, invalid
      });
      expect(result.kpis.terminalValue).toBeGreaterThan(0);
      expect(Number.isFinite(result.kpis.terminalValue)).toBe(true);
    });

    test('forward_purchase method uses contractual price', () => {
      const result = calculateFullFinancials({
        ...officeTvInput,
        terminalValueMethod: 'forward_purchase',
        forwardPurchasePriceCr: 215,
      });
      expect(result.kpis.terminalValueMethod).toBe('forward_purchase');
      expect(result.kpis.terminalValue).toBeCloseTo(215, 2);
    });

    test('capRateValuationCr is always populated for cross-method comparison', () => {
      const result = calculateFullFinancials({
        ...officeTvInput,
        terminalValueMethod: 'exit_multiple',
        exitMultiple: 15,
      });
      expect(result.kpis.capRateValuationCr).not.toBeNull();
      expect(result.kpis.capRateValuationCr).toBeGreaterThan(0);
    });

    test('terminal value is included in final-quarter cash flow and therefore in NPV', () => {
      const tvCapRate = calculateFullFinancials(officeTvInput);
      const tvFwd = calculateFullFinancials({
        ...officeTvInput,
        terminalValueMethod: 'forward_purchase',
        forwardPurchasePriceCr: tvCapRate.kpis.terminalValue * 2, // Double the TV
      });
      // Doubling TV should significantly increase NPV
      expect(tvFwd.kpis.npv).toBeGreaterThan(tvCapRate.kpis.npv);
    });
  });
});
