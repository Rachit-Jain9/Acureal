import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal, Button, Badge, SkeletonList, ErrorState } from '../../design-system';
import { rentRollAPI } from '../../services/api';
import { useCommitImport } from '../../hooks/useRentRoll';
import { toast } from '../common/Toast';

// Register import — upload a filled Acureal template, review the staged preview
// (parsed server-side, no writes), then commit. The commit re-parses the file
// server-side (never trusts these preview rows), so what you see is exactly
// what lands. Family/version are validated on the server with readable errors.

const KIND_LABEL = {
  lease: 'Leases',
  sale: 'Free-sale units',
  occupant: 'Occupiers',
  hotel_key_block: 'Key inventory',
  hotel_contract: 'Contracts',
  hotel_operating_month: 'Operating months',
};

// A few key columns to preview per kind (the full set imports; this is a glance).
const PREVIEW_COLS = {
  lease: [['record_label', 'Unit'], ['tenant_name', 'Tenant'], ['status', 'Status'], ['chargeable_area_sqft', 'Area'], ['base_rent_rate', 'Rate']],
  sale: [['record_label', 'Plot'], ['status', 'Status'], ['area_sqft', 'Area'], ['base_price_per_sqft', '₹/sqft'], ['agreement_value', 'Agreement']],
  occupant: [['record_label', 'Unit'], ['occupant_name', 'Occupant'], ['status', 'Status'], ['existing_carpet_area_sqft', 'Existing'], ['transit_rent_monthly', 'Transit ₹/mo']],
  hotel_key_block: [['room_type', 'Room type'], ['keys_count', 'Keys'], ['ooo_pct', 'OOO %']],
  hotel_contract: [['record_label', 'Contract'], ['operator_name', 'Operator'], ['contract_type', 'Type']],
  hotel_operating_month: [['month', 'Month'], ['occupancy_pct', 'Occ %'], ['adr', 'ADR'], ['gop', 'GOP']],
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error('read failed'));
  reader.readAsDataURL(file);
});

const dash = <span className="text-content-muted">—</span>;
const cell = (v) => (v === null || v === undefined || v === '' ? dash : String(v));

export default function ImportRegisterButton({ dealId, variant = 'secondary', size = 'sm' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} leftIcon={<Upload size={14} />} onClick={() => setOpen(true)}>
        Import
      </Button>
      {open && <ImportModal dealId={dealId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImportModal({ dealId, onClose }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState(null);
  const [dataUrl, setDataUrl] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const commit = useCommitImport();

  const onPick = async (file) => {
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPreview(null);
    setDataUrl(null);
    setLoading(true);
    try {
      const url = await readFileAsDataUrl(file);
      const res = await rentRollAPI.previewImport(dealId, url);
      setDataUrl(url);
      setPreview(res.data.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'That file could not be read. Make sure it is a filled Acureal template (.xlsx).');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = () => {
    commit.mutate({ dealId, fileBase64: dataUrl }, {
      onSuccess: (res) => {
        const n = res?.data?.total ?? 0;
        toast.success(`Imported ${n} record${n === 1 ? '' : 's'}${fileName ? ` from ${fileName}` : ''}.`);
        onClose();
      },
    });
  };

  const total = preview?.totalRows ?? 0;
  const kinds = preview ? Object.entries(preview.kinds).filter(([, g]) => g.count > 0) : [];
  const warnings = preview?.warnings || [];

  return (
    <Modal
      open
      onClose={commit.isPending ? () => {} : onClose}
      closeOnOverlayClick={!commit.isPending}
      title="Import from template"
      description="Upload a filled Acureal template. Review what will be added, then import — nothing is saved until you confirm."
      size="lg"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-xs text-content-muted truncate max-w-[16rem]">
            {fileName
              ? <span className="inline-flex items-center gap-1.5"><FileSpreadsheet size={13} /> {fileName}</span>
              : 'No file selected'}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={commit.isPending}>Cancel</Button>
            <Button
              variant="primary"
              loading={commit.isPending}
              disabled={!preview || total === 0}
              onClick={handleImport}
              leftIcon={<Upload size={14} />}
            >
              {total > 0 ? `Import ${total} record${total === 1 ? '' : 's'}` : 'Import'}
            </Button>
          </div>
        </div>
      )}
    >
      {!preview && !loading && !error && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-hairline rounded-editorial p-8 text-center transition-colors duration-150 ease-out hover:border-accent/50 hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
        >
          <Upload size={22} className="mx-auto text-content-muted mb-2" />
          <div className="text-sm font-medium text-content-primary">Choose a filled template (.xlsx)</div>
          <div className="text-xs text-content-muted mt-1">
            Download a template from this register tab first, fill one row per record, then upload it here.
          </div>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
      />

      {loading && <div className="py-4"><SkeletonList rows={4} /></div>}

      {error && (
        <div className="space-y-3">
          <ErrorState tone="danger" title="That file couldn’t be imported">{error}</ErrorState>
          <Button variant="secondary" size="sm" leftIcon={<Upload size={14} />} onClick={() => inputRef.current?.click()}>
            Choose a different file
          </Button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm flex-wrap">
            {total > 0 ? (
              <>
                <CheckCircle2 size={16} className="text-data-positive" />
                <span className="text-content-primary font-medium">{total} record{total === 1 ? '' : 's'} ready</span>
                <span className="text-content-muted">across {kinds.length} section{kinds.length === 1 ? '' : 's'}</span>
              </>
            ) : (
              <>
                <AlertTriangle size={16} className="text-data-warning" />
                <span className="text-content-secondary">No records found — every data row in this template is blank.</span>
              </>
            )}
          </div>

          {preview.truncated && (
            <div className="text-xs text-data-warning">
              Only the first rows were read — the file exceeds the import row cap. Split it into smaller files and import each.
            </div>
          )}

          {kinds.map(([kind, group]) => (
            <div key={kind} className="border border-hairline rounded-editorial overflow-hidden">
              <div className="flex items-center justify-between bg-bg-secondary px-3 py-2">
                <span className="text-sm font-medium text-content-primary">{KIND_LABEL[kind] || kind}</span>
                <Badge tone="info">{group.count}</Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline-soft">
                      {(PREVIEW_COLS[kind] || []).map(([, h]) => (
                        <th key={h} className="px-3 py-1.5 text-left text-eyebrow uppercase tracking-[0.06em] text-content-muted font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.slice(0, 6).map((r, i) => (
                      <tr key={i} className="border-b border-hairline-soft last:border-0">
                        {(PREVIEW_COLS[kind] || []).map(([k]) => (
                          <td key={k} className="px-3 py-1.5 text-content-secondary tabular-nums">{cell(r[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {group.count > 6 && (
                  <div className="px-3 py-1.5 text-xs text-content-muted border-t border-hairline-soft">+{group.count - 6} more row{group.count - 6 === 1 ? '' : 's'}</div>
                )}
              </div>
            </div>
          ))}

          {warnings.length > 0 && (
            <details className="border border-hairline rounded-editorial">
              <summary className="cursor-pointer px-3 py-2 text-sm text-data-warning flex items-center gap-1.5 select-none">
                <AlertTriangle size={14} /> {warnings.length} cell{warnings.length === 1 ? '' : 's'} left out — click to review
              </summary>
              <ul className="px-3 pb-3 pt-1 space-y-1 max-h-40 overflow-y-auto">
                {warnings.slice(0, 60).map((w, i) => (
                  <li key={i} className="text-xs text-content-muted">
                    {(KIND_LABEL[w.kind] || w.kind)} · row {w.row}: {w.message}
                  </li>
                ))}
                {warnings.length > 60 && <li className="text-xs text-content-muted">…and {warnings.length - 60} more.</li>}
              </ul>
            </details>
          )}

          <p className="text-xs text-content-muted">
            These rows are <span className="text-content-secondary">added</span> to the register (existing records are kept). Values were read exactly as typed;
            anything invalid was left out and listed above. Re-parsed on import, so what you see is what lands.
          </p>
        </div>
      )}
    </Modal>
  );
}
