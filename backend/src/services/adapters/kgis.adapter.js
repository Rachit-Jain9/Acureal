const axios = require('axios');

const KGIS_BASE_URL = process.env.KGIS_BASE_URL || 'https://kgis.ksrsac.in:9000/genericwebservices/ws';
const REQUEST_TIMEOUT_MS = Number(process.env.KGIS_TIMEOUT_MS || 10000);

const getFirst = (object, keys) => {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null && object[key] !== '') {
      return object[key];
    }
  }
  return null;
};

const asArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.result)) return value.result;
  if (Array.isArray(value.results)) return value.results;
  if (Array.isArray(value.response)) return value.response;
  return [value];
};

const normalizeHierarchy = (payload) => {
  const first = asArray(payload)[0] || {};
  return {
    raw: first,
    district: getFirst(first, ['district', 'District', 'districtName', 'DISTRICT_NAME']),
    taluk: getFirst(first, ['taluk', 'Taluk', 'talukName', 'TALUK_NAME']),
    hobli: getFirst(first, ['hobli', 'Hobli', 'hobliName', 'HOBLI_NAME']),
    village: getFirst(first, ['village', 'Village', 'villageName', 'VILLAGE_NAME']),
    village_code: getFirst(first, ['villageCode', 'villagecode', 'VillageCode', 'VILLAGE_CODE', 'kgisVillageId']),
  };
};

const normalizeSurveyNumbers = (payload) =>
  asArray(payload)
    .map((row) => ({
      raw: row,
      survey_number: getFirst(row, ['surveyNo', 'surveyno', 'survey_number', 'SurveyNo', 'SY_NO']),
      hissa_number: getFirst(row, ['hissaNo', 'hissano', 'hissa_number', 'HissaNo']),
      village_code: getFirst(row, ['villageCode', 'villagecode', 'VillageCode', 'VILLAGE_CODE']),
    }))
    .filter((row) => row.survey_number);

const fetchNearbyHierarchy = async ({ lat, lng }) => {
  const response = await axios.get(`${KGIS_BASE_URL}/nearbyadminhierarchy`, {
    params: { lat, lng, distance: 100, coordType: 1 },
    timeout: REQUEST_TIMEOUT_MS,
  });
  return response.data;
};

const fetchSurveyNumbers = async ({ villageCode, lat, lng }) => {
  const response = await axios.get(`${KGIS_BASE_URL}/surveyno`, {
    params: {
      villagecode: villageCode,
      coordinates: `${lng},${lat}`,
      type: 'DD',
      distance: 500,
    },
    timeout: REQUEST_TIMEOUT_MS,
  });
  return response.data;
};

const fetchGeometry = async ({ villageCode, surveyNumber }) => {
  const response = await axios.get(`${KGIS_BASE_URL}/geomForSurveyNum/${villageCode}/${surveyNumber}/DD`, {
    timeout: REQUEST_TIMEOUT_MS,
  });
  return response.data;
};

const fetchKgisContext = async (property = {}) => {
  const lat = property.lat === null || property.lat === undefined ? null : Number(property.lat);
  const lng = property.lng === null || property.lng === undefined ? null : Number(property.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      provider: 'kgis',
      status: 'not_available',
      confidence: 0,
      message: 'K-GIS lookup needs latitude and longitude.',
      hierarchy: null,
      survey_numbers: [],
      geometry_geojson: null,
      reference_only: true,
    };
  }

  const hierarchyPayload = await fetchNearbyHierarchy({ lat, lng });
  const hierarchy = normalizeHierarchy(hierarchyPayload);

  if (!hierarchy.village_code) {
    return {
      provider: 'kgis',
      status: 'partial',
      confidence: 0.35,
      message: 'K-GIS hierarchy returned but no village code was identified.',
      hierarchy,
      survey_numbers: [],
      geometry_geojson: null,
      raw: { hierarchy: hierarchyPayload },
      reference_only: true,
    };
  }

  const surveyPayload = await fetchSurveyNumbers({ villageCode: hierarchy.village_code, lat, lng });
  const surveyNumbers = normalizeSurveyNumbers(surveyPayload);
  const requestedSurvey = property.survey_number ? String(property.survey_number).trim() : null;
  const selectedSurvey =
    surveyNumbers.find((row) => requestedSurvey && String(row.survey_number).trim() === requestedSurvey) ||
    (surveyNumbers.length === 1 ? surveyNumbers[0] : null);

  let geometryPayload = null;
  if (selectedSurvey?.survey_number) {
    geometryPayload = await fetchGeometry({
      villageCode: hierarchy.village_code,
      surveyNumber: selectedSurvey.survey_number,
    });
  }

  return {
    provider: 'kgis',
    status: selectedSurvey ? 'matched' : 'candidates',
    confidence: selectedSurvey ? 0.65 : 0.45,
    message: selectedSurvey
      ? 'K-GIS hierarchy and survey geometry returned. Treat as reference only.'
      : 'K-GIS hierarchy returned multiple/no survey candidates. Analyst verification required.',
    hierarchy,
    survey_numbers: surveyNumbers,
    selected_survey: selectedSurvey,
    geometry_geojson: geometryPayload || null,
    raw: {
      hierarchy: hierarchyPayload,
      survey_numbers: surveyPayload,
      geometry: geometryPayload,
    },
    reference_only: true,
  };
};

module.exports = {
  fetchKgisContext,
};
