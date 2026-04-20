import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import useAuthStore from './store/authStore';
import Layout from './components/layout/Layout';
import ToastContainer from './components/common/Toast';
import LoadingSpinner from './components/common/LoadingSpinner';
import ErrorBoundary from './components/common/ErrorBoundary';

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
const IntelligencePage = lazy(() => import('./pages/IntelligencePage'));
const MasterPlanAdminPage = lazy(() => import('./pages/MasterPlanAdminPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-96">
      <LoadingSpinner size="lg" />
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
      <ToastContainer />
      <Routes>
        {/* Public landing page — no auth required */}
        <Route path="/" element={withSuspense(<LandingPage />)} />

        {/* Auth */}
        <Route path="/login" element={withSuspense(<LoginPage />)} />

        {/* Authenticated app — all under /dashboard */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <ErrorBoundary>
                <Layout />
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
          <Route path="financials/:dealId" element={withSuspense(<FinancialsPage />)} />
          <Route path="comps" element={withSuspense(<CompsPage />)} />
          <Route path="intelligence" element={withSuspense(<IntelligencePage />)} />
          {/* Compare: accessible but not in primary nav */}
          <Route path="compare" element={withSuspense(<DealComparePage />)} />
          <Route path="reports" element={withSuspense(<ReportsPage />)} />
          <Route path="settings" element={withSuspense(<SettingsPage />)} />
          <Route path="settings/master-plan" element={withSuspense(<MasterPlanAdminPage />)} />
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
