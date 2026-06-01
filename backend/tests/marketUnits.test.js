'use strict';

const { millionsToCr, formatQuantumCr, MILLIONS_PER_CRORE } = require('../src/utils/marketUnits');

describe('marketUnits — quantum_inr_mn (INR millions) → Crore', () => {
  test('1 Crore is 10 million', () => {
    expect(MILLIONS_PER_CRORE).toBe(10);
  });

  test('millionsToCr divides by 10, not 100 (regression: 10x understatement)', () => {
    // Seed rows in 20260404_market_data.sql: 5000 mn is annotated "~₹500 Cr".
    expect(millionsToCr(5000)).toBe(500);
    expect(millionsToCr(10000)).toBe(1000);
    expect(millionsToCr(16000)).toBe(1600);
  });

  test('millionsToCr returns null for non-numeric input', () => {
    expect(millionsToCr(null)).toBeNull();
    expect(millionsToCr(undefined)).toBeNull();
    expect(millionsToCr('abc')).toBeNull();
  });

  test('formatQuantumCr renders the seed rows at true scale', () => {
    expect(formatQuantumCr(5000)).toBe('500 Cr');
    expect(formatQuantumCr(16000)).toBe('1600 Cr');
  });

  test('formatQuantumCr returns null for missing / zero quantum', () => {
    expect(formatQuantumCr(null)).toBeNull();
    expect(formatQuantumCr(0)).toBeNull();
    expect(formatQuantumCr('')).toBeNull();
  });
});
