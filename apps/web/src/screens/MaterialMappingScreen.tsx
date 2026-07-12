import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Save, Shield } from 'lucide-react';
import { MaterialMappingRecord, TenantRecord } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
import { useAuth } from '../context/AuthContext';
import { fetchAdminSheetNameOverrides, fetchCalculatorMappings, fetchMaterialMappings, fetchTenants, upsertMaterialMappings } from '../services/adminApi';
import { defaultSheetNamePresetOverrides, sanitizeSheetNameOverrides, sheetNamePresetEntries } from '../services/sheetNameOverrides';

type MaterialMappingScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenMaterialMapping'>;

type SheetRow = {
  key: string;
  label: string;
};

function mappingKey(market: string, sheetKey: string) {
  return `${market}::${sheetKey}`;
}

function buildDraftSnapshot(drafts: Record<string, string>) {
  return JSON.stringify(
    Object.entries(drafts)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, value]) => [key, value.trim()]),
  );
}

function savedMappingKey(record: MaterialMappingRecord) {
  return mappingKey(record.market, record.sheetKey);
}

export function MaterialMappingScreen({
  onBack,
  onOpenMappings,
  onOpenMaterials,
  onOpenPrintingCosts,
  onOpenSettings,
  onOpenSheetSizeSettings,
  onOpenShippingCosts,
  onOpenShippingSettings,
  onOpenTenants,
  onOpenUsers,
  tenantId,
}: MaterialMappingScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [markets, setMarkets] = useState<string[]>([]);
  const [selectedMarket, setSelectedMarket] = useState('');
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedDrafts, setSavedDrafts] = useState<Record<string, string>>({});
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);

  const isSuperAdmin = session?.user.role === 'super_admin';
  const effectiveTenantId = isSuperAdmin ? selectedTenantId ?? tenantId ?? undefined : tenantId ?? session?.user.tenantId ?? undefined;
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
        if (isSuperAdmin) {
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
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load tenants');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTenants();
    return () => {
      active = false;
    };
  }, [isSuperAdmin, selectedTenantId]);

  useEffect(() => {
    let active = true;
    if (!effectiveTenantId || !isSuperAdmin) {
      setMarkets([]);
      setSheetRows([]);
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
        const [mappingResponse, sheetResponse, materialResponse] = await Promise.all([
          fetchCalculatorMappings(effectiveTenantId),
          fetchAdminSheetNameOverrides(effectiveTenantId),
          fetchMaterialMappings(effectiveTenantId),
        ]);
        if (!active) return;

        const nextMarkets = [...new Set(mappingResponse.mappings.map((mapping) => mapping.market))].sort((left, right) => left.localeCompare(right));
        const overrides = sanitizeSheetNameOverrides(sheetResponse.settings.overrides);
        const presetKeys = new Set(sheetNamePresetEntries.map((entry) => entry.key));
        const nextSheetRows = [
          ...sheetNamePresetEntries.map((entry) => ({
            key: entry.key,
            label: overrides[entry.key] || defaultSheetNamePresetOverrides[entry.key] || entry.label,
          })),
          ...Object.entries(overrides)
            .filter(([key]) => !presetKeys.has(key))
            .map(([key, value]) => ({ key, label: value || key }))
            .sort((left, right) => left.label.localeCompare(right.label)),
        ];
        const savedByKey = new Map(materialResponse.mappings.map((record) => [savedMappingKey(record), record.productCode]));
        const legacyProductCodes = sheetResponse.settings.productCodes ?? {};
        const nextDrafts: Record<string, string> = {};
        nextMarkets.forEach((market) => {
          nextSheetRows.forEach((row) => {
            nextDrafts[mappingKey(market, row.key)] = savedByKey.get(mappingKey(market, row.key)) ?? legacyProductCodes[row.key] ?? '';
          });
        });

        setMarkets(nextMarkets);
        setSheetRows(nextSheetRows);
        setDrafts(nextDrafts);
        setSavedDrafts(nextDrafts);
        setSelectedMarket((current) => (current && nextMarkets.includes(current) ? current : nextMarkets[0] ?? ''));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load material mappings');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      active = false;
    };
  }, [effectiveTenantId, isSuperAdmin]);

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

  function updateDraft(sheetKey: string, value: string) {
    if (!selectedMarket) return;
    setDrafts((current) => ({
      ...current,
      [mappingKey(selectedMarket, sheetKey)]: value,
    }));
  }

  async function handleSave() {
    if (!effectiveTenantId || !selectedMarket) {
      setError('Select a tenant and market before saving material mappings');
      return false;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await upsertMaterialMappings({
        mappings: sheetRows.map((row) => ({
          market: selectedMarket,
          sheetKey: row.key,
          productCode: (drafts[mappingKey(selectedMarket, row.key)] || '').trim(),
        })),
      }, effectiveTenantId);
      const updatedByKey = new Map(response.mappings.map((record) => [savedMappingKey(record), record.productCode]));
      setDrafts((current) => {
        const next = { ...current };
        sheetRows.forEach((row) => {
          next[mappingKey(selectedMarket, row.key)] = updatedByKey.get(mappingKey(selectedMarket, row.key)) ?? '';
        });
        return next;
      });
      setSavedDrafts((current) => {
        const next = { ...current };
        sheetRows.forEach((row) => {
          next[mappingKey(selectedMarket, row.key)] = updatedByKey.get(mappingKey(selectedMarket, row.key)) ?? '';
        });
        return next;
      });
      setNotice('Material mappings saved.');
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save material mappings');
      return false;
    } finally {
      setSaving(false);
    }
  }

  if (!isSuperAdmin) {
    return (
      <main className="dense-main mx-auto flex min-h-0 w-full max-w-3xl items-center px-6 py-8">
        <Card className="w-full">
          <CardContent className="space-y-4 p-8 text-center">
            <Shield className="mx-auto h-8 w-8 text-violet-300" />
            <CardTitle>Access restricted</CardTitle>
            <CardDescription>Only super admin users can manage material mappings.</CardDescription>
            <Button onClick={onBack} variant="secondary">Back</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <AdminWorkspaceShell
      activeSection="material-mapping"
      canAccessManagement
      canAccessShippingCosts
      canAccessPrintingCosts
      pageTitle="Product Mapping"
      onBack={() => confirmDiscardChanges(onBack)}
      onOpenLanding={() => confirmDiscardChanges(onBack)}
      onOpenMappings={onOpenMappings ? () => confirmDiscardChanges(onOpenMappings) : undefined}
      onOpenMaterialMapping={() => {}}
      onOpenMaterials={onOpenMaterials ? () => confirmDiscardChanges(onOpenMaterials) : undefined}
      onOpenPrintingCosts={onOpenPrintingCosts ? () => confirmDiscardChanges(onOpenPrintingCosts) : undefined}
      onOpenSettings={onOpenSettings ? () => confirmDiscardChanges(onOpenSettings) : undefined}
      onOpenSheetSizeSettings={onOpenSheetSizeSettings ? () => confirmDiscardChanges(onOpenSheetSizeSettings) : undefined}
      onOpenShippingCosts={onOpenShippingCosts ? () => confirmDiscardChanges(onOpenShippingCosts) : undefined}
      onOpenShippingSettings={onOpenShippingSettings ? () => confirmDiscardChanges(onOpenShippingSettings) : undefined}
      onOpenTenants={onOpenTenants ? () => confirmDiscardChanges(onOpenTenants) : undefined}
      onOpenUsers={onOpenUsers ? () => confirmDiscardChanges(onOpenUsers) : undefined}
    >
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

        <section className="flex flex-wrap gap-4">
          <div className="w-full sm:w-[320px]">
            <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
              <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span>
              <select
                id="material-mapping-tenant"
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

          <div className="w-full sm:w-[320px]">
            <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
              <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Market</span>
              <select
                id="material-mapping-market"
                className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
                onChange={(event) => setSelectedMarket(event.target.value)}
                value={selectedMarket}
              >
                {markets.length === 0 ? <option value="">No markets available</option> : null}
                {markets.map((market) => (
                  <option key={`material-market-${market}`} value={market}>{market}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="w-full max-w-4xl space-y-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-800/60 px-6 py-14">
              <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
            </div>
          ) : markets.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/40 px-6 py-12 text-center">
              <p className="text-base font-semibold text-white">No markets available</p>
              <p className="mt-2 text-sm text-slate-400">Add or import Quantity Mappings before setting material mappings.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[280px]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-2 text-left">Sheet Name</th>
                    <th className="border border-slate-700 px-4 py-2 text-left">Product Code</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.map((row, rowIndex) => (
                    <tr
                      key={row.key}
                      className={`border-t border-white/5 ${rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}`}
                    >
                      <td className="border border-slate-700 px-4 py-2 font-semibold text-white">{row.label}</td>
                      <td className="border border-slate-700 px-4 py-2">
                        <Input
                          className="h-8 rounded-none border-0 border-b border-slate-600 bg-transparent px-0 text-white shadow-none focus-visible:border-violet-400 focus-visible:ring-0 focus-visible:ring-offset-0"
                          onChange={(event) => updateDraft(row.key, event.target.value)}
                          placeholder={`Product code for ${row.label}`}
                          value={drafts[mappingKey(selectedMarket, row.key)] || ''}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && markets.length > 0 ? (
            <div className="flex justify-end">
              <Button
                className="h-9 min-w-[132px] rounded-md px-3 text-sm font-semibold btn-theme-primary"
                disabled={!effectiveTenantId || !selectedMarket || saving}
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
              You have unsaved changes in Product Mapping. Leaving now will discard them.
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
