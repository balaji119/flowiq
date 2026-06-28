import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Save, Shield } from 'lucide-react';
import { CalculatorMappingRecord, MarketSheetSizeRecord, TenantRecord } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import { fetchCalculatorMappings, fetchMarketSheetSizes, fetchTenants, upsertMarketSheetSizes } from '../services/adminApi';

type SheetSizeSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenSheetSizeSettings'>;

type SheetSizeDraft = {
  widthMm: string;
  heightMm: string;
};

type SheetSizeRow = {
  key: string;
  name: string;
  assetId?: string;
  presetKey?: string;
};

const presetRows = [
  { key: '8-sheet', name: '8 Sheet' },
  { key: '8-sheet-a0', name: '8 Sheet A0' },
  { key: '6-sheet', name: '6 Sheet' },
  { key: '4-sheet', name: '4 Sheet' },
  { key: '2-sheet', name: '2 Sheet' },
];

function hasMegaFamilyQuantity(mapping: CalculatorMappingRecord): boolean {
  return (mapping.quantities.Mega ?? 0) > 0
    || (mapping.quantities['DOT M'] ?? 0) > 0
    || (mapping.quantities.MP ?? 0) > 0;
}

function rowKeyForAsset(assetId: string) {
  return `asset:${assetId}`;
}

function rowKeyForPreset(market: string, presetKey: string) {
  return `preset:${market}:${presetKey}`;
}

function savedKey(size: MarketSheetSizeRecord) {
  if (size.assetId) return rowKeyForAsset(size.assetId);
  return rowKeyForPreset(size.market, size.presetKey || '');
}

function emptyDraft(): SheetSizeDraft {
  return { widthMm: '', heightMm: '' };
}

function toDraft(size?: MarketSheetSizeRecord): SheetSizeDraft {
  if (!size) return emptyDraft();
  return {
    widthMm: size.widthMm > 0 ? String(size.widthMm) : '',
    heightMm: size.heightMm > 0 ? String(size.heightMm) : '',
  };
}

function toNumber(value: string) {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isValidDimensionInput(value: string) {
  return value === '' || /^\d{0,5}$/.test(value);
}

function buildDraftSnapshot(draftValues: Record<string, SheetSizeDraft>) {
  return JSON.stringify(
    Object.entries(draftValues)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => [
        key,
        value.widthMm.trim(),
        value.heightMm.trim(),
      ]),
  );
}

export function SheetSizeSettingsScreen({
  onBack,
  onOpenMappings,
  onOpenMaterials,
  onOpenPrintingCosts,
  onOpenSettings,
  onOpenShippingCosts,
  onOpenShippingSettings,
  onOpenTenants,
  onOpenUsers,
  tenantId,
}: SheetSizeSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [savedSizes, setSavedSizes] = useState<MarketSheetSizeRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SheetSizeDraft>>({});
  const [savedDrafts, setSavedDrafts] = useState<Record<string, SheetSizeDraft>>({});
  const [selectedMarketFilter, setSelectedMarketFilter] = useState('');
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  const canAccessManagement = session?.user.role !== 'user';
  const canSwitchTenant = session?.user.role === 'super_admin';
  const effectiveTenantId = canSwitchTenant ? selectedTenantId ?? tenantId ?? undefined : tenantId ?? session?.user.tenantId ?? undefined;
  const hasUnsavedChanges = useMemo(
    () => buildDraftSnapshot(drafts) !== buildDraftSnapshot(savedDrafts),
    [drafts, savedDrafts],
  );

  useEffect(() => {
    let active = true;

    async function loadTenants() {
      try {
        setLoading(true);
        setError('');
        if (canSwitchTenant) {
          const response = await fetchTenants();
          if (!active) return;
          setTenants(response.tenants);
          setSelectedTenantId((current) => (
            current && response.tenants.some((tenant) => tenant.id === current)
              ? current
              : response.tenants[0]?.id ?? null
          ));
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load tenants');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTenants();
    return () => {
      active = false;
    };
  }, [canSwitchTenant, selectedTenantId]);

  useEffect(() => {
    let active = true;
    if (!effectiveTenantId) {
      setMappings([]);
      setSavedSizes([]);
      setDrafts({});
      setSavedDrafts({});
      setLoading(false);
      return;
    }

    async function loadSettings() {
      try {
        setLoading(true);
        setError('');
        setNotice('');
        const [mappingResponse, sizeResponse] = await Promise.all([
          fetchCalculatorMappings(effectiveTenantId),
          fetchMarketSheetSizes(effectiveTenantId),
        ]);
        if (!active) return;

        const sortedMappings = [...mappingResponse.mappings].sort((left, right) => {
          const marketCompare = left.market.localeCompare(right.market);
          if (marketCompare !== 0) return marketCompare;
          const labelCompare = left.label.localeCompare(right.label);
          if (labelCompare !== 0) return labelCompare;
          return left.asset.localeCompare(right.asset);
        });
        const sizesByKey = new Map(sizeResponse.sizes.map((size) => [savedKey(size), size]));
        const nextDrafts: Record<string, SheetSizeDraft> = {};
        sortedMappings.forEach((mapping) => {
          nextDrafts[rowKeyForAsset(mapping.id)] = toDraft(sizesByKey.get(rowKeyForAsset(mapping.id)));
        });
        [...new Set(sortedMappings.map((mapping) => mapping.market))].forEach((market) => {
          presetRows.forEach((preset) => {
            nextDrafts[rowKeyForPreset(market, preset.key)] = toDraft(sizesByKey.get(rowKeyForPreset(market, preset.key)));
          });
        });
        setMappings(sortedMappings);
        setSavedSizes(sizeResponse.sizes);
        setDrafts(nextDrafts);
        setSavedDrafts(nextDrafts);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load sheet size settings');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      active = false;
    };
  }, [effectiveTenantId]);

  const marketOptions = useMemo(
    () => [...new Set(mappings.map((mapping) => mapping.market))],
    [mappings],
  );

  useEffect(() => {
    if (marketOptions.length === 0) {
      setSelectedMarketFilter('');
      return;
    }
    if (!selectedMarketFilter || !marketOptions.includes(selectedMarketFilter)) {
      setSelectedMarketFilter(marketOptions[0]);
    }
  }, [marketOptions, selectedMarketFilter]);

  const selectedMarketRows = useMemo<SheetSizeRow[]>(() => {
    if (!selectedMarketFilter) return [];
    const assetRows = mappings
      .filter((mapping) => mapping.market === selectedMarketFilter && hasMegaFamilyQuantity(mapping))
      .map((mapping) => ({
        key: rowKeyForAsset(mapping.id),
        name: mapping.label || mapping.asset,
        assetId: mapping.id,
      }));
    return [
      ...presetRows.map((preset) => ({
        key: rowKeyForPreset(selectedMarketFilter, preset.key),
        name: preset.name,
        presetKey: preset.key,
      })),
      ...assetRows,
    ];
  }, [mappings, selectedMarketFilter]);

  function updateDraft(rowKey: string, field: keyof SheetSizeDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || emptyDraft()),
        [field]: value,
      },
    }));
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

  async function handleSave() {
    if (!effectiveTenantId || !selectedMarketFilter) {
      setError('Select a tenant and market before saving sheet sizes');
      return false;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertMarketSheetSizes({
        sizes: selectedMarketRows.map((row) => {
          const draft = drafts[row.key] || emptyDraft();
          return {
            market: selectedMarketFilter,
            assetId: row.assetId ?? null,
            presetKey: row.presetKey,
            name: row.name,
            widthMm: toNumber(draft.widthMm),
            heightMm: toNumber(draft.heightMm),
          };
        }),
      }, effectiveTenantId);

      const updatedByKey = new Map(response.sizes.map((size) => [savedKey(size), size]));
      setSavedSizes((current) => {
        const nextByKey = new Map(current.map((size) => [savedKey(size), size]));
        response.sizes.forEach((size) => nextByKey.set(savedKey(size), size));
        return Array.from(nextByKey.values());
      });
      setDrafts((current) => {
        const next = { ...current };
        selectedMarketRows.forEach((row) => {
          next[row.key] = toDraft(updatedByKey.get(row.key));
        });
        return next;
      });
      setSavedDrafts((current) => {
        const next = { ...current };
        selectedMarketRows.forEach((row) => {
          next[row.key] = toDraft(updatedByKey.get(row.key));
        });
        return next;
      });
      setNotice('Sheet size settings saved.');
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save sheet size settings');
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!canAccessManagement) {
    return (
      <main className="dense-main mx-auto flex min-h-0 w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-violet-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only admin and super admin users can manage sheet size settings.</CardDescription>
            <Button onClick={onBack} variant="secondary">Back</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <AdminWorkspaceShell
      activeSection="sheet-size-settings"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      pageTitle="Sheet Size"
      onBack={() => confirmDiscardChanges(onBack)}
      onOpenLanding={() => confirmDiscardChanges(onBack)}
      onOpenMappings={onOpenMappings ? () => confirmDiscardChanges(onOpenMappings) : undefined}
      onOpenMaterials={onOpenMaterials ? () => confirmDiscardChanges(onOpenMaterials) : undefined}
      onOpenPrintingCosts={onOpenPrintingCosts ? () => confirmDiscardChanges(onOpenPrintingCosts) : undefined}
      onOpenSettings={onOpenSettings ? () => confirmDiscardChanges(onOpenSettings) : undefined}
      onOpenSheetSizeSettings={() => {}}
      onOpenShippingCosts={onOpenShippingCosts ? () => confirmDiscardChanges(onOpenShippingCosts) : undefined}
      onOpenShippingSettings={onOpenShippingSettings ? () => confirmDiscardChanges(onOpenShippingSettings) : undefined}
      onOpenTenants={onOpenTenants ? () => confirmDiscardChanges(onOpenTenants) : undefined}
      onOpenUsers={onOpenUsers ? () => confirmDiscardChanges(onOpenUsers) : undefined}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

        <section className="flex flex-wrap gap-4">
          {canSwitchTenant ? (
            <div className="w-full sm:w-[320px]">
              <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span>
                <select
                  id="sheet-size-tenant"
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
          ) : null}

          <div className="w-full sm:w-[320px]">
            <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
              <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Market</span>
              <select
                id="sheet-size-market-filter"
                className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                onChange={(event) => setSelectedMarketFilter(event.target.value)}
                value={selectedMarketFilter}
              >
                {marketOptions.length === 0 ? <option value="">No markets available</option> : null}
                {marketOptions.map((market) => (
                  <option key={`sheet-size-market-${market}`} value={market}>
                    {market}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="w-full max-w-3xl space-y-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : marketOptions.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">No mapping data yet</p>
              <p className="mt-2 text-sm text-slate-400">Add or import Quantity Mappings before setting sheet sizes.</p>
            </div>
          ) : selectedMarketRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">No eligible assets for this market</p>
              <p className="mt-2 text-sm text-slate-400">Assets appear here when Mega, Dot Mega, or Mega Portrait has a quantity.</p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="dense-table w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col />
                  <col className="w-[140px]" />
                  <col className="w-[140px]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-3 text-left">Name</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Width (mm)</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Height (mm)</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedMarketRows.map((row, rowIndex) => {
                    const draft = drafts[row.key] || emptyDraft();
                    return (
                      <tr
                        key={row.key}
                        className={`border-t border-white/5 ${rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}`}
                      >
                        <td className="whitespace-nowrap border border-slate-700 px-4 py-3 font-semibold text-white">{row.name}</td>
                        <td className="border border-slate-700 px-2 py-2">
                          <Input
                            className="mx-auto h-8 max-w-[112px] text-sm"
                            inputMode="numeric"
                            max={99999}
                            min={0}
                            onChange={(event) => {
                              if (isValidDimensionInput(event.target.value)) {
                                updateDraft(row.key, 'widthMm', event.target.value);
                              }
                            }}
                            step="1"
                            type="number"
                            value={draft.widthMm}
                          />
                        </td>
                        <td className="border border-slate-700 px-2 py-2">
                          <Input
                            className="mx-auto h-8 max-w-[112px] text-sm"
                            inputMode="numeric"
                            max={99999}
                            min={0}
                            onChange={(event) => {
                              if (isValidDimensionInput(event.target.value)) {
                                updateDraft(row.key, 'heightMm', event.target.value);
                              }
                            }}
                            step="1"
                            type="number"
                            value={draft.heightMm}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && marketOptions.length > 0 && selectedMarketRows.length > 0 ? (
            <div className="flex justify-end">
              <Button
                className="h-9 min-w-[132px] rounded-md px-3 text-sm font-semibold btn-theme-primary"
                disabled={!effectiveTenantId || !selectedMarketFilter || saving}
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
              You have unsaved changes in Sheet Size. Leaving now will discard them.
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
