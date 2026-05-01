import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Shield } from 'lucide-react';
import { CalculatorMappingRecord, formatKeys, FormatKey, PrintingCostBreakdown, TenantRecord } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { fetchCalculatorMappings, fetchMarketAssetPrintingCosts, fetchTenants, upsertMarketAssetPrintingCosts } from '../services/adminApi';

type PrintingCostSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
};

type AssetCostDraft = Record<FormatKey, string>;
const posterFormatKeys: FormatKey[] = ['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'QA0'];
const megaFormatKeys: FormatKey[] = ['Mega', 'DOT M', 'MP'];

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
  };
}

function costKey(market: string, assetId: string) {
  return `${market}\x00${assetId}`;
}

function toDraft(costs?: PrintingCostBreakdown): AssetCostDraft {
  const next = createEmptyCostDraft();
  if (!costs) return next;
  for (const key of formatKeys) {
    next[key] = String(costs[key] ?? 0);
  }
  const megaValue = megaCostValue(next);
  next.Mega = megaValue;
  next['DOT M'] = megaValue;
  next.MP = megaValue;
  return next;
}

function toBreakdown(draft: AssetCostDraft): PrintingCostBreakdown {
  const next = {} as PrintingCostBreakdown;
  for (const key of formatKeys) {
    const parsed = Number.parseFloat((draft[key] || '').trim());
    next[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  const normalizedMegaCost = next.Mega;
  next['DOT M'] = normalizedMegaCost;
  next.MP = normalizedMegaCost;
  return next;
}

function posterCostValue(draft: AssetCostDraft): string {
  const values = posterFormatKeys.map((key) => draft[key]);
  const firstNonEmpty = values.find((value) => value.trim() !== '');
  return firstNonEmpty ?? draft['8-sheet'] ?? '0';
}

function megaCostValue(draft: AssetCostDraft): string {
  const values = megaFormatKeys.map((key) => draft[key]);
  const firstNonEmpty = values.find((value) => value.trim() !== '');
  return firstNonEmpty ?? draft.Mega ?? '0';
}

export function PrintingCostSettingsScreen({ onBack, tenantId }: PrintingCostSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [draftsByAsset, setDraftsByAsset] = useState<Record<string, AssetCostDraft>>({});
  const [marketFilter, setMarketFilter] = useState<string>('');
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});

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
        const [mappingResponse, costResponse] = await Promise.all([
          fetchCalculatorMappings(tenant),
          fetchMarketAssetPrintingCosts(tenant),
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
  const visibleMappings = useMemo(
    () => selectedMarketMappings.filter((mapping) => !maintenanceAssetIds.has(mapping.id) && mapping.quantities.Mega > 0),
    [maintenanceAssetIds, selectedMarketMappings],
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
    if (selectedMarketMappings.length === 0) return '0';
    const values = selectedMarketMappings.map((mapping) => {
      const rowKey = costKey(mapping.market, mapping.id);
      return posterCostValue(draftsByAsset[rowKey] || createEmptyCostDraft());
    });
    const first = values[0] ?? '0';
    return values.every((value) => value === first) ? first : '';
  }, [draftsByAsset, selectedMarketMappings]);

  useEffect(() => {
    if (marketOptions.length === 0) {
      setMarketFilter('');
      return;
    }
    if (!marketFilter || !marketOptions.includes(marketFilter)) {
      setMarketFilter(marketOptions[0]);
    }
  }, [marketFilter, marketOptions]);

  function updateMegaDraft(market: string, assetId: string, value: string) {
    const rowKey = costKey(market, assetId);
    setDraftsByAsset((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || createEmptyCostDraft()),
        Mega: value,
        'DOT M': value,
        MP: value,
      },
    }));
    setDirtyRows((current) => ({
      ...current,
      [rowKey]: true,
    }));
  }

  function updatePosterDraft(market: string, assetId: string, value: string) {
    const rowKey = costKey(market, assetId);
    setDraftsByAsset((current) => {
      const currentRow = { ...(current[rowKey] || createEmptyCostDraft()) };
      posterFormatKeys.forEach((posterKey) => {
        currentRow[posterKey] = value;
      });
      return {
        ...current,
        [rowKey]: currentRow,
      };
    });
    setDirtyRows((current) => ({
      ...current,
      [rowKey]: true,
    }));
  }

  function updateMarketPosterDraft(value: string) {
    if (!marketFilter) return;
    setDraftsByAsset((current) => {
      const next = { ...current };
      selectedMarketMappings.forEach((mapping) => {
        const rowKey = costKey(mapping.market, mapping.id);
        const currentRow = { ...(next[rowKey] || createEmptyCostDraft()) };
        posterFormatKeys.forEach((posterKey) => {
          currentRow[posterKey] = value;
        });
        next[rowKey] = currentRow;
      });
      return next;
    });
    setDirtyRows((current) => {
      const next = { ...current };
      selectedMarketMappings.forEach((mapping) => {
        next[costKey(mapping.market, mapping.id)] = true;
      });
      return next;
    });
  }

  async function handleSaveMarket(targetMarket: string) {
    if (!selectedTenantId || !targetMarket) return;
    const dirtyAssetIds = Array.from(dirtyAssetIdsByMarket.get(targetMarket) ?? []);
    if (dirtyAssetIds.length === 0) return;

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

      const response = await upsertMarketAssetPrintingCosts({ costs: payload }, selectedTenantId);
      setDirtyRows((current) => {
        const next = { ...current };
        dirtyAssetIds.forEach((assetId) => {
          delete next[costKey(targetMarket, assetId)];
        });
        return next;
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save printing costs');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!selectedTenantId || loading || saving || dirtyAssetIdsByMarket.size === 0) return;
    const dirtyMarkets = Array.from(dirtyAssetIdsByMarket.keys());
    const targetMarket = dirtyAssetIdsByMarket.has(marketFilter) ? marketFilter : dirtyMarkets[0];
    if (!targetMarket) return;

    const timer = window.setTimeout(() => {
      void handleSaveMarket(targetMarket);
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dirtyAssetIdsByMarket, draftsByAsset, loading, marketFilter, saving, selectedTenantId]);

  if (!isSuperAdmin) {
    return (
      <main className="dense-main flex min-h-screen w-full flex-col gap-6">
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
    <main className="dense-main flex min-h-screen w-full flex-col gap-6">
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
          {loading ? (
            <div className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
              Loading assets and costs...
            </div>
          ) : visibleMappings.length === 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-900/60 px-4 py-6 text-sm text-slate-400">
              No assets found for this market.
            </div>
          ) : (
            <div className="rounded-md border border-slate-700 bg-slate-900/60">
              <table className="dense-table w-full table-fixed border-collapse text-xs sm:text-sm">
                <colgroup>
                  <col className="w-[24%]" />
                  <col className="w-[52%]" />
                  <col className="w-[24%]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Market</th>
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Asset</th>
                    <th className="border border-slate-700 px-1 py-2 text-center sm:px-2">Mega Price ($)</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMappings.map((mapping) => {
                    const rowKey = costKey(mapping.market, mapping.id);
                    const draft = draftsByAsset[rowKey] || createEmptyCostDraft();
                    return (
                      <tr key={`cost-row-${mapping.id}`} className="border-t border-slate-700/70 bg-slate-800/65">
                        <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{mapping.market}</td>
                        <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">
                          <p className="truncate font-semibold">{mapping.label || mapping.asset}</p>
                          <p className="truncate text-[10px] text-slate-400 sm:text-xs">{mapping.asset}</p>
                        </td>
                        <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300">$</span>
                            <Input
                              className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                              inputMode="decimal"
                              type="number"
                              min={0}
                              step="0.01"
                              value={megaCostValue(draft)}
                              onChange={(event) => updateMegaDraft(mapping.market, mapping.id, event.target.value)}
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
      </section>
    </main>
  );
}


