import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, Shield } from 'lucide-react';
import { CalculatorMappingRecord, formatKeys, FormatKey, MarketAssetPrintingCostRecord, PrintingCostBreakdown, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { fetchCalculatorMappings, fetchMarketAssetPrintingCosts, fetchTenants, upsertMarketAssetPrintingCosts } from '../services/adminApi';

type PrintingCostSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
};

type AssetCostDraft = Record<FormatKey, string>;

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
  return next;
}

function toBreakdown(draft: AssetCostDraft): PrintingCostBreakdown {
  const next = {} as PrintingCostBreakdown;
  for (const key of formatKeys) {
    const parsed = Number.parseFloat((draft[key] || '').trim());
    next[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return next;
}

export function PrintingCostSettingsScreen({ onBack, tenantId }: PrintingCostSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [costRecords, setCostRecords] = useState<MarketAssetPrintingCostRecord[]>([]);
  const [draftsByAsset, setDraftsByAsset] = useState<Record<string, AssetCostDraft>>({});
  const [marketFilter, setMarketFilter] = useState<string>('');
  const [dirtyMarkets, setDirtyMarkets] = useState<Record<string, boolean>>({});

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
        setNotice('');
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
        setCostRecords(costResponse.costs);

        const costByKey = new Map(costResponse.costs.map((record) => [costKey(record.market, record.assetId), record.costs]));
        const nextDrafts: Record<string, AssetCostDraft> = {};
        sortedMappings.forEach((mapping) => {
          nextDrafts[costKey(mapping.market, mapping.id)] = toDraft(costByKey.get(costKey(mapping.market, mapping.id)));
        });
        setDraftsByAsset(nextDrafts);
        setDirtyMarkets({});
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
    () => selectedMarketMappings.filter((mapping) => !maintenanceAssetIds.has(mapping.id)),
    [maintenanceAssetIds, selectedMarketMappings],
  );

  useEffect(() => {
    if (marketOptions.length === 0) {
      setMarketFilter('');
      return;
    }
    if (!marketFilter || !marketOptions.includes(marketFilter)) {
      setMarketFilter(marketOptions[0]);
    }
  }, [marketFilter, marketOptions]);

  function updateDraft(market: string, assetId: string, key: FormatKey, value: string) {
    const rowKey = costKey(market, assetId);
    setDraftsByAsset((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || createEmptyCostDraft()),
        [key]: value,
      },
    }));
    setDirtyMarkets((current) => ({
      ...current,
      [market]: true,
    }));
  }

  async function handleSaveAll(options?: { silent?: boolean }) {
    if (!selectedTenantId || !marketFilter) return;
    setSaving(true);
    setError('');
    if (!options?.silent) {
      setNotice('');
    }

    try {
      const payload = selectedMarketMappings.map((mapping) => {
        const sourceMapping = maintenanceAssetIds.has(mapping.id) ? parentByMaintenanceAssetId.get(mapping.id) ?? mapping : mapping;
        const rowKey = costKey(sourceMapping.market, sourceMapping.id);
        const draft = draftsByAsset[rowKey] || createEmptyCostDraft();
        return {
          market: mapping.market,
          assetId: mapping.id,
          costs: toBreakdown(draft),
        };
      });

      const response = await upsertMarketAssetPrintingCosts({ costs: payload }, selectedTenantId);
      setCostRecords(response.costs);
      setDirtyMarkets((current) => ({
        ...current,
        [marketFilter]: false,
      }));
      setNotice(`Saved printing costs for ${payload.length} asset${payload.length === 1 ? '' : 's'}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save printing costs');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!selectedTenantId || !marketFilter || loading || visibleMappings.length === 0 || !dirtyMarkets[marketFilter]) return;

    const timer = window.setTimeout(() => {
      void handleSaveAll({ silent: true });
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dirtyMarkets, draftsByAsset, loading, marketFilter, selectedTenantId, visibleMappings]);

  if (!isSuperAdmin) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <Card>
          <CardHeader className="p-6">
            <CardTitle className="flex items-center gap-3"><Shield className="h-5 w-5 text-violet-300" /> Printing Costs</CardTitle>
            <CardDescription>This section is available to super admin only.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="space-y-4">
        <Button onClick={onBack} variant="ghost">
          <ArrowLeft className="h-4 w-4" />
          Back to Admin
        </Button>
        <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
          <Shield className="h-3.5 w-3.5" />
          Printing Cost Admin
        </Badge>
      </header>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}
      {notice ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}

      <Card>
        <CardHeader className="p-5 pb-0">
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="printing-cost-tenant">Tenant</Label>
            <select
              id="printing-cost-tenant"
              className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100"
              value={selectedTenantId ?? ''}
              onChange={(event) => setSelectedTenantId(event.target.value || null)}
            >
              <option value="">Select tenant</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="printing-cost-market-filter">Market</Label>
            <select
              id="printing-cost-market-filter"
              className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100"
              value={marketFilter}
              onChange={(event) => setMarketFilter(event.target.value)}
            >
              {marketOptions.map((market) => (
                <option key={`printing-cost-market-${market}`} value={market}>
                  {market}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400">Loaded costs: {costRecords.length}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-5 pb-0">
          <CardTitle>Asset printing costs</CardTitle>
          <CardDescription>
            Enter per-unit cost for each poster category. Changes auto-save.
            {saving ? ' Saving...' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
              Loading assets and costs...
            </div>
          ) : visibleMappings.length === 0 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-6 text-sm text-slate-400">
              No assets found for this market.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60">
              <table className="w-full table-fixed border-collapse text-xs sm:text-sm">
                <colgroup>
                  <col className="w-[28%]" />
                  {formatKeys.map((key) => (
                    <col key={`cost-col-${key}`} className="w-[9%]" />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Asset</th>
                    {formatKeys.map((key) => (
                      <th key={`cost-head-${key}`} className="border border-slate-700 px-1 py-2 text-center sm:px-2">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleMappings.map((mapping) => {
                    const rowKey = costKey(mapping.market, mapping.id);
                    const draft = draftsByAsset[rowKey] || createEmptyCostDraft();
                    return (
                      <tr key={`cost-row-${mapping.id}`} className="border-t border-slate-700/70 bg-slate-800/65">
                        <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">
                          <p className="truncate font-semibold">{mapping.label || mapping.asset}</p>
                          <p className="truncate text-[10px] text-slate-400 sm:text-xs">{mapping.asset}</p>
                        </td>
                        {formatKeys.map((key) => (
                          <td key={`cost-cell-${mapping.id}-${key}`} className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                            <Input
                              className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                              inputMode="decimal"
                              type="number"
                              min={0}
                              step="0.01"
                              value={draft[key]}
                              onChange={(event) => updateDraft(mapping.market, mapping.id, key, event.target.value)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
