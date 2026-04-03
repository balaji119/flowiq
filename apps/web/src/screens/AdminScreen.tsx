import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, Database, LoaderCircle, Plus, Truck, Users } from 'lucide-react';
import { TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { createTenant, fetchTenants } from '../services/adminApi';

type AdminScreenProps = {
  onBack: () => void;
  onOpenUsers?: (tenantId: string) => void;
  onOpenMappings?: (tenantId: string) => void;
  onOpenShippingSettings?: (tenantId: string) => void;
};

export function AdminScreen({ onBack, onOpenUsers, onOpenMappings, onOpenShippingSettings }: AdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId || null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);

  const canManageTenants = session?.user.role === 'super_admin';
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);
  const effectiveTenantId = canManageTenants ? selectedTenantId : session?.user.tenantId ?? null;

  useEffect(() => {
    let active = true;

    async function loadAdminHome() {
      try {
        setLoading(true);
        setError('');

        if (!canManageTenants) {
          setLoading(false);
          return;
        }

        const tenantResponse = await fetchTenants();
        if (!active) return;
        setTenants(tenantResponse.tenants);
        if (!selectedTenantId && tenantResponse.tenants[0]) {
          setSelectedTenantId(tenantResponse.tenants[0].id);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load tenants');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadAdminHome();
    return () => {
      active = false;
    };
  }, [canManageTenants, selectedTenantId]);

  async function handleCreateTenant() {
    setCreatingTenant(true);
    setError('');
    setNotice('');

    try {
      const response = await createTenant({ name: tenantName });
      setTenants((current) => [...current, response.tenant]);
      setSelectedTenantId(response.tenant.id);
      setTenantDialogOpen(false);
      setTenantName('');
      setNotice(`Tenant ${response.tenant.name} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create tenant');
    } finally {
      setCreatingTenant(false);
    }
  }

  function openUsers() {
    if (!effectiveTenantId || !onOpenUsers) return;
    onOpenUsers(effectiveTenantId);
  }

  function openMappings() {
    if (!effectiveTenantId || !onOpenMappings) return;
    onOpenMappings(effectiveTenantId);
  }

  function openShippingSettings() {
    if (!effectiveTenantId || !onOpenShippingSettings) return;
    onOpenShippingSettings(effectiveTenantId);
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-center rounded-[28px] border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="space-y-4">
        <div>
          <Button onClick={onBack} variant="ghost">
            <ArrowLeft className="h-4 w-4" />
            Back to Schedule
          </Button>
        </div>
        <div className="space-y-3">
          <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
            <Users className="h-3.5 w-3.5" />
            Admin Home
          </Badge>
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      {canManageTenants ? (
        <Card>
          <CardHeader className="p-5 pb-0">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-violet-300" />
                  Tenant
                </CardTitle>
                <CardDescription>All admin actions below will be scoped to the selected tenant.</CardDescription>
              </div>
              <Button
                onClick={() => {
                  setTenantName('');
                  setTenantDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Create Tenant
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
              <p className="text-sm font-semibold text-white">{selectedTenant ? `Selected tenant: ${selectedTenant.name}` : 'No tenant selected'}</p>
              <p className="mt-1 text-sm text-slate-400">Select a tenant below to continue.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {tenants.map((tenant) => {
                const active = selectedTenantId === tenant.id;
                return (
                  <button
                    key={tenant.id}
                    className={active
                      ? 'rounded-2xl border border-violet-400 bg-violet-500/10 p-4 text-left shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)] transition'
                      : 'rounded-2xl border border-slate-700 bg-slate-800/80 p-4 text-left transition hover:border-slate-500 hover:bg-slate-800'}
                    onClick={() => setSelectedTenantId(tenant.id)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-bold text-white">{tenant.name}</p>
                      </div>
                      {active ? <Badge>Selected</Badge> : null}
                    </div>
                    {tenant.createdAt ? <p className="mt-3 text-xs text-slate-500">Created {new Date(tenant.createdAt).toLocaleString()}</p> : null}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="p-5 pb-0">
          <CardTitle>Admin actions</CardTitle>
          <CardDescription>Open a dedicated page for the selected tenant.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-left transition hover:border-violet-400/60 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!effectiveTenantId}
            onClick={openUsers}
            type="button"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-violet-400/40 bg-violet-500/10 p-2 text-violet-200">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">User Management</p>
                <p className="mt-1 text-xs text-slate-400">Add, update, and delete users for this tenant.</p>
              </div>
            </div>
          </button>

          <button
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-left transition hover:border-violet-400/60 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!effectiveTenantId}
            onClick={openMappings}
            type="button"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-violet-400/40 bg-violet-500/10 p-2 text-violet-200">
                <Database className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Manage Quantity Mapping</p>
                <p className="mt-1 text-xs text-slate-400">Configure quantity templates by market and asset.</p>
              </div>
            </div>
          </button>

          <button
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-left transition hover:border-violet-400/60 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!effectiveTenantId}
            onClick={openShippingSettings}
            type="button"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-violet-400/40 bg-violet-500/10 p-2 text-violet-200">
                <Truck className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">Manage Shipping Settings</p>
                <p className="mt-1 text-xs text-slate-400">Maintain market addresses and shipping rates.</p>
              </div>
            </div>
          </button>
        </CardContent>
      </Card>

      <Dialog open={tenantDialogOpen} onOpenChange={setTenantDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Tenant</DialogTitle>
            <DialogDescription>Create a tenant and select it to continue with admin actions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name-dialog">Tenant name</Label>
              <Input id="tenant-name-dialog" value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="Acme Print" />
            </div>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setTenantDialogOpen(false)} type="button" variant="ghost">
                Cancel
              </Button>
              <Button disabled={creatingTenant || !tenantName.trim()} onClick={() => void handleCreateTenant()}>
                {creatingTenant ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {creatingTenant ? 'Creating...' : 'Create Tenant'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
