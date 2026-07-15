import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Modal, Button, Checkbox } from '../../design-system';
import { toast } from '../common/Toast';
import { rentRollAPI } from '../../services/api';
import { buildRegisterPrefill } from '../../utils/rentRollPrefill';
import { stashPrefill } from '../../utils/programmeToInputs';

// Controlled register → financial-model handoff (plan v2, critique-adopted):
// never a blind prefill. Shows current model input vs register-derived value
// per field; the operator accepts field-by-field; Apply freezes an immutable
// register snapshot and carries its id + content hash as provenance, so the
// saved model can always cite exactly which version of the evidence seeded it.

const fmtValue = (v, unit) => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const grouped = n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  if (unit === 'sqft') return `${grouped} sqft`;
  if (unit === '%') return `${grouped}%`;
  if (unit === '₹/sqft/mo') return `₹${grouped}`;
  return grouped;
};

const compactINR = (n) => {
  if (!Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
};

const differs = (current, derived) => {
  const c = Number(current);
  if (current === null || current === undefined || current === '' || !Number.isFinite(c)) return true;
  // Meaningful divergence only — a 103.33 vs 103.3 rounding echo is not a change.
  return Math.abs(c - derived) > Math.max(Math.abs(derived) * 0.001, 0.005);
};

export default function ApplyToFinancialsModal({
  open,
  dealId,
  assetClass,
  records,
  register,
  currentInputs,   // saved model_params.inputs (canonical keys), or null pre-model
  onClose,
}) {
  const navigate = useNavigate();
  const [applying, setApplying] = useState(false);

  const proposal = useMemo(
    // Pass the whole kind-map — the mapper picks lease vs sale rows by class.
    () => buildRegisterPrefill({ records, register, assetClass }),
    [records, register, assetClass],
  );

  // Default selection: fields where the register actually moves the model.
  const [accepted, setAccepted] = useState(() => new Set(
    (proposal.fields || [])
      .filter((f) => differs(currentInputs?.[f.name], f.derived))
      .map((f) => f.name),
  ));

  const toggle = (name) => setAccepted((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  const handleApply = async () => {
    setApplying(true);
    try {
      // Freeze the evidence FIRST — the snapshot id + hash are the provenance
      // the saved model will cite, and the staleness checks compare against.
      const res = await rentRollAPI.createSnapshot(dealId, {
        label: 'Applied to financials',
        trigger: 'apply_to_financials',
      });
      const snapshot = res.data.data;

      const payload = { __prefilledFrom: 'rent_roll', __prefilledAt: new Date().toISOString(), __prefilledAssetClass: assetClass };
      const acceptedFields = [];
      for (const f of proposal.fields) {
        if (!accepted.has(f.name)) continue;
        payload[f.name] = String(f.derived);
        acceptedFields.push({ name: f.name, value: f.derived, previous: currentInputs?.[f.name] ?? null });
      }
      payload.__rentRollProvenance = {
        ...proposal.provenance,
        snapshotId: snapshot.id,
        dataHash: snapshot.data_hash,
        acceptedFields,
      };

      // Staging can fail (private mode / storage quota) — never navigate as
      // if it worked. The snapshot already exists, which is harmless: it is
      // labelled and auditable, and re-applying will freeze a fresh one.
      if (!stashPrefill(dealId, payload)) {
        toast.error('Your browser blocked session storage, so nothing was staged. Re-try, or enter the values on the Financials page directly.');
        return;
      }
      onClose();
      navigate(`/dashboard/financials/${dealId}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not snapshot the register — nothing was applied.');
    } finally {
      setApplying(false);
    }
  };

  if (!proposal.supported) {
    return (
      <Modal open={open} onClose={onClose} title="Apply to Financials" size="md"
        footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <p className="text-sm text-content-secondary">{proposal.reason}</p>
      </Modal>
    );
  }

  // Supported class, but no model INPUT is derivable yet (e.g. sourcing-stage
  // rows with no areas or rates). Say so honestly — and still surface any cost
  // signal (e.g. a redevelopment rehousing obligation), which is the register's
  // core output and must never disappear behind a "nothing derivable" message.
  if (proposal.fields.length === 0) {
    return (
      <Modal open={open} onClose={onClose} title="Apply register to Financials" size="md"
        footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
        <p className="text-sm text-content-secondary">
          {proposal.costSignal
            ? 'No model inputs can be derived from the register yet, but it surfaces an obligation to carry into the model manually:'
            : 'Nothing can be derived from the register yet — the recorded rows are missing the figures the model needs (areas and rates). Fill those in on the register tab and this comparison will populate.'}
        </p>
        {proposal.costSignal && (
          <div className="mt-3 rounded-editorial border border-hairline bg-bg-secondary px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-content-primary">{proposal.costSignal.label}</span>
              <span className="text-sm font-semibold tabular-nums text-content-primary">{compactINR(proposal.costSignal.amount)}</span>
            </div>
            <p className="text-xs text-content-muted mt-1">{proposal.costSignal.note}</p>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      // Never dismissible mid-apply: an in-flight snapshot + navigation must
      // not fire after the operator thinks they cancelled.
      onClose={applying ? () => {} : onClose}
      closeOnOverlayClick={!applying}
      title="Apply register to Financials"
      description={`Derived from ${proposal.provenance.basisCount} ${proposal.provenance.basisNoun}${proposal.provenance.basisCount === 1 ? '' : 's'}, as of ${proposal.provenance.asOfDate}. Accept field by field — Apply freezes a register snapshot and stages the values; the model itself only changes when you hit Calculate.`}
      size="lg"
      footer={(
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={applying}>Cancel</Button>
          <Button
            variant="primary"
            loading={applying}
            disabled={accepted.size === 0}
            onClick={handleApply}
            rightIcon={<ArrowRight size={14} />}
          >
            {`Apply ${accepted.size} field${accepted.size === 1 ? '' : 's'}`}
          </Button>
        </div>
      )}
    >
      <div className="border border-hairline rounded-editorial overflow-hidden">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Comparison of current financial-model assumptions against values derived from the rent roll
          </caption>
          <thead>
            <tr className="bg-bg-secondary">
              <th scope="col" className="px-3 py-2 w-10"><span className="sr-only">Accept</span></th>
              <th scope="col" className="px-3 py-2 text-left text-eyebrow uppercase tracking-[0.06em] font-medium text-content-muted">Assumption</th>
              <th scope="col" className="px-3 py-2 text-right text-eyebrow uppercase tracking-[0.06em] font-medium text-content-muted">Current model</th>
              <th scope="col" className="px-3 py-2 text-right text-eyebrow uppercase tracking-[0.06em] font-medium text-content-muted">From register</th>
            </tr>
          </thead>
          <tbody>
            {proposal.fields.map((f) => {
              const changed = differs(currentInputs?.[f.name], f.derived);
              return (
                <tr key={f.name} className="border-t border-hairline-soft">
                  <td className="px-3 py-2.5 align-top">
                    <Checkbox
                      checked={accepted.has(f.name)}
                      onChange={() => toggle(f.name)}
                      aria-label={`Accept ${f.label}`}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-content-primary font-medium">{f.label}</div>
                    <div className="text-xs text-content-muted mt-0.5">{f.note}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-content-secondary align-top">
                    {fmtValue(currentInputs?.[f.name], f.unit)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums align-top font-medium ${changed ? 'text-content-primary' : 'text-content-muted'}`}>
                    {fmtValue(f.derived, f.unit)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {proposal.costSignal && (
        <div className="mt-3 rounded-editorial border border-hairline bg-bg-secondary px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-content-primary">{proposal.costSignal.label}</span>
            <span className="text-sm font-semibold tabular-nums text-content-primary">{compactINR(proposal.costSignal.amount)}</span>
          </div>
          <p className="text-xs text-content-muted mt-1">{proposal.costSignal.note}</p>
        </div>
      )}
      <p className="text-xs text-content-muted mt-3">
        Rent figures are gross — for JDA/JV structures the model applies the ownership share downstream.
        Applying freezes a register snapshot; the saved model cites it, and REDIP warns if the register changes afterwards.
      </p>
    </Modal>
  );
}
