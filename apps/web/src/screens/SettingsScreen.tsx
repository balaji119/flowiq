import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Plus, Save, Shield, Trash2 } from 'lucide-react';
import { SheetNameOverrides, TenantRecord } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import { fetchAdminSheetNameOverrides, fetchCalculatorMappings, fetchTenants, upsertAdminSheetNameOverrides } from '../services/adminApi';
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
  onOpenMaterials,
  onOpenPrintingCosts,
  onOpenSheetSizeSettings,
  onOpenShippingCosts,
  onOpenShippingSettings,
  onOpenTenants,
  onOpenUsers,
  tenantId,
}: SettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [presetOverrides, setPresetOverrides] = useState<Record<string, string>>({});
  const [multipleArtworkFormats, setMultipleArtworkFormats] = useState<Record<string, boolean>>({});
  const [customPrintCostFormats, setCustomPrintCostFormats] = useState<Record<string, boolean>>({});
  const [productCodes, setProductCodes] = useState<Record<string, string>>({});
  const [customOverrides, setCustomOverrides] = useState<CustomOverrideRow[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  const canSwitchTenant = session?.user.role === 'super_admin';
  const effectiveTenantId = canSwitchTenant ? selectedTenantId ?? tenantId ?? undefined : tenantId ?? session?.user.tenantId ?? undefined;

  function buildSettingsSnapshot(
    presetValues: Record<string, string>,
    customValues: CustomOverrideRow[],
    multipleArtworkValues: Record<string, boolean>,
    customPrintCostValues: Record<string, boolean>,
    productCodeValues: Record<string, string>,
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
    const normalizedCustomPrintCostFormats = Object.fromEntries(
      Object.entries(customPrintCostValues).filter(([, enabled]) => Boolean(enabled)),
    );
    return JSON.stringify({
      overrides: merged,
      multipleArtworkFormats: normalizedMultipleArtworkFormats,
      customPrintCostFormats: normalizedCustomPrintCostFormats,
      productCodes: Object.fromEntries(Object.entries(productCodeValues).filter(([, code]) => code.trim()).map(([key, code]) => [key, code.trim()])),
    });
  }

  const currentSnapshot = useMemo(
    () => buildSettingsSnapshot(presetOverrides, customOverrides, multipleArtworkFormats, customPrintCostFormats, productCodes),
    [presetOverrides, customOverrides, multipleArtworkFormats, customPrintCostFormats, productCodes],
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
          setSelectedTenantId((current) => (
            current && tenantResponse.tenants.some((tenant) => tenant.id === current)
              ? current
              : tenantResponse.tenants[0]?.id ?? null
          ));
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
        const [response, mappingsResponse] = await Promise.all([
          fetchAdminSheetNameOverrides(effectiveTenantId),
          fetchCalculatorMappings(effectiveTenantId),
        ]);
        if (!active) return;
        let normalized = sanitizeSheetNameOverrides(response.settings.overrides);
        const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
        const importedCustomColumns = Array.from(
          new Set(
            mappingsResponse.mappings.flatMap((mapping) => Object.keys(mapping.quantities as Record<string, number>)),
          ),
        ).reduce<SheetNameOverrides>((result, quantityKey) => {
          const canonicalKey = toCanonicalSheetNameKey(quantityKey);
          if (!canonicalKey || presetKeys.has(canonicalKey) || normalized[canonicalKey] || result[canonicalKey]) return result;
          result[canonicalKey] = quantityKey;
          return result;
        }, {});
        if (Object.keys(importedCustomColumns).length > 0) {
          const synchronized = await upsertAdminSheetNameOverrides(
            {
              overrides: { ...normalized, ...importedCustomColumns },
              multipleArtworkFormats: response.settings.multipleArtworkFormats ?? {},
              customPrintCostFormats: response.settings.customPrintCostFormats ?? {},
              productCodes: response.settings.productCodes ?? {},
            },
            effectiveTenantId,
          );
          if (!active) return;
          normalized = sanitizeSheetNameOverrides(synchronized.settings.overrides);
          response.settings.multipleArtworkFormats = synchronized.settings.multipleArtworkFormats;
        }
        const nextPreset: Record<string, string> = {};
        sheetNamePresetEntries.forEach((entry) => {
          nextPreset[entry.key] = normalized[entry.key] || defaultSheetNamePresetOverrides[entry.key] || '';
        });
        setPresetOverrides(nextPreset);
        setMultipleArtworkFormats(response.settings.multipleArtworkFormats ?? {});
        setCustomPrintCostFormats(response.settings.customPrintCostFormats ?? {});
        setProductCodes(response.settings.productCodes ?? {});

        const nextCustom = Object.entries(normalized)
          .filter(([key]) => !presetKeys.has(key))
          .map(([key, value]) => createCustomRow(key, value))
          .sort((left, right) => left.source.localeCompare(right.source));
        setCustomOverrides(nextCustom);
        setSavedSnapshot(buildSettingsSnapshot(nextPreset, nextCustom, response.settings.multipleArtworkFormats ?? {}, response.settings.customPrintCostFormats ?? {}, response.settings.productCodes ?? {}));
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
      return false;
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
    const normalizedCustomPrintCostFormats = Object.fromEntries(
      Object.entries(customPrintCostFormats).filter(([, enabled]) => Boolean(enabled)),
    );

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertAdminSheetNameOverrides({
        overrides: merged,
        multipleArtworkFormats: normalizedMultipleArtworkFormats,
      customPrintCostFormats: normalizedCustomPrintCostFormats,
      productCodes,
      }, effectiveTenantId);
      const normalized = sanitizeSheetNameOverrides(response.settings.overrides);

      const nextPreset: Record<string, string> = {};
      sheetNamePresetEntries.forEach((entry) => {
        nextPreset[entry.key] = normalized[entry.key] || defaultSheetNamePresetOverrides[entry.key] || '';
      });
      setPresetOverrides(nextPreset);
      setMultipleArtworkFormats(response.settings.multipleArtworkFormats ?? {});
      setCustomPrintCostFormats(response.settings.customPrintCostFormats ?? {});
      setProductCodes(response.settings.productCodes ?? {});

      const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
      const nextCustom = Object.entries(normalized)
        .filter(([key]) => !presetKeys.has(key))
        .map(([key, value]) => createCustomRow(key, value))
        .sort((left, right) => left.source.localeCompare(right.source));
      setCustomOverrides(nextCustom);
      setSavedSnapshot(buildSettingsSnapshot(nextPreset, nextCustom, response.settings.multipleArtworkFormats ?? {}, response.settings.customPrintCostFormats ?? {}, response.settings.productCodes ?? {}));
      setNotice('Sheet name overrides saved.');
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save settings');
      return false;
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
      pageTitle="Sheet Name"
      onBack={() => confirmDiscardChanges(onBack)}
      onOpenLanding={() => confirmDiscardChanges(onBack)}
      onOpenMappings={onOpenMappings ? () => confirmDiscardChanges(onOpenMappings) : undefined}
      onOpenMaterials={onOpenMaterials ? () => confirmDiscardChanges(onOpenMaterials) : undefined}
      onOpenPrintingCosts={onOpenPrintingCosts ? () => confirmDiscardChanges(onOpenPrintingCosts) : undefined}
      onOpenSettings={() => {}}
      onOpenSheetSizeSettings={onOpenSheetSizeSettings ? () => confirmDiscardChanges(onOpenSheetSizeSettings) : undefined}
      onOpenShippingCosts={onOpenShippingCosts ? () => confirmDiscardChanges(onOpenShippingCosts) : undefined}
      onOpenShippingSettings={onOpenShippingSettings ? () => confirmDiscardChanges(onOpenShippingSettings) : undefined}
      onOpenTenants={onOpenTenants ? () => confirmDiscardChanges(onOpenTenants) : undefined}
      onOpenUsers={onOpenUsers ? () => confirmDiscardChanges(onOpenUsers) : undefined}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

        {canSwitchTenant ? (
          <section className="flex flex-wrap gap-4">
            <div className="w-full sm:w-[320px]">
              <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span>
                <select
                  id="sheet-name-tenant"
                  className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                  value={selectedTenantId ?? ''}
                  onChange={(event) => {
                    const nextTenantId = event.target.value || null;
                    confirmDiscardChanges(() => setSelectedTenantId(nextTenantId));
                  }}
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        ) : null}

        <section className="w-full max-w-7xl space-y-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
                <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
                  <Label className="text-sm font-semibold text-slate-100">Sheet Name Mappings</Label>
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
                    <col className="w-[220px]" />
                    <col className="w-[340px]" />
                    <col className="w-[220px]" />
                    <col className="w-[180px]" />
                    <col className="w-[180px]" />
                    <col className="w-[90px]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                      <th className="border border-slate-700 px-4 py-2 text-left">Current Name</th>
                      <th className="border border-slate-700 px-4 py-2 text-left">Override Name</th>
                      <th className="border border-slate-700 px-4 py-2 text-left">Product Code</th>
                      <th className="border border-slate-700 px-4 py-2 text-center">Multiple Artwork</th>
                      <th className="border border-slate-700 px-4 py-2 text-center">Custom Print Cost</th>
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
                        <td className="border border-slate-700 px-4 py-2">
                          <Input
                            className="h-8 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-violet-400 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={session?.user.role !== 'super_admin'}
                            onChange={(event) => setProductCodes((current) => ({ ...current, [entry.key]: event.target.value }))}
                            placeholder={`Product code for ${entry.label}`}
                            title={session?.user.role === 'super_admin' ? 'PrintIQ product code' : 'Super admin only'}
                            value={productCodes[entry.key] || ''}
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
                          <input
                            checked={Boolean(customPrintCostFormats[entry.key])}
                            className="h-4 w-4 accent-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={session?.user.role !== 'super_admin'}
                            onChange={(event) => setCustomPrintCostFormats((current) => ({
                              ...current,
                              [entry.key]: event.target.checked,
                            }))}
                            title={session?.user.role === 'super_admin' ? 'Use tenant-level custom print cost tiers' : 'Super admin only'}
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
                          <td className="border border-slate-700 px-4 py-2">
                            <Input
                              className="h-8 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-violet-400 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={session?.user.role !== 'super_admin'}
                              onChange={(event) => {
                                const customKey = toCanonicalSheetNameKey(row.source);
                                if (!customKey) return;
                                setProductCodes((current) => ({ ...current, [customKey]: event.target.value }));
                              }}
                              placeholder={`Product code for ${displayName}`}
                              title={session?.user.role === 'super_admin' ? 'PrintIQ product code' : 'Super admin only'}
                              value={productCodes[toCanonicalSheetNameKey(row.source)] || ''}
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
                            <input
                              checked={Boolean(customPrintCostFormats[toCanonicalSheetNameKey(row.source)])}
                              className="h-4 w-4 accent-violet-400 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={session?.user.role !== 'super_admin'}
                              onChange={(event) => {
                                const customKey = toCanonicalSheetNameKey(row.source);
                                if (!customKey) return;
                                setCustomPrintCostFormats((current) => ({
                                  ...current,
                                  [customKey]: event.target.checked,
                                }));
                              }}
                              title={session?.user.role === 'super_admin' ? 'Use tenant-level custom print cost tiers' : 'Super admin only'}
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
                                  setCustomPrintCostFormats((current) => {
                                    const next = { ...current };
                                    delete next[customKey];
                                    return next;
                                  });
                                  setProductCodes((current) => {
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
          {!loading ? (
            <div className="flex justify-end">
              <Button
                className="h-9 min-w-[132px] rounded-md px-3 text-sm font-semibold btn-theme-primary"
                disabled={!effectiveTenantId || saving}
                onClick={() => void handleSave()}
                type="button"
              >
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          ) : null}
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
              onClick={() => {
                const action = pendingNavigationAction;
                setDiscardDialogOpen(false);
                setPendingNavigationAction(null);
                if (action) action();
              }}
              type="button"
              variant="secondary"
            >
              Discard
            </Button>
            <Button
              disabled={saving || loading}
              onClick={() => {
                void (async () => {
                  const action = pendingNavigationAction;
                  const saved = await handleSave();
                  if (!saved) return;
                  setDiscardDialogOpen(false);
                  setPendingNavigationAction(null);
                  if (action) action();
                })();
              }}
              type="button"
            >
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : null}
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminWorkspaceShell>
  );
}
