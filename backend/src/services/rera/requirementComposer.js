'use strict';

/**
 * requirementComposer — selects the requirement set for a deal context.
 *
 * Pure: filters the declarative catalog (`RERA_REQUIREMENTS`) by each item's
 * `applies_when` predicates (AND, via the rule evaluator), then groups the
 * survivors into buckets in catalog order, dropping empty buckets. The engine
 * then scores the resulting items against the deal's evidence.
 *
 * This is where asset-class / joint-development / conditional tailoring
 * happens — declaratively, not via copy-pasted overlays.
 */

const { RERA_BUCKETS, RERA_REQUIREMENTS } = require('../../constants/reraRequirementCatalog');
const { evaluateAll } = require('./ruleEvaluator');

const appliesToContext = (item, ctx) => {
  if (!item || !item.applies_when || item.applies_when.length === 0) return true;
  return evaluateAll(item.applies_when, ctx).passed;
};

const composeRequirements = (ctx = {}) => {
  const selected = RERA_REQUIREMENTS.filter((it) => appliesToContext(it, ctx));
  const byBucket = new Map();
  for (const it of selected) {
    if (!byBucket.has(it.bucket)) byBucket.set(it.bucket, []);
    byBucket.get(it.bucket).push(it);
  }
  const buckets = [];
  for (const meta of RERA_BUCKETS) {
    const items = byBucket.get(meta.id);
    if (items && items.length) buckets.push({ ...meta, items });
  }
  return buckets;
};

module.exports = { composeRequirements, appliesToContext };
