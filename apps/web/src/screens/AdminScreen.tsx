import { useEffect, useMemo, useState } from 'react';
import { Building2, Database, LoaderCircle, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { AuthRole, AuthUser, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Switch } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { createTenant, createUser, deleteUser, fetchTenants, fetchUsers, updateUser } from '../services/adminApi';

const roles: AuthRole[] = ['super_admin', 'admin', 'user'];

type AdminScreenProps = {
  onBack: () => void;
  onOpenMappings?: () => void;
};

type UserFormState = {
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  active: boolean;
};

function emptyUserForm(): UserFormState {
  return {
    name: '',
    email: '',
    password: '',
    role: 'user',
    active: true,
  };
}

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

export function AdminScreen({ onBack, onOpenMappings }: AdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId || null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [tenantName, setTenantName] = useState('');
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(() => emptyUserForm());

  const canManageTenants = session?.user.role === 'super_admin';
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);
  const effectiveTenantId = canManageTenants ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined;
  const availableRoles = useMemo<AuthRole[]>(
    () => (session?.user.role === 'super_admin' ? roles : ['user']),
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
          if (!active) return;
          setTenants(nextTenants);
          if (!selectedTenantId && nextTenants[0]) {
            setSelectedTenantId(nextTenants[0].id);
          }
        }

        const userResponse = await fetchUsers(canManageTenants ? selectedTenantId || undefined : session?.user.tenantId || undefined);
        if (!active) return;
        setUsers(userResponse.users);
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
  }, [canManageTenants, selectedTenantId, session?.user.tenantId]);

  const canActOnUser = (user: AuthUser) => {
    if (session?.user.role === 'super_admin') {
      return user.role === 'admin' || user.role === 'user';
    }
    if (session?.user.role === 'admin') {
      return user.role === 'user' && session.user.tenantId !== null && user.tenantId === session.user.tenantId;
    }
    return false;
  };

  const userDialogRequiresTenant = userForm.role !== 'super_admin';
  const userDialogTenantLabel = userDialogRequiresTenant
    ? selectedTenant
      ? selectedTenant.name
      : 'No tenant selected'
    : 'Global super admin';

  useEffect(() => {
    console.info('[AdminScreen] tenant dialog state changed', { open: tenantDialogOpen });
  }, [tenantDialogOpen]);

  useEffect(() => {
    console.info('[AdminScreen] user dialog state changed', {
      open: userDialogOpen,
      editingUserId,
      role: userForm.role,
    });
  }, [editingUserId, userDialogOpen, userForm.role]);

  function openCreateTenantDialog() {
    console.info('[AdminScreen] Create Tenant button clicked');
    setTenantName('');
    setTenantDialogOpen(true);
  }

  function openCreateUserDialog() {
    console.info('[AdminScreen] Create User button clicked', {
      selectedTenantId,
      sessionRole: session?.user.role,
    });
    setEditingUserId(null);
    setUserForm(emptyUserForm());
    setUserDialogOpen(true);
  }

  function openEditUserDialog(user: AuthUser) {
    console.info('[AdminScreen] Edit User button clicked', { userId: user.id, role: user.role });
    setEditingUserId(user.id);
    setUserForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role === 'super_admin' ? 'super_admin' : user.role,
      active: user.active,
    });
    setUserDialogOpen(true);
  }

  async function handleCreateTenant() {
    console.info('[AdminScreen] handleCreateTenant called', { tenantName });
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
      console.error('[AdminScreen] create tenant failed', createError);
      setError(createError instanceof Error ? createError.message : 'Unable to create tenant');
    } finally {
      setCreatingTenant(false);
    }
  }

  async function handleSaveUser() {
    const tenantIdForUser =
      session?.user.role === 'super_admin'
        ? (userForm.role === 'super_admin' ? null : selectedTenantId)
        : session?.user.tenantId;

    console.info('[AdminScreen] handleSaveUser called', {
      editingUserId,
      role: userForm.role,
      tenantIdForUser,
      selectedTenantId,
    });

    if (session?.user.role === 'super_admin' && userDialogRequiresTenant && !tenantIdForUser) {
      console.warn('[AdminScreen] blocked user save because no tenant is selected');
      setError('Select a tenant before creating or editing an admin or user.');
      setNotice('');
      return;
    }

    setSavingUser(true);
    setError('');
    setNotice('');

    try {
      if (editingUserId) {
        const response = await updateUser(editingUserId, {
          name: userForm.name,
          password: userForm.password || undefined,
          role: userForm.role,
          active: userForm.active,
          tenantId: tenantIdForUser,
        });
        setUsers((current) => current.map((user) => (user.id === editingUserId ? response.user : user)));
        setNotice(`User ${response.user.name} updated.`);
      } else {
        const response = await createUser({
          name: userForm.name,
          email: userForm.email,
          password: userForm.password,
          role: userForm.role,
          tenantId: tenantIdForUser,
        });
        setUsers((current) => [...current, response.user]);
        setNotice(`User ${response.user.name} created.`);
      }
      setUserDialogOpen(false);
      setEditingUserId(null);
      setUserForm(emptyUserForm());
    } catch (saveError) {
      console.error('[AdminScreen] save user failed', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save user');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser(user: AuthUser) {
    console.info('[AdminScreen] Delete User button clicked', { userId: user.id });
    const confirmed = window.confirm(`Delete ${user.name}?`);
    if (!confirmed) return;

    setDeletingUserId(user.id);
    setError('');
    setNotice('');
    try {
      await deleteUser(user.id);
      setUsers((current) => current.filter((currentUser) => currentUser.id !== user.id));
      setNotice(`User ${user.name} deleted.`);
    } catch (deleteError) {
      console.error('[AdminScreen] delete user failed', deleteError);
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete user');
    } finally {
      setDeletingUserId(null);
    }
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
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
            <Users className="h-3.5 w-3.5" />
            Admin Workspace
          </Badge>
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-white">Tenant and user setup</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              Review tenants and users from one place, then open dedicated windows to create or edit records.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onOpenMappings ? (
            <Button onClick={onOpenMappings} variant="outline">
              <Database className="h-4 w-4" />
              Manage Quantity Mappings
            </Button>
          ) : null}
          <Button onClick={onBack} variant="secondary">
            Back to Schedule
          </Button>
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
                  Tenants
                </CardTitle>
                <CardDescription>Review tenants and pick one to scope admin actions.</CardDescription>
              </div>
              <Button onClick={openCreateTenantDialog}>
                <Plus className="h-4 w-4" />
                Create Tenant
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
              <p className="text-sm font-semibold text-white">{selectedTenant ? `Selected tenant: ${selectedTenant.name}` : 'No tenant selected'}</p>
              <p className="mt-1 text-sm text-slate-400">{selectedTenant ? selectedTenant.id : 'Choose a tenant below to scope user and mapping administration.'}</p>
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
                        <p className="mt-2 break-all text-xs text-slate-400">{tenant.id}</p>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle>Users</CardTitle>
              <CardDescription>
                {canManageTenants
                  ? 'List users first, then open a dedicated window to create or edit them.'
                  : 'Admins can manage only users in their own tenant.'}
              </CardDescription>
            </div>
            <Button onClick={openCreateUserDialog}>
              <Plus className="h-4 w-4" />
              Create User
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {canManageTenants ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
              <p className="text-sm font-semibold text-white">
                {selectedTenant ? `Current tenant scope: ${selectedTenant.name}` : 'Choose a tenant to manage tenant-scoped users'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                {selectedTenant ? selectedTenant.id : 'Super admins can create tenant-scoped admins and users only after selecting a tenant.'}
              </p>
            </div>
          ) : null}

          <div className="space-y-3">
            {users.map((user) => {
              const canManage = canActOnUser(user);
              return (
                <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800/80 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-1">
                    <p className="text-base font-bold text-white">{user.name}</p>
                    <p className="text-sm text-slate-400">
                      {user.email} • {user.role.replace('_', ' ')} • {user.tenantName || 'Global'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-slate-300">{user.active ? 'Active' : 'Inactive'}</span>
                    {canManage ? (
                      <>
                        <Button onClick={() => openEditUserDialog(user)} size="sm" variant="secondary">
                          <Pencil className="h-4 w-4" />
                          Edit
                        </Button>
                        <Button disabled={deletingUserId === user.id} onClick={() => void handleDeleteUser(user)} size="sm" variant="destructive">
                          {deletingUserId === user.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Delete
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {users.length === 0 ? <p className="text-sm text-slate-400">No users found for this scope yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={tenantDialogOpen}
        onOpenChange={(open) => {
          console.info('[AdminScreen] tenant dialog onOpenChange', { open });
          setTenantDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Tenant</DialogTitle>
            <DialogDescription>Create a tenant first, then use it to scope admins, users, and mappings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name-dialog">Tenant name</Label>
              <Input id="tenant-name-dialog" value={tenantName} onChange={(event) => setTenantName(event.target.value)} placeholder="Acme Print" />
            </div>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setTenantDialogOpen(false)} type="button" variant="ghost">Cancel</Button>
              <Button disabled={creatingTenant} onClick={() => void handleCreateTenant()}>
                {creatingTenant ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {creatingTenant ? 'Creating...' : 'Create Tenant'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={userDialogOpen}
        onOpenChange={(open) => {
          console.info('[AdminScreen] user dialog onOpenChange', { open });
          setUserDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUserId ? 'Edit User' : 'Create User'}</DialogTitle>
            <DialogDescription>
              {userDialogRequiresTenant
                ? `This ${userForm.role.replace('_', ' ')} will belong to ${userDialogTenantLabel}.`
                : 'This super admin will be created without a tenant assignment.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={userForm.name} onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))} placeholder="Jane Doe" />
            </div>
            {!editingUserId ? (
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={userForm.email} onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))} placeholder="jane@company.com" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Email</Label>
                <Input disabled value={userForm.email} />
              </div>
            )}
            <div className="space-y-2">
              <Label>{editingUserId ? 'New password' : 'Temporary password'}</Label>
              <Input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={editingUserId ? 'Leave blank to keep current password' : 'Temporary password'} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="flex flex-wrap gap-2">
                {availableRoles.map((role) => (
                  <PickerChip key={role} label={role.replace('_', ' ')} active={userForm.role === role} onPress={() => setUserForm((current) => ({ ...current, role }))} />
                ))}
              </div>
            </div>
            {editingUserId ? (
              <div className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800/70 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">User status</p>
                  <p className="text-sm text-slate-400">Disable access without deleting the account.</p>
                </div>
                <Switch checked={userForm.active} onCheckedChange={(value) => setUserForm((current) => ({ ...current, active: value }))} />
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button onClick={() => setUserDialogOpen(false)} type="button" variant="ghost">Cancel</Button>
              <Button disabled={savingUser} onClick={() => void handleSaveUser()}>
                {savingUser ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingUserId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {savingUser ? 'Saving...' : editingUserId ? 'Save Changes' : userForm.role === 'super_admin' ? 'Create Super Admin' : 'Create User'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
