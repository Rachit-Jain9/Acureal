const axios = require('axios');

const parseGuidanceValue = (raw = {}) => {
  const candidates = [
    raw.guidance_value_per_sqft,
    raw.guideline_value_per_sqft,
    raw.value_inr_per_sqft,
    raw.rate_per_sqft,
    raw?.data?.guidance_value_per_sqft,
    raw?.data?.guideline_value_per_sqft,
    raw?.data?.value_inr_per_sqft,
  ];

  const numeric = candidates
    .map((value) => (value === null || value === undefined ? null : Number(String(value).replace(/[^\d.]/g, ''))))
    .find((value) => Number.isFinite(value) && value > 0);

  return numeric || null;
};

const isConfigured = () => Boolean(process.env.LANDEED_API_KEY && process.env.LANDEED_GUIDANCE_VALUE_ENDPOINT);

const getStatus = () => ({
  provider: 'landeed',
  status: isConfigured() ? 'configured' : 'not_configured',
  message: isConfigured()
    ? 'Landeed adapter is configured.'
    : 'LANDEED_API_KEY and LANDEED_GUIDANCE_VALUE_ENDPOINT are required before vendor guidance values can be used.',
});

const lookupGuidanceValue = async (property = {}) => {
  if (!isConfigured()) {
    return {
      provider: 'landeed',
      status: 'not_configured',
      confidence: 0,
      message: 'Landeed business API credentials are not configured.',
      citations: [],
    };
  }

  try {
    const response = await axios.post(
      process.env.LANDEED_GUIDANCE_VALUE_ENDPOINT,
      {
        state: property.state || 'Karnataka',
        city: property.city || 'Bengaluru',
        address: property.address || null,
        locality: property.locality || null,
        survey_number: property.survey_number || null,
        latitude: property.lat || null,
        longitude: property.lng || null,
        land_use_type: property.zoning || property.property_type || null,
      },
      {
        timeout: Number(process.env.LANDEED_TIMEOUT_MS || 12000),
        headers: {
          Authorization: `Bearer ${process.env.LANDEED_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const value = parseGuidanceValue(response.data);

    return {
      provider: 'landeed',
      status: value ? 'matched' : 'unmatched',
      confidence: value ? 0.8 : 0.2,
      value_inr_per_sqft: value,
      raw: response.data,
      message: value
        ? 'Vendor guidance value returned by configured Landeed adapter.'
        : 'Landeed responded but no guidance value field was recognized.',
      citations: [
        {
          id: 'vendor-landeed-guidance',
          kind: 'vendor_guidance',
          label: 'Landeed guidance value response',
          authority: 'Landeed',
          status: 'vendor_data',
        },
      ],
    };
  } catch (error) {
    return {
      provider: 'landeed',
      status: 'error',
      confidence: 0,
      message: error.response?.data?.message || error.message || 'Landeed lookup failed.',
      citations: [],
    };
  }
};

module.exports = {
  getStatus,
  lookupGuidanceValue,
};
