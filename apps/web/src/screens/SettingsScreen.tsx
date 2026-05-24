import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, Shield, Trash2 } from 'lucide-react';
import { SheetNameOverrides, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import { fetchAdminSheetNameOverrides, fetchTenants, upsertAdminSheetNameOverrides } from '../services/adminApi';
import { defaultSheetNamePresetOverrides, sanitizeSheetNameOverrides, sheetNamePresetEntries, toCanonicalSheetNameKey } from '../services/sheetNameOverrides';

type SettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenSettings'>;

type CustomOverrideRow = {
  id: string;
  source: string;
  name: string;
};

function createCustomRow(source = '', name = ''): CustomOverrideRow {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source,
    name,
  };
}

export function SettingsScreen({
  onBack,
  onOpenMappings,
  onOpenPrintingCosts,
  onOpenShippingCosts,
  onOpenShippingSettings,
  onOpenUsers,
  tenantId,
}: SettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(session?.user.tenantId ?? null);
  const [presetOverrides, setPresetOverrides] = useState<Record<string, string>>({});
  const [multipleArtworkFormats, setMultipleArtworkFormats] = useState<Record<string, boolean>>({});
  const [customOverrides, setCustomOverrides] = useState<CustomOverrideRow[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  const canSwitchTenant = session?.user.role === 'super_admin' && !tenantId;
  const effectiveTenantId = tenantId ?? (canSwitchTenant ? selectedTenantId ?? undefined : session?.user.tenantId ?? undefined);
  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === selectedTenantId) ?? null, [selectedTenantId, tenants]);

  function buildSettingsSnapshot(
    presetValues: Record<string, string>,
    customValues: CustomOverrideRow[],
    multipleArtworkValues: Record<string, boolean>,
  ) {
    const merged: SheetNameOverrides = {};
    sheetNamePresetEntries.forEach((entry) => {
      const nextValue = (presetValues[entry.key] || '').trim();
      if (nextValue) merged[entry.key] = nextValue;
    });
    customValues.forEach((row) => {
      const sourceKey = toCanonicalSheetNameKey(row.source);
      const nextValue = row.name.trim();
      if (!sourceKey || !nextValue) return;
      merged[sourceKey] = nextValue;
    });
    const normalizedMultipleArtworkFormats = Object.fromEntries(
      Object.entries(multipleArtworkValues).filter(([, enabled]) => Boolean(enabled)),
    );
    return JSON.stringify({
      overrides: merged,
      multipleArtworkFormats: normalizedMultipleArtworkFormats,
    });
  }

  const currentSnapshot = useMemo(
    () => buildSettingsSnapshot(presetOverrides, customOverrides, multipleArtworkFormats),
    [presetOverrides, customOverrides, multipleArtworkFormats],
  );
  const hasUnsavedChanges = savedSnapshot !== '' && currentSnapshot !== savedSnapshot;

  useEffect(() => {
    let active = true;
    async function loadBaseData() {
      try {
        setLoading(true);
        setError('');
        if (canSwitchTenant) {
          const tenantResponse = await fetchTenants();
          if (!active) return;
          setTenants(tenantResponse.tenants);
          if (!selectedTenantId && tenantResponse.tenants[0]) {
            setSelectedTenantId(tenantResponse.tenants[0].id);
          }
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

    void loadBaseData();
    return () => {
      active = false;
    };
  }, [canSwitchTenant, selectedTenantId]);

  useEffect(() => {
    let active = true;
    if (!effectiveTenantId) {
      setPresetOverrides({});
      setCustomOverrides([]);
      setLoading(false);
      return;
    }

    async function loadSettings() {
      try {
        setLoading(true);
        setError('');
        const response = await fetchAdminSheetNameOverrides(effectiveTenantId);
        if (!active) return;
        const normalized = sanitizeSheetNameOverrides(response.settings.overrides);
        const nextPreset: Record<string, string> = {};
        sheetNamePresetEntries.forEach((entry) => {
          nextPreset[entry.key] = normalized[entry.key] || defaultSheetNamePresetOverrides[entry.key] || '';
        });
        setPresetOverrides(nextPreset);
        setMultipleArtworkFormats(response.settings.multipleArtworkFormats ?? {});

        const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
        const nextCustom = Object.entries(normalized)
          .filter(([key]) => !presetKeys.has(key))
          .map(([key, value]) => createCustomRow(key, value))
          .sort((left, right) => left.source.localeCompare(right.source));
        setCustomOverrides(nextCustom);
        setSavedSnapshot(buildSettingsSnapshot(nextPreset, nextCustom, response.settings.multipleArtworkFormats ?? {}));
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load settings');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadSettings();
    return () => {
      active = false;
    };
  }, [effectiveTenantId]);

  async function handleSave() {
    if (!effectiveTenantId) {
      setError('Select a tenant before saving settings');
      return;
    }

    const merged: SheetNameOverrides = {};
    sheetNamePresetEntries.forEach((entry) => {
      const nextValue = (presetOverrides[entry.key] || '').trim();
      if (nextValue) {
        merged[entry.key] = nextValue;
      }
    });
    customOverrides.forEach((row) => {
      const sourceKey = toCanonicalSheetNameKey(row.source);
      const nextValue = row.name.trim();
      if (!sourceKey || !nextValue) return;
      merged[sourceKey] = nextValue;
    });
    const normalizedMultipleArtworkFormats = Object.fromEntries(
      Object.entries(multipleArtworkFormats).filter(([, enabled]) => Boolean(enabled)),
    );

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertAdminSheetNameOverrides({ overrides: merged, multipleArtworkFormats: normalizedMultipleArtworkFormats }, effectiveTenantId);
      const normalized = sanitizeSheetNameOverrides(response.settings.overrides);

      const nextPreset: Record<string, string> = {};
      sheetNamePresetEntries.forEach((entry) => {
        nextPreset[entry.key] = normalized[entry.key] || defaultSheetNamePresetOverrides[entry.key] || '';
      });
      setPresetOverrides(nextPreset);
      setMultipleArtworkFormats(response.settings.multipleArtworkFormats ?? {});

      const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
      const nextCustom = Object.entries(normalized)
        .filter(([key]) => !presetKeys.has(key))
        .map(([key, value]) => createCustomRow(key, value))
        .sort((left, right) => left.source.localeCompare(right.source));
      setCustomOverrides(nextCustom);
      setSavedSnapshot(buildSettingsSnapshot(nextPreset, nextCustom, response.settings.multipleArtworkFormats ?? {}));
      setNotice('Sheet name overrides saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (session?.user.role === 'user') {
    return (
      <main className="dense-main mx-auto flex min-h-0 w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-violet-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage sheet name settings.</CardDescription>
            <Button onClick={onBack} variant="secondary">Back</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function confirmDiscardChanges(action: () => void) {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    setPendingNavigationAction(() => action);
    setDiscardDialogOpen(true);
  }

  return (
    <AdminWorkspaceShell
      activeSection="settings"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      pageTitle="Settings"
      topBarActions={
        <Button
          className="h-9 min-w-[132px] rounded-md px-3 text-sm font-semibold btn-theme-primary"
          disabled={!effectiveTenantId || saving || loading}
          onClick={() => void handleSave()}
          type="button"
        >
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      }
      onBack={() => confirmDiscardChanges(onBack)}
      onOpenLanding={() => confirmDiscardChanges(onBack)}
      onOpenMappings={onOpenMappings ? () => confirmDiscardChanges(onOpenMappings) : undefined}
      onOpenPrintingCosts={onOpenPrintingCosts ? () => confirmDiscardChanges(onOpenPrintingCosts) : undefined}
      onOpenSettings={() => {}}
      onOpenShippingCosts={onOpenShippingCosts ? () => confirmDiscardChanges(onOpenShippingCosts) : undefined}
      onOpenShippingSettings={onOpenShippingSettings ? () => confirmDiscardChanges(onOpenShippingSettings) : undefined}
      onOpenUsers={onOpenUsers ? () => confirmDiscardChanges(onOpenUsers) : undefined}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

        {canSwitchTenant ? (
          <Card>
            <CardHeader className="p-5 pb-0">
              <CardTitle>Tenant scope</CardTitle>
              <CardDescription>Super admins can maintain sheet names for any tenant.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-slate-700 bg-slate-800/70 p-4">
                <p className="text-sm font-semibold text-white">
                  {selectedTenant ? `Managing settings for ${selectedTenant.name}` : 'No tenant selected'}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedTenant ? selectedTenant.id : 'Select a tenant below. Settings are tenant-specific.'}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {tenants.map((tenant) => {
                  const active = selectedTenantId === tenant.id;
                  return (
                    <button
                      key={tenant.id}
                      className={active
                        ? 'rounded-md border border-violet-400 bg-violet-500/10 p-4 text-left shadow-[0_10px_25px_-12px_rgba(105, 53, 228,0.85)] transition'
                        : 'rounded-md border border-slate-700 bg-slate-800/80 p-4 text-left transition hover:border-slate-500 hover:bg-slate-800'}
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
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : null}

        <section className="max-w-5xl space-y-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
                <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
                  <Label className="text-sm font-semibold text-slate-100">Sheet Size Mappings</Label>
                  <Button
                    className="h-8 px-3"
                    onClick={() => setCustomOverrides((current) => [...current, createCustomRow()])}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    <Plus className="h-4 w-4" />
                    Add Custom
                  </Button>
                </div>
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[260px]" />
                    <col className="w-[420px]" />
                    <col className="w-[180px]" />
                    <col className="w-[90px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                      <th className="border border-slate-700 px-4 py-2 text-left">Current Name</th>
                      <th className="border border-slate-700 px-4 py-2 text-left">Override Name</th>
                      <th className="border border-slate-700 px-4 py-2 text-center">Multiple Artwork</th>
                      <th className="border border-slate-700 px-4 py-2 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetNamePresetEntries.map((entry, rowIndex) => (
                      <tr
                        key={entry.key}
                        className={`border-t border-white/5 ${rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}`}
                      >
                        <td className="border border-slate-700 px-4 py-2 font-semibold text-white">{entry.label}</td>
                        <td className="border border-slate-700 px-4 py-2">
                          <Input
                            className="h-8 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-violet-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                            onChange={(event) =>
                              setPresetOverrides((current) => ({
                                ...current,
                                [entry.key]: event.target.value,
                              }))
                            }
                            placeholder={`Override for ${entry.label}`}
                            value={presetOverrides[entry.key] || ''}
                          />
                        </td>
                        <td className="border border-slate-700 px-4 py-2 text-center">
                          <input
                            checked={Boolean(multipleArtworkFormats[entry.key])}
                            className="h-4 w-4 accent-violet-400"
                            onChange={(event) =>
                              setMultipleArtworkFormats((current) => ({
                                ...current,
                                [entry.key]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                        </td>
                        <td className="border border-slate-700 px-4 py-2 text-center">
                          <Button
                            className="h-8 w-8 cursor-not-allowed rounded-md border-0 p-0 text-slate-600 opacity-60"
                            disabled
                            title="Preset rows cannot be deleted"
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {customOverrides.map((row, rowIndex) => {
                      const displayName = row.source.trim() || `Custom ${rowIndex + 1}`;
                      return (
                        <tr
                          key={row.id}
                          className={`border-t border-white/5 ${((sheetNamePresetEntries.length + rowIndex) % 2 === 0) ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}`}
                        >
                          <td className="border border-slate-700 px-4 py-2">
                            <Input
                              className="h-8 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-violet-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                              onChange={(event) =>
                                setCustomOverrides((current) => current.map((item) => (item.id === row.id ? { ...item, source: event.target.value } : item)))
                              }
                              placeholder={`Current name (for example ${displayName})`}
                              value={row.source}
                            />
                          </td>
                          <td className="border border-slate-700 px-4 py-2">
                            <Input
                              className="h-8 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-violet-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                              onChange={(event) =>
                                setCustomOverrides((current) => current.map((item) => (item.id === row.id ? { ...item, name: event.target.value } : item)))
                              }
                              placeholder={`Override for ${displayName}`}
                              value={row.name}
                            />
                          </td>
                          <td className="border border-slate-700 px-4 py-2 text-center">
                            <input
                              checked={Boolean(multipleArtworkFormats[toCanonicalSheetNameKey(row.source)])}
                              className="h-4 w-4 accent-violet-400"
                              onChange={(event) => {
                                const customKey = toCanonicalSheetNameKey(row.source);
                                if (!customKey) return;
                                setMultipleArtworkFormats((current) => ({
                                  ...current,
                                  [customKey]: event.target.checked,
                                }));
                              }}
                              type="checkbox"
                            />
                          </td>
                          <td className="border border-slate-700 px-4 py-2 text-center">
                            <Button
                              className="h-8 w-8 rounded-md border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200"
                              onClick={() => {
                                const customKey = toCanonicalSheetNameKey(row.source);
                                setCustomOverrides((current) => current.filter((item) => item.id !== row.id));
                                if (customKey) {
                                  setMultipleArtworkFormats((current) => {
                                    const next = { ...current };
                                    delete next[customKey];
                                    return next;
                                  });
                                }
                              }}
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>
      <Dialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          setDiscardDialogOpen(open);
          if (!open) setPendingNavigationAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="pb-1">
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes in Settings. Leaving now will discard them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              onClick={() => {
                setDiscardDialogOpen(false);
                setPendingNavigationAction(null);
              }}
              type="button"
              variant="ghost"
            >
              Stay
            </Button>
            <Button
              className="border border-rose-300/35 bg-rose-600 text-white hover:bg-rose-500"
              onClick={() => {
                const action = pendingNavigationAction;
                setDiscardDialogOpen(false);
                setPendingNavigationAction(null);
                if (action) action();
              }}
              type="button"
            >
              Discard & Leave
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminWorkspaceShell>
  );
}
