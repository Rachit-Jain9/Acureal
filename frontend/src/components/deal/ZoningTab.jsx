import { useState } from 'react';
import {
  MapPin,
  Ruler,
  Shield,
  AlertTriangle,
  CheckCircle2,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { clsx } from 'clsx';

const OVERLAY_CHECKS = [
  { key: 'lake_buffer',      label: 'Lake / Water Body Buffer (75 m)' },
  { key: 'rajakaluve',       label: 'Rajakaluve (Storm Drain) Buffer' },
  { key: 'heritage',         label: 'Heritage Zone / Protected Monument' },
  { key: 'airport_height',   label: 'Airport Height Constraint (CIAL / HAL)' },
  { key: 'tod_zone',         label: 'TOD Zone (Transit-Oriented Development)' },
  { key: 'road_widening',    label: 'Road Widening Reservation' },
  { key: 'eco_sensitive',    label: 'Eco-Sensitive / Forest Zone' },
];

const STATUS_CONFIG = {
  not_checked: {
    label: 'Not checked',
    color: 'bg-gray-100 text-gray-500',
    icon: null,
  },
  clear: {
    label: 'Clear',
    color: 'bg-green-100 text-green-700',
    icon: CheckCircle2,
  },
  flag: {
    label: 'Flag',
    color: 'bg-red-100 text-red-700',
    icon: AlertTriangle,
  },
};

function SectionCard({ icon: Icon, title, children, className }) {
  return (
    <div className={clsx('card', className)}>
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon size={16} className="text-primary-600 flex-shrink-0" />}
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function DataRow({ label, value, missing }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-500 w-48 flex-shrink-0">{label}</span>
      {missing ? (
        <span className="text-xs text-gray-400 italic">Not provided</span>
      ) : (
        <span className="text-xs font-medium text-gray-800 text-right">{value}</span>
      )}
    </div>
  );
}

export default function ZoningTab({ deal, dealId, setTab }) {
  const [overlayStatuses, setOverlayStatuses] = useState(
    Object.fromEntries(OVERLAY_CHECKS.map((o) => [o.key, 'not_checked']))
  );
  const [zoningNotes, setZoningNotes] = useState('');

  // Pull zoning fields from the joined property data on the deal
  const zoning_type        = deal?.zoning_type        || deal?.property?.zoning_type;
  const road_width_mtrs    = deal?.road_width_mtrs    || deal?.property?.road_width_mtrs;
  const permissible_fsi    = deal?.permissible_fsi    || deal?.property?.permissible_fsi;
  const existing_fsi       = deal?.existing_fsi       || deal?.property?.existing_fsi;
  const circle_rate_inr    = deal?.circle_rate_per_sqft || deal?.property?.circle_rate_per_sqft;
  const land_area_sqft     = deal?.land_area_sqft;

  const hasParccelData = zoning_type || road_width_mtrs || permissible_fsi || circle_rate_inr;

  // Buildability estimate — deterministic frontend calc only
  const canEstimate = land_area_sqft && permissible_fsi && road_width_mtrs;
  let buildability = null;
  if (canEstimate) {
    const grossBuiltUp      = land_area_sqft * permissible_fsi;
    const groundCoverage    = land_area_sqft * 0.40;
    const estimatedFloors   = groundCoverage > 0 ? grossBuiltUp / groundCoverage : null;
    buildability = {
      gross_built_up:    grossBuiltUp,
      ground_coverage:   groundCoverage,
      estimated_floors:  estimatedFloors,
    };
  }

  const cycleOverlayStatus = (key) => {
    setOverlayStatuses((prev) => {
      const current = prev[key];
      const next =
        current === 'not_checked' ? 'clear'
        : current === 'clear'     ? 'flag'
        : 'not_checked';
      return { ...prev, [key]: next };
    });
  };

  const fmt = (n, decimals = 0) =>
    n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: decimals });

  return (
    <div className="space-y-5">
      {/* 1 — Parcel Zoning Summary */}
      <SectionCard icon={MapPin} title="Parcel Zoning Summary">
        {hasParccelData ? (
          <div>
            <DataRow
              label="Zoning / Land Use"
              value={zoning_type}
              missing={!zoning_type}
            />
            <DataRow
              label="Road Width (m)"
              value={road_width_mtrs ? `${road_width_mtrs} m` : null}
              missing={!road_width_mtrs}
            />
            <DataRow
              label="Permissible FSI"
              value={permissible_fsi != null ? fmt(permissible_fsi, 2) : null}
              missing={permissible_fsi == null}
            />
            <DataRow
              label="Existing / Consumed FSI"
              value={existing_fsi != null ? fmt(existing_fsi, 2) : null}
              missing={existing_fsi == null}
            />
            <DataRow
              label="Circle Rate (INR/sqft)"
              value={circle_rate_inr != null ? `₹${fmt(circle_rate_inr)}` : null}
              missing={circle_rate_inr == null}
            />
          </div>
        ) : (
          <p className="text-sm text-gray-400 italic">
            Not yet configured — fill in Parcel / Site details to populate zoning fields.
          </p>
        )}
      </SectionCard>

      {/* 2 — Buildability Estimate */}
      <SectionCard icon={Ruler} title="Buildability Estimate">
        {canEstimate && buildability ? (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="rounded-lg bg-primary-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Gross Built-Up Area</p>
                <p className="text-lg font-bold text-primary-700">
                  {fmt(buildability.gross_built_up)} sqft
                </p>
                <p className="text-xs text-gray-400">
                  {fmt(buildability.gross_built_up / 43560, 2)} acres
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Ground Coverage (40%)</p>
                <p className="text-lg font-bold text-gray-700">
                  {fmt(buildability.ground_coverage)} sqft
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Estimated Floors</p>
                <p className="text-lg font-bold text-gray-700">
                  {buildability.estimated_floors != null
                    ? fmt(buildability.estimated_floors, 1)
                    : '—'}
                </p>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
              These are rule-engine estimates based on permissible FSI and a 40% coverage
              assumption. Verify against actual authority approvals, setback rules, and
              site constraints before relying on these figures.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-400 italic mb-2">
              Complete parcel data to generate buildability estimate.
            </p>
            <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
              {!land_area_sqft   && <li>Land area (sqft) — missing</li>}
              {!permissible_fsi  && <li>Permissible FSI — missing</li>}
              {!road_width_mtrs  && <li>Road width (m) — missing</li>}
            </ul>
          </div>
        )}
      </SectionCard>

      {/* 3 — Regulatory Overlays */}
      <SectionCard icon={Shield} title="Overlay & Buffer Checks">
        <p className="text-xs text-gray-500 mb-3">
          Connect parcel geometry and spatial datasets to auto-evaluate overlays. Manual
          status entry is supported below. Click a status badge to cycle through
          Not checked → Clear → Flag.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-xs font-medium text-gray-500 w-2/3">
                  Overlay Type
                </th>
                <th className="text-left py-2 text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {OVERLAY_CHECKS.map((overlay) => {
                const status = overlayStatuses[overlay.key];
                const cfg    = STATUS_CONFIG[status];
                const Icon   = cfg.icon;
                return (
                  <tr key={overlay.key} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 text-xs text-gray-700">{overlay.label}</td>
                    <td className="py-2.5">
                      <button
                        onClick={() => cycleOverlayStatus(overlay.key)}
                        className={clsx(
                          'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                          cfg.color
                        )}
                        title="Click to cycle status"
                      >
                        {Icon && <Icon size={11} />}
                        {cfg.label}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3 italic">
          Run spatial analysis once parcel is geocoded and geometry is confirmed. Automated
          overlay evaluation requires BBMP/BDA GIS datasets (see TODO_DATA.md).
        </p>
      </SectionCard>

      {/* 4 — Zoning Rule Sets */}
      <SectionCard icon={FileText} title="Applicable Rule Sets">
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center mb-3">
          <p className="text-sm text-gray-500 mb-2">
            No rule sets loaded for this deal's jurisdiction.
          </p>
          <p className="text-xs text-gray-400 max-w-lg mx-auto">
            Upload master plan documents, zoning gazette notifications, or BBMP/BDA rule
            extracts in the Documents tab. The rules engine will parse and version them
            once document extraction is configured.
          </p>
          {setTab && (
            <button
              onClick={() => setTab('documents')}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-xs font-medium hover:bg-primary-100 transition-colors"
            >
              <ExternalLink size={12} />
              Go to Documents
            </button>
          )}
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">
          <Shield size={11} />
          Bengaluru / BBMP rules framework: Ready when documents are uploaded
        </div>
      </SectionCard>

      {/* 5 — Manual Zoning Notes */}
      <SectionCard icon={AlertTriangle} title="Zoning Notes (Manual)">
        <p className="text-xs text-gray-400 mb-2">
          This field is for manual analyst notes. Not used for calculations.
        </p>
        <textarea
          rows={4}
          value={zoningNotes}
          onChange={(e) => setZoningNotes(e.target.value)}
          placeholder="Enter zoning observations, planning constraints, authority feedback, or pending clarifications..."
          className="input text-sm w-full"
        />
      </SectionCard>
    </div>
  );
}
