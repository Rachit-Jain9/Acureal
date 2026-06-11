// frontend/src/utils/bbmpRegister.js
// Single source of truth for "which BBMP UAV register is the HEADLINE band for
// this deal".
//
// The BBMP Guidance Value gazette carries TWO street registers — residential
// (pages 17-362) and non-residential (363-686). The SAME street can sit in a
// DIFFERENT UAV zone per register, so a commercial deal anchored on the
// residential band reads the wrong number.
//
// The parcelContext service keeps residential as the structural primary on
// purpose: it runs PRE-property (before the deal's use-type exists) and the band
// is a display/audit field — it is NEVER a FAR/buildability/kernel input (FAR
// joins on properties.zone_id, the reviewed RMP zone, not this BBMP band). So
// the use-type-aware choice of which register to HEADLINE belongs on the deal
// surfaces that already hold the deal's asset_class. This helper centralizes the
// rule so the two surfaces (DealPlanningSnapshot, DealStreetLookupCard) stay in
// lockstep.
//
// asset_class is the closed set in backend/src/constants/assetClasses.js:
//   residential_apartments, plotted_development, villas, commercial_office,
//   retail, industrial_warehousing, hospitality, mixed_use, raw_land,
//   redevelopment.
// NOTE: the values are commercial_office / industrial_warehousing — NOT
// 'commercial' / 'industrial'. A naive includes('commercial') would silently
// miss retail/industrial_warehousing/hospitality. mixed_use is deliberately
// EXCLUDED — its financial-model class maps to residential_apartments and it
// legitimately spans both registers, so we surface both bands rather than flip.

export const NON_RESIDENTIAL_ASSET_CLASSES = new Set([
  'commercial_office',
  'retail',
  'industrial_warehousing',
  'hospitality',
]);

export const prefersNonResidentialBand = (assetClass) =>
  NON_RESIDENTIAL_ASSET_CLASSES.has(assetClass);

/**
 * Pick the headline BBMP zone from a parcelContext `bbmpZone` payload.
 * bbmpZone is residential-primary with the non-residential register attached as
 * a nested `non_residential` twin. For a non-residential asset class, promote the
 * twin to headline (keeping residential as `residential_twin` so nothing is
 * hidden); otherwise return the residential band unchanged. Always falls back to
 * residential when the non-residential twin is absent (not every street is in
 * both registers). Adds `primary_register` so the UI can label which band leads.
 */
export const selectPrimaryBbmpZone = (bbmpZone, assetClass) => {
  if (!bbmpZone) return null;
  if (prefersNonResidentialBand(assetClass) && bbmpZone.non_residential?.zone_code) {
    const nr = bbmpZone.non_residential;
    return {
      ...nr,
      register: 'non_residential',
      primary_register: 'non_residential',
      residential_twin: {
        zone_code: bbmpZone.zone_code,
        zone_name: bbmpZone.zone_name,
        guidance_value_band_min_inr: bbmpZone.guidance_value_band_min_inr,
        guidance_value_band_max_inr: bbmpZone.guidance_value_band_max_inr,
      },
    };
  }
  return { ...bbmpZone, primary_register: bbmpZone.register || 'residential' };
};

/**
 * Pick the headline row from a flat BBMP street-index result (the useStreetLookup
 * rows, each carrying a `register` column, ordered by trigram match quality).
 * Prefer the wanted-register row for the SAME street as the top hit (so we never
 * headline a different street's zone), then any wanted-register row, then the top
 * hit. Rows with no `register` are treated as residential. For a residential /
 * unknown asset class this returns the top hit unchanged when the rows are
 * single-register (the legacy behavior).
 */
export const selectPrimaryStreetRow = (rows, assetClass) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const top = rows[0];
  const wantNonRes = prefersNonResidentialBand(assetClass);
  const isWanted = (r) =>
    wantNonRes ? r.register === 'non_residential' : (!r.register || r.register === 'residential');
  return (
    rows.find((r) => isWanted(r) && r.street_name_en === top?.street_name_en)
    || rows.find((r) => isWanted(r))
    || top
    || null
  );
};
