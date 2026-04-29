'use strict';

/**
 * Authority verification links, contextualised with the parcel's known
 * identifiers so the analyst lands on the portal with a copy-paste payload
 * instead of a blank form.
 *
 * Honesty rules:
 * - Never fabricate a query-string format that the official portal doesn't
 *   actually accept. Karnataka land/registry/RERA portals are mostly aspx
 *   postback flows or require auth — deep links don't work.
 * - When the portal accepts a deep link (we know it does for K-GIS Cadastral
 *   Atlas via lat/lng + zoom), construct it.
 * - Otherwise return the canonical homepage and a `copy_text` payload the
 *   analyst can paste into the portal's first form field.
 *
 * Inputs:
 *   property: full row from properties (lat, lng, survey_number, pid,
 *     khata_no, bhoomi_id, rera_registration_number, address, city)
 *   kgis:     formatted K-GIS payload from parcelIntelligence.service
 *     (hierarchy.{district,taluk,hobli,village} + survey_numbers[])
 *
 * Output:
 *   Array of link descriptors. Each has the same shape so the frontend can
 *   render a uniform list and the verify-item dialog can consume any one.
 */

const HOMEPAGES = {
  kaveri: 'https://kaveri.karnataka.gov.in/landing-page',
  bhoomi_rtc: 'https://landrecords.karnataka.gov.in/Service2/',
  bbmp_eaasthi: 'https://www.bbmpeaasthi.karnataka.gov.in/',
  igr_guidance: 'https://igr.karnataka.gov.in/page/Revised%2BGuidelines%2BValue/en',
  rera: 'https://rera.karnataka.gov.in/home/searchProjects',
  kgis_protocol: 'https://ksrsac.in/web/sites/default/files/projects/2018-02/K-GIS%20Data%20Exchange%20Protocol.pdf',
  // K-GIS hosts its public viewer at /kgis/. The /cadastral/ path was an
  // assumption that 404'd in production — it does not accept lat/lng deep
  // links. Use the viewer homepage and surface lat/lng in the copy payload
  // so the analyst can paste into the viewer's search box.
  kgis_viewer: 'https://kgis.ksrsac.in/kgis/',
};

const trim = (value) => (value == null ? '' : String(value).trim());

const firstSurveyNumber = (kgis) => {
  if (kgis?.survey_numbers && kgis.survey_numbers.length) {
    const first = kgis.survey_numbers[0];
    return trim(typeof first === 'string' ? first : first?.survey_number || '');
  }
  return '';
};

const collectSurveyNumbers = (property, kgis) => {
  const fromKgis = (kgis?.survey_numbers || [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.survey_number))
    .filter(Boolean)
    .map(trim);
  const fromProperty = trim(property?.survey_number);
  return Array.from(new Set([fromProperty, ...fromKgis].filter(Boolean)));
};

const buildContextLines = ({ surveyNumbers, hierarchy = {}, property = {} }) => {
  const out = [];
  if (surveyNumbers.length) out.push(`Survey No: ${surveyNumbers.join(', ')}`);
  if (hierarchy.village) out.push(`Village: ${hierarchy.village}`);
  if (hierarchy.hobli) out.push(`Hobli: ${hierarchy.hobli}`);
  if (hierarchy.taluk) out.push(`Taluk: ${hierarchy.taluk}`);
  if (hierarchy.district) out.push(`District: ${hierarchy.district}`);
  if (property.pid) out.push(`PID: ${property.pid}`);
  if (property.khata_no) out.push(`Khata No: ${property.khata_no}`);
  if (property.bhoomi_id) out.push(`Bhoomi ID: ${property.bhoomi_id}`);
  if (property.rera_registration_number) out.push(`RERA: ${property.rera_registration_number}`);
  return out;
};

const presence = (value) => (value ? 'present' : 'missing');

const buildVerificationLinks = ({ property = {}, kgis = {} } = {}) => {
  const hierarchy = kgis?.hierarchy || {};
  const surveyNumbers = collectSurveyNumbers(property, kgis);
  const contextLines = buildContextLines({ surveyNumbers, hierarchy, property });
  const surveyNo = firstSurveyNumber(kgis) || trim(property.survey_number);

  const links = [];

  // ── Bhoomi RTC ────────────────────────────────────────────────────────
  // Public portal is an aspx postback flow — no deep link. We surface the
  // exact field values to type and a copy-paste payload.
  links.push({
    key: 'bhoomi_rtc',
    label: 'Bhoomi RTC',
    authority: 'Karnataka Revenue Dept.',
    purpose: 'Pull the latest Record of Rights (RTC/Pahani) for this survey.',
    href: HOMEPAGES.bhoomi_rtc,
    deep_link: false,
    status: surveyNo && hierarchy.village ? 'ready' : 'inputs_missing',
    hint: surveyNo
      ? `Choose ${hierarchy.district || '<district>'} → ${hierarchy.taluk || '<taluk>'} → ${hierarchy.hobli || '<hobli>'} → ${hierarchy.village || '<village>'}, then enter Survey No ${surveyNo}.`
      : 'Add a survey number on the property to use this lookup.',
    inputs: {
      survey_number: presence(surveyNo),
      district: presence(hierarchy.district),
      taluk: presence(hierarchy.taluk),
      hobli: presence(hierarchy.hobli),
      village: presence(hierarchy.village),
    },
    copy_text: contextLines.join(' | '),
  });

  // ── Kaveri (encumbrance) ──────────────────────────────────────────────
  // Auth-walled. Same approach: hint + copy-paste.
  links.push({
    key: 'kaveri_ec',
    label: 'Kaveri EC',
    authority: 'Karnataka Stamps & Registration',
    purpose: 'Look up the encumbrance certificate (mortgages, charges, transfers).',
    href: HOMEPAGES.kaveri,
    deep_link: false,
    status: surveyNo ? 'ready' : 'inputs_missing',
    hint: surveyNo
      ? `Sign in, choose Encumbrance, then search SRO ${hierarchy.taluk || '<taluk>'} for survey ${surveyNo}.`
      : 'Add a survey number on the property to use this lookup.',
    inputs: {
      survey_number: presence(surveyNo),
      taluk: presence(hierarchy.taluk),
    },
    copy_text: contextLines.join(' | '),
  });

  // ── BBMP e-Aasthi ─────────────────────────────────────────────────────
  // PID-based lookup; portal needs login. Show the PID/Khata payload.
  links.push({
    key: 'bbmp_eaasthi',
    label: 'BBMP e-Aasthi',
    authority: 'Bruhat Bengaluru Mahanagara Palike',
    purpose: 'Verify property tax, e-Khata, and ownership name on record.',
    href: HOMEPAGES.bbmp_eaasthi,
    deep_link: false,
    status: property.pid || property.khata_no ? 'ready' : 'inputs_missing',
    hint: property.pid
      ? `Sign in and enter PID ${property.pid}.`
      : property.khata_no
        ? `Sign in and enter Khata No ${property.khata_no}.`
        : 'Add PID or Khata number on the property to use this lookup.',
    inputs: {
      pid: presence(property.pid),
      khata_no: presence(property.khata_no),
    },
    copy_text: [
      property.pid ? `PID: ${property.pid}` : null,
      property.khata_no ? `Khata No: ${property.khata_no}` : null,
      property.address ? `Address: ${property.address}` : null,
    ].filter(Boolean).join(' | '),
  });

  // ── K-RERA ────────────────────────────────────────────────────────────
  links.push({
    key: 'rera',
    label: 'K-RERA Project',
    authority: 'Karnataka Real Estate Regulatory Authority',
    purpose: 'Confirm RERA registration status and approved plans.',
    href: HOMEPAGES.rera,
    deep_link: false,
    status: property.rera_registration_number ? 'ready' : 'inputs_missing',
    hint: property.rera_registration_number
      ? `Search for project number ${property.rera_registration_number}.`
      : 'Add a RERA registration number on the property to use this lookup.',
    inputs: {
      rera_registration_number: presence(property.rera_registration_number),
    },
    copy_text: property.rera_registration_number
      ? `RERA: ${property.rera_registration_number}`
      : '',
  });

  // ── IGR Guidance Value ────────────────────────────────────────────────
  links.push({
    key: 'igr_guidance',
    label: 'IGR Guidance',
    authority: 'Inspector General of Registration (Karnataka)',
    purpose: 'Cross-check the published guidance value (circle rate) for the locality.',
    href: HOMEPAGES.igr_guidance,
    deep_link: false,
    status: hierarchy.village || property.address ? 'ready' : 'inputs_missing',
    hint: hierarchy.village
      ? `Open the latest district PDF for ${hierarchy.district || '<district>'}, then find ${hierarchy.village} (${hierarchy.hobli || ''}).`
      : 'Add a parcel address or refresh K-GIS to surface the village name.',
    inputs: {
      district: presence(hierarchy.district),
      village: presence(hierarchy.village),
      address: presence(property.address),
    },
    copy_text: contextLines.join(' | '),
  });

  // ── K-GIS Cadastral Atlas (homepage link + copy-paste coords) ─────────
  // The K-GIS viewer does NOT accept lat/lng query parameters — the previous
  // deep-link URL 404'd in production. Now we link to the viewer homepage
  // and surface the coords in the copy payload so the analyst can paste
  // into the viewer's search box.
  const lat = property.lat;
  const lng = property.lng;
  const hasCoords = lat != null && lng != null;
  links.push({
    key: 'kgis_cadastral',
    label: 'K-GIS Cadastral',
    authority: 'Karnataka State Remote Sensing Applications Centre',
    purpose: 'Cross-check zoning overlays, land-use, and survey boundaries on the master map.',
    href: HOMEPAGES.kgis_viewer,
    deep_link: false,
    status: hasCoords ? 'ready' : 'inputs_missing',
    hint: hasCoords
      ? 'Opens the K-GIS viewer; paste the copied lat/lng into the search box.'
      : 'Geocode the property to enable the K-GIS workflow.',
    inputs: {
      lat: presence(lat),
      lng: presence(lng),
    },
    copy_text: hasCoords ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : '',
  });

  // ── Google Maps satellite (true deep-link, universally reliable) ──────
  // Independent visual verification of the parcel location. The K-GIS
  // viewer is the canonical regulatory source, but Google's satellite
  // imagery is current and the URL pattern is stable (no auth, no CAPTCHA).
  if (hasCoords) {
    const latStr = Number(lat).toFixed(6);
    const lngStr = Number(lng).toFixed(6);
    links.push({
      key: 'google_maps_satellite',
      label: 'Google Maps satellite',
      authority: 'Google Maps imagery',
      purpose: 'Visually confirm the parcel location, road frontage, and surroundings on current satellite imagery.',
      href: `https://www.google.com/maps/@${latStr},${lngStr},19z/data=!3m1!1e3`,
      deep_link: true,
      status: 'ready',
      hint: 'Opens the satellite view centred on the parcel pin.',
      inputs: {
        lat: presence(lat),
        lng: presence(lng),
      },
      copy_text: `${latStr}, ${lngStr}`,
    });
  }

  return links;
};

module.exports = {
  buildVerificationLinks,
  HOMEPAGES,
};
