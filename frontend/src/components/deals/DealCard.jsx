import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  MoreVertical, Presentation, Share2, Trash2, Loader2, Download,
  Check, Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDeleteDeal, usePrefetchDealWorkspace } from '../../hooks/useDeals';
import useAuthStore from '../../store/authStore';
import Badge from '../common/Badge';
import { toast } from '../common/Toast';
import { confirm } from '../../design-system';
import { exportsAPI } from '../../services/api';
import { downloadAxiosResponse } from '../../utils/download';
import {
  formatCrores,
  formatPct,
  formatRelativeTime,
  STAGE_CONFIG,
  PRIORITY_CONFIG,
  DEAL_TYPE_LABELS,
} from '../../utils/format';
import { ASSET_CLASS_LABELS } from '../../utils/assetClasses';
import { DEAL_STRUCTURE_LABELS_COMPACT as DEAL_STRUCTURE_LABELS } from '../../utils/dealStructures';
import ShareDealPanel from '../deal/ShareDealPanel';
import UrgencyStrip from './UrgencyStrip';

/**
 * DealCard — single deal tile on the Deals list page.
 *
 * Extracted from `pages/DealsPage.jsx` (PR-NX, 2026-05-25) when the page
 * crossed 1,400 lines. The card is fully self-contained: it owns its
 * own menu / share / delete-confirm state, its own data-fetching hooks
 * (`useDeleteDeal`, `usePrefetchDealWorkspace`), and its own action
 * handlers. Parent passes the `deal` payload and (optionally) a
 * `onToggleSelect` callback to wire multi-select.
 *
 * Hover / focus pre-fetches the deal workspace via React Query so the
 * click-through resolves instantly. The full opacity-0 → group-hover
 * checkbox affordance mirrors the comps queue's multi-select pattern.
 */
export default function DealCard({ deal, selected = false, onToggleSelect }) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const deleteDeal = useDeleteDeal();
  // Pre-fetch the deal's full workspace payload on hover / focus so the
  // click into the deal page resolves instantly. Bounded by React Query
  // 30s staleTime + the cache-check inside the hook (no thrash if
  // hovered repeatedly).
  const prefetchWorkspace = usePrefetchDealWorkspace();

  const [menuOpen, setMenuOpen] = useState(false);
  const [showShare, setShowShare] = useState(false);
  // Delete-confirm flow uses the shared design-system `confirm()`
  // primitive — no local boolean state needed.
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef(null);

  const stageCfg = STAGE_CONFIG[deal.stage] || STAGE_CONFIG.screening;
  const priorityCfg = PRIORITY_CONFIG[deal.priority] || PRIORITY_CONFIG.medium;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const stopAll = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleExport = async (e) => {
    stopAll(e);
    setMenuOpen(false);
    setExporting(true);
    try {
      const response = await exportsAPI.dealPptx(deal.id);
      const safe = (deal.name || 'deal').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      downloadAxiosResponse(response, `redip-${safe}.pptx`);
      toast.success('PPTX deck downloaded');
    } catch (err) {
      toast.error(err.response?.data?.message || 'PPTX export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleShare = (e) => {
    stopAll(e);
    setMenuOpen(false);
    setShowShare(true);
  };

  const handleDelete = async (e) => {
    stopAll(e);
    setMenuOpen(false);
    const ok = await confirm({
      title: 'Delete Deal',
      message: `Permanently delete "${deal.name}"? This cannot be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await deleteDeal.mutateAsync(deal.id);
    } catch {
      // toast handled by hook
    }
  };

  const handleCheckboxClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleSelect?.(deal.id);
  };

  return (
    <>
      <Link
        to={`/dashboard/deals/${deal.id}`}
        onMouseEnter={() => prefetchWorkspace(deal.id)}
        onFocus={() => prefetchWorkspace(deal.id)}
        className={clsx(
          'card-editorial hover:shadow-md transition-all cursor-pointer relative group',
          selected && 'ring-1 ring-accent/50 bg-accent-soft/20',
        )}
      >
        {/* Multi-select checkbox — visible on hover or when this card is
            already part of the active selection. Click stops propagation
            so it doesn't navigate to the deal detail page. Mirrors the
            comps queue pattern (PR #208). */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            aria-pressed={selected}
            aria-label={selected ? 'Deselect deal' : 'Select deal'}
            className={clsx(
              'absolute top-3 left-3 z-10 w-5 h-5 rounded border flex items-center justify-center',
              'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              selected
                ? 'bg-accent border-accent text-white opacity-100'
                : 'bg-bg-elevated border-hairline text-transparent opacity-0 group-hover:opacity-100 hover:border-accent',
            )}
          >
            {selected && <Check size={12} strokeWidth={3} />}
          </button>
        )}
        <div className={clsx('flex items-start justify-between mb-3 gap-2', selected && 'pl-7')}>
          <h3 className="font-semibold text-content-primary truncate pr-2">{deal.name}</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge tone={stageCfg.tone}>{stageCfg.label}</Badge>
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => { stopAll(e); setMenuOpen((v) => !v); }}
                aria-label="Deal actions"
                className="p-1 rounded hover:bg-bg-secondary text-content-secondary hover:text-content-primary focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-md border border-hairline-strong bg-bg-elevated shadow-lg z-20"
                  onClick={stopAll}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary disabled:opacity-50"
                  >
                    {exporting ? <Loader2 size={14} className="animate-spin" /> : <Presentation size={14} />}
                    Export Deck
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-content-secondary hover:bg-bg-secondary"
                  >
                    <Share2 size={14} />
                    Share
                  </button>
                  {isAdmin && (
                    <>
                      <div className="border-t border-hairline" />
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-sm text-content-secondary mb-1">{deal.property_name || 'Unlinked property'}</p>
        <p className="text-xs text-content-muted mb-3">{deal.city}{deal.state ? `, ${deal.state}` : ''}</p>

        <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
          <div>
            <p className="text-xs text-content-muted">Land Area</p>
            <p className="font-medium text-content-primary">
              {deal.land_area_acres
                ? `${Number(deal.land_area_acres).toFixed(2)} acres`
                : deal.land_area_sqft
                  ? `${Number(deal.land_area_sqft).toLocaleString('en-IN')} sqft`
                  : 'Pending'}
            </p>
          </div>
          <div>
            <p className="text-xs text-content-muted">Headline Economics</p>
            <p className="font-medium text-content-primary">
              {deal.land_ask_price_cr ? formatCrores(deal.land_ask_price_cr) : formatCrores(deal.total_revenue_cr)}
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2 mb-3">
          <Badge tone={priorityCfg.tone}>{priorityCfg.label}</Badge>
          <span className="text-xs text-content-secondary">{DEAL_TYPE_LABELS[deal.deal_type] || deal.deal_type}</span>
          {deal.asset_class && (
            <span className="text-xs text-content-secondary">
              {ASSET_CLASS_LABELS[deal.asset_class] || deal.asset_class}
            </span>
          )}
          {deal.deal_structure && (
            <span className="text-xs text-content-secondary">
              {DEAL_STRUCTURE_LABELS[deal.deal_structure] || deal.deal_structure}
            </span>
          )}
        </div>

        {/* Urgency strip — surfaces the same per-deal signals the dashboard's
            "Today's Attention" panel rolls up portfolio-wide. Each chip means
            "this deal needs you to do something specific." Rendered only when
            at least one signal fires so a clean deal stays clean. */}
        <UrgencyStrip deal={deal} />

        {Array.isArray(deal.key_risks) && deal.key_risks.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {deal.key_risks.slice(0, 2).map((risk) => (
              <span
                key={risk}
                className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"
              >
                {risk}
              </span>
            ))}
            {deal.open_high_risk_count > 2 && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                +{deal.open_high_risk_count - 2} more
              </span>
            )}
          </div>
        )}

        {/* Recommendation Engine summary chip — surfaces "N findings" with the
            top-severity dot so the operator can scan the pipeline by severity.
            Renders only when at least one recommendation exists on the deal
            (the workspace-load that produced the snapshot also persisted it). */}
        {deal.recommendations_summary && deal.recommendations_summary.total > 0 && (
          <div className="mb-3">
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                deal.recommendations_summary.top_severity === 'critical' && 'border-red-200 bg-red-50 text-red-700',
                deal.recommendations_summary.top_severity === 'high' && 'border-amber-200 bg-amber-50 text-amber-800',
                deal.recommendations_summary.top_severity === 'medium' && 'border-slate-200 bg-slate-50 text-slate-700',
                deal.recommendations_summary.top_severity === 'low' && 'border-hairline bg-bg-secondary text-content-secondary',
              )}
              title={deal.recommendations_summary.top_card?.headline || ''}
            >
              <Sparkles size={11} />
              {deal.recommendations_summary.total} finding
              {deal.recommendations_summary.total === 1 ? '' : 's'}
              {deal.recommendations_summary.by_severity.critical > 0 && (
                <span className="text-red-700">· {deal.recommendations_summary.by_severity.critical} critical</span>
              )}
              {deal.recommendations_summary.by_severity.critical === 0 && deal.recommendations_summary.by_severity.high > 0 && (
                <span className="text-amber-800">· {deal.recommendations_summary.by_severity.high} high</span>
              )}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between text-sm border-t pt-3">
          <div>
            <span className="text-content-muted text-xs">IRR</span>
            <p className="font-medium">{formatPct(deal.irr_pct)}</p>
          </div>
          <div className="text-right">
            <span className="text-content-muted text-xs">Revenue</span>
            <p className="font-medium">{formatCrores(deal.total_revenue_cr)}</p>
          </div>
        </div>

        {(deal.last_activity_date || deal.updated_at) && (
          <p className="text-xs text-content-muted mt-2">
            Updated {formatRelativeTime(deal.last_activity_date || deal.updated_at)}
          </p>
        )}
      </Link>

      {showShare && (
        <ShareDealPanel
          dealId={deal.id}
          dealName={deal.name}
          isOwner={deal.created_by === user?.id}
          onClose={() => setShowShare(false)}
        />
      )}

    </>
  );
}
