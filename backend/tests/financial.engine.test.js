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
});
