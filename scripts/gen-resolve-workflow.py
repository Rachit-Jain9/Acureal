# -*- coding: utf-8 -*-
"""Generate the discrepancy-resolution workflow .js with the manifest embedded."""
import json

MAN = r'C:\Users\rachi\OneDrive - UW\Desktop\Acureal\backend\_pdf_tmp\igr_disc_manifest.json'
OUT = r'C:\Users\rachi\OneDrive - UW\Desktop\Acureal\backend\_pdf_tmp\resolve_workflow.js'

manifest = json.load(open(MAN, encoding='utf-8'))
mjson = json.dumps(manifest, ensure_ascii=False)

JS = r'''export const meta = {
  name: 'igr-discrepancy-resolution',
  description: 'Adjudicate the rows where the deterministic value and the vision name disagreed: re-read each page, pick the correct per-sq.m value, classify developed-land vs agricultural vs apartment, and give a clean locality name.',
  phases: [{ title: 'Resolve' }],
}

const MANIFEST = __MANIFEST__

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { resolutions: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: {
      sl_no: { type: 'integer' },
      category: { type: 'string', enum: ['developed_land', 'agricultural', 'apartment', 'other'] },
      value_inr_per_sqm: { type: ['integer', 'null'] },
      locality_english: { type: 'string' },
      land_use_type: { type: 'string', enum: ['residential', 'commercial', 'industrial'] },
    },
    required: ['sl_no', 'category', 'value_inr_per_sqm', 'locality_english', 'land_use_type'],
  } } }, required: ['resolutions'],
}

function itemLine(it) {
  if (it.kind === 'pick_value') {
    return '  - Sl.No ' + it.sl_no + ' ("' + it.name_hint + '"): two readings disagree on the developed-land rate: ' + it.candidates[0] + ' vs ' + it.candidates[1] + '. Read the C4/C5/C6 cell and report the value ACTUALLY printed.'
  }
  if (it.kind === 'confirm') {
    return '  - Sl.No ' + it.sl_no + ' ("' + it.name_hint + '"): confirm the developed-land rate (one pass read ' + it.det_value + ') and give the CLEAN locality name (strip any "Survey Numbers near to..." boilerplate -- keep just the village/layout/street name).'
  }
  return '  - Sl.No ' + it.sl_no + ' ("' + it.name_hint + '"): classify this row -- DEVELOPED LAND (a real per-sq.m site rate in C4/C5/C6, >= ~1000), AGRICULTURAL (only C7, a small per-acre number), or APARTMENT (C8 / named as an Apartment building)? One pass read ' + it.agent_value + '.'
}

function buildPrompt(pg) {
  const lines = pg.items.map(itemLine).join('\n')
  return 'Use the Read tool on this EXACT image path: ' + pg.path + '\n\n'
    + 'This is page ' + pg.page + ' of the ' + pg.sro + ' Sub-Registrar Office IGR guidance-value gazette (2023-24). Ruled 8-column table:\n'
    + '  C1 Sl.No | C2 Kannada name | C3 English name\n'
    + '  C4 Competent-authority residential sites (Rs/sq.m) | C5 Local-body residential sites (Rs/sq.m) | C6 Villa/row-house (Rs/sq.m)\n'
    + '  C7 Agricultural land (per ACRE, small numbers like 47/120) | C8 Apartments (per built-up area)\n\n'
    + 'ADJUDICATE these specific rows (two earlier passes disagreed). Look VERY carefully at each exact row:\n'
    + lines + '\n\n'
    + 'For each Sl.No return:\n'
    + '  - category: "developed_land" (a genuine per-sq.m C4-C6 site rate), "agricultural" (only C7 per-acre), "apartment" (C8 / apartment building), or "other".\n'
    + '  - value_inr_per_sqm: the developed-land per-sq.m rate (C4-C6) if category is developed_land; otherwise null. Read the digits EXACTLY as printed.\n'
    + '  - locality_english: the clean English locality name (no Kannada, no survey-number boilerplate).\n'
    + '  - land_use_type: industrial if Industrial/KIADB; commercial if commercial/shops/market/plaza/complex; else residential.\n\n'
    + 'Read the exact printed digits. Never guess. Return JSON {"resolutions":[...]}.'
}

phase('Resolve')
log('adjudicating ' + MANIFEST.reduce(function (n, p) { return n + p.items.length }, 0) + ' rows across ' + MANIFEST.length + ' pages')
const CHUNK = 5
const out = []
for (let i = 0; i < MANIFEST.length; i += CHUNK) {
  const batch = MANIFEST.slice(i, i + CHUNK)
  const r = await parallel(batch.map(function (pg) {
    return function () {
      return agent(buildPrompt(pg), { label: pg.sro + ' p' + pg.page + ' (resolve)', phase: 'Resolve', agentType: 'general-purpose', schema: SCHEMA })
        .then(function (res) { return { sro: pg.sro, page: pg.page, resolutions: (res && res.resolutions) || [] } })
        .catch(function () { return { sro: pg.sro, page: pg.page, resolutions: [], failed: true } })
    }
  }))
  out.push.apply(out, r.filter(Boolean))
  log('progress ' + Math.min(i + CHUNK, MANIFEST.length) + '/' + MANIFEST.length)
}
return { resolved: out, total: out.reduce(function (n, p) { return n + p.resolutions.length }, 0), failed: out.filter(function (p) { return p.failed }).map(function (p) { return p.sro + ' p' + p.page }) }
'''

JS = JS.replace('__MANIFEST__', mjson)
open(OUT, 'w', encoding='utf-8').write(JS)
print('wrote', OUT, len(JS), 'chars;', len(manifest), 'pages')
