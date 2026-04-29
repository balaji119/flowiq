'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AdminWorkspaceShell } from './src/components/AdminWorkspaceShell';
import { CampaignArtworkFolderScreen } from './src/screens/CampaignArtworkFolderScreen';
import { CampaignLandingScreen } from './src/screens/CampaignLandingScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MappingAdminScreen } from './src/screens/MappingAdminScreen';
import { PrintingCostSettingsScreen } from './src/screens/PrintingCostSettingsScreen';
import { QuoteBuilderScreen } from './src/screens/QuoteBuilderScreen';
import { ShippingCostSettingsScreen } from './src/screens/ShippingCostSettingsScreen';
import { ShippingSettingsScreen } from './src/screens/ShippingSettingsScreen';
import { UserManagementScreen } from './src/screens/UserManagementScreen';

type AppView = 'landing' | 'quote' | 'artwork' | 'users' | 'mappings' | 'shipping' | 'shipping-costs' | 'printing-costs';

type AppNavState = {
  view: AppView;
  selectedAdminTenantId: string | null;
  selectedCampaignId: string | null;
  startFreshCampaign: boolean;
};

function buildUrlFromState(state: AppNavState) {
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.selectedAdminTenantId) params.set('tenantId', state.selectedAdminTenantId);
  if (state.selectedCampaignId) params.set('campaignId', state.selectedCampaignId);
  if (state.startFreshCampaign) params.set('fresh', '1');
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

function parseView(raw: string | null): AppView {
  if (raw === 'users') return 'users';
  if (raw === 'mappings') return 'mappings';
  if (raw === 'shipping') return 'shipping';
  if (raw === 'shipping-costs') return 'shipping-costs';
  if (raw === 'printing-costs') return 'printing-costs';
  if (raw === 'quote') return 'quote';
  if (raw === 'artwork') return 'artwork';
  if (raw === 'admin') return 'users';
  return 'landing';
}

function readStateFromUrl(defaultTenantId: string | null): AppNavState {
  const params = new URLSearchParams(window.location.search);
  const view = parseView(params.get('view'));
  const campaignId = params.get('campaignId');
  const tenantId = params.get('tenantId');
  const fresh = params.get('fresh') === '1';

  return {
    view,
    selectedAdminTenantId: tenantId ?? defaultTenantId,
    selectedCampaignId: campaignId,
    startFreshCampaign: fresh,
  };
}

function AppShell() {
  const { loading, session } = useAuth();
  const [view, setView] = useState<AppView>('landing');
  const [selectedAdminTenantId, setSelectedAdminTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [startFreshCampaign, setStartFreshCampaign] = useState(false);
  const hydratedHistoryRef = useRef(false);

  function applyNavState(nextState: AppNavState) {
    setView(nextState.view);
    setSelectedAdminTenantId(nextState.selectedAdminTenantId);
    setSelectedCampaignId(nextState.selectedCampaignId);
    setStartFreshCampaign(nextState.startFreshCampaign);
  }

  function navigate(nextState: AppNavState) {
    applyNavState(nextState);
    const url = buildUrlFromState(nextState);
    window.history.pushState(nextState, '', url);
  }

  function navigateTo(nextView: AppView, overrides?: Partial<AppNavState>) {
    navigate({
      view: nextView,
      selectedAdminTenantId,
      selectedCampaignId,
      startFreshCampaign,
      ...overrides,
    });
  }

  useEffect(() => {
    if (loading || !session || hydratedHistoryRef.current) return;
    const defaultTenantId = session.user.tenantId ?? null;

    const initialState = readStateFromUrl(defaultTenantId);
    applyNavState(initialState);
    window.history.replaceState(initialState, '', buildUrlFromState(initialState));
    hydratedHistoryRef.current = true;

    function handlePopState(event: PopStateEvent) {
      const nextState = (event.state as AppNavState | null) ?? readStateFromUrl(defaultTenantId);
      applyNavState(nextState);
    }

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [loading, session]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-slate-100 shadow-2xl shadow-slate-950/40">
          <LoaderCircle className="h-5 w-5 animate-spin text-violet-300" />
          <span className="text-sm font-medium">Loading your workspace...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  const canAccessManagement = session.user.role !== 'user';
  const canAccessSuperAdminPages = session.user.role === 'super_admin';

  function renderGlobalSidebar(content: ReactNode, options?: { pageTitle?: string; topBarActions?: ReactNode }) {
    return (
      <AdminWorkspaceShell
        activeSection={view === 'quote' || view === 'artwork' ? 'landing' : view}
        canAccessManagement={canAccessManagement}
        canAccessPrintingCosts={canAccessSuperAdminPages}
        canAccessShippingCosts={canAccessSuperAdminPages}
        pageTitle={options?.pageTitle}
        topBarActions={options?.topBarActions}
        onOpenLanding={() => navigateTo('landing')}
        onOpenMappings={canAccessManagement ? () => navigateTo('mappings') : undefined}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={canAccessManagement ? () => navigateTo('shipping') : undefined}
        onOpenUsers={canAccessManagement ? () => navigateTo('users') : undefined}
      >
        {content}
      </AdminWorkspaceShell>
    );
  }

  if (view === 'users') {
    return (
      <UserManagementScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        tenantId={selectedAdminTenantId ?? session.user.tenantId ?? ''}
      />
    );
  }

  if (view === 'mappings') {
    return (
      <MappingAdminScreen
        onBack={() => navigateTo('landing')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'shipping') {
    return (
      <ShippingSettingsScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'shipping-costs') {
    return (
      <ShippingCostSettingsScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'printing-costs') {
    return renderGlobalSidebar(
      <PrintingCostSettingsScreen
        onBack={() => navigateTo('landing')}
        tenantId={selectedAdminTenantId}
      />,
      { pageTitle: 'Printing Cost' },
    );
  }

  if (view === 'quote') {
    return renderGlobalSidebar(
      <QuoteBuilderScreen
        campaignId={selectedCampaignId}
        startFresh={startFreshCampaign}
        onBack={() => navigateTo('landing')}
        onOpenAdmin={canAccessManagement ? () => navigateTo('users') : undefined}
      />,
      { pageTitle: 'Campaign Builder' },
    );
  }

  if (view === 'artwork') {
    return renderGlobalSidebar(
      <CampaignArtworkFolderScreen
        campaignId={selectedCampaignId}
        onBack={() => navigateTo('landing')}
        onOpenCampaign={(campaignId) =>
          navigateTo('quote', {
            selectedCampaignId: campaignId,
            startFreshCampaign: false,
          })
        }
      />,
      { pageTitle: 'Master Artwork Folder' },
    );
  }

  return renderGlobalSidebar(
    <CampaignLandingScreen
      onOpenCampaign={(campaignId) => {
        navigateTo('quote', {
          selectedCampaignId: campaignId,
          startFreshCampaign: campaignId === null,
        });
      }}
    />,
    { pageTitle: 'Campaign Schedules' },
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
