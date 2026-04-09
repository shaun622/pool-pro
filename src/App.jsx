import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { BusinessProvider, useBusiness } from './hooks/useBusiness'
import BottomNav from './components/layout/BottomNav'

const Login = lazy(() => import('./pages/Login'))
const Signup = lazy(() => import('./pages/Signup'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const RoutePage = lazy(() => import('./pages/Route'))
const Clients = lazy(() => import('./pages/Clients'))
const ClientDetail = lazy(() => import('./pages/ClientDetail'))
const PoolDetail = lazy(() => import('./pages/PoolDetail'))
const NewService = lazy(() => import('./pages/NewService'))
const ServiceDetail = lazy(() => import('./pages/ServiceDetail'))
const Jobs = lazy(() => import('./pages/Jobs'))
const JobDetail = lazy(() => import('./pages/JobDetail'))
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
  return <Outlet />
}

function BusinessGuard() {
  const { user } = useAuth()
  const { business, loading } = useBusiness()
  if (loading) return <Loading />
  // Redirect customers to their portal instead of onboarding
  if (!business) {
    if (user?.user_metadata?.role === 'customer') return <Navigate to="/portal" replace />
    return <Navigate to="/onboarding" replace />
  }
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
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

              {/* Auth routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Protected routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/onboarding" element={<Onboarding />} />
                <Route element={<BusinessGuard />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/route" element={<RoutePage />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/clients/:id" element={<ClientDetail />} />
                  <Route path="/pools/:id" element={<PoolDetail />} />
                  <Route path="/pools/:id/service" element={<NewService />} />
                  <Route path="/services/:id" element={<ServiceDetail />} />
                  <Route path="/jobs" element={<Jobs />} />
                  <Route path="/jobs/:id" element={<JobDetail />} />
                  <Route path="/recurring-jobs" element={<RecurringJobs />} />
                  <Route path="/quotes" element={<Quotes />} />
                  <Route path="/quotes/new" element={<QuoteBuilder />} />
                  <Route path="/quotes/:id" element={<QuoteBuilder />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/settings/staff" element={<Staff />} />
                  <Route path="/settings/chemicals" element={<ChemicalLibrary />} />
                  <Route path="/settings/templates" element={<CommunicationTemplates />} />
                  <Route path="/settings/job-types" element={<JobTypeTemplates />} />
                  <Route path="/settings/automations" element={<Automations />} />
                  <Route path="/settings/surveys" element={<SurveyResults />} />
                  <Route path="/settings/integrations" element={<Integrations />} />
                  <Route path="/settings/import" element={<ImportData />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/new" element={<InvoiceBuilder />} />
                  <Route path="/invoices/:id" element={<InvoiceBuilder />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/subscription" element={<Subscription />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </BusinessProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
