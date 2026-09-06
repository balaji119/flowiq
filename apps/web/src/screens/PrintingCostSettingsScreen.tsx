import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Shield } from 'lucide-react';
import { CalculatorMappingRecord, CustomPrintCostInput, formatKeys, FormatKey, PrintingCostBreakdown, SheetNameOverrides, TenantRecord } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { fetchAdminSheetNameOverrides, fetchCalculatorMappings, fetchCustomPrintCosts, fetchMarketAssetPrintingCosts, fetchMarketPrintingCosts, fetchTenants, upsertAdminSheetNameOverrides, upsertCustomPrintCosts, upsertMarketAssetPrintingCosts, upsertMarketPrintingCosts } from '../services/adminApi';
import { resolveCanonicalSheetName, toCanonicalSheetNameKey } from '../services/sheetNameOverrides';

type PrintingCostSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
};

type AssetCostDraft = Record<string, string>;
type CustomCostDraft = Record<'onePageCost' | 'twoPageCost' | 'fivePageCost' | 'tenPlusPageCost', string>;
const posterFormatKeys: FormatKey[] = ['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'QA0'];
const settingsKeyByFormatKey: Partial<Record<FormatKey, string>> = {
  '8-sheet': '8-sheet',
  QA0: '8-sheet-a0',
  '6-sheet': '6-sheet',
  '4-sheet': '4-sheet',
  '2-sheet': '2-sheet',
  Mega: 'mega',
  'DOT M': 'dot-m',
  MP: 'mega-portrait',
  FF: 'ff',
};

function createEmptyCostDraft(): AssetCostDraft {
  return {
    '8-sheet': '0',
    '6-sheet': '0',
    '4-sheet': '0',
    '2-sheet': '0',
    QA0: '0',
    Mega: '0',
    'DOT M': '0',
    MP: '0',
    FF: '0',
  };
}

function quantityForSheetKey(mapping: CalculatorMappingRecord, sheetKey: string) {
  const quantities = mapping.quantities as Record<string, number>;
  if (typeof quantities[sheetKey] === 'number') return quantities[sheetKey];
  const matchingKey = Object.keys(quantities).find((key) => toCanonicalSheetNameKey(key) === sheetKey);
  return matchingKey ? quantities[matchingKey] ?? 0 : 0;
}

function draftValue(draft: Record<string, string>, sheetKey: string) {
  const formatKey = formatKeys.find((key) => settingsKeyByFormatKey[key] === sheetKey);
  return draft[sheetKey] ?? (formatKey ? draft[formatKey] : undefined) ?? '0';
}

function costKey(market: string, assetId: string) {
  return `${market}\x00${assetId}`;
}

function assetSheetCostFlagKey(assetId: string, sheetKey: string) {
  return `asset:${assetId}|sheet:${sheetKey}`;
}

function toDraft(costs?: PrintingCostBreakdown): AssetCostDraft {
  const next: AssetCostDraft = createEmptyCostDraft();
  if (!costs) return next;
  Object.entries(costs).forEach(([key, value]) => {
    next[key] = String(value ?? 0);
  });
  return next;
}

function toBreakdown(draft: Record<string, string>): PrintingCostBreakdown {
  const next: PrintingCostBreakdown = {};
  Object.keys(draft).forEach((key) => {
    if ((posterFormatKeys as readonly string[]).includes(key)) return;
    const parsed = Number.parseFloat((draft[key] || '').trim());
    next[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  });
  return next;
}

function parseCostValue(value: string) {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function customCostDraft(cost?: CustomPrintCostInput): CustomCostDraft {
  return {
    onePageCost: String(cost?.onePageCost ?? 0),
    twoPageCost: String(cost?.twoPageCost ?? 0),
    fivePageCost: String(cost?.fivePageCost ?? 0),
    tenPlusPageCost: String(cost?.tenPlusPageCost ?? 0),
  };
}

function parseCustomCost(sheetKey: string, draft: CustomCostDraft): CustomPrintCostInput {
  const parse = (value: string) => {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return {
    sheetKey,
    onePageCost: parse(draft.onePageCost),
    twoPageCost: parse(draft.twoPageCost),
    fivePageCost: parse(draft.fivePageCost),
    tenPlusPageCost: parse(draft.tenPlusPageCost),
  };
}

export function PrintingCostSettingsScreen({ onBack, tenantId }: PrintingCostSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [draftsByAsset, setDraftsByAsset] = useState<Record<string, Record<string, string>>>({});
  const [posterCostsByMarket, setPosterCostsByMarket] = useState<Record<string, string>>({});
  const [marketFilter, setMarketFilter] = useState<string>('');
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});
  const [dirtyPosterMarkets, setDirtyPosterMarkets] = useState<Record<string, boolean>>({});
  const [sheetNameOverrides, setSheetNameOverrides] = useState<SheetNameOverrides>({});
  const [multipleArtworkFormats, setMultipleArtworkFormats] = useState<Record<string, boolean>>({});
  const [customPrintCostFormats, setCustomPrintCostFormats] = useState<Record<string, boolean>>({});
  const [customSheetSizeFormats, setCustomSheetSizeFormats] = useState<Record<string, boolean>>({});
  const [customPrintCostFlagsDirty, setCustomPrintCostFlagsDirty] = useState(false);
  const [customCostDrafts, setCustomCostDrafts] = useState<Record<string, CustomCostDraft>>({});
  const [dirtyCustomRows, setDirtyCustomRows] = useState<Record<string, boolean>>({});

  const isSuperAdmin = session?.user.role === 'super_admin';

  useEffect(() => {
    let active = true;

    async function loadTenants() {
      if (!isSuperAdmin) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError('');
        const response = await fetchTenants();
        if (!active) return;
        setTenants(response.tenants);
        if (!selectedTenantId && response.tenants[0]) {
          setSelectedTenantId(response.tenants[0].id);
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
  }, [isSuperAdmin, selectedTenantId]);

  useEffect(() => {
    let active = true;
    if (!isSuperAdmin || !selectedTenantId) return;
    const tenant = selectedTenantId;

    async function loadCosts() {
      try {
        setLoading(true);
        setError('');
        const [mappingResponse, costResponse, marketCostResponse, sheetResponse, customCostResponse] = await Promise.all([
          fetchCalculatorMappings(tenant),
          fetchMarketAssetPrintingCosts(tenant),
          fetchMarketPrintingCosts(tenant),
          fetchAdminSheetNameOverrides(tenant),
          fetchCustomPrintCosts(tenant),
        ]);
        if (!active) return;

        const sortedMappings = [...mappingResponse.mappings].sort((left, right) => {
          const marketCompare = left.market.localeCompare(right.market);
          if (marketCompare !== 0) return marketCompare;
          const labelCompare = left.label.localeCompare(right.label);
          if (labelCompare !== 0) return labelCompare;
          return left.asset.localeCompare(right.asset);
        });
        setMappings(sortedMappings);
        const costByKey = new Map(costResponse.costs.map((record) => [costKey(record.market, record.assetId), record.costs]));
        const nextDrafts: Record<string, AssetCostDraft> = {};
        sortedMappings.forEach((mapping) => {
          nextDrafts[costKey(mapping.market, mapping.id)] = toDraft(costByKey.get(costKey(mapping.market, mapping.id)));
        });
        setDraftsByAsset(nextDrafts);
        setDirtyRows({});
        const marketCostByName = new Map(marketCostResponse.costs.map((record) => [record.market, String(record.posterCost ?? 0)]));
        const nextPosterCosts: Record<string, string> = {};
        sortedMappings.forEach((mapping) => {
          if (!(mapping.market in nextPosterCosts)) {
            nextPosterCosts[mapping.market] = marketCostByName.get(mapping.market) ?? '0';
          }
        });
        setPosterCostsByMarket(nextPosterCosts);
        setDirtyPosterMarkets({});
        setSheetNameOverrides(sheetResponse.settings.overrides);
        setMultipleArtworkFormats(sheetResponse.settings.multipleArtworkFormats ?? {});
        setCustomPrintCostFormats(sheetResponse.settings.customPrintCostFormats ?? {});
        setCustomSheetSizeFormats(sheetResponse.settings.customSheetSizeFormats ?? {});
        setCustomPrintCostFlagsDirty(false);
        const customCostsByKey = new Map(customCostResponse.costs.map((cost) => [cost.sheetKey, cost]));
        const nextCustomDrafts: Record<string, CustomCostDraft> = {};
        Object.entries(sheetResponse.settings.customPrintCostFormats ?? {}).forEach(([sheetKey, enabled]) => {
          if (enabled) nextCustomDrafts[sheetKey] = customCostDraft(customCostsByKey.get(sheetKey));
        });
        setCustomCostDrafts(nextCustomDrafts);
        setDirtyCustomRows({});
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load printing cost settings');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCosts();
    return () => {
      active = false;
    };
  }, [isSuperAdmin, selectedTenantId]);

  const marketOptions = useMemo(
    () => [...new Set(mappings.map((mapping) => mapping.market))],
    [mappings],
  );
  const selectedMarketMappings = useMemo(
    () => mappings.filter((mapping) => mapping.market === marketFilter),
    [marketFilter, mappings],
  );
  const maintenanceAssetIds = useMemo(
    () => new Set(selectedMarketMappings.map((mapping) => mapping.maintenanceAssetId).filter((assetId): assetId is string => Boolean(assetId))),
    [selectedMarketMappings],
  );
  const parentByMaintenanceAssetId = useMemo(() => {
    const map = new Map<string, CalculatorMappingRecord>();
    selectedMarketMappings.forEach((mapping) => {
      if (mapping.maintenanceAssetId) {
        map.set(mapping.maintenanceAssetId, mapping);
      }
    });
    return map;
  }, [selectedMarketMappings]);
  const customSheetRows = useMemo(
    () => selectedMarketMappings
      .filter((mapping) => !maintenanceAssetIds.has(mapping.id))
      .flatMap((mapping) => Object.keys(customSheetSizeFormats)
        .filter((sheetKey) => customSheetSizeFormats[sheetKey] && quantityForSheetKey(mapping, sheetKey) > 0)
        .map((sheetKey) => ({
          mapping,
          sheetKey,
          label: `${mapping.label || mapping.asset} | ${resolveCanonicalSheetName(sheetKey, sheetNameOverrides)}`,
        }))),
    [customSheetSizeFormats, maintenanceAssetIds, selectedMarketMappings, sheetNameOverrides],
  );
  const customPrintCostRows = useMemo(
    () => customSheetRows.filter(({ mapping, sheetKey }) => Boolean(customPrintCostFormats[assetSheetCostFlagKey(mapping.id, sheetKey)])),
    [customPrintCostFormats, customSheetRows],
  );
  const dirtyAssetIdsByMarket = useMemo(() => {
    const byMarket = new Map<string, Set<string>>();
    Object.entries(dirtyRows).forEach(([rowKey, isDirty]) => {
      if (!isDirty) return;
      const [market, assetId] = rowKey.split('\x00');
      if (!market || !assetId) return;
      if (!byMarket.has(market)) {
        byMarket.set(market, new Set<string>());
      }
      byMarket.get(market)?.add(assetId);
    });
    return byMarket;
  }, [dirtyRows]);
  const marketPosterCost = useMemo(() => {
    if (!marketFilter) return '0';
    return posterCostsByMarket[marketFilter] ?? '0';
  }, [marketFilter, posterCostsByMarket]);

  useEffect(() => {
    if (marketOptions.length === 0) {
      setMarketFilter('');
      return;
    }
    if (!marketFilter || !marketOptions.includes(marketFilter)) {
      setMarketFilter(marketOptions[0]);
    }
  }, [marketFilter, marketOptions]);

  function updateCustomSheetDraft(market: string, assetId: string, sheetKey: string, value: string) {
    const rowKey = costKey(market, assetId);
    setDraftsByAsset((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || createEmptyCostDraft()),
        [sheetKey]: value,
      },
    }));
    setDirtyRows((current) => ({
      ...current,
      [rowKey]: true,
    }));
  }

  function updateMarketPosterDraft(value: string) {
    if (!marketFilter) return;
    setPosterCostsByMarket((current) => ({ ...current, [marketFilter]: value }));
    setDirtyPosterMarkets((current) => ({ ...current, [marketFilter]: true }));
  }

  function updateCustomPrintCostFlag(market: string, assetId: string, sheetKey: string, checked: boolean) {
    const flagKey = assetSheetCostFlagKey(assetId, sheetKey);
    setCustomPrintCostFormats((current) => {
      const next = { ...current };
      if (checked) {
        next[flagKey] = true;
      } else {
        delete next[flagKey];
      }
      return next;
    });
    if (checked) {
      setDraftsByAsset((current) => {
        const rowKey = costKey(market, assetId);
        return {
          ...current,
          [rowKey]: {
            ...(current[rowKey] || createEmptyCostDraft()),
            [sheetKey]: '',
          },
        };
      });
      setDirtyRows((current) => ({ ...current, [costKey(market, assetId)]: true }));
      setCustomCostDrafts((current) => ({
        ...current,
        [flagKey]: current[flagKey] ?? customCostDraft(),
      }));
    } else {
      setDirtyCustomRows((current) => {
        const next = { ...current };
        delete next[flagKey];
        return next;
      });
    }
    setCustomPrintCostFlagsDirty(true);
  }

  function updateCustomCostDraft(sheetKey: string, field: keyof CustomCostDraft, value: string) {
    setCustomCostDrafts((current) => ({
      ...current,
      [sheetKey]: { ...(current[sheetKey] ?? customCostDraft()), [field]: value },
    }));
    setDirtyCustomRows((current) => ({ ...current, [sheetKey]: true }));
  }

  useEffect(() => {
    if (!selectedTenantId || loading || saving || !customPrintCostFlagsDirty) return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      setError('');
      try {
        await upsertAdminSheetNameOverrides({
          overrides: sheetNameOverrides,
          multipleArtworkFormats,
          customPrintCostFormats,
          customSheetSizeFormats,
        }, selectedTenantId);
        setCustomPrintCostFlagsDirty(false);
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save custom print cost selections');
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [customPrintCostFlagsDirty, customPrintCostFormats, customSheetSizeFormats, loading, multipleArtworkFormats, saving, selectedTenantId, sheetNameOverrides]);

  useEffect(() => {
    if (!selectedTenantId || loading || saving) return;
    const sheetKeys = Object.keys(dirtyCustomRows).filter((key) => dirtyCustomRows[key] && customPrintCostFormats[key]);
    if (sheetKeys.length === 0) return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      setError('');
      try {
        await upsertCustomPrintCosts({
          costs: sheetKeys.map((sheetKey) => parseCustomCost(sheetKey, customCostDrafts[sheetKey] ?? customCostDraft())),
        }, selectedTenantId);
        setDirtyCustomRows((current) => {
          const next = { ...current };
          sheetKeys.forEach((key) => delete next[key]);
          return next;
        });
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Unable to save custom printing costs');
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [customCostDrafts, customPrintCostFormats, dirtyCustomRows, loading, saving, selectedTenantId]);

  async function handleSaveMarket(targetMarket: string) {
    if (!selectedTenantId || !targetMarket) return;
    const dirtyAssetIds = Array.from(dirtyAssetIdsByMarket.get(targetMarket) ?? []);
    const hasDirtyPosterCost = Boolean(dirtyPosterMarkets[targetMarket]);
    if (dirtyAssetIds.length === 0 && !hasDirtyPosterCost) return;

    const marketMappings = mappings.filter((mapping) => mapping.market === targetMarket);
    const marketMaintenanceAssetIds = new Set(
      marketMappings
        .map((mapping) => mapping.maintenanceAssetId)
        .filter((assetId): assetId is string => Boolean(assetId)),
    );
    const marketParentByMaintenanceAssetId = new Map<string, CalculatorMappingRecord>();
    marketMappings.forEach((mapping) => {
      if (mapping.maintenanceAssetId) {
        marketParentByMaintenanceAssetId.set(mapping.maintenanceAssetId, mapping);
      }
    });

    setSaving(true);
    setError('');

    try {
      if (hasDirtyPosterCost) {
        await upsertMarketPrintingCosts({
          costs: [{
            market: targetMarket,
            posterCost: parseCostValue(posterCostsByMarket[targetMarket] ?? '0'),
          }],
        }, selectedTenantId);
      }

      if (dirtyAssetIds.length > 0) {
        const nextAssetIds = new Set(dirtyAssetIds);
        marketMappings.forEach((mapping) => {
          if (nextAssetIds.has(mapping.id) && mapping.maintenanceAssetId) {
            nextAssetIds.add(mapping.maintenanceAssetId);
          }
        });

        const payload = marketMappings
          .filter((mapping) => nextAssetIds.has(mapping.id))
          .map((mapping) => {
            const sourceMapping = marketMaintenanceAssetIds.has(mapping.id)
              ? marketParentByMaintenanceAssetId.get(mapping.id) ?? mapping
              : mapping;
            const rowKey = costKey(sourceMapping.market, sourceMapping.id);
            const draft = draftsByAsset[rowKey] || createEmptyCostDraft();
            return {
              market: mapping.market,
              assetId: mapping.id,
              costs: toBreakdown(draft),
            };
          });

        await upsertMarketAssetPrintingCosts({ costs: payload }, selectedTenantId);
      }
      setDirtyRows((current) => {
        const next = { ...current };
        dirtyAssetIds.forEach((assetId) => {
          delete next[costKey(targetMarket, assetId)];
        });
        return next;
      });
      setDirtyPosterMarkets((current) => {
        const next = { ...current };
        delete next[targetMarket];
        return next;
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save printing costs');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!selectedTenantId || loading || saving) return;
    const dirtyMarkets = Array.from(new Set([
      ...Array.from(dirtyAssetIdsByMarket.keys()),
      ...Object.keys(dirtyPosterMarkets).filter((market) => dirtyPosterMarkets[market]),
    ]));
    if (dirtyMarkets.length === 0) return;
    const targetMarket = dirtyMarkets.includes(marketFilter) ? marketFilter : dirtyMarkets[0];
    if (!targetMarket) return;

    const timer = window.setTimeout(() => {
      void handleSaveMarket(targetMarket);
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dirtyAssetIdsByMarket, dirtyPosterMarkets, draftsByAsset, loading, marketFilter, posterCostsByMarket, saving, selectedTenantId]);

  if (!isSuperAdmin) {
    return (
      <main className="dense-main flex min-h-0 w-full flex-col gap-6">
        <Card>
          <CardHeader className="p-6">
            <CardTitle className="flex items-center gap-3"><Shield className="h-5 w-5 text-violet-300" /> Printing Costs</CardTitle>
            <CardDescription>This section is available to super admin only.</CardDescription>
            <div>
              <Button className="mt-3" onClick={onBack} type="button" variant="secondary">
                Back
              </Button>
            </div>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="dense-main flex min-h-0 w-full flex-col gap-6">
      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      <section className="flex flex-wrap gap-4">
          <div className="w-full sm:w-[320px]">
            <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
              <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span>
            <select
              id="printing-cost-tenant"
                className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
              value={selectedTenantId ?? ''}
              onChange={(event) => setSelectedTenantId(event.target.value || null)}
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
              id="printing-cost-market-filter"
                className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
              value={marketFilter}
              onChange={(event) => setMarketFilter(event.target.value)}
            >
              {marketOptions.map((market) => (
                <option key={`printing-cost-market-${market}`} value={market}>
                  {market}
                </option>
                ))}
              </select>
            </div>
          </div>
          <div className="w-full sm:w-[320px]">
            <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
              <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Poster Cost</span>
              <div className="flex h-full flex-1 items-center gap-2 px-3">
                <span className="text-slate-300">$</span>
                <Input
                  id="printing-cost-global-poster"
                  className="h-full border-0 bg-transparent px-0 text-sm [appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  inputMode="decimal"
                  type="number"
                  min={0}
                  step="0.01"
                  value={marketPosterCost}
                  onChange={(event) => updateMarketPosterDraft(event.target.value)}
                />
              </div>
            </div>
          </div>
      </section>

      <section className="space-y-4">
        {saving ? (
          <div className="flex justify-end">
            <p className="text-sm text-slate-300">Saving...</p>
          </div>
        ) : null}
        <h2 className="text-base font-semibold text-white">Custom Sheet Cost</h2>
          {loading ? (
            <div className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
              Loading assets and costs...
            </div>
          ) : customSheetRows.length === 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-6 text-sm text-slate-400">
              No assets found for this market.
            </div>
          ) : (
            <div className="rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="dense-table w-full table-fixed border-collapse text-xs sm:text-sm">
                <colgroup>
                  <col className="w-[20%]" />
                  <col className="w-[42%]" />
                  <col className="w-[16%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Market</th>
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Asset | Sheet Type</th>
                    <th className="border border-slate-700 px-1 py-2 text-center sm:px-2">Custom Print Cost</th>
                    <th className="border border-slate-700 px-1 py-2 text-center sm:px-2">Custom Sheet Price ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {customSheetRows.map(({ mapping, sheetKey, label }, rowIndex) => {
                    const rowKey = costKey(mapping.market, mapping.id);
                    const draft = draftsByAsset[rowKey] || createEmptyCostDraft();
                    const customPrintCostEnabled = Boolean(customPrintCostFormats[assetSheetCostFlagKey(mapping.id, sheetKey)]);
                    return (
                      <tr
                        key={`cost-row-${mapping.id}-${sheetKey}`}
                        className={`border-t border-white/5 ${rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}`}
                      >
                        <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{mapping.market}</td>
                        <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">
                          <p className="truncate font-semibold">{label}</p>
                        </td>
                        <td className="border border-slate-700 px-1 py-1.5 text-center sm:px-2 sm:py-2">
                          <input
                            checked={customPrintCostEnabled}
                            className="h-4 w-4 accent-violet-400"
                            onChange={(event) => updateCustomPrintCostFlag(mapping.market, mapping.id, sheetKey, event.target.checked)}
                            type="checkbox"
                          />
                        </td>
                        <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300">$</span>
                            <Input
                              className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                              disabled={customPrintCostEnabled}
                              inputMode="decimal"
                              type="number"
                              min={0}
                              step="0.01"
                              value={customPrintCostEnabled ? '' : draftValue(draft, sheetKey)}
                              onChange={(event) => updateCustomSheetDraft(mapping.market, mapping.id, sheetKey, event.target.value)}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        {!loading && customPrintCostRows.length > 0 ? (
          <div className="space-y-2 pt-2">
            <h2 className="text-base font-semibold text-white">Custom Cost</h2>
            <div className="overflow-x-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="dense-table w-full min-w-[900px] table-fixed border-collapse text-xs sm:text-sm">
                <colgroup>
                  <col className="w-[36%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                    <th className="border border-slate-700 px-3 py-2 text-left">Asset | Sheet Type</th>
                    <th className="border border-slate-700 px-2 py-2 text-center">1 Page Cost ($)</th>
                    <th className="border border-slate-700 px-2 py-2 text-center">2 Page Cost ($)</th>
                    <th className="border border-slate-700 px-2 py-2 text-center">5 Page Cost ($)</th>
                    <th className="border border-slate-700 px-2 py-2 text-center">10+ Page Cost ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {customPrintCostRows.map(({ mapping, sheetKey, label }, rowIndex) => {
                    const rowKey = assetSheetCostFlagKey(mapping.id, sheetKey);
                    const draft = customCostDrafts[rowKey] ?? customCostDraft();
                    const fields: Array<keyof CustomCostDraft> = ['onePageCost', 'twoPageCost', 'fivePageCost', 'tenPlusPageCost'];
                    return (
                      <tr key={`custom-print-cost-${rowKey}`} className={rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'}>
                        <td className="border border-slate-700 px-3 py-2 font-semibold text-white">{label}</td>
                        {fields.map((field) => (
                          <td key={`${rowKey}-${field}`} className="border border-slate-700 px-2 py-1.5">
                            <Input
                              className="h-8 text-right text-xs sm:text-sm"
                              inputMode="decimal"
                              min={0}
                              onChange={(event) => updateCustomCostDraft(rowKey, field, event.target.value)}
                              step="0.01"
                              type="number"
                              value={draft[field]}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}


