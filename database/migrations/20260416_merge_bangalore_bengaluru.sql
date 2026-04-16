-- ============================================================================
-- Merge Bangalore → Bengaluru across all tables
-- ============================================================================
-- Bengaluru is the official name. Standardize all data to use it.
-- ============================================================================

-- Properties
UPDATE properties SET city = 'Bengaluru', updated_at = NOW()
WHERE LOWER(city) = 'bangalore';

-- Comps
UPDATE comps SET city = 'Bengaluru', updated_at = NOW()
WHERE LOWER(city) = 'bangalore';

-- Market transactions
UPDATE market_transactions SET city = 'Bengaluru'
WHERE LOWER(city) = 'bangalore';

-- Micro-market benchmarks
UPDATE micro_market_benchmarks SET city = 'Bengaluru', updated_at = NOW()
WHERE LOWER(city) = 'bangalore';

-- Micro-market names containing "Bangalore"
UPDATE micro_market_benchmarks
SET micro_market = REPLACE(micro_market, 'Bangalore', 'Bengaluru'),
    updated_at = NOW()
WHERE micro_market ILIKE '%Bangalore%';
