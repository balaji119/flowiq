'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AdminScreen } from './src/screens/AdminScreen';
import { CampaignLandingScreen } from './src/screens/CampaignLandingScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MappingAdminScreen } from './src/screens/MappingAdminScreen';
import { QuoteBuilderScreen } from './src/screens/QuoteBuilderScreen';
import { ShippingSettingsScreen } from './src/screens/ShippingSettingsScreen';
import { UserManagementScreen } from './src/screens/UserManagementScreen';

type AppView = 'landing' | 'quote' | 'admin' | 'users' | 'mappings' | 'shipping';

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
  if (raw === 'landing' || raw === 'quote' || raw === 'admin' || raw === 'users' || raw === 'mappings' || raw === 'shipping') {
    return raw;
  }
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
          <span className="text-sm font-medium">Loading your workspace…</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (view === 'admin') {
    return (
      <AdminScreen
        onBack={() =>
          navigate({
            view: 'landing',
            selectedAdminTenantId,
            selectedCampaignId,
            startFreshCampaign,
          })
        }
        onOpenUsers={(tenantId) => {
          navigate({
            view: 'users',
            selectedAdminTenantId: tenantId,
            selectedCampaignId,
            startFreshCampaign,
          });
        }}
        onOpenMappings={(tenantId) => {
          navigate({
            view: 'mappings',
            selectedAdminTenantId: tenantId,
            selectedCampaignId,
            startFreshCampaign,
          });
        }}
        onOpenShippingSettings={(tenantId) => {
          navigate({
            view: 'shipping',
            selectedAdminTenantId: tenantId,
            selectedCampaignId,
            startFreshCampaign,
          });
        }}
      />
    );
  }

  if (view === 'users') {
    return (
      <UserManagementScreen
        onBack={() =>
          navigate({
            view: 'admin',
            selectedAdminTenantId,
            selectedCampaignId,
            startFreshCampaign,
          })
        }
        tenantId={selectedAdminTenantId ?? session.user.tenantId ?? ''}
      />
    );
  }

  if (view === 'mappings') {
    return (
      <MappingAdminScreen
        onBack={() =>
          navigate({
            view: 'admin',
            selectedAdminTenantId,
            selectedCampaignId,
            startFreshCampaign,
          })
        }
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'shipping') {
    return (
      <ShippingSettingsScreen
        onBack={() =>
          navigate({
            view: 'admin',
            selectedAdminTenantId,
            selectedCampaignId,
            startFreshCampaign,
          })
        }
        tenantId={selectedAdminTenantId}
      />
    );
  }

  if (view === 'quote') {
    return (
      <QuoteBuilderScreen
        campaignId={selectedCampaignId}
        startFresh={startFreshCampaign}
        onBack={() =>
          navigate({
            view: 'landing',
            selectedAdminTenantId,
            selectedCampaignId,
            startFreshCampaign,
          })
        }
        onOpenAdmin={
          session.user.role !== 'user'
            ? () =>
                navigate({
                  view: 'admin',
                  selectedAdminTenantId,
                  selectedCampaignId,
                  startFreshCampaign,
                })
            : undefined
        }
      />
    );
  }

  return (
    <CampaignLandingScreen
      onOpenAdmin={
        session.user.role !== 'user'
          ? () =>
              navigate({
                view: 'admin',
                selectedAdminTenantId,
                selectedCampaignId,
                startFreshCampaign,
              })
          : undefined
      }
      onOpenCampaign={(campaignId) => {
        navigate({
          view: 'quote',
          selectedAdminTenantId,
          selectedCampaignId: campaignId,
          startFreshCampaign: campaignId === null,
        });
      }}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
