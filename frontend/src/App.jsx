import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import useAuthStore from './store/authStore';
// Layout (the authenticated app shell: sidebar, header, command palette, guide
// catalog, product tour) is lazy-loaded so the PUBLIC landing + login pages —
// which never mount it — don't download the whole shell on first paint.
const Layout = lazy(() => import('./components/layout/Layout'));
import ToastContainer from './components/common/Toast';
import { ConfirmDialogContainer } from './design-system';
import ErrorBoundary from './components/common/ErrorBoundary';
import CookieBanner from './components/common/CookieBanner';
import LegalReAcceptanceModal from './components/common/LegalReAcceptanceModal';
import useLegalPending from './hooks/useLegalPending';
import RequirePlatformAdmin from './components/auth/RequirePlatformAdmin';

// Neutralize scroll-wheel on focused number inputs. Browsers increment/decrement
// <input type="number"> values on wheel when focused, which is a common footgun
// on long underwriting forms — a stray scroll can silently change an assumption.
// Blurring on wheel preserves native scroll behavior while keeping values stable.
function useDisableNumberInputScroll() {
  useEffect(() => {
    const handler = (e) => {
      const el = e.target;
      if (
        el instanceof HTMLInputElement
        && el.type === 'number'
        && document.activeElement === el
      ) {
        el.blur();
      }
    };
    document.addEventListener('wheel', handler, { passive: true });
    return () => document.removeEventListener('wheel', handler);
  }, []);
}

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DealsPage = lazy(() => import('./pages/DealsPage'));
const DealDetailPage = lazy(() => import('./pages/DealDetailPage'));
const PropertyDetailPage = lazy(() => import('./pages/PropertyDetailPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const FinancialsPage = lazy(() => import('./pages/FinancialsPage'));
const CompsPage = lazy(() => import('./pages/CompsPage'));
const DealComparePage = lazy(() => import('./pages/DealComparePage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const PrivacyCentrePage = lazy(() => import('./pages/PrivacyCentrePage'));
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'));
const MasterPlanAdminPage = lazy(() => import('./pages/MasterPlanAdminPage'));
const MasterPlanExplorerPage = lazy(() => import('./pages/MasterPlanExplorerPage'));
// Customer-facing front door to the gazette-cited BBMP street register.
const ParcelEvidenceRoomPage = lazy(() => import('./pages/ParcelEvidenceRoomPage'));
const ParcelIntelligenceAdminPage = lazy(() => import('./pages/ParcelIntelligenceAdminPage'));
const CompsQueuePage = lazy(() => import('./pages/CompsQueuePage'));
const CompsQueueDetailPage = lazy(() => import('./pages/CompsQueueDetailPage'));
const AdminAiUsagePage = lazy(() => import('./pages/AdminAiUsagePage'));
const AdminAbEvalPage = lazy(() => import('./pages/AdminAbEvalPage'));
// E7-PR1 (2026-05-27) — operator-only view of the learning-loop telemetry.
const AdminLearningSignalsPage = lazy(() => import('./pages/AdminLearningSignalsPage'));
// E7-PR2 (2026-05-27) — operator-only audit-trail tail with filters.
const AdminAuditTrailPage = lazy(() => import('./pages/AdminAuditTrailPage'));
// E7-PR3 (2026-05-27) — unified admin landing with KPI tiles per surface.
const AdminHomePage = lazy(() => import('./pages/AdminHomePage'));
// Reliability — the liveness watchdog's operator-facing vitals board.
const AdminSystemHealthPage = lazy(() => import('./pages/AdminSystemHealthPage'));
// Growth — open-beta signup roster (who has joined the platform).
const AdminSignupsPage = lazy(() => import('./pages/AdminSignupsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const TermsPage = lazy(() => import('./pages/legal/TermsPage'));
const PrivacyPage = lazy(() => import('./pages/legal/PrivacyPage'));
const CookiesPage = lazy(() => import('./pages/legal/CookiesPage'));
const GrievancePage = lazy(() => import('./pages/legal/GrievancePage'));
const SubprocessorsPage = lazy(() => import('./pages/legal/SubprocessorsPage'));
const VerifyEmailPage = lazy(() => import('./pages/legal/VerifyEmailPage'));

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuthStore();
  // `useLegalPending` no-ops while unauthenticated; once auth lands it fetches
  // /api/legal/me and surfaces any current Terms/Privacy versions the user has
  // not yet accepted. The modal is rendered inline (above `children`) so it
  // overlays whatever protected page the router resolves — the user cannot
  // reach any protected surface without resolving the prompt.
  const { pending, refresh } = useLegalPending();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return (
    <>
      {children}
      {pending.length > 0 && (
        <LegalReAcceptanceModal pending={pending} onAccepted={refresh} />
      )}
    </>
  );
}

function PageLoader() {
  // Route-level Suspense fallback: a viewport-filling content skeleton (header +
  // KPI row + body) rather than a centered spinner, per the skeletons-not-spinners
  // bar. Respects prefers-reduced-motion.
  return (
    <div className="p-6 space-y-4 animate-pulse motion-reduce:animate-none" aria-busy="true">
      <div className="h-8 w-64 rounded bg-bg-secondary" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="h-28 rounded-editorial bg-bg-secondary" />
        <div className="h-28 rounded-editorial bg-bg-secondary" />
        <div className="h-28 rounded-editorial bg-bg-secondary" />
      </div>
      <div className="h-64 rounded-editorial bg-bg-secondary" />
    </div>
  );
}

function withSuspense(element) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>{element}</Suspense>
    </ErrorBoundary>
  );
}

function LegacyPropertyDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={`/dashboard/properties/${id}`} replace />;
}

export default function App() {
  useDisableNumberInputScroll();
  return (
    <BrowserRouter>
      <Analytics />
      <SpeedInsights />
      <ToastContainer />
      <ConfirmDialogContainer />
      <CookieBanner />
      <Routes>
        {/* Public landing page — no auth required */}
        <Route path="/" element={withSuspense(<LandingPage />)} />

        {/* Auth */}
        <Route path="/login" element={withSuspense(<LoginPage />)} />

        {/* Public legal pages — no auth required, linked from signup form
            and Public footer. Lazy-loaded so they don't bloat the
            authenticated bundle. */}
        <Route path="/terms" element={withSuspense(<TermsPage />)} />
        <Route path="/privacy" element={withSuspense(<PrivacyPage />)} />
        <Route path="/cookies" element={withSuspense(<CookiesPage />)} />
        <Route path="/grievance" element={withSuspense(<GrievancePage />)} />
        <Route path="/subprocessors" element={withSuspense(<SubprocessorsPage />)} />
        <Route path="/verify-email" element={withSuspense(<VerifyEmailPage />)} />

        {/* Authenticated app — all under /dashboard */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                {withSuspense(<Layout />)}
              </ErrorBoundary>
            </ProtectedRoute>
          }
        >
          <Route index element={withSuspense(<DashboardPage />)} />
          <Route path="deals" element={withSuspense(<DealsPage />)} />
          <Route path="deals/:id" element={withSuspense(<DealDetailPage />)} />
          {/* Properties list is folded into deals; keep parcel detail route for direct links */}
          <Route path="properties" element={<Navigate to="/dashboard/deals" replace />} />
          <Route path="properties/:id" element={withSuspense(<PropertyDetailPage />)} />
          <Route path="map" element={withSuspense(<MapPage />)} />
          {/* Master Plan Explorer — analyst-visible, read-only RMP 2015 reference map */}
          <Route path="master-plan" element={withSuspense(<MasterPlanExplorerPage />)} />
          {/* Parcel Evidence Room — customer-facing, cited BBMP street register lookup */}
          <Route path="parcel-evidence" element={withSuspense(<ParcelEvidenceRoomPage />)} />
          <Route path="financials/:dealId" element={withSuspense(<FinancialsPage />)} />
          <Route path="comps" element={withSuspense(<CompsPage />)} />
          <Route path="intelligence" element={withSuspense(<IntelligencePage />)} />
          {/* Compare: accessible but not in primary nav */}
          <Route path="compare" element={withSuspense(<DealComparePage />)} />
          <Route path="reports" element={withSuspense(<ReportsPage />)} />
          <Route path="settings" element={withSuspense(<SettingsPage />)} />
          <Route path="settings/team" element={withSuspense(<TeamPage />)} />
          <Route path="privacy" element={withSuspense(<PrivacyCentrePage />)} />
          {/* Admin / data-curation surfaces — moved out of Settings (which is now
              personal profile only). Old /settings/* paths kept as redirects so
              existing bookmarks don't break. */}
          {/* Platform admin only — workspace admins (every account) must NOT
              reach these. Sidebar hides the group too via isPlatformAdmin. */}
          {/* E7-PR3 (2026-05-27) — Admin Home landing at /admin */}
          <Route path="admin" element={<RequirePlatformAdmin>{withSuspense(<AdminHomePage />)}</RequirePlatformAdmin>} />
          <Route path="admin/master-plan" element={<RequirePlatformAdmin>{withSuspense(<MasterPlanAdminPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/parcel-intelligence" element={<RequirePlatformAdmin>{withSuspense(<ParcelIntelligenceAdminPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/comps-queue" element={<RequirePlatformAdmin>{withSuspense(<CompsQueuePage />)}</RequirePlatformAdmin>} />
          <Route path="admin/comps-queue/:id" element={<RequirePlatformAdmin>{withSuspense(<CompsQueueDetailPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/ai-usage" element={<RequirePlatformAdmin>{withSuspense(<AdminAiUsagePage />)}</RequirePlatformAdmin>} />
          <Route path="admin/ab-eval" element={<RequirePlatformAdmin>{withSuspense(<AdminAbEvalPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/learning-signals" element={<RequirePlatformAdmin>{withSuspense(<AdminLearningSignalsPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/audit-trail" element={<RequirePlatformAdmin>{withSuspense(<AdminAuditTrailPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/system-health" element={<RequirePlatformAdmin>{withSuspense(<AdminSystemHealthPage />)}</RequirePlatformAdmin>} />
          <Route path="admin/signups" element={<RequirePlatformAdmin>{withSuspense(<AdminSignupsPage />)}</RequirePlatformAdmin>} />
          <Route path="settings/master-plan" element={<Navigate to="/dashboard/admin/master-plan" replace />} />
          <Route path="settings/parcel-intelligence" element={<Navigate to="/dashboard/admin/parcel-intelligence" replace />} />
          {/* Legacy routes: redirect to deals */}
          <Route path="documents" element={<Navigate to="/dashboard/deals" replace />} />
          <Route path="activities" element={<Navigate to="/dashboard/deals" replace />} />
          <Route path="*" element={withSuspense(<NotFoundPage />)} />
        </Route>

        {/* Legacy top-level redirects for old bookmark paths */}
        <Route path="/deals" element={<Navigate to="/dashboard/deals" replace />} />
        <Route path="/properties" element={<Navigate to="/dashboard/deals" replace />} />
        <Route path="/properties/:id" element={<LegacyPropertyDetailRedirect />} />
        <Route path="/documents" element={<Navigate to="/dashboard/deals" replace />} />
        <Route path="/activities" element={<Navigate to="/dashboard/deals" replace />} />

        <Route path="*" element={withSuspense(<NotFoundPage />)} />
      </Routes>
    </BrowserRouter>
  );
}
