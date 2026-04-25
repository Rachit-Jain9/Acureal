const VALUE_PATTERN = /(?:Rs\.?|INR)?\s*([0-9][0-9,]{2,}(?:\.\d+)?)\s*(?:per\s*)?(sq\.?\s*ft|sqft|sft|square\s*feet|acre|gunta)?/i;

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const parseAmount = (value) => {
  if (!value) return null;
  const numeric = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

const inferUnit = (unitText) => {
  const unit = String(unitText || '').toLowerCase();
  if (unit.includes('acre')) return 'acre';
  if (unit.includes('gunta')) return 'gunta';
  return 'sqft';
};

const parseGuidanceText = (text, meta = {}) => {
  const rows = [];
  const reviewQueue = [];

  String(text || '')
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean)
    .forEach((line, index) => {
      const match = line.match(VALUE_PATTERN);
      if (!match) return;

      const value = parseAmount(match[1]);
      const unit = inferUnit(match[2]);
      if (!value) return;

      const left = clean(line.slice(0, match.index));
      const parts = left.split(/\s{2,}|[,|;-]/).map(clean).filter(Boolean);
      const locality = parts[parts.length - 2] || parts[0] || '';
      const road = parts[parts.length - 1] || '';
      const confidence = locality ? (road ? 0.66 : 0.52) : 0.35;

      const parsed = {
        sro_name: meta.sro_name || null,
        locality,
        road_name: road,
        land_use_type: meta.land_use_type || 'residential',
        value,
        unit_type: unit,
        source_page: meta.page_number || null,
        source_section: meta.source_section || `Line ${index + 1}`,
        confidence,
        raw_text: line,
      };

      rows.push(parsed);
      if (confidence < 0.7) {
        reviewQueue.push({
          reason: 'low_confidence_igr_row_parse',
          ...parsed,
        });
      }
    });

  return {
    adapter: 'igr_pdf',
    status: rows.length ? 'parsed_for_review' : 'no_rows_detected',
    rows,
    review_queue: reviewQueue,
    message: rows.length
      ? 'IGR PDF text produced candidate guidance-value rows. Human review is required before approval.'
      : 'No guidance-value rows were detected in the supplied text.',
  };
};

module.exports = {
  parseGuidanceText,
};
