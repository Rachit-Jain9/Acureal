import { useState } from 'react';
import { clsx } from 'clsx';
import useAuthStore from '../store/authStore';
import PageHeader from '../components/common/PageHeader';
import { ErrorState } from '../design-system';
import MasterPlanCorpusPanel from '../components/masterplan/MasterPlanCorpusPanel';
import MasterPlanBbmpUavPanel from '../components/masterplan/MasterPlanBbmpUavPanel';
import ZoneLibrary from '../components/masterplan/ZoneLibrary';
import DocumentsPanel from '../components/masterplan/DocumentsPanel';
import PlanningIntelligencePanel from '../components/masterplan/PlanningIntelligencePanel';

/**
 * Roles allowed to mutate master-plan data (create / edit zones, upload
 * source documents, run extractions, edit metadata).
 *
 * Read-only viewers see the same tabs but with mutation controls hidden.
 */
const EDITOR_ROLES = ['admin', 'owner', 'editor', 'analyst'];

/**
 * Master Plan admin page.
 *
 * Thin tab router that owns nothing more than the active-tab state and
 * the editor-role permission check. The actual heavy lifting (zone CRUD,
 * source-document intake + extraction, the planning-intelligence panels)
 * is owned by the dedicated tab components under
 * `frontend/src/components/masterplan/`.
 *
 * Decomposed in the Task #6 effort (Tier A helpers, Tier B modals,
 * Tier C tab panels). Down from ~1,850 lines pre-decomposition.
 */
export default function MasterPlanAdminPage() {
  const { user } = useAuthStore();
  const role = String(user?.role || '').toLowerCase();
  const canEdit = EDITOR_ROLES.includes(role);
  const [tab, setTab] = useState('zones');

  return (
    <div>
      <PageHeader
        title="Master Plan — Regulatory Data"
        description="Curated zoning regulations (FSI, ground coverage, setbacks, use rules) used across deals. Source: RMP 2031 Draft (OpenCity.in)."
      />

      {!canEdit && (
        <ErrorState tone="warn" className="mb-4">
          Read-only view. Only admins, owners, editors, and analysts can add or edit zones.
          Always verify regulatory data with BBMP/BDA before using it in underwriting.
        </ErrorState>
      )}

      <div className="flex gap-1 border-b border-hairline-strong mb-4">
        {[
          { key: 'intelligence', label: 'Planning Intelligence' },
          { key: 'zones', label: 'Zone Library' },
          { key: 'documents', label: 'Source Documents' },
          { key: 'corpus', label: 'Source Corpus' },
          { key: 'bbmp-uav', label: 'BBMP UAV' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px',
              tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-content-secondary hover:text-content-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'intelligence' && <PlanningIntelligencePanel />}
      {tab === 'zones' && <ZoneLibrary canEdit={canEdit} />}
      {tab === 'documents' && <DocumentsPanel canEdit={canEdit} />}
      {tab === 'corpus' && <MasterPlanCorpusPanel />}
      {tab === 'bbmp-uav' && <MasterPlanBbmpUavPanel />}
    </div>
  );
}
