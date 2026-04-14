jest.mock('axios', () => ({
  get: jest.fn(),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

const axios = require('axios');
const { query } = require('../src/config/database');
const { refreshRates } = require('../src/services/fx.service');

describe('FX Service', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-14T06:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('should skip a second successful refresh on the same day', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'already-fetched' }] });

    const result = await refreshRates();

    expect(result).toEqual({
      refreshed: false,
      reason: 'already_refreshed_today',
      fetchDate: '2026-04-14',
    });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('should convert the USD feed into INR base rates and persist them', async () => {
    const persistedRows = [];

    query.mockImplementation(async (sql, params) => {
      if (sql.includes('FROM exchange_rate_fetch_log')) {
        return { rows: [] };
      }

      if (sql.includes('INSERT INTO exchange_rates')) {
        persistedRows.push(params);
        return { rowCount: 1, rows: [] };
      }

      if (sql.includes('INSERT INTO exchange_rate_fetch_log')) {
        return { rowCount: 1, rows: [] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    axios.get.mockResolvedValue({
      data: {
        date: '2026-04-14',
        usd: {
          inr: 80,
          eur: 0.9,
          gbp: 0.75,
          aed: 3.67,
          sgd: 1.35,
          jpy: 150,
          aud: 1.5,
          cad: 1.4,
        },
      },
    });

    const result = await refreshRates();

    expect(result).toMatchObject({
      refreshed: true,
      date: '2026-04-14',
      fetchDate: '2026-04-14',
      currenciesUpdated: 8,
      source: 'fawazahmed_currency_api',
      freshnessStatus: 'fresh',
    });

    expect(axios.get).toHaveBeenCalledWith(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      expect.objectContaining({
        timeout: 10000,
        headers: { Accept: 'application/json' },
      })
    );

    const usdRow = persistedRows.find((params) => params[1] === 'USD');
    const eurRow = persistedRows.find((params) => params[1] === 'EUR');
    const jpyRow = persistedRows.find((params) => params[1] === 'JPY');

    expect(usdRow[0]).toBe('INR');
    expect(usdRow[2]).toBeCloseTo(1 / 80, 10);
    expect(eurRow[2]).toBeCloseTo(0.9 / 80, 10);
    expect(jpyRow[2]).toBeCloseTo(150 / 80, 10);
    expect(usdRow[4]).toBe('2026-04-14');
    expect(usdRow[5]).toBe('fresh');
  });
});
