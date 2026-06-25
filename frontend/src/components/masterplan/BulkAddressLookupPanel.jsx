import { useMemo, useState } from 'react';
import { Sparkles, Copy, Check, RefreshCw, X, AlertTriangle, MapPin } from 'lucide-react';
import { Card, SectionHeader, ErrorState } from '../../design-system';
import Badge from '../common/Badge';
import { propertiesAPI } from '../../services/api';

/**
 * BulkAddressLookupPanel — paste up to 50 addresses, click Run, get a
 * table back of the auto-derived context (coordinates, BBMP zone, ward,
 * Planning District, K-GIS taluk, applicable-warning count) for each.
 *
 * Phase C-5 of the autonomous-window plan. Useful for screening a batch
 * of leads before deciding which become full deals.
 *
 * Throttling: 5 addresses processed in parallel (Google geocoding has
 * a 50-QPS limit; 5 keeps us well under and gives K-GIS room too). 50
 * addresses → ~10 batches × ~2s = ~20 seconds end-to-end.
 *
 * Honesty (CLAUDE.md):
 *   - Uses the same `/api/properties/auto-derive-context` endpoint as
 *     the per-deal AutoFillParcelContextCard. Same gating, same
 *     accuracy, same fall-through behaviour. No special bulk-mode
 *     shortcuts that could silently lower quality.
 *   - Per-row failures don't abort the batch — they're surfaced as
 *     "failed" status in the row so the operator sees what didn't
 *     resolve.
 *   - No CSV export (per operator standing rule from 2026-05-10:
 *     don't add CSV/export until explicitly asked). Copy-as-TSV
 *     button is provided because TSV pastes cleanly into Excel /
 *     Sheets without surfacing it as an "export" feature.
 */

const MAX_ADDRESSES = 50;
const CONCURRENCY = 5;

// Parse a textarea blob into a deduped, trimmed, non-empty list of
// addresses. Caps at MAX_ADDRESSES; returns the over-cap count for UX.
function parseAddresses(raw) {
  if (!raw) return { addresses: [], dropped: 0, overCap: 0 };
  const seen = new Set();
  const out = [];
  let dropped = 0;
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  const overCap = Math.max(0, out.length - MAX_ADDRESSES);
  return { addresses: out.slice(0, MAX_ADDRESSES), dropped, overCap };
}

// Tiny concurrency-limited runner. No external deps.
async function runWithConcurrency(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  const startWorker = async () => {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err };
      }
      completed += 1;
      onProgress?.(completed, items.length);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, startWorker);
  await Promise.all(workers);
  return results;
}

// Project an auto-derive payload into the columns the bulk table shows.
function projectRow(address, payload) {
  if (!payload) {
    return {
      address,
      status: 'failed',
      lat: null,
      lng: null,
      coord_source: null,
      coord_confidence: null,
      within_bbmp: null,
      bbmp_zone: null,
      bbmp_ward: null,
      bbmp_guidance_band: null,
      pd_code: null,
      pd_name: null,
      kgis_taluk: null,
      kgis_village: null,
      warning_count: 0,
      error: 'No payload returned',
    };
  }
  const c = payload.coordinates || {};
  const j = payload.bbmpJurisdiction || {};
  const z = payload.bbmpZone || {};
  const pd = payload.planningDistrict || {};
  const kh = payload.kgis?.hierarchy || {};
  const band =
    Number.isFinite(z.guidance_value_band_min_inr) && Number.isFinite(z.guidance_value_band_max_inr)
      ? `₹${Number(z.guidance_value_band_min_inr).toLocaleString('en-IN')}-${Number(
          z.guidance_value_band_max_inr,
        ).toLocaleString('en-IN')}`
      : null;
  const gated = payload.coordinatesGate?.gated;
  return {
    address,
    status: gated ? 'low_confidence' : payload.coordinates?.lat ? 'ok' : 'failed',
    lat: c.lat ?? null,
    lng: c.lng ?? null,
    coord_source: c.source ?? null,
    coord_confidence: typeof c.confidence === 'number' ? c.confidence : null,
    within_bbmp: j.withinBbmp ?? null,
    bbmp_zone: z.zone_code ?? null,
    bbmp_ward: j.ward?.ward_no ?? null,
    bbmp_guidance_band: band,
    pd_code: pd.pd_code ?? null,
    pd_name: pd.pd_name ?? null,
    kgis_taluk: kh.taluk ?? null,
    kgis_village: kh.village ?? null,
    warning_count: Array.isArray(payload.applicableWarnings) ? payload.applicableWarnings.length : 0,
    error: null,
  };
}

// Build a tab-separated representation suitable for paste-into-Excel.
function rowsToTsv(rows) {
  const header = [
    'Address',
    'Status',
    'Lat',
    'Lng',
    'Coord source',
    'Confidence',
    'Within BBMP',
    'BBMP zone',
    'BBMP ward',
    'Guidance band',
    'PD code',
    'PD name',
    'K-GIS taluk',
    'K-GIS village',
    'Warnings',
  ];
  const lines = [header.join('\t')];
  for (const r of rows) {
    lines.push(
      [
        r.address,
        r.status,
        r.lat ?? '',
        r.lng ?? '',
        r.coord_source ?? '',
        r.coord_confidence != null ? `${Math.round(r.coord_confidence * 100)}%` : '',
        r.within_bbmp === true ? 'Yes' : r.within_bbmp === false ? 'No' : '',
        r.bbmp_zone ?? '',
        r.bbmp_ward ?? '',
        r.bbmp_guidance_band ?? '',
        r.pd_code ?? '',
        r.pd_name ?? '',
        r.kgis_taluk ?? '',
        r.kgis_village ?? '',
        r.warning_count || '',
      ]
        .map((cell) => String(cell).replace(/\t/g, ' ').replace(/\n/g, ' '))
        .join('\t'),
    );
  }
  return lines.join('\n');
}

export default function BulkAddressLookupPanel() {
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const parsed = useMemo(() => parseAddresses(raw), [raw]);

  const handleRun = async () => {
    if (parsed.addresses.length === 0) return;
    setRunning(true);
    setError(null);
    setRows([]);
    setProgress({ done: 0, total: parsed.addresses.length });
    try {
      const results = await runWithConcurrency(
        parsed.addresses,
        CONCURRENCY,
        async (address) => {
          try {
            const resp = await propertiesAPI.autoDeriveContext({ address });
            return projectRow(address, resp.data?.data);
          } catch (err) {
            return {
              ...projectRow(address, null),
              error: err?.response?.data?.message || err?.message || 'Request failed',
            };
          }
        },
        (done, total) => setProgress({ done, total }),
      );
      setRows(results);
    } catch (err) {
      setError(err?.message || 'Bulk lookup failed');
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => {
    setRaw('');
    setRows([]);
    setError(null);
    setProgress({ done: 0, total: 0 });
  };

  const handleCopyTsv = async () => {
    if (rows.length === 0) return;
    try {
      await navigator.clipboard.writeText(rowsToTsv(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not write to clipboard. Try again or copy manually from the table.');
    }
  };

  const okCount = rows.filter((r) => r.status === 'ok').length;
  const lowConfCount = rows.filter((r) => r.status === 'low_confidence').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;

  return (
    <Card className="p-5" data-testid="bulk-lookup-panel">
      <SectionHeader
        icon={Sparkles}
        eyebrow="Bulk lookup"
        title="Bulk address → context lookup"
        sub={`Paste up to ${MAX_ADDRESSES} addresses (one per line). Each one runs through the same auto-derive pipeline as a deal's Parcel/Site tab — coordinates, BBMP zone, ward, Planning District, K-GIS taluk, applicable warnings. Useful for screening a batch of leads before creating deals.`}
        size="sm"
      />

      <div className="space-y-3">
        <div className="relative">
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={`100 Brigade Road, Bengaluru\nWhitefield Main Road\nBommanahalli Industrial Area, Bengaluru\n...`}
            rows={6}
            disabled={running}
            aria-label="Addresses (one per line)"
            className="w-full px-3 py-2 text-sm rounded-md border border-hairline bg-bg-elevated text-content-primary placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 font-mono leading-relaxed"
            data-testid="bulk-lookup-textarea"
          />
          {raw && (
            <button
              type="button"
              onClick={() => setRaw('')}
              disabled={running}
              className="absolute top-2 right-2 text-content-muted hover:text-content-primary p-1 rounded transition-colors duration-150 ease-out disabled:opacity-50"
              aria-label="Clear addresses"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-content-muted flex items-center gap-2 flex-wrap">
            <span data-testid="bulk-lookup-count">
              <span className="font-medium text-content-secondary tabular-nums">
                {parsed.addresses.length}
              </span>
              {' '}of {MAX_ADDRESSES} addresses
            </span>
            {parsed.dropped > 0 && (
              <span className="text-premium">
                · {parsed.dropped} duplicate{parsed.dropped === 1 ? '' : 's'} dropped
              </span>
            )}
            {parsed.overCap > 0 && (
              <span className="text-premium">
                · {parsed.overCap} over the cap (will be ignored)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {rows.length > 0 && !running && (
              <button
                type="button"
                onClick={handleClear}
                className="text-xs px-3 py-1.5 rounded-md border border-hairline text-content-secondary hover:bg-bg-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
                data-testid="bulk-lookup-clear"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={handleRun}
              disabled={running || parsed.addresses.length === 0}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-accent text-white hover:bg-accent-hover transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none"
              aria-label="Run bulk lookup"
              data-testid="bulk-lookup-run"
            >
              {running ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {running
                ? `Processing ${progress.done}/${progress.total}…`
                : `Run lookup on ${parsed.addresses.length || '…'} address${parsed.addresses.length === 1 ? '' : 'es'}`}
            </button>
          </div>
        </div>

        {error && (
          <ErrorState tone="warn" className="text-xs">
            {error}
          </ErrorState>
        )}

        {/* Progress bar during processing */}
        {running && progress.total > 0 && (
          <div className="h-1 w-full bg-bg-secondary rounded overflow-hidden" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <div
              className="h-full bg-accent transition-all duration-300 ease-out"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Badge tone="success">{okCount} ok</Badge>
                {lowConfCount > 0 && <Badge tone="warn">{lowConfCount} low-confidence</Badge>}
                {failedCount > 0 && <Badge tone="danger">{failedCount} failed</Badge>}
              </div>
              <button
                type="button"
                onClick={handleCopyTsv}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-hairline text-content-secondary hover:bg-bg-secondary hover:text-content-primary transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]"
                aria-label="Copy results as Excel-ready table"
                data-testid="bulk-lookup-copy-tsv"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy as Excel-ready table'}
              </button>
            </div>
            <BulkResultsTable rows={rows} />
          </>
        )}
      </div>
    </Card>
  );
}

function BulkResultsTable({ rows }) {
  return (
    <div className="overflow-x-auto border border-hairline rounded-md">
      <table className="w-full text-xs" data-testid="bulk-lookup-table">
        <thead className="bg-bg-secondary text-content-muted uppercase tracking-wider">
          <tr>
            <th className="text-left px-2 py-2 font-medium">Address</th>
            <th className="text-left px-2 py-2 font-medium">Status</th>
            <th className="text-left px-2 py-2 font-medium">Coords</th>
            <th className="text-left px-2 py-2 font-medium">Within BBMP</th>
            <th className="text-left px-2 py-2 font-medium">BBMP zone</th>
            <th className="text-left px-2 py-2 font-medium">Ward</th>
            <th className="text-left px-2 py-2 font-medium">Guidance band</th>
            <th className="text-left px-2 py-2 font-medium">Planning District</th>
            <th className="text-left px-2 py-2 font-medium">K-GIS taluk</th>
            <th className="text-left px-2 py-2 font-medium">Warnings</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((r, i) => (
            <tr
              key={`${r.address}-${i}`}
              className="hover:bg-bg-secondary/40 transition-colors duration-150"
              data-testid={`bulk-lookup-row-${i}`}
            >
              <td className="px-2 py-2 align-top">
                <div className="font-medium text-content-primary leading-snug min-w-[180px] max-w-[240px]">
                  {r.address}
                </div>
                {r.error && <p className="text-[10px] text-premium mt-0.5 flex items-center gap-1"><AlertTriangle size={9} />{r.error}</p>}
              </td>
              <td className="px-2 py-2 align-top">
                {r.status === 'ok' && <Badge tone="success">ok</Badge>}
                {r.status === 'low_confidence' && <Badge tone="warn">low conf</Badge>}
                {r.status === 'failed' && <Badge tone="danger">failed</Badge>}
              </td>
              <td className="px-2 py-2 align-top tabular-nums text-content-secondary">
                {Number.isFinite(r.lat) && Number.isFinite(r.lng) ? (
                  <span>{Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}</span>
                ) : <span className="text-content-muted">—</span>}
              </td>
              <td className="px-2 py-2 align-top">
                {r.within_bbmp === true && <Badge tone="success">Yes</Badge>}
                {r.within_bbmp === false && <Badge tone="neutral">No</Badge>}
                {r.within_bbmp === null && <span className="text-content-muted">—</span>}
              </td>
              <td className="px-2 py-2 align-top text-content-primary">
                {r.bbmp_zone ? `Zone ${r.bbmp_zone}` : <span className="text-content-muted">—</span>}
              </td>
              <td className="px-2 py-2 align-top tabular-nums text-content-secondary">
                {r.bbmp_ward != null ? r.bbmp_ward : <span className="text-content-muted">—</span>}
              </td>
              <td className="px-2 py-2 align-top tabular-nums text-content-secondary">
                {r.bbmp_guidance_band || <span className="text-content-muted">—</span>}
              </td>
              <td className="px-2 py-2 align-top">
                {r.pd_code ? (
                  <div className="text-content-primary leading-snug min-w-[120px] max-w-[180px]">
                    <span className="font-medium tabular-nums">{r.pd_code}</span>
                    {r.pd_name && <span className="block text-[10px] text-content-muted">{r.pd_name}</span>}
                  </div>
                ) : (
                  <span className="text-content-muted">—</span>
                )}
              </td>
              <td className="px-2 py-2 align-top text-content-secondary">
                {r.kgis_taluk ? (
                  <div className="leading-snug">
                    {r.kgis_taluk}
                    {r.kgis_village && <span className="block text-[10px] text-content-muted">/ {r.kgis_village}</span>}
                  </div>
                ) : (
                  <span className="text-content-muted">—</span>
                )}
              </td>
              <td className="px-2 py-2 align-top tabular-nums text-content-secondary">
                {r.warning_count > 0 ? (
                  <span className="inline-flex items-center gap-1 text-premium"><MapPin size={9} />{r.warning_count}</span>
                ) : (
                  <span className="text-content-muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Exported for tests
export const _internal = { parseAddresses, projectRow, rowsToTsv, MAX_ADDRESSES, CONCURRENCY };
