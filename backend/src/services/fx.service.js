'use strict';

/**
 * Exchange rate service.
 *
 * Provider: exchangerate.host (free, no API key required for basic usage)
 * Base currency: INR (canonical platform currency)
 *
 * Behavior:
 * - Fetch latest rates daily and persist to exchange_rates table
 * - On provider failure, fall back to most recent stored rate (mark as 'fallback')
 * - Rates stored as: 1 INR = X quote_currency
 */

const axios = require('axios');
const { query } = require('../config/database');

const BASE_CURRENCY = 'INR';
const SUPPORTED_QUOTES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY', 'AUD', 'CAD'];
const PROVIDER_URL = 'https://api.exchangerate.host/latest';
const PROVIDER_NAME = 'exchangerate_host';
const FETCH_TIMEOUT_MS = 10000;

/**
 * Fetch latest rates from exchangerate.host.
 * Returns { rates: { USD: x, EUR: y, ... }, date: 'YYYY-MM-DD' } or null on failure.
 */
const fetchFromProvider = async () => {
  try {
    const response = await axios.get(PROVIDER_URL, {
      params: {
        base: BASE_CURRENCY,
        symbols: SUPPORTED_QUOTES.join(','),
      },
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'Accept': 'application/json' },
    });

    const data = response.data;
    if (!data?.success || !data?.rates) {
      console.warn('[FX] Provider returned non-success response:', data?.error);
      return null;
    }

    return {
      rates: data.rates,
      date: data.date || new Date().toISOString().slice(0, 10),
    };
  } catch (err) {
    console.error('[FX] Provider fetch error:', err.message);
    return null;
  }
};

/**
 * Persist rates to exchange_rates table.
 * Upserts: one row per base/quote/date.
 */
const persistRates = async (rates, effectiveDate, source, freshnessStatus = 'fresh') => {
  const entries = Object.entries(rates).filter(([quote]) => SUPPORTED_QUOTES.includes(quote));
  let updated = 0;

  for (const [quote, rate] of entries) {
    if (!rate || !isFinite(rate) || rate <= 0) continue;
    await query(
      `INSERT INTO exchange_rates
         (base_currency, quote_currency, rate, source, effective_date, fetched_at, freshness_status)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (base_currency, quote_currency, effective_date)
       DO UPDATE SET
         rate = EXCLUDED.rate,
         source = EXCLUDED.source,
         fetched_at = NOW(),
         freshness_status = EXCLUDED.freshness_status,
         fetch_error = NULL`,
      [BASE_CURRENCY, quote, rate, source, effectiveDate, freshnessStatus]
    );
    updated++;
  }

  return updated;
};

/**
 * Log a fetch attempt.
 */
const logFetch = async ({ fetchDate, source, success, currenciesUpdated = 0, errorMessage = null, durationMs = 0 }) => {
  try {
    await query(
      `INSERT INTO exchange_rate_fetch_log
         (fetch_date, source, success, currencies_updated, error_message, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [fetchDate, source, success, currenciesUpdated, errorMessage, durationMs]
    );
  } catch (err) {
    console.error('[FX] Failed to write fetch log:', err.message);
  }
};

/**
 * Main daily refresh function.
 * Called by the /api/fx/refresh endpoint or a scheduled cron.
 */
const refreshRates = async () => {
  const startTime = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Check if already fetched fresh today
  const existing = await query(
    `SELECT id FROM exchange_rates
     WHERE base_currency = $1 AND effective_date = $2 AND freshness_status = 'fresh'
     LIMIT 1`,
    [BASE_CURRENCY, today]
  );

  if (existing.rows.length > 0) {
    return { refreshed: false, reason: 'already_fresh_today', date: today };
  }

  // Attempt live fetch
  const providerData = await fetchFromProvider();
  const durationMs = Date.now() - startTime;

  if (providerData) {
    const updated = await persistRates(providerData.rates, providerData.date, PROVIDER_NAME, 'fresh');
    await logFetch({ fetchDate: today, source: PROVIDER_NAME, success: true, currenciesUpdated: updated, durationMs });
    return { refreshed: true, date: providerData.date, currenciesUpdated: updated, source: PROVIDER_NAME };
  }

  // Provider failed — mark most recent stored rates as fallback for today
  console.warn('[FX] Live fetch failed. Using most recent stored rates as fallback.');

  const fallbackResult = await query(
    `SELECT DISTINCT ON (quote_currency) quote_currency, rate, effective_date
     FROM exchange_rates
     WHERE base_currency = $1
     ORDER BY quote_currency, effective_date DESC`,
    [BASE_CURRENCY]
  );

  let fallbackUpdated = 0;
  for (const row of fallbackResult.rows) {
    await query(
      `INSERT INTO exchange_rates
         (base_currency, quote_currency, rate, source, effective_date, fetched_at, freshness_status)
       VALUES ($1, $2, $3, 'fallback', $4, NOW(), 'fallback')
       ON CONFLICT (base_currency, quote_currency, effective_date)
       DO UPDATE SET freshness_status = 'fallback', fetched_at = NOW()`,
      [BASE_CURRENCY, row.quote_currency, row.rate, today]
    );
    fallbackUpdated++;
  }

  const errorMsg = 'Live provider unavailable; using prior day fallback rates.';
  await logFetch({ fetchDate: today, source: PROVIDER_NAME, success: false, currenciesUpdated: fallbackUpdated, errorMessage: errorMsg, durationMs });

  return {
    refreshed: false,
    fallback: true,
    fallbackCount: fallbackUpdated,
    reason: 'provider_unavailable',
    date: today,
  };
};

/**
 * Get the latest available rate for a currency pair.
 * Returns the most recent row, regardless of date.
 */
const getRate = async (quoteCurrency) => {
  const result = await query(
    `SELECT rate, source, effective_date, fetched_at, freshness_status
     FROM exchange_rates
     WHERE base_currency = $1 AND quote_currency = $2
     ORDER BY effective_date DESC
     LIMIT 1`,
    [BASE_CURRENCY, quoteCurrency.toUpperCase()]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0];
};

/**
 * Get all latest rates (one per quote currency).
 */
const getAllRates = async () => {
  const result = await query(
    `SELECT DISTINCT ON (quote_currency)
       quote_currency, rate, source, effective_date, fetched_at, freshness_status
     FROM exchange_rates
     WHERE base_currency = $1
     ORDER BY quote_currency, effective_date DESC`,
    [BASE_CURRENCY]
  );

  return result.rows;
};

/**
 * Convert an INR amount to another currency using the latest stored rate.
 */
const convertFromINR = async (amountInr, quoteCurrency) => {
  const rateRow = await getRate(quoteCurrency);
  if (!rateRow) return null;

  return {
    amount: parseFloat((amountInr * rateRow.rate).toFixed(4)),
    currency: quoteCurrency,
    rate: rateRow.rate,
    source: rateRow.source,
    effectiveDate: rateRow.effective_date,
    freshnessStatus: rateRow.freshness_status,
  };
};

module.exports = { refreshRates, getRate, getAllRates, convertFromINR, BASE_CURRENCY, SUPPORTED_QUOTES };
