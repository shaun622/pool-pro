import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { BusinessProvider, useBusiness } from './hooks/useBusiness'
import { ThemeProvider } from './contexts/ThemeContext'
import { LanguageProvider } from './contexts/LanguageContext'
import { ToastProvider } from './contexts/ToastContext'
import AppShell from './components/layout/AppShell'
import TechShell from './components/layout/TechShell'
import MfaGate from './components/auth/MfaGate'

const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Schedule = lazy(() => import('./pages/Schedule'))
const TechnicianReport = lazy(() => import('./pages/TechnicianReport'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientDetail = lazy(() => import('./pages/ClientDetail').then(m => ({ default: m.ClientRoute })))
const PoolDetail = lazy(() => import('./pages/PoolDetail'))
const NewService = lazy(() => import('./pages/NewService'))
const ServiceDetail = lazy(() => import('./pages/ServiceDetail'))
const WorkOrders = lazy(() => import('./pages/WorkOrders'))
const WorkOrderDetail = lazy(() => import('./pages/WorkOrderDetail'))
const Quotes = lazy(() => import('./pages/Quotes'))
const QuoteBuilder = lazy(() => import('./pages/QuoteBuilder'))
const Settings = lazy(() => import('./pages/Settings'))
const Staff = lazy(() => import('./pages/Staff'))
const ChemicalLibrary = lazy(() => import('./pages/ChemicalLibrary'))
const CommunicationTemplates = lazy(() => import('./pages/settings/CommunicationTemplates'))
const JobTypeTemplates = lazy(() => import('./pages/settings/JobTypeTemplates'))
const RecurringJobs = lazy(() => import('./pages/RecurringJobs'))
const Automations = lazy(() => import('./pages/settings/Automations'))
const SurveyResults = lazy(() => import('./pages/settings/SurveyResults'))
const Integrations = lazy(() => import('./pages/settings/Integrations'))
const ImportData = lazy(() => import('./pages/settings/ImportData'))
const BusinessDetails = lazy(() => import('./pages/settings/BusinessDetails'))
const Security = lazy(() => import('./pages/settings/Security'))
const Branches = lazy(() => import('./pages/settings/Branches'))
const Notifications = lazy(() => import('./pages/settings/Notifications'))
const PublicSurvey = lazy(() => import('./pages/PublicSurvey'))
const Invoices = lazy(() => import('./pages/Invoices'))
const InvoiceBuilder = lazy(() => import('./pages/InvoiceBuilder'))
const Reports = lazy(() => import('./pages/Reports'))
const Subscription = lazy(() => import('./pages/Subscription'))
const PublicQuote = lazy(() => import('./pages/PublicQuote'))
const PortalLogin = lazy(() => import('./pages/portal/PortalLogin'))
const PortalSetup = lazy(() => import('./pages/portal/PortalSetup'))
const PortalTokenLanding = lazy(() => import('./pages/portal/PortalTokenLanding'))
const PortalDashboard = lazy(() => import('./pages/portal/PortalDashboard'))
const InviteAccept = lazy(() => import('./pages/InviteAccept'))
const TechRunSheet = lazy(() => import('./pages/tech/TechRunSheet'))
const TechProfile = lazy(() => import('./pages/tech/TechProfile'))

function Loading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-pool-500" />
    </div>
  )
}

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  // Force the TOTP step-up for anyone who has enrolled a factor (fails open for
  // everyone else — see MfaGate).
  return <MfaGate><Outlet /></MfaGate>
}

// Admin guard: requires business ownership or admin staff role
function BusinessGuard() {
  const { user } = useAuth()
  const { business, loading, userRole } = useBusiness()
  if (loading) return <Loading />
  // Redirect customers to their portal
  if (!business) {
    if (user?.user_metadata?.role === 'customer') return <Navigate to="/portal" replace />
    return <Navigate to="/onboarding" replace />
  }
  // Tech users get redirected to their view
  if (userRole === 'tech') return <Navigate to="/tech" replace />
  return <AppShell />
}

// Shared guard: renders correct shell based on role (for routes accessible to both techs and admins)
function RoleShell() {
  const { business, loading, userRole } = useBusiness()
  if (loading) return <Loading />
  if (!business) return <Navigate to="/login" replace />
  if (userRole === 'tech') return <TechShell />
  return <AppShell />
}

// Tech guard: requires tech role staff member
function TechGuard() {
  const { business, loading, userRole } = useBusiness()
  if (loading) return <Loading />
  if (!business) return <Navigate to="/login" replace />
  // Admin/owner should use the full app
  if (userRole === 'owner' || userRole === 'admin') return <Navigate to="/" replace />
  return <TechShell />
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
      <LanguageProvider>
      <ToastProvider>
      <AuthProvider>
        <BusinessProvider>
          <Suspense fallback={<Loading />}>
            <Routes>
              {/* Public routes - no auth */}
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route path="/portal/setup/:token" element={<PortalSetup />} />
              <Route path="/portal" element={<PortalDashboard />} />
              <Route path="/portal/:token" element={<PortalTokenLanding />} />
              <Route path="/quote/:token" element={<PublicQuote />} />
              <Route path="/survey/:token" element={<PublicSurvey />} />
              <Route path="/invite/:token" element={<InviteAccept />} />

              {/* Auth routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding" element={<Onboarding />} />

                {/* Shared routes — accessible to both techs and admins */}
                <Route element={<RoleShell />}>
                  <Route path="/pools/:id/service" element={<NewService />} />
                  <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
                  <Route path="/services/:id" element={<ServiceDetail />} />
                </Route>

                {/* Tech routes */}
                <Route element={<TechGuard />}>
                  <Route path="/tech" element={<TechRunSheet />} />
                  <Route path="/tech/profile" element={<TechProfile />} />
                </Route>

                {/* Admin/Owner routes */}
                <Route element={<BusinessGuard />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/schedule" element={<Schedule />} />
                  <Route path="/route" element={<Navigate to="/schedule" replace />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/clients/:slug" element={<ClientDetail />} />
                  <Route path="/pools/:id" element={<PoolDetail />} />
                  <Route path="/work-orders" element={<WorkOrders />} />
                  <Route path="/recurring-jobs" element={<RecurringJobs />} />
                  <Route path="/quotes" element={<Quotes />} />
                  <Route path="/quotes/new" element={<QuoteBuilder />} />
                  <Route path="/quotes/:id" element={<QuoteBuilder />} />
                  {/* Settings — nested shell. Sub-pages render into <Outlet />. */}
                  <Route path="/settings" element={<Settings />}>
                    <Route index               element={<BusinessDetails />} />
                    <Route path="analytics"    element={<Reports />} />
                    <Route path="reports"      element={<TechnicianReport />} />
                    <Route path="staff"        element={<Staff />} />
                    <Route path="security"     element={<Security />} />
                    <Route path="branches"     element={<Branches />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="chemicals"    element={<ChemicalLibrary />} />
                    <Route path="templates"    element={<CommunicationTemplates />} />
                    <Route path="job-types"    element={<JobTypeTemplates />} />
                    <Route path="automations"  element={<Automations />} />
                    <Route path="surveys"      element={<SurveyResults />} />
                    <Route path="integrations" element={<Integrations />} />
                    <Route path="import"       element={<ImportData />} />
                    <Route path="billing"      element={<Subscription />} />
                  </Route>
                  {/* Redirects for cached bookmarks / PWA installs */}
                  <Route path="/settings/business" element={<Navigate to="/settings" replace />} />
                  <Route path="/subscription"      element={<Navigate to="/settings/billing" replace />} />
                  <Route path="/reports"           element={<Navigate to="/settings/analytics" replace />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/new" element={<InvoiceBuilder />} />
                  <Route path="/invoices/:id" element={<InvoiceBuilder />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BusinessProvider>
      </AuthProvider>
      </ToastProvider>
      </LanguageProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
