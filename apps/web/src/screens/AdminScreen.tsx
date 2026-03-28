import { useEffect, useMemo, useState } from 'react';
import { Building2, Database, LoaderCircle, RefreshCw, Users } from 'lucide-react';
import { AuthRole, AuthUser, PrintIqOptionsCacheStatus, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Switch } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { createTenant, createUser, fetchPrintIqOptionsStatus, fetchTenants, fetchUsers, refreshPrintIqOptionsCache, updateUser } from '../services/adminApi';

const roles: AuthRole[] = ['super_admin', 'admin', 'user'];

type AdminScreenProps = {
  onBack: () => void;
  onOpenMappings?: () => void;
};

function PickerChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <button
      className={[
        'rounded-full border px-4 py-2 text-sm font-semibold capitalize transition',
        active
          ? 'border-violet-400 bg-violet-500 text-white shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)]'
          : 'border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700',
      ].join(' ')}
      onClick={onPress}
      type="button"
    >
      {label}
    </button>
  );
}

function MetricCard({ label, value, meta }: { label: string; value: number; meta: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800/80 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-200">{label}</p>
      <p className="mt-3 text-3xl font-black text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{meta}</p>
    </div>
  );
}

export function AdminScreen({ onBack, onOpenMappings }: AdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId || null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [tenantName, setTenantName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');

  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<AuthRole>('user');
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [optionsStatus, setOptionsStatus] = useState<PrintIqOptionsCacheStatus | null>(null);
  const [refreshingOptions, setRefreshingOptions] = useState(false);

  const canManageTenants = session?.user.role === 'super_admin';
  const availableRoles = useMemo(
    () => (session?.user.role === 'super_admin' ? roles : roles.filter((role) => role !== 'super_admin')),
    [session?.user.role],
  );

  useEffect(() => {
    let active = true;

    async function loadAdminData() {
      try {
        setLoading(true);
        setError('');

        let nextTenants: TenantRecord[] = [];
        if (canManageTenants) {
          const tenantResponse = await fetchTenants();
          nextTenants = tenantResponse.tenants;
          if (active) {
            setTenants(nextTenants);
          }

          const cacheStatus = await fetchPrintIqOptionsStatus();
          if (active) {
            setOptionsStatus(cacheStatus);
          }
        }

        const effectiveTenantId =
          session?.user.role === 'super_admin'
            ? selectedTenantId || undefined
            : session?.user.tenantId || undefined;

        const userResponse = await fetchUsers(effectiveTenantId);
        if (!active) {
          return;
        }

        setUsers(userResponse.users);
        if (session?.user.role === 'super_admin' && !selectedTenantId && nextTenants[0]) {
          setSelectedTenantId(nextTenants[0].id);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load admin data');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadAdminData();

    return () => {
      active = false;
    };
  }, [canManageTenants, selectedTenantId, session?.user.role, session?.user.tenantId]);

  async function handleCreateTenant() {
    setCreatingTenant(true);
    setError('');
    setNotice('');

    try {
      const response = await createTenant({ name: tenantName, slug: tenantSlug || undefined });
      setTenants((current) => [...current, response.tenant]);
      setSelectedTenantId(response.tenant.id);
      setTenantName('');
      setTenantSlug('');
      setNotice(`Tenant ${response.tenant.name} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create tenant');
    } finally {
      setCreatingTenant(false);
    }
  }

  async function handleCreateUser() {
    setCreatingUser(true);
    setError('');
    setNotice('');

    try {
      const response = await createUser({
        name: userName,
        email: userEmail,
        password: userPassword,
        role: userRole,
        tenantId: session?.user.role === 'super_admin' ? selectedTenantId : session?.user.tenantId,
      });
      setUsers((current) => [...current, response.user]);
      setUserName('');
      setUserEmail('');
      setUserPassword('');
      setUserRole('user');
      setNotice(`User ${response.user.name} created.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create user');
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleToggleUser(user: AuthUser, active: boolean) {
    setError('');
    setNotice('');

    try {
      const response = await updateUser(user.id, { active });
      setUsers((current) => current.map((item) => (item.id === user.id ? response.user : item)));
      setNotice(`${response.user.name} is now ${response.user.active ? 'active' : 'inactive'}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update user');
    }
  }

  async function handleRefreshPrintIqOptions() {
    setRefreshingOptions(true);
    setError('');
    setNotice('');

    try {
      const result = await refreshPrintIqOptionsCache();
      setOptionsStatus({
        stocks: { cached: true, count: result.stocks.count, updatedAt: result.stocks.updatedAt },
        processes: { cached: true, count: result.processes.count, updatedAt: result.processes.updatedAt },
      });
      setNotice(result.message);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh PrintIQ option cache');
    } finally {
      setRefreshingOptions(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
            <Users className="h-3.5 w-3.5" />
            Admin Workspace
          </Badge>
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-white">Tenant and user setup</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              Manage tenant onboarding, user access, and cached PrintIQ configuration without leaving the browser workflow.
            </p>
          </div>
        </div>
        <Button onClick={onBack} variant="secondary">
          Back to Schedule
        </Button>
      </header>

      {onOpenMappings ? (
        <div className="flex justify-end">
          <Button onClick={onOpenMappings} variant="outline">
            <Database className="h-4 w-4" />
            Manage Quantity Mappings
          </Button>
        </div>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-[28px] border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : (
        <div className="grid gap-6">
          {canManageTenants ? (
            <Card>
              <CardHeader className="p-5 pb-0">
                <CardTitle className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-violet-300" />
                  Tenants
                </CardTitle>
                <CardDescription>Create a tenant before adding tenant-specific admins and users.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tenant-name">Tenant name</Label>
                    <Input id="tenant-name" value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="Acme Print" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-slug">Slug</Label>
                    <Input id="tenant-slug" value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)} placeholder="acme-print" />
                  </div>
                </div>
                <Button disabled={creatingTenant} onClick={() => void handleCreateTenant()}>
                  {creatingTenant ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {creatingTenant ? 'Creating…' : 'Create Tenant'}
                </Button>
                {tenants.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {tenants.map((tenant) => (
                      <PickerChip key={tenant.id} label={tenant.name} active={selectedTenantId === tenant.id} onPress={() => setSelectedTenantId(tenant.id)} />
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {canManageTenants ? (
            <Card>
              <CardHeader className="p-5 pb-0">
                <CardTitle className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-violet-300" />
                  PrintIQ Option Cache
                </CardTitle>
                <CardDescription>Refresh the cached stock and process options whenever PrintIQ configuration changes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <MetricCard
                    label="Stocks"
                    value={optionsStatus?.stocks.count ?? 0}
                    meta={optionsStatus?.stocks.updatedAt ? `Updated ${new Date(optionsStatus.stocks.updatedAt).toLocaleString()}` : 'Not imported yet'}
                  />
                  <MetricCard
                    label="Processes"
                    value={optionsStatus?.processes.count ?? 0}
                    meta={optionsStatus?.processes.updatedAt ? `Updated ${new Date(optionsStatus.processes.updatedAt).toLocaleString()}` : 'Not imported yet'}
                  />
                </div>
                <Button disabled={refreshingOptions} onClick={() => void handleRefreshPrintIqOptions()}>
                  {refreshingOptions ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {refreshingOptions ? 'Importing…' : 'Import / Refresh PrintIQ Options'}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="p-5 pb-0">
              <CardTitle>Users</CardTitle>
              <CardDescription>
                {canManageTenants ? 'Create admins or users for the selected tenant.' : 'Manage users for your tenant.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="user-name">Name</Label>
                  <Input id="user-name" value={userName} onChange={(event) => setUserName(event.target.value)} placeholder="Jane Doe" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-email">Email</Label>
                  <Input id="user-email" type="email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} placeholder="jane@company.com" />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="user-password">Temporary password</Label>
                  <Input id="user-password" type="password" value={userPassword} onChange={(event) => setUserPassword(event.target.value)} placeholder="Temporary password" />
                </div>
                <Button disabled={creatingUser} onClick={() => void handleCreateUser()}>
                  {creatingUser ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                  {creatingUser ? 'Creating…' : 'Create User'}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <div className="flex flex-wrap gap-2">
                  {availableRoles.map((role) => (
                    <PickerChip key={role} label={role.replace('_', ' ')} active={userRole === role} onPress={() => setUserRole(role)} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {users.map((user) => (
                  <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800/80 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-base font-bold text-white">{user.name}</p>
                      <p className="text-sm text-slate-400">
                        {user.email} • {user.role.replace('_', ' ')} • {user.tenantName || 'Global'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-slate-300">{user.active ? 'Active' : 'Inactive'}</span>
                      <Switch checked={user.active} onCheckedChange={(value) => void handleToggleUser(user, value)} />
                    </div>
                  </div>
                ))}
                {users.length === 0 ? <p className="text-sm text-slate-400">No users found for this scope yet.</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
