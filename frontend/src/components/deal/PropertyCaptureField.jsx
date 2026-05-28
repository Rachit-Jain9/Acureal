import { useState } from 'react';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Wand2,
  RefreshCw,
} from 'lucide-react';
import { useCaptureProperty, useCreateProperty } from '../../hooks/useProperties';
import ReadOnlyPropertyMap from '../maps/ReadOnlyPropertyMap';
import { toast } from '../common/Toast';

/**
 * PropertyCaptureField — Smart Property Capture for creating a property
 * from a single pasted input (Google Maps URL, Plus Code, lat/lng,
 * survey number, address, or broker free text).
 *
 * Props:
 *   - onSaved(propertyId, propertyData) — called after a successful save.
 *   - onCancel()                          — called when the user cancels.
 *   - defaultInput (optional)             — pre-fill the paste box.
 *   - compact (optional, bool)            — shrinks the map for modal use.
 *
 * The component runs in two phases:
 *   1. Capture — user pastes ANY input → POST /api/properties/capture
 *      returns a resolved candidate (address, coords, BBMP ward, K-GIS
 *      hierarchy, guidance value, verify links, AI extraction).
 *   2. Confirm — user reviews the preview card → POST /properties with
 *      the suggested fields → onSaved fires.
 *
 * The user can edit the name field before saving. Low-confidence matches
 * surface a yellow warning banner so the user knows to confirm the pin.
 */
export default function PropertyCaptureField({
  onSaved,
  onCancel,
  defaultInput = '',
  compact = false,
}) {
  const [input, setInput] = useState(defaultInput);
  const [aiAssisted, setAiAssisted] = useState(true);
  const [candidate, setCandidate] = useState(null);
  const [editedName, setEditedName] = useState('');

  const captureMutation = useCaptureProperty();
  const createMutation = useCreateProperty();

  const isLoading = captureMutation.isPending;
  const isSaving = createMutation.isPending;

  const handleCapture = async () => {
    if (!input.trim()) return;
    try {
      const c = await captureMutation.mutateAsync({ input: input.trim(), aiAssisted });
      setCandidate(c);
      setEditedName(c?.suggestedFields?.name || '');
    } catch {
      // toast handled by hook
    }
  };

  const handleReset = () => {
    setCandidate(null);
    setEditedName('');
    captureMutation.reset();
  };

  const handleSave = async () => {
    if (!candidate?.suggestedFields) return;
    const payload = {
      ...candidate.suggestedFields,
      name: editedName.trim() || candidate.suggestedFields.name,
    };
    // Drop falsy / unsupported fields so the property route validator
    // doesn't trip on stray nulls.
    const cleaned = Object.fromEntries(
      Object.entries(payload).filter(([_, v]) => v !== null && v !== undefined && v !== ''),
    );
    try {
      const result = await createMutation.mutateAsync(cleaned);
      const newId = result?.data?.id || result?.data;
      if (newId && onSaved) onSaved(newId, result?.data);
      else if (newId) toast.success('Property created');
    } catch {
      // toast handled by hook
    }
  };

  return (
    <div className="space-y-3">
      {/* ── Capture box ─────────────────────────────────────────────────── */}
      {!candidate && (
        <div className="space-y-2.5">
          <label htmlFor="property-capture-input" className="block text-xs font-medium text-content-secondary">
            Paste anything: a Google Maps link, Plus Code, coordinates, survey number, address, or broker message.
          </label>
          <textarea
            id="property-capture-input"
            aria-label="Property capture input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={compact ? 2 : 3}
            placeholder={'e.g. "3JV8+P4W Bengaluru"  •  "12.97, 77.59"  •  "Survey No. 45/2, Devanahalli"  •  https://maps.app.goo.gl/...  •  "5 acres on KIAL road, asking 18 Cr"'}
            className="input text-sm resize-none w-full font-normal"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleCapture();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-1.5 text-xs text-content-secondary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={aiAssisted}
                onChange={(e) => setAiAssisted(e.target.checked)}
                className="rounded border-hairline accent-primary-600"
              />
              <Sparkles size={12} className="text-primary-600" />
              <span>AI-extract narrative inputs (area, asking price, asset class)</span>
            </label>
            <button
              type="button"
              onClick={handleCapture}
              disabled={!input.trim() || isLoading}
              className="btn btn-primary text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={13} />}
              {isLoading ? 'Resolving...' : 'Capture'}
            </button>
          </div>
          {captureMutation.isError && (
            <div className="text-xs text-error-700 bg-error-50 border border-error-200 rounded-md px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span>Could not resolve that input. Try a Google Maps share link, Plus Code, or full address.</span>
            </div>
          )}
        </div>
      )}

      {/* ── Preview card ────────────────────────────────────────────────── */}
      {candidate && (
        <CandidatePreview
          candidate={candidate}
          editedName={editedName}
          onChangeName={setEditedName}
          onReset={handleReset}
          onSave={handleSave}
          onCancel={onCancel}
          isSaving={isSaving}
          compact={compact}
        />
      )}
    </div>
  );
}

// ─── CANDIDATE PREVIEW ────────────────────────────────────────────────────

function CandidatePreview({
  candidate,
  editedName,
  onChangeName,
  onReset,
  onSave,
  onCancel,
  isSaving,
  compact,
}) {
  const { classification, resolved, context, suggestedFields, aiExtraction, warnings } = candidate;
  const hasCoords = Number.isFinite(resolved?.lat) && Number.isFinite(resolved?.lng);

  return (
    <div className="space-y-3">
      {/* Header: classification + reset */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClassificationChip type={classification.type} confidence={classification.confidence} />
          {resolved?.confidence != null && (
            <ConfidenceBadge label="Geocode" value={resolved.confidence} status={resolved.status} />
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-content-muted hover:text-content-secondary flex items-center gap-1"
        >
          <RefreshCw size={11} /> Reset
        </button>
      </div>

      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-amber-900">
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" /> <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Editable name */}
      <div>
        <label className="block text-xs font-medium text-content-secondary mb-1">
          Property name (you can edit this)
        </label>
        <input
          type="text"
          value={editedName}
          onChange={(e) => onChangeName(e.target.value)}
          className="input text-sm"
          placeholder="e.g. Devanahalli Land Parcel"
        />
      </div>

      {/* Map + key fields side-by-side */}
      <div className={compact ? 'space-y-2.5' : 'grid grid-cols-1 lg:grid-cols-5 gap-3'}>
        <div className={compact ? '' : 'lg:col-span-2'}>
          {hasCoords ? (
            <ReadOnlyPropertyMap
              lat={resolved.lat}
              lng={resolved.lng}
              title={resolved.formatted_address || 'Captured parcel'}
              heightClassName={compact ? 'h-44' : 'h-52'}
              zoom={16}
              enableScrollZoom={false}
              enableFullscreen={false}
              enableLayerToggle={false}
              geocodeStatus={resolved.status}
            />
          ) : (
            <div className="h-44 rounded-md bg-bg-secondary border border-hairline flex items-center justify-center text-xs text-content-muted">
              No coordinates yet — pin will be placed when you save.
            </div>
          )}
        </div>

        <dl className={`text-xs space-y-1.5 ${compact ? '' : 'lg:col-span-3'}`}>
          <FieldLine label="Address" value={resolved?.formatted_address || suggestedFields?.address} />
          <FieldLine
            label="Coordinates"
            value={
              hasCoords
                ? `${resolved.lat.toFixed(5)}, ${resolved.lng.toFixed(5)}`
                : null
            }
          />
          <FieldLine label="City / state" value={[suggestedFields?.city, suggestedFields?.state].filter(Boolean).join(', ')} />
          <FieldLine label="Pincode" value={suggestedFields?.pincode} />
          {suggestedFields?.surveyNumber && (
            <FieldLine label="Survey No." value={suggestedFields.surveyNumber} hint="From input — verify via Bhoomi/Kaveri" />
          )}
          {context?.bbmpJurisdiction?.withinBbmp && context?.bbmpJurisdiction?.ward?.name && (
            <FieldLine
              label="BBMP ward"
              value={`${context.bbmpJurisdiction.ward.name}${context.bbmpJurisdiction.ward.no ? ` (#${context.bbmpJurisdiction.ward.no})` : ''}`}
              hint="From BBMP street index"
            />
          )}
          {context?.bbmpJurisdiction?.withinBbmp === false && (
            <FieldLine
              label="BBMP jurisdiction"
              value="Outside BBMP city limits"
              hint={context.bbmpJurisdiction.kgis_taluk ? `Governed by ${context.bbmpJurisdiction.kgis_taluk} planning authority` : null}
            />
          )}
          {context?.kgis?.hierarchy?.taluk && (
            <FieldLine
              label="K-GIS taluk / village"
              value={[context.kgis.hierarchy.taluk, context.kgis.hierarchy.village].filter(Boolean).join(' / ')}
              hint="From Karnataka K-GIS layer"
            />
          )}
          {context?.bbmpZone?.guidance_value && (
            <FieldLine
              label="Guidance value"
              value={formatGuidance(context.bbmpZone.guidance_value)}
              hint="BBMP property-tax guidance band"
            />
          )}
        </dl>
      </div>

      {/* AI extraction summary (only when free text) */}
      {aiExtraction && (
        <AiExtractionPanel ai={aiExtraction} suggestedFields={suggestedFields} />
      )}

      {/* Verify links */}
      {context?.verifyLinks?.length > 0 && (
        <VerifyLinks links={context.verifyLinks} />
      )}

      {/* Footer actions */}
      <div className="flex justify-end gap-3 pt-1">
        <button type="button" onClick={onCancel} className="btn btn-secondary text-sm">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !editedName.trim()}
          className="btn btn-primary text-sm disabled:opacity-50 flex items-center gap-1.5"
        >
          {isSaving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
          {isSaving ? 'Saving...' : 'Save Property'}
        </button>
      </div>
    </div>
  );
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

function FieldLine({ label, value, hint }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2">
      <dt className="text-content-muted min-w-[120px] flex-shrink-0">{label}</dt>
      <dd className="text-content-primary font-medium flex-1">
        <span>{value}</span>
        {hint && <span className="block text-[10px] text-content-muted font-normal mt-0.5">{hint}</span>}
      </dd>
    </div>
  );
}

const CLASSIFICATION_LABELS = {
  googleMapsUrl: { label: 'Google Maps link', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  plusCode: { label: 'Plus Code', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  latLng: { label: 'Coordinates', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  surveyNumber: { label: 'Survey number', color: 'bg-amber-50 text-amber-800 border-amber-200' },
  freeText: { label: 'AI-extracted narrative', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  address: { label: 'Address', color: 'bg-bg-secondary text-content-secondary border-hairline' },
};

function ClassificationChip({ type, confidence }) {
  const meta = CLASSIFICATION_LABELS[type] || CLASSIFICATION_LABELS.address;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.color}`}>
      {type === 'freeText' && <Sparkles size={10} />}
      {meta.label}
      {confidence != null && (
        <span className="opacity-70">· {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
}

function ConfidenceBadge({ label, value, status }) {
  const pct = Math.round((value || 0) * 100);
  const isLow = (value ?? 1) < 0.7 || status === 'approximate';
  const tone = isLow
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${tone}`}>
      {label} {pct}%
    </span>
  );
}

function AiExtractionPanel({ ai, suggestedFields }) {
  const rows = [];
  if (ai.land_area_acres) rows.push({ label: 'Land area', value: `${ai.land_area_acres} acres` });
  else if (ai.land_area_sqft) rows.push({ label: 'Land area', value: `${Number(ai.land_area_sqft).toLocaleString('en-IN')} sqft` });
  if (ai.asking_price_cr) rows.push({ label: 'Asking', value: `₹${ai.asking_price_cr} Cr` });
  if (ai.asking_price_per_sqft_inr) rows.push({ label: 'Asking', value: `₹${Number(ai.asking_price_per_sqft_inr).toLocaleString('en-IN')}/sqft` });
  if (ai.asking_price_per_acre_cr) rows.push({ label: 'Asking', value: `₹${ai.asking_price_per_acre_cr} Cr / acre` });
  if (ai.asset_class_hint) rows.push({ label: 'Asset class', value: ai.asset_class_hint.replace(/_/g, ' ') });
  if (ai.deal_structure_hint) rows.push({ label: 'Deal structure', value: ai.deal_structure_hint.replace(/_/g, ' ') });
  if (ai.notes) rows.push({ label: 'Notes', value: ai.notes });

  if (rows.length === 0) return null;
  return (
    <div className="text-xs bg-violet-50/50 border border-violet-100 rounded-md px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5 text-violet-800 font-medium mb-1">
        <Sparkles size={11} /> AI-extracted from your text
      </div>
      <dl className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start gap-2">
            <dt className="text-violet-700/80 min-w-[100px] flex-shrink-0">{r.label}</dt>
            <dd className="text-content-primary flex-1">{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[10px] text-violet-700/70 italic mt-1">
        Will be saved as the property's initial pricing/area. Review and edit on the deal page if anything is off.
      </p>
    </div>
  );
}

function VerifyLinks({ links }) {
  // Backend returns an array of { label, url, kind } objects. Render up to 5.
  const visible = links.slice(0, 6).filter((l) => l && l.url && l.label);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      <span className="text-[10px] text-content-muted uppercase tracking-wider self-center mr-1">Verify externally:</span>
      {visible.map((l, i) => (
        <a
          key={i}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border border-hairline text-content-secondary hover:text-primary-700 hover:border-primary-300 transition-colors"
        >
          {l.label} <ExternalLink size={9} />
        </a>
      ))}
    </div>
  );
}

function formatGuidance(g) {
  if (!g) return null;
  if (typeof g === 'string') return g;
  const min = g.min_inr || g.min;
  const max = g.max_inr || g.max;
  if (min && max) {
    return `₹${Number(min).toLocaleString('en-IN')} – ₹${Number(max).toLocaleString('en-IN')} / sqft`;
  }
  return null;
}
