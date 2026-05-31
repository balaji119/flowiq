import { useEffect, useState } from "react";
import { Building2, LoaderCircle, Pencil, Plus, Shield, Trash2 } from "lucide-react";
import { TenantRecord } from "@flowiq/shared";
import {
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
  createTenant,
  deleteTenant,
  fetchTenants,
  updateTenant,
} from "../services/adminApi";

type TenantManagementScreenProps = {
  onBack: () => void;
} & Omit<AdminWorkspaceHandlers, "onBack" | "onOpenTenants">;

type TenantFormState = {
  name: string;
};

function emptyTenantForm(): TenantFormState {
  return {
    name: "",
  };
}

export function TenantManagementScreen({
  onBack,
  onOpenMappings,
  onOpenPrintingCosts,
  onOpenSettings,
  onOpenSheetSizeSettings,
  onOpenShippingSettings,
  onOpenShippingCosts,
  onOpenUsers,
}: TenantManagementScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [tenantDialogError, setTenantDialogError] = useState("");
  const [savingTenant, setSavingTenant] = useState(false);
  const [deletingTenantId, setDeletingTenantId] = useState<string | null>(null);
  const [tenantPendingDelete, setTenantPendingDelete] = useState<TenantRecord | null>(null);
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [tenantForm, setTenantForm] = useState<TenantFormState>(() => emptyTenantForm());

  useEffect(() => {
    let active = true;

    async function loadTenants() {
      if (session?.user.role !== "super_admin") {
        setTenants([]);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError("");
        const response = await fetchTenants();
        if (!active) return;
        setTenants(response.tenants);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load tenants");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadTenants();
    return () => {
      active = false;
    };
  }, [session?.user.role]);

  function openCreateTenantDialog() {
    setEditingTenantId(null);
    setTenantForm(emptyTenantForm());
    setTenantDialogError("");
    setTenantDialogOpen(true);
  }

  function openEditTenantDialog(tenant: TenantRecord) {
    setEditingTenantId(tenant.id);
    setTenantForm({ name: tenant.name });
    setTenantDialogError("");
    setTenantDialogOpen(true);
  }

  function closeTenantDialog() {
    setTenantDialogOpen(false);
    setEditingTenantId(null);
    setTenantForm(emptyTenantForm());
    setTenantDialogError("");
  }

  async function handleSaveTenant() {
    setSavingTenant(true);
    setTenantDialogError("");
    setNotice("");

    try {
      if (editingTenantId) {
        const response = await updateTenant(editingTenantId, {
          name: tenantForm.name,
        });
        setTenants((current) =>
          current.map((tenant) =>
            tenant.id === editingTenantId ? response.tenant : tenant,
          ),
        );
        setNotice(`Tenant ${response.tenant.name} updated.`);
      } else {
        const response = await createTenant({
          name: tenantForm.name,
        });
        setTenants((current) =>
          [...current, response.tenant].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        );
        setNotice(`Tenant ${response.tenant.name} created.`);
      }
      closeTenantDialog();
    } catch (saveError) {
      setTenantDialogError(
        saveError instanceof Error ? saveError.message : "Unable to save tenant",
      );
    } finally {
      setSavingTenant(false);
    }
  }

  function openDeleteTenantDialog(tenant: TenantRecord) {
    setTenantPendingDelete(tenant);
  }

  function closeDeleteTenantDialog() {
    if (deletingTenantId) return;
    setTenantPendingDelete(null);
  }

  async function handleConfirmDeleteTenant() {
    if (!tenantPendingDelete) return;

    setDeletingTenantId(tenantPendingDelete.id);
    setError("");
    setNotice("");
    try {
      await deleteTenant(tenantPendingDelete.id);
      setTenants((current) =>
        current.filter((tenant) => tenant.id !== tenantPendingDelete.id),
      );
      setNotice(`Tenant ${tenantPendingDelete.name} deleted.`);
      setTenantPendingDelete(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Unable to delete tenant",
      );
    } finally {
      setDeletingTenantId(null);
    }
  }

  if (session?.user.role !== "super_admin") {
    return (
      <main className="dense-main mx-auto flex min-h-0 w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-violet-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>
              Only super admin users can manage tenants.
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
      activeSection="tenants"
      canAccessManagement
      canAccessShippingCosts
      canAccessPrintingCosts
      pageTitle="Tenant Management"
      topBarActions={
        <Button
          className="h-10 min-w-[150px] rounded-md border border-violet-300/35 bg-violet-500 px-5 text-sm font-semibold text-white shadow-[0_2px_10px_rgba(105, 53, 228,0.25)] transition-all duration-150 hover:-translate-y-[1px] hover:bg-violet-400 hover:shadow-[0_6px_16px_rgba(105, 53, 228,0.32)] focus-visible:ring-2 focus-visible:ring-violet-300/70 focus-visible:ring-offset-0"
          onClick={openCreateTenantDialog}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Create Tenant
        </Button>
      }
      onBack={onBack}
      onOpenLanding={onBack}
      onOpenMappings={onOpenMappings}
      onOpenPrintingCosts={onOpenPrintingCosts}
      onOpenSettings={onOpenSettings}
      onOpenSheetSizeSettings={onOpenSheetSizeSettings}
      onOpenShippingCosts={onOpenShippingCosts}
      onOpenShippingSettings={onOpenShippingSettings}
      onOpenTenants={() => {}}
      onOpenUsers={onOpenUsers}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? (
          <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">
            {notice}
          </div>
        ) : null}

        <section className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="dense-table min-w-[820px] w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-3 text-left">
                      Tenant
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-center">
                      Users
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-center">
                      Campaigns
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-left">
                      Created
                    </th>
                    <th className="border border-slate-700 px-4 py-3 text-center">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.length > 0 ? (
                    tenants.map((tenant, rowIndex) => (
                      <tr
                        key={tenant.id}
                        className={`border-t border-white/5 ${
                          rowIndex % 2 === 0 ? "bg-[#241c45]/70" : "bg-[#1a1733]"
                        }`}
                      >
                        <td className="border border-slate-700 px-4 py-3 font-semibold text-white">
                          <span className="inline-flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-violet-300" />
                            {tenant.name}
                          </span>
                        </td>
                        <td className="border border-slate-700 px-4 py-3 text-center text-slate-200">
                          {tenant.userCount ?? 0}
                        </td>
                        <td className="border border-slate-700 px-4 py-3 text-center text-slate-200">
                          {tenant.campaignCount ?? 0}
                        </td>
                        <td className="border border-slate-700 px-4 py-3 text-slate-300">
                          {tenant.createdAt
                            ? new Date(tenant.createdAt).toLocaleString("en-GB")
                            : "-"}
                        </td>
                        <td className="border border-slate-700 px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              className="h-9 px-3"
                              onClick={() => openEditTenantDialog(tenant)}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </Button>
                            <Button
                              className="h-9 px-3"
                              disabled={deletingTenantId === tenant.id}
                              onClick={() => openDeleteTenantDialog(tenant)}
                              size="sm"
                              type="button"
                              variant="destructive"
                            >
                              {deletingTenantId === tenant.id ? (
                                <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="bg-[#1a1733]">
                      <td
                        className="border border-slate-700 px-4 py-8 text-center text-sm text-slate-400"
                        colSpan={5}
                      >
                        No tenants found yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Dialog
          open={tenantDialogOpen}
          onOpenChange={(open) => {
            if (open) {
              setTenantDialogOpen(true);
              return;
            }
            closeTenantDialog();
          }}
        >
          <DialogContent>
            <DialogHeader className="pr-8">
              <DialogTitle>
                {editingTenantId ? "Edit Tenant" : "Create Tenant"}
              </DialogTitle>
              <DialogDescription>
                Tenants separate users, campaigns, mappings, and settings.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {tenantDialogError ? (
                <div
                  className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200"
                  role="alert"
                >
                  {tenantDialogError}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={tenantForm.name}
                  onChange={(event) =>
                    setTenantForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="ADS"
                />
              </div>

              <div className="flex justify-end gap-3">
                <Button onClick={closeTenantDialog} type="button" variant="ghost">
                  Cancel
                </Button>

                <Button
                  disabled={savingTenant || !tenantForm.name.trim()}
                  onClick={() => void handleSaveTenant()}
                  type="button"
                >
                  {savingTenant ? (
                    <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                  ) : editingTenantId ? (
                    <Pencil className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {savingTenant
                    ? "Saving..."
                    : editingTenantId
                      ? "Save Changes"
                      : "Create Tenant"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(tenantPendingDelete)}
          onOpenChange={(open) => {
            if (open) return;
            closeDeleteTenantDialog();
          }}
        >
          <DialogContent>
            <DialogHeader className="pb-2">
              <DialogTitle>Delete Tenant</DialogTitle>
              <DialogDescription className="pt-1 leading-6">
                {tenantPendingDelete
                  ? `Delete ${tenantPendingDelete.name}? This action cannot be undone.`
                  : "Delete this tenant? This action cannot be undone."}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              Tenants with assigned users or campaigns must be cleaned up before
              they can be deleted.
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                disabled={Boolean(deletingTenantId)}
                onClick={closeDeleteTenantDialog}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                disabled={Boolean(deletingTenantId)}
                onClick={() => void handleConfirmDeleteTenant()}
                type="button"
                variant="destructive"
              >
                {deletingTenantId ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                {deletingTenantId ? "Deleting..." : "Delete Tenant"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </AdminWorkspaceShell>
  );
}
