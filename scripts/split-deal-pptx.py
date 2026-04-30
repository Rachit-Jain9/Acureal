"""One-shot splitter for dealPptx.service.js — see PR refactor branch.

Reads backend/src/services/dealPptx.service.js and emits 5 modules under
backend/src/services/exports/pptx/. Idempotent: re-running overwrites.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'backend', 'src', 'services', 'dealPptx.service.js')
OUT = os.path.join(ROOT, 'backend', 'src', 'services', 'exports', 'pptx')

with open(SRC, 'r', encoding='utf-8') as f:
    lines = f.readlines()

if len(lines) != 2292:
    print(f"WARN: expected 2292 lines, got {len(lines)}", file=sys.stderr)


def slice_lines(start_1, end_1):
    return ''.join(lines[start_1 - 1:end_1])


HELPERS_HEADER = """'use strict';

/**
 * Pure helpers + constants for the PPTX deal-deck pipeline.
 *
 * Extracted from the original dealPptx.service.js (2,292 LOC) as part of
 * the Bet 3 god-service decomposition. Every export here is dependency-
 * free or only depends on other exports from this same file.
 */

"""

HELPERS_FOOTER = """
module.exports = {
  FONT,
  COLORS,
  ASSET_CLASS_LABELS,
  DEAL_TYPE_LABELS,
  DEAL_STRUCTURE_LABELS,
  STAGE_LABELS,
  PRIORITY_LABELS,
  INCOME_ASSETS,
  LAND_LED_ASSETS,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  resolveStatusText,
  dedupeByTitle,
  severityRank,
  normalizeStructureFamily,
  hasStructureMismatch,
  getAssetClassLabel,
  getDealTypeLabel,
  getDealStructureLabel,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
};
"""

CONTENT_HEADER = """'use strict';

/**
 * Content row + commentary builders for the PPTX deal-deck pipeline.
 *
 * Each `buildXxxRows`/`buildXxxCommentary`/`buildXxxPoints` function takes
 * the merged deal+kpis+market context (and sometimes the raw exportContext)
 * and returns a typed shape ready to render. Slide renderers consume these
 * via the `context.slideManifest` data plumbed by deckContext.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const {
  COLORS,
  ASSET_CLASS_LABELS,
  STAGE_LABELS,
  PRIORITY_LABELS,
  INCOME_ASSETS,
  LAND_LED_ASSETS,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  resolveStatusText,
  dedupeByTitle,
  severityRank,
  hasStructureMismatch,
  getAssetClassLabel,
  getDealTypeLabel,
  getDealStructureLabel,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
} = require('./_helpers');

"""

CONTENT_FOOTER = """
module.exports = {
  buildDerivedRiskRows,
  buildFinancialRows,
  buildFinancialCommentary,
  buildTransactionCommentary,
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
  buildMarketObservations,
  buildAssetNarrative,
  buildCounterpartyRows,
  buildLocationRows,
  buildAssetDetailRows,
  buildProjectRows,
  buildApprovalRows,
  buildDiligenceRows,
  buildTransactionRows,
  buildRiskRows,
  buildNextStepGroups,
};
"""

DECK_HEADER = """'use strict';

/**
 * Deck context builder. Composes deal + financials + market data into a
 * normalized `context` object plus a `slideManifest` array that the
 * orchestrator iterates over.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const { inferAssetClass } = require('../../../utils/assetClass');
const {
  COLORS,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  dedupeByTitle,
  severityRank,
  hasStructureMismatch,
  getAssetClassLabel,
  getDealTypeLabel,
  getDealStructureLabel,
  isIncomeAsset,
  isLandLedAsset,
  isStructuredDeal,
  midpoint,
  filterRows,
} = require('./_helpers');
const {
  buildDerivedRiskRows,
  buildFinancialRows,
  buildFinancialCommentary,
  buildTransactionCommentary,
  buildExecutiveSummaryPoints,
  buildInvestmentHighlights,
  buildMarketObservations,
  buildAssetNarrative,
  buildCounterpartyRows,
  buildLocationRows,
  buildAssetDetailRows,
  buildProjectRows,
  buildApprovalRows,
  buildDiligenceRows,
  buildTransactionRows,
  buildRiskRows,
  buildNextStepGroups,
} = require('./contentBuilders');

"""

DECK_FOOTER = """
module.exports = {
  buildSlideManifest,
  buildDeckContext,
};
"""

PRIMS_HEADER = """'use strict';

/**
 * pptxgenjs render primitives — slide-level building blocks shared across
 * every renderXxx function. Sets defaults, draws the top header, builds
 * cards / KPI tiles / bullet lists / tables, paints section dividers.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const { COLORS, FONT, truncate } = require('./_helpers');

"""

PRIMS_FOOTER = """
module.exports = {
  setSlideDefaults,
  addTopHeader,
  addCard,
  addKpiCard,
  addBulletList,
  addTable,
  addSectionDivider,
};
"""

SLIDES_HEADER = """'use strict';

/**
 * Slide renderers. Each renderXxx takes (pptx, slide, context,
 * pageNumber, totalSlides) and paints one slide's content using the
 * primitives. Pure presentation — all data shaping happened upstream in
 * contentBuilders + deckContext.
 *
 * Extracted from the original dealPptx.service.js as part of the Bet 3
 * god-service decomposition.
 */

const {
  COLORS,
  FONT,
  num,
  firstNumber,
  positiveNumber,
  firstText,
  humanize,
  formatNumber,
  formatCrores,
  formatPct,
  formatArea,
  formatRate,
  formatRent,
  formatDate,
  truncate,
  pickSeverityColor,
  resolveStatusText,
  dedupeByTitle,
  hasStructureMismatch,
  isIncomeAsset,
  isLandLedAsset,
  midpoint,
  filterRows,
} = require('./_helpers');
const {
  setSlideDefaults,
  addTopHeader,
  addCard,
  addKpiCard,
  addBulletList,
  addTable,
  addSectionDivider,
} = require('./primitives');

"""

SLIDES_FOOTER = """
module.exports = {
  renderCover,
  renderContents,
  renderExecutiveSummary,
  renderInvestmentHighlights,
  renderStructure,
  renderMarketPositioning,
  renderLocationContext,
  renderAssetSnapshot,
  renderReadiness,
  renderFinancialOverview,
  renderCashFlowSensitivity,
  renderTransactionSummary,
  renderRisksMitigants,
  renderNextSteps,
  renderDisclaimer,
};
"""

writes = [
    ('_helpers.js',         HELPERS_HEADER + slice_lines(6, 250)        + HELPERS_FOOTER),
    ('contentBuilders.js',  CONTENT_HEADER + slice_lines(251, 984)      + CONTENT_FOOTER),
    ('deckContext.js',      DECK_HEADER    + slice_lines(985, 1200)     + DECK_FOOTER),
    ('primitives.js',       PRIMS_HEADER   + slice_lines(1201, 1386)    + PRIMS_FOOTER),
    ('slides.js',           SLIDES_HEADER  + slice_lines(1387, 2238)    + SLIDES_FOOTER),
]

os.makedirs(OUT, exist_ok=True)
for name, content in writes:
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(content)
    nl = sum(1 for _ in open(p, encoding='utf-8'))
    print(f"  {name}: {nl} lines")

print("Done.")
