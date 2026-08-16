'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { TenantRecord } from '@flowiq/shared';
import { LoaderCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ArtworkUploadProvider } from './src/context/ArtworkUploadContext';
import { AdminWorkspaceShell } from './src/components/AdminWorkspaceShell';
import { CampaignArtworkFolderScreen } from './src/screens/CampaignArtworkFolderScreen';
import { CampaignLandingScreen } from './src/screens/CampaignLandingScreen';
import { ForgotPasswordScreen } from './src/screens/ForgotPasswordScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MappingAdminScreen } from './src/screens/MappingAdminScreen';
import { MaterialMappingScreen } from './src/screens/MaterialMappingScreen';
import { MaterialsSettingsScreen } from './src/screens/MaterialsSettingsScreen';
import { PrintingCostSettingsScreen } from './src/screens/PrintingCostSettingsScreen';
import { QuoteBuilderScreen } from './src/screens/QuoteBuilderScreen';
import { ResetPasswordScreen } from './src/screens/ResetPasswordScreen';
import { SheetSizeSettingsScreen } from './src/screens/SheetSizeSettingsScreen';
import { ShippingCostSettingsScreen } from './src/screens/ShippingCostSettingsScreen';
import { ShippingSettingsScreen } from './src/screens/ShippingSettingsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TenantManagementScreen } from './src/screens/TenantManagementScreen';
import { UserManagementScreen } from './src/screens/UserManagementScreen';
import { fetchTenants } from './src/services/adminApi';

type AppView = 'home' | 'landing' | 'quote' | 'artwork' | 'users' | 'tenants' | 'mappings' | 'shipping' | 'shipping-costs' | 'printing-costs' | 'settings' | 'sheet-size-settings' | 'material-mapping' | 'materials';

type AppNavState = {
  view: AppView;
  selectedAdminTenantId: string | null;
  selectedCampaignId: string | null;
  startFreshCampaign: boolean;
  autoDownloadVisuals: boolean;
  autoDownloadInstalls: boolean;
  closeAfterVisualsDownload: boolean;
  autoSendEmailToAds: boolean;
  closeAfterEmailSend: boolean;
};

function buildUrlFromState(state: AppNavState) {
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.selectedAdminTenantId) params.set('tenantId', state.selectedAdminTenantId);
  if (state.selectedCampaignId) params.set('campaignId', state.selectedCampaignId);
  if (state.startFreshCampaign) params.set('fresh', '1');
  if (state.autoDownloadVisuals) params.set('downloadVisuals', '1');
  if (state.autoDownloadInstalls) params.set('downloadInstalls', '1');
  if (state.closeAfterVisualsDownload) params.set('closeAfterDownload', '1');
  if (state.autoSendEmailToAds) params.set('sendEmailToAds', '1');
  if (state.closeAfterEmailSend) params.set('closeAfterSend', '1');
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

function parseView(raw: string | null): AppView {
  if (raw === 'users') return 'users';
  if (raw === 'tenants') return 'tenants';
  if (raw === 'mappings') return 'mappings';
  if (raw === 'shipping') return 'shipping';
  if (raw === 'shipping-costs') return 'shipping-costs';
  if (raw === 'printing-costs') return 'printing-costs';
  if (raw === 'settings') return 'settings';
  if (raw === 'sheet-size-settings') return 'sheet-size-settings';
  if (raw === 'material-mapping') return 'material-mapping';
  if (raw === 'materials') return 'materials';
  if (raw === 'quote') return 'quote';
  if (raw === 'artwork') return 'artwork';
  if (raw === 'admin') return 'users';
  if (raw === 'home') return 'home';
  return 'home';
}

function readStateFromUrl(defaultTenantId: string | null): AppNavState {
  const params = new URLSearchParams(window.location.search);
  const view = parseView(params.get('view'));
  const campaignId = params.get('campaignId');
  const tenantId = params.get('tenantId');
  const fresh = params.get('fresh') === '1';
  const autoDownloadVisuals = params.get('downloadVisuals') === '1';
  const autoDownloadInstalls = params.get('downloadInstalls') === '1';
  const closeAfterVisualsDownload = params.get('closeAfterDownload') === '1';
  const autoSendEmailToAds = params.get('sendEmailToAds') === '1';
  const closeAfterEmailSend = params.get('closeAfterSend') === '1';

  return {
    view,
    selectedAdminTenantId: tenantId ?? defaultTenantId,
    selectedCampaignId: campaignId,
    startFreshCampaign: fresh,
    autoDownloadVisuals,
    autoDownloadInstalls,
    closeAfterVisualsDownload,
    autoSendEmailToAds,
    closeAfterEmailSend,
  };
}

function AppShell() {
  const { loading, session } = useAuth();
  const [authRoute, setAuthRoute] = useState<{ pathname: string; resetToken: string | null; ready: boolean }>({
    pathname: '/',
    resetToken: null,
    ready: false,
  });
  const [view, setView] = useState<AppView>('home');
  const [selectedAdminTenantId, setSelectedAdminTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [startFreshCampaign, setStartFreshCampaign] = useState(false);
  const [autoDownloadVisuals, setAutoDownloadVisuals] = useState(false);
  const [autoDownloadInstalls, setAutoDownloadInstalls] = useState(false);
  const [closeAfterVisualsDownload, setCloseAfterVisualsDownload] = useState(false);
  const [autoSendEmailToAds, setAutoSendEmailToAds] = useState(false);
  const [closeAfterEmailSend, setCloseAfterEmailSend] = useState(false);
  const [adminTenantOptions, setAdminTenantOptions] = useState<TenantRecord[]>([]);
  const hydratedHistoryRef = useRef(false);

  function applyNavState(nextState: AppNavState) {
    setView(nextState.view);
    setSelectedAdminTenantId(nextState.selectedAdminTenantId);
    setSelectedCampaignId(nextState.selectedCampaignId);
    setStartFreshCampaign(nextState.startFreshCampaign);
    setAutoDownloadVisuals(nextState.autoDownloadVisuals);
    setAutoDownloadInstalls(nextState.autoDownloadInstalls);
    setCloseAfterVisualsDownload(nextState.closeAfterVisualsDownload);
    setAutoSendEmailToAds(nextState.autoSendEmailToAds);
    setCloseAfterEmailSend(nextState.closeAfterEmailSend);
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
      autoDownloadVisuals,
      autoDownloadInstalls,
      closeAfterVisualsDownload,
      autoSendEmailToAds,
      closeAfterEmailSend,
      ...overrides,
    });
  }

  const clearAutomationFlags: Pick<AppNavState, 'autoDownloadVisuals' | 'autoDownloadInstalls' | 'closeAfterVisualsDownload' | 'autoSendEmailToAds' | 'closeAfterEmailSend'> = {
    autoDownloadVisuals: false,
    autoDownloadInstalls: false,
    closeAfterVisualsDownload: false,
    autoSendEmailToAds: false,
    closeAfterEmailSend: false,
  };

  useEffect(() => {
    setAuthRoute({
      pathname: window.location.pathname,
      resetToken: new URLSearchParams(window.location.search).get('token'),
      ready: true,
    });
  }, []);

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

  useEffect(() => {
    if (loading || !session) return;
    if (session.user.role !== 'super_admin') {
      setAdminTenantOptions([]);
      setSelectedAdminTenantId(session.user.tenantId ?? null);
      return;
    }

    let active = true;
    async function loadTenantsForSuperAdmin() {
      try {
        const response = await fetchTenants();
        if (!active) return;
        const sortedTenants = [...response.tenants].sort((left, right) => left.name.localeCompare(right.name));
        setAdminTenantOptions(sortedTenants);
        setSelectedAdminTenantId((current) => {
          if (current && sortedTenants.some((tenant) => tenant.id === current)) {
            return current;
          }
          return sortedTenants[0]?.id ?? null;
        });
      } catch {
        if (active) {
          setAdminTenantOptions([]);
        }
      }
    }

    void loadTenantsForSuperAdmin();
    return () => {
      active = false;
    };
  }, [loading, session]);

  function handleTenantSelection(nextTenantId: string) {
    navigateTo(view, {
      selectedAdminTenantId: nextTenantId,
      selectedCampaignId: null,
      startFreshCampaign: false,
      ...clearAutomationFlags,
    });
  }

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
    if (!authRoute.ready) {
      return (
        <div className="flex min-h-screen items-center justify-center px-6">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/80 px-5 py-4 text-slate-100 shadow-2xl shadow-slate-950/40">
            <LoaderCircle className="h-5 w-5 animate-spin text-violet-300" />
            <span className="text-sm font-medium">Loading your workspace...</span>
          </div>
        </div>
      );
    }
    if (authRoute.pathname === '/forgot-password') {
      return <ForgotPasswordScreen />;
    }
    if (authRoute.pathname === '/reset-password') {
      return <ResetPasswordScreen token={authRoute.resetToken} />;
    }
    return <LoginScreen />;
  }

  const canAccessManagement = session.user.role !== 'user';
  const canAccessSuperAdminPages = session.user.role === 'super_admin';

  function renderGlobalSidebar(content: ReactNode, options?: { pageTitle?: string; topBarActions?: ReactNode; hideHeader?: boolean }) {
    return (
      <AdminWorkspaceShell
        activeSection={view === 'quote' || view === 'artwork' ? 'landing' : view}
        canAccessManagement={canAccessManagement}
        canAccessPrintingCosts={canAccessSuperAdminPages}
        canAccessShippingCosts={canAccessSuperAdminPages}
        hideHeader={options?.hideHeader}
        pageTitle={options?.pageTitle}
        topBarActions={options?.topBarActions}
        onOpenHome={() => navigateTo('home')}
        onOpenLanding={() => navigateTo('landing')}
        onOpenMappings={canAccessManagement ? () => navigateTo('mappings') : undefined}
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={canAccessManagement ? () => navigateTo('materials') : undefined}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={canAccessManagement ? () => navigateTo('settings') : undefined}
        onOpenSheetSizeSettings={canAccessManagement ? () => navigateTo('sheet-size-settings') : undefined}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={canAccessManagement ? () => navigateTo('shipping') : undefined}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
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
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={() => navigateTo('settings')}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
        tenantId={selectedAdminTenantId ?? session.user.tenantId ?? ''}
      />
    );
  }

  if (view === 'tenants') {
    return (
      <TenantManagementScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={() => navigateTo('settings')}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenUsers={() => navigateTo('users')}
      />
    );
  }

  if (view === 'mappings') {
    return (
      <MappingAdminScreen
        onBack={() => navigateTo('landing')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenSettings={() => navigateTo('settings')}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
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
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={() => navigateTo('settings')}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'shipping-costs') {
    return renderGlobalSidebar(
      <ShippingCostSettingsScreen
        tenantId={selectedAdminTenantId}
      />,
      { pageTitle: 'Freight Rate Card' },
    );
  }

  if (view === 'settings') {
    return (
      <SettingsScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'sheet-size-settings') {
    return (
      <SheetSizeSettingsScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={() => navigateTo('settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'material-mapping') {
    return (
      <MaterialMappingScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenMaterials={() => navigateTo('materials')}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={() => navigateTo('settings')}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
        onOpenUsers={() => navigateTo('users')}
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'materials') {
    return (
      <MaterialsSettingsScreen
        onBack={() => navigateTo('landing')}
        onOpenMappings={() => navigateTo('mappings')}
        onOpenMaterialMapping={canAccessSuperAdminPages ? () => navigateTo('material-mapping') : undefined}
        onOpenPrintingCosts={canAccessSuperAdminPages ? () => navigateTo('printing-costs') : undefined}
        onOpenSettings={() => navigateTo('settings')}
        onOpenSheetSizeSettings={() => navigateTo('sheet-size-settings')}
        onOpenShippingCosts={canAccessSuperAdminPages ? () => navigateTo('shipping-costs') : undefined}
        onOpenShippingSettings={() => navigateTo('shipping')}
        onOpenTenants={canAccessSuperAdminPages ? () => navigateTo('tenants') : undefined}
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
        tenantId={selectedAdminTenantId}
        startFresh={startFreshCampaign}
        autoDownloadVisuals={autoDownloadVisuals}
        autoDownloadInstalls={autoDownloadInstalls}
        closeAfterVisualsDownload={closeAfterVisualsDownload}
        autoSendEmailToAds={autoSendEmailToAds}
        closeAfterEmailSend={closeAfterEmailSend}
        onBack={() => navigateTo('landing', clearAutomationFlags)}
        onOpenAdmin={canAccessManagement ? () => navigateTo('users') : undefined}
      />,
      { pageTitle: 'Campaign Builder' },
    );
  }

  if (view === 'artwork') {
    return renderGlobalSidebar(
      <CampaignArtworkFolderScreen
        campaignId={selectedCampaignId}
        tenantId={selectedAdminTenantId}
        onBack={() => navigateTo('landing')}
        onOpenCampaign={(campaignId) =>
          navigateTo('quote', {
            selectedCampaignId: campaignId,
            startFreshCampaign: false,
            ...clearAutomationFlags,
          })
        }
      />,
      { pageTitle: 'Master Artwork Folder' },
    );
  }

  if (view === 'home') {
    return renderGlobalSidebar(
      <CampaignLandingScreen
        showHero
        selectedTenantId={selectedAdminTenantId}
        tenantOptions={canAccessSuperAdminPages ? adminTenantOptions : []}
        requiresTenantSelection={canAccessSuperAdminPages}
        onTenantChange={handleTenantSelection}
        onOpenCampaign={(campaignId) => {
          navigateTo('quote', {
            selectedCampaignId: campaignId,
            startFreshCampaign: campaignId === null,
            ...clearAutomationFlags,
          });
        }}
      />,
      { hideHeader: true },
    );
  }

  return renderGlobalSidebar(
    <CampaignLandingScreen
      showHero
      selectedTenantId={selectedAdminTenantId}
      tenantOptions={canAccessSuperAdminPages ? adminTenantOptions : []}
      requiresTenantSelection={canAccessSuperAdminPages}
      onTenantChange={handleTenantSelection}
      onOpenCampaign={(campaignId) => {
        navigateTo('quote', {
          selectedCampaignId: campaignId,
          startFreshCampaign: campaignId === null,
          ...clearAutomationFlags,
        });
      }}
    />,
    { hideHeader: true },
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ArtworkUploadProvider>
        <AppShell />
      </ArtworkUploadProvider>
    </AuthProvider>
  );
}
