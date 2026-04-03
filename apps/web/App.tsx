'use client';

import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AdminScreen } from './src/screens/AdminScreen';
import { CampaignLandingScreen } from './src/screens/CampaignLandingScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MappingAdminScreen } from './src/screens/MappingAdminScreen';
import { QuoteBuilderScreen } from './src/screens/QuoteBuilderScreen';
import { ShippingSettingsScreen } from './src/screens/ShippingSettingsScreen';
import { UserManagementScreen } from './src/screens/UserManagementScreen';

function AppShell() {
  const { loading, session } = useAuth();
  const [view, setView] = useState<'landing' | 'quote' | 'admin' | 'users' | 'mappings' | 'shipping'>('landing');
  const [selectedAdminTenantId, setSelectedAdminTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [startFreshCampaign, setStartFreshCampaign] = useState(false);

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
        onBack={() => setView('landing')}
        onOpenUsers={(tenantId) => {
          setSelectedAdminTenantId(tenantId);
          setView('users');
        }}
        onOpenMappings={(tenantId) => {
          setSelectedAdminTenantId(tenantId);
          setView('mappings');
        }}
        onOpenShippingSettings={(tenantId) => {
          setSelectedAdminTenantId(tenantId);
          setView('shipping');
        }}
      />
    );
  }

  if (view === 'users') {
    return <UserManagementScreen onBack={() => setView('admin')} tenantId={selectedAdminTenantId ?? session.user.tenantId ?? ''} />;
  }

  if (view === 'mappings') {
    return <MappingAdminScreen onBack={() => setView('admin')} tenantId={selectedAdminTenantId} />;
  }

  if (view === 'shipping') {
    return <ShippingSettingsScreen onBack={() => setView('admin')} tenantId={selectedAdminTenantId} />;
  }

  if (view === 'quote') {
    return (
      <QuoteBuilderScreen
        campaignId={selectedCampaignId}
        startFresh={startFreshCampaign}
        onBack={() => setView('landing')}
        onOpenAdmin={session.user.role !== 'user' ? () => setView('admin') : undefined}
      />
    );
  }

  return (
    <CampaignLandingScreen
      onOpenAdmin={session.user.role !== 'user' ? () => setView('admin') : undefined}
      onOpenCampaign={(campaignId) => {
        setSelectedCampaignId(campaignId);
        setStartFreshCampaign(campaignId === null);
        setView('quote');
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
