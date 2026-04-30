import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Database,
  LoaderCircle,
  Plus,
  Shield,
  Truck,
  Users,
  X,
} from "lucide-react";
import { TenantRecord } from "@flowiq/shared";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@flowiq/ui";
import { useAuth } from "../context/AuthContext";
import { createTenant, fetchTenants } from "../services/adminApi";

type AdminScreenProps = {
  onBack: () => void;
  onOpenUsers?: (tenantId: string) => void;
  onOpenMappings?: (tenantId: string) => void;
  onOpenShippingSettings?: (tenantId: string) => void;
  onOpenShippingCosts?: (tenantId: string) => void;
  onOpenPrintingCosts?: (tenantId: string) => void;
};

export function AdminScreen({
  onBack,
  onOpenUsers,
  onOpenMappings,
  onOpenShippingSettings,
  onOpenShippingCosts,
  onOpenPrintingCosts,
}: AdminScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(
    session?.user.tenantId || null,
  );
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false);
  const [creatingTenant, setCreatingTenant] = useState(false);

  const canManageTenants = session?.user.role === "super_admin";
  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null,
    [selectedTenantId, tenants],
  );
  const effectiveTenantId = canManageTenants
    ? selectedTenantId
    : (session?.user.tenantId ?? null);

  useEffect(() => {
    let active = true;

    async function loadAdminHome() {
      try {
        setLoading(true);
        setError("");

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
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Unable to load tenants",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAdminHome();
    return () => {
      active = false;
    };
  }, [canManageTenants, selectedTenantId]);

  async function handleCreateTenant() {
    setCreatingTenant(true);
    setError("");
    setNotice("");

    try {
      const response = await createTenant({ name: tenantName });
      setTenants((prev) => [...prev, response.tenant]);
      setSelectedTenantId(response.tenant.id);
      setTenantDialogOpen(false);
      setTenantName("");
      setNotice(`Tenant ${response.tenant.name} created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create tenant");
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

  function openPrintingCosts() {
    if (!effectiveTenantId || !onOpenPrintingCosts) return;
    onOpenPrintingCosts(effectiveTenantId);
  }

  function openShippingCosts() {
    if (!effectiveTenantId || !onOpenShippingCosts) return;
    onOpenShippingCosts(effectiveTenantId);
  }

  if (loading) {
    return (
      <main className="dense-main mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-center rounded-[28px] border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      </main>
    );
  }

  return (
    <main className="dense-main mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      {/* ---------------- MODAL FIX ---------------- */}
      <Dialog open={tenantDialogOpen} onOpenChange={setTenantDialogOpen}>
        <DialogContent className="relative">
          {/* Close Button (Top Right) */}
          <button
            onClick={() => setTenantDialogOpen(false)}
            className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Header */}
          <DialogHeader className="pr-8">
            <DialogTitle>Create Tenant</DialogTitle>
            <DialogDescription>
              Create a tenant and select it to continue with admin actions.
            </DialogDescription>
          </DialogHeader>

          {/* Content */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name-dialog">Tenant name</Label>
              <Input
                id="tenant-name-dialog"
                value={tenantName}
                onChange={(e) => setTenantName(e.target.value)}
                placeholder="Acme Print"
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button
                onClick={() => setTenantDialogOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>

              <Button
                disabled={creatingTenant || !tenantName.trim()}
                onClick={() => void handleCreateTenant()}
              >
                {creatingTenant ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {creatingTenant ? "Creating..." : "Create Tenant"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
