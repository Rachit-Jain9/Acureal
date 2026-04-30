import { useRef, useState } from 'react';
import { Upload, FileJson, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useImportZoneGeoJSON } from '../../hooks/useMasterPlan';
import { toast } from '../common/Toast';

const ACCEPT_TYPES = '.geojson,.json,application/geo+json,application/json';

function isFeatureCollection(parsed) {
  return parsed && typeof parsed === 'object' && parsed.type === 'FeatureCollection' && Array.isArray(parsed.features);
}

export default function ZoneGeoJsonImportButton() {
  const fileInputRef = useRef(null);
  const [overwriteGeom, setOverwriteGeom] = useState(false);
  const [summary, setSummary] = useState(null);
  const importMut = useImportZoneGeoJSON();

  const openFilePicker = () => {
    setSummary(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    let parsed;
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsText(file);
      });
      parsed = JSON.parse(text);
    } catch (err) {
      toast.error(`Could not read GeoJSON: ${err.message}`);
      return;
    }

    if (!isFeatureCollection(parsed)) {
      toast.error('File is not a GeoJSON FeatureCollection (missing type or features).');
      return;
    }

    if (parsed.features.length === 0) {
      toast.error('FeatureCollection has no features to import.');
      return;
    }

    try {
      const result = await importMut.mutateAsync({
        featureCollection: parsed,
        overwriteGeom,
      });
      setSummary({ ...result, file_name: file.name });
    } catch (err) {
      // toast already fired in the hook
      setSummary(null);
    }
  };

  const summaryHasContent = summary && (
    Number(summary.updated || 0) > 0
    || Number(summary.skipped_existing_geom || 0) > 0
    || Number(summary.skipped_unknown_zone || 0) > 0
    || Number(summary.rejected || 0) > 0
  );

  const summaryErrors = Array.isArray(summary?.errors) ? summary.errors.slice(0, 5) : [];
  const moreErrors = Array.isArray(summary?.errors) && summary.errors.length > 5
    ? summary.errors.length - 5
    : 0;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_TYPES}
        onChange={handleFileChange}
        className="sr-only"
        aria-label="GeoJSON file"
      />
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 text-xs text-content-secondary select-none">
          <input
            type="checkbox"
            checked={overwriteGeom}
            onChange={(event) => setOverwriteGeom(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-hairline text-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          Overwrite existing geometry
        </label>
        <button
          type="button"
          onClick={openFilePicker}
          disabled={importMut.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-hairline-strong text-content-primary text-sm hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-150"
        >
          {importMut.isPending ? (
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Upload size={14} />
          )}
          Import GeoJSON
        </button>
      </div>

      {summaryHasContent && (
        <div className="mt-3 p-3 rounded-md border border-hairline bg-bg-secondary/40 text-sm">
          <div className="flex items-center gap-2 text-content-primary font-medium">
            <FileJson size={14} className="text-content-muted" />
            {summary.file_name}
          </div>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <div className="text-content-muted">Received</div>
              <div className="text-content-primary font-medium tabular-nums">{summary.received ?? 0}</div>
            </div>
            <div>
              <div className="text-content-muted">Updated</div>
              <div className="text-content-primary font-medium tabular-nums flex items-center gap-1">
                {Number(summary.updated || 0) > 0 && <CheckCircle2 size={11} className="text-data-positive" />}
                {summary.updated ?? 0}
              </div>
            </div>
            <div>
              <div className="text-content-muted">Skipped (had geom)</div>
              <div className="text-content-primary font-medium tabular-nums">{summary.skipped_existing_geom ?? 0}</div>
            </div>
            <div>
              <div className="text-content-muted">Unmatched</div>
              <div className="text-content-primary font-medium tabular-nums">{summary.skipped_unknown_zone ?? 0}</div>
            </div>
          </div>

          {summaryErrors.length > 0 && (
            <div className="mt-3 pt-3 border-t border-hairline">
              <div className="flex items-center gap-1.5 text-content-secondary text-xs uppercase tracking-[0.08em] mb-1.5">
                <AlertTriangle size={11} />
                Issues
              </div>
              <ul className="text-xs text-content-secondary space-y-1">
                {summaryErrors.map((issue, idx) => (
                  <li key={`${issue.zone_code || 'feature'}-${idx}`}>
                    <span className="text-content-muted">#{issue.index}</span>{' '}
                    {issue.zone_code && <span className="font-mono">{issue.zone_code}</span>}{' '}
                    — {issue.reason}
                  </li>
                ))}
                {moreErrors > 0 && (
                  <li className="text-content-muted">+ {moreErrors} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
