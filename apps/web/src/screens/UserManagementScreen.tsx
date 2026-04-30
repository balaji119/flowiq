import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { AuthRole, AuthUser, TenantRecord } from "@flowiq/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@flowiq/ui";
import {
  AdminWorkspaceHandlers,
  AdminWorkspaceShell,
} from "../components/AdminWorkspaceShell";
import { useAuth } from "../context/AuthContext";
import {
  createUser,
  deleteUser,
  fetchTenants,
  fetchUsers,
  updateUser,
} from "../services/adminApi";

type UserManagementScreenProps = {
  onBack: () => void;
  tenantId: string;
} & Omit<AdminWorkspaceHandlers, "onBack" | "onOpenUsers">;

type UserFormState = {
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  active: boolean;
};

const tenantScopedRolesForSuperAdmin: AuthRole[] = ["admin", "user"];
const tenantScopedRolesForAdmin: AuthRole[] = ["user"];

function emptyUserForm(): UserFormState {
  return {
    name: "",
    email: "",
    password: "",
    role: "user",
    active: true,
  };
}

function PickerChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <button
      className={[
        "rounded-full border px-4 py-2 text-sm font-semibold capitalize transition",
        active
          ? "border-violet-400 bg-violet-500 text-white shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)]"
          : "border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700",
      ].join(" ")}
      onClick={onPress}
      type="button"
    >
      {label}
    </button>
  );
}

export function UserManagementScreen({
  onBack,
  onOpenMappings,
  onOpenPrintingCosts,
  onOpenShippingSettings,
  onOpenShippingCosts,
  tenantId,
}: UserManagementScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState(tenantId);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState<UserFormState>(() =>
    emptyUserForm(),
  );

  const availableRoles = useMemo<AuthRole[]>(
    () =>
      session?.user.role === "super_admin"
        ? tenantScopedRolesForSuperAdmin
        : tenantScopedRolesForAdmin,
    [session?.user.role],
  );
  const isSuperAdmin = session?.user.role === "super_admin";
  const effectiveTenantId = isSuperAdmin ? selectedTenantId : tenantId;
  const tenantOptions = useMemo(
    () =>
      isSuperAdmin
        ? [...tenants]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((tenant) => ({ id: tenant.id, name: tenant.name }))
        : [
            {
              id: tenantId,
              name: session?.user.tenantName || "Current Tenant",
            },
          ],
    [isSuperAdmin, session?.user.tenantName, tenantId, tenants],
  );
  const selectedTenantName = useMemo(
    () =>
      tenantOptions.find((tenant) => tenant.id === effectiveTenantId)?.name ||
      "",
    [effectiveTenantId, tenantOptions],
  );

  useEffect(() => {
    let active = true;

    async function loadTenantsForScope() {
      if (!isSuperAdmin) {
        setSelectedTenantId(tenantId);
        return;
      }
      try {
        const tenantResponse = await fetchTenants();
        if (!active) return;
        setTenants(tenantResponse.tenants);
        if (
          !selectedTenantId ||
          !tenantResponse.tenants.some(
            (tenant) => tenant.id === selectedTenantId,
          )
        ) {
          setSelectedTenantId(tenantResponse.tenants[0]?.id || "");
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load tenants",
          );
        }
      }
    }

    void loadTenantsForScope();
    return () => {
      active = false;
    };
  }, [isSuperAdmin, tenantId]);

  useEffect(() => {
    let active = true;

    async function loadUsers() {
      if (!effectiveTenantId) {
        setUsers([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError("");
        const userResponse = await fetchUsers(effectiveTenantId);
        if (!active) return;
        setUsers(userResponse.users);
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load users",
          );
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
  }, [effectiveTenantId]);

  const canActOnUser = (user: AuthUser) => {
    if (session?.user.role === "super_admin") {
      return user.role === "admin" || user.role === "user";
    }
    if (session?.user.role === "admin") {
      return user.role === "user" && user.tenantId === effectiveTenantId;
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
      password: "",
      role: user.role === "admin" ? "admin" : "user",
      active: user.active,
    });
    setUserDialogOpen(true);
  }

  function closeUserDialog() {
    setUserDialogOpen(false);
    setEditingUserId(null);
    setUserForm(emptyUserForm());
  }

  async function handleSaveUser() {
    if (!effectiveTenantId) return;
    setSavingUser(true);
    setError("");
    setNotice("");

    try {
      if (editingUserId) {
        const response = await updateUser(editingUserId, {
          name: userForm.name,
          password: userForm.password || undefined,
          role: userForm.role,
          active: userForm.active,
          tenantId: effectiveTenantId,
        });
        setUsers((current) =>
          current.map((user) =>
            user.id === editingUserId ? response.user : user,
          ),
        );
        setNotice(`User ${response.user.name} updated.`);
      } else {
        const response = await createUser({
          name: userForm.name,
          email: userForm.email,
          password: userForm.password,
          role: userForm.role,
          tenantId: effectiveTenantId,
        });
        setUsers((current) => [...current, response.user]);
        setNotice(`User ${response.user.name} created.`);
      }
      closeUserDialog();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Unable to save user",
      );
    } finally {
      setSavingUser(false);
    }
  }

  async function handleDeleteUser(user: AuthUser) {
    const confirmed = window.confirm(`Delete ${user.name}?`);
    if (!confirmed) return;

    setDeletingUserId(user.id);
    setError("");
    setNotice("");
    try {
      await deleteUser(user.id);
      setUsers((current) =>
        current.filter((currentUser) => currentUser.id !== user.id),
      );
      setNotice(`User ${user.name} deleted.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete user",
      );
    } finally {
      setDeletingUserId(null);
    }
  }

  if (session?.user.role === "user") {
    return (
      <main className="dense-main mx-auto flex min-h-screen w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-amber-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>
              Only admin and super admin users can manage users.
            </CardDescription>
            <Button onClick={onBack} variant="secondary">
              Back
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <AdminWorkspaceShell
      activeSection="users"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === "super_admin"}
      canAccessPrintingCosts={session?.user.role === "super_admin"}
      pageTitle="User Management"
      topBarActions={
        <Button
          className="h-10 min-w-[126px] rounded-md px-4 text-sm font-semibold"
          disabled={!effectiveTenantId}
          onClick={openCreateUserDialog}
        >
          <Plus className="h-4 w-4" />
          Create User
        </Button>
      }
      onBack={onBack}
      onOpenLanding={onBack}
      onOpenMappings={onOpenMappings}
      onOpenPrintingCosts={onOpenPrintingCosts}
      onOpenShippingCosts={onOpenShippingCosts}
      onOpenShippingSettings={onOpenShippingSettings}
      onOpenUsers={() => {}}
    >
      <main className="dense-main flex min-h-screen w-full flex-col gap-6">
        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">
            {notice}
          </div>
        ) : null}

        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="w-full md:w-auto">
              <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800 md:w-[320px]">
                <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">
                  Tenant
                </span>
                <select
                  id="tenant-picker"
                  className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:opacity-70"
                  disabled={!isSuperAdmin || tenantOptions.length === 0}
                  onChange={(event) => setSelectedTenantId(event.target.value)}
                  value={effectiveTenantId}
                >
                  {tenantOptions.length === 0 ? (
                    <option value="">No tenants available</option>
                  ) : null}
                  {tenantOptions.map((tenant) => (
                    <option
                      key={`tenant-option-${tenant.id}`}
                      value={tenant.id}
                    >
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/60">
              <table className="dense-table min-w-[980px] w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-3 text-left">
                      Name
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-left">
                      Email
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-left">
                      Role
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-center">
                      Status
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((user) => {
                      const canManage = canActOnUser(user);
                      return (
                        <tr
                          key={user.id}
                          className="border-t border-slate-700/70 bg-slate-900/50"
                        >
                          <td className="border border-slate-700 px-4 py-3 font-semibold text-white">
                            {user.name}
                          </td>
                          <td className="border border-slate-700 px-4 py-3 text-slate-300">
                            {user.email}
                          </td>
                          <td className="border border-slate-700 px-4 py-3 text-slate-300 capitalize">
                            {user.role.replace("_", " ")}
                          </td>
                          <td className="border border-slate-700 px-4 py-3 text-center">
                            <Badge
                              className={
                                user.active
                                  ? ""
                                  : "border-slate-500/70 bg-slate-800 text-slate-200"
                              }
                            >
                              {user.active ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="border border-slate-700 px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              {canManage ? (
                                <>
                                  <Button
                                    className="h-9 px-3"
                                    onClick={() => openEditUserDialog(user)}
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                  >
                                    <Pencil className="h-4 w-4" />
                                    Edit
                                  </Button>
                                  <Button
                                    className="h-9 px-3"
                                    disabled={deletingUserId === user.id}
                                    onClick={() => void handleDeleteUser(user)}
                                    size="sm"
                                    type="button"
                                    variant="destructive"
                                  >
                                    {deletingUserId === user.id ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                    Delete
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-slate-500">
                                  -
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr className="bg-slate-900/50">
                      <td
                        className="border border-slate-700 px-4 py-8 text-center text-sm text-slate-400"
                        colSpan={5}
                      >
                        No users found for this tenant yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Dialog
          open={userDialogOpen}
          onOpenChange={(open) => {
            if (open) {
              setUserDialogOpen(true);
              return;
            }
            closeUserDialog();
          }}
        >
          <DialogContent>
            {/* Header */}
            <DialogHeader className="pr-8">
              <DialogTitle>
                {editingUserId ? "Edit User" : "Create User"}
              </DialogTitle>
              <DialogDescription>
                This user will belong to{" "}
                {selectedTenantName || "the selected tenant"}.
              </DialogDescription>
            </DialogHeader>

            {/* FORM (unchanged) */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={userForm.name}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Jane Doe"
                />
              </div>

              {!editingUserId ? (
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={userForm.email}
                    onChange={(event) =>
                      setUserForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="jane@company.com"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input disabled value={userForm.email} />
                </div>
              )}

              <div className="space-y-2">
                <Label>
                  {editingUserId ? "New password" : "Temporary password"}
                </Label>
                <Input
                  type="password"
                  value={userForm.password}
                  onChange={(event) =>
                    setUserForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder={
                    editingUserId
                      ? "Leave blank to keep current password"
                      : "Temporary password"
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <div className="flex flex-wrap gap-2">
                  {availableRoles.map((role) => (
                    <PickerChip
                      key={role}
                      label={role.replace("_", " ")}
                      active={userForm.role === role}
                      onPress={() =>
                        setUserForm((current) => ({ ...current, role }))
                      }
                    />
                  ))}
                </div>
              </div>

              {editingUserId ? (
                <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/70 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      User status
                    </p>
                    <p className="text-sm text-slate-400">
                      Disable access without deleting the account.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className={[
                        "rounded-full border px-4 py-2 text-sm font-semibold transition",
                        userForm.active
                          ? "border-violet-400 bg-violet-500 text-white shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)]"
                          : "border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500 hover:bg-slate-700",
                      ].join(" ")}
                      onClick={() =>
                        setUserForm((current) => ({ ...current, active: true }))
                      }
                      type="button"
                    >
                      Active
                    </button>
                    <button
                      className={[
                        "rounded-full border px-4 py-2 text-sm font-semibold transition",
                        !userForm.active
                          ? "border-violet-400 bg-violet-500 text-white shadow-[0_10px_25px_-12px_rgba(139,92,246,0.9)]"
                          : "border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500 hover:bg-slate-700",
                      ].join(" ")}
                      onClick={() =>
                        setUserForm((current) => ({
                          ...current,
                          active: false,
                        }))
                      }
                      type="button"
                    >
                      Inactive
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end gap-3">
                <Button onClick={closeUserDialog} variant="ghost">
                  Cancel
                </Button>

                <Button
                  disabled={
                    savingUser ||
                    !userForm.name.trim() ||
                    (!editingUserId &&
                      (!userForm.email.trim() || !userForm.password.trim()))
                  }
                  onClick={() => void handleSaveUser()}
                >
                  {savingUser ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : editingUserId ? (
                    <Pencil className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {savingUser
                    ? "Saving..."
                    : editingUserId
                      ? "Save Changes"
                      : "Create User"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </AdminWorkspaceShell>
  );
}
