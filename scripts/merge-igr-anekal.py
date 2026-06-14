# -*- coding: utf-8 -*-
"""
Merge the deterministic Anekal-belt values (authoritative numbers, by column
position) with the vision-agent locality names (authoritative names), keyed on
(sro, sl_no). Emits a clean merged row set + a discrepancy report.

  - value_inr_per_sqm  <- deterministic (CLAUDE.md hard rule: numbers are
                          read from column position, never an LLM)
  - locality           <- vision agent (reads wrapped English names reliably)
  - land_use_type      <- vision agent
  - cross-check        <- deterministic value vs the agent's independently
                          read `value_seen`; mismatches are flagged, not
                          silently trusted.

Rows present in only one source are flagged (a deterministic value with no
agent name, or an agent row with no deterministic value) for a targeted re-check.
"""
import io, os, json

TMP = r'C:\Users\rachi\OneDrive - UW\Desktop\REDIP\backend\_pdf_tmp'
DET = os.path.join(TMP, 'igr_anekal_belt.json')           # deterministic rows
VIS = os.path.join(TMP, 'igr_vision_names.json')          # workflow result.pages
OUT = os.path.join(TMP, 'igr_anekal_merged.json')

det = json.load(open(DET, encoding='utf-8'))
visdoc = json.load(open(VIS, encoding='utf-8'))
vis_pages = visdoc.get('pages', visdoc) if isinstance(visdoc, dict) else visdoc

# Flatten vision rows -> {(sro, sl_no): {...}}
vis = {}
for pg in vis_pages:
    sro = pg['sro']
    for r in pg.get('rows', []):
        vis[(sro, int(r['sl_no']))] = {
            'locality': (r.get('locality_english') or '').strip(),
            'land_use_type': r.get('land_use_type') or 'residential',
            'value_seen': r.get('value_seen'),
            'page': pg['page'],
        }

det_map = {(d['sro'], int(d['sl_no'])): d for d in det}

merged, discrepancies = [], []
matched = mismatch_val = 0

for key, d in sorted(det_map.items()):
    sro, sl = key
    v = vis.get(key)
    if not v:
        discrepancies.append({'type': 'no_agent_name', 'sro': sro, 'sl_no': sl,
                              'page': d['page'], 'det_value_sqm': d['value_inr_per_sqm'],
                              'det_name': d['locality']})
        continue
    # cross-check the value
    vs = v.get('value_seen')
    ok = (vs is not None and abs(int(vs) - d['value_inr_per_sqm']) <= 1)
    if vs is not None and not ok:
        mismatch_val += 1
        discrepancies.append({'type': 'value_mismatch', 'sro': sro, 'sl_no': sl,
                              'page': d['page'], 'det_value_sqm': d['value_inr_per_sqm'],
                              'agent_value_seen': vs, 'name': v['locality']})
    else:
        matched += 1
    merged.append({
        'sro': sro,
        'sl_no': sl,
        'page': d['page'],
        'locality': v['locality'] or d['locality'],
        'value_inr_per_sqm': d['value_inr_per_sqm'],            # deterministic
        'value_inr_per_sqft': round(d['value_inr_per_sqm'] / 10.76391041671, 2),
        'land_use_type': v['land_use_type'],                    # vision
        'value_cross_checked': bool(ok),
    })

# Agent rows with no deterministic value (deterministic possibly missed a value)
for key, v in sorted(vis.items()):
    if key not in det_map:
        sro, sl = key
        discrepancies.append({'type': 'no_det_value', 'sro': sro, 'sl_no': sl,
                              'page': v['page'], 'agent_value_seen': v.get('value_seen'),
                              'name': v['locality']})

json.dump({'rows': merged, 'discrepancies': discrepancies}, io.open(OUT, 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

print('merged rows:', len(merged))
print('cross-check: %d matched, %d value-mismatch' % (matched, mismatch_val))
n = {}
for d in discrepancies:
    n[d['type']] = n.get(d['type'], 0) + 1
print('discrepancies:', n)
print('by sro:', {s: sum(1 for r in merged if r['sro'] == s) for s in ['Anekal', 'Attibele', 'Jigani']})
print('land_use:', {u: sum(1 for r in merged if r['land_use_type'] == u) for u in ['residential', 'commercial', 'industrial']})
print('wrote', OUT)
print('\n--- sample (Anekal p14) ---')
for r in merged:
    if r['sro'] == 'Anekal' and r['page'] == 14:
        flag = '' if r['value_cross_checked'] else '  [!val]'
        print('  %3d %-44s sqft=%-7.0f %s%s' % (r['sl_no'], r['locality'][:44], r['value_inr_per_sqft'], r['land_use_type'], flag))
