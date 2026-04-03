import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, Pencil, Plus, Shield, Trash2, Users } from 'lucide-react';
import { AuthRole, AuthUser, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Switch } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { createUser, deleteUser, fetchTenants, fetchUsers, updateUser } from '../services/adminApi';

type UserManagementScreenProps = {
  onBack: () => void;
  tenantId: string;
};

type UserFormState = {
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  active: boolean;
};

const tenantScopedRolesForSuperAdmin: AuthRole[] = ['admin', 'user'];
const tenantScopedRolesForAdmin: AuthRole[] = ['user'];

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

export function UserManagementScreen({ onBack, tenantId }: UserManagementScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [tenantName, setTenantName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(() => emptyUserForm());

  const availableRoles = useMemo<AuthRole[]>(
    () => (session?.user.role === 'super_admin' ? tenantScopedRolesForSuperAdmin : tenantScopedRolesForAdmin),
    [session?.user.role],
  );

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      try {
        setLoading(true);
        setError('');
        const userResponse = await fetchUsers(tenantId);
        if (!active) return;
        setUsers(userResponse.users);

        if (session?.user.role === 'super_admin') {
          const tenantResponse = await fetchTenants();
          if (!active) return;
          const tenant = tenantResponse.tenants.find((item: TenantRecord) => item.id === tenantId);
          setTenantName(tenant?.name || '');
        } else {
          setTenantName(session?.user.tenantName || '');
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load users');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadUsers();
    return () => {
      active = false;
    };
  }, [session?.user.role, session?.user.tenantName, tenantId]);

  const canActOnUser = (user: AuthUser) => {
    if (session?.user.role === 'super_admin') {
      return user.role === 'admin' || user.role === 'user';
    }
    if (session?.user.role === 'admin') {
      return user.role === 'user' && user.tenantId === tenantId;
    }
    return false;
  };

  function openCreateUserDialog() {
    setEditingUserId(null);
    setUserForm(emptyUserForm());
    setUserDialogOpen(true);
  }

  function openEditUserDialog(user: AuthUser) {
    setEditingUserId(user.id);
    setUserForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role === 'admin' ? 'admin' : 'user',
      active: user.active,
    });
    setUserDialogOpen(true);
  }

  async function handleSaveUser() {
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
          tenantId,
        });
        setUsers((current) => current.map((user) => (user.id === editingUserId ? response.user : user)));
        setNotice(`User ${response.user.name} updated.`);
      } else {
        const response = await createUser({
          name: userForm.name,
          email: userForm.email,
          password: userForm.password,
          role: userForm.role,
          tenantId,
        });
        setUsers((current) => [...current, response.user]);
        setNotice(`User ${response.user.name} created.`);
      }
      setUserDialogOpen(false);
      setEditingUserId(null);
      setUserForm(emptyUserForm());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save user');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser(user: AuthUser) {
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
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete user');
    } finally {
      setDeletingUserId(null);
    }
  }

  if (session?.user.role === 'user') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-amber-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage users.</CardDescription>
            <Button onClick={onBack} variant="secondary">
              Back
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
            <Users className="h-3.5 w-3.5" />
            User Management
          </Badge>
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-white">Tenant users</h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-400">
              Manage users for {tenantName || 'the selected tenant'}. Tenant scope is locked on this screen.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onBack} variant="secondary">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button onClick={openCreateUserDialog}>
            <Plus className="h-4 w-4" />
            Create User
          </Button>
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      <Card>
        <CardHeader className="p-5 pb-0">
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {loading ? 'Loading users...' : `${users.length} user${users.length === 1 ? '' : 's'} in this tenant.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
            <p className="text-sm font-semibold text-white">Tenant ID</p>
            <p className="mt-1 text-sm text-slate-400 break-all">{tenantId}</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : (
            <div className="space-y-3">
              {users.map((user) => {
                const canManage = canActOnUser(user);
                return (
                  <div key={user.id} className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-800/80 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <p className="text-base font-bold text-white">{user.name}</p>
                      <p className="text-sm text-slate-400">
                        {user.email} • {user.role.replace('_', ' ')}
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
              {users.length === 0 ? <p className="text-sm text-slate-400">No users found for this tenant yet.</p> : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUserId ? 'Edit User' : 'Create User'}</DialogTitle>
            <DialogDescription>
              This user will belong to {tenantName || 'the selected tenant'}.
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
              <Button
                onClick={() => {
                  setUserDialogOpen(false);
                  setEditingUserId(null);
                  setUserForm(emptyUserForm());
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={savingUser || !userForm.name.trim() || (!editingUserId && (!userForm.email.trim() || !userForm.password.trim()))} onClick={() => void handleSaveUser()}>
                {savingUser ? <LoaderCircle className="h-4 w-4 animate-spin" /> : editingUserId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {savingUser ? 'Saving...' : editingUserId ? 'Save Changes' : 'Create User'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
