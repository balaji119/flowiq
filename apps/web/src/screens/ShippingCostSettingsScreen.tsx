import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LoaderCircle, Shield, Truck } from 'lucide-react';
import { CalculatorMappingRecord, MarketAssetShippingCostInput, MarketAssetShippingCostRecord, MarketShippingRateRecord, TenantRecord } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import {
  fetchCalculatorMappings,
  fetchMarketAssetShippingCosts,
  fetchMarketShippingRates,
  fetchTenants,
  upsertMarketAssetShippingCosts,
  upsertMarketShippingRate,
} from '../services/adminApi';

type ShippingCostSettingsScreenProps = {
  onBack: () => void;
  tenantId?: string | null;
};

type AssetShippingDraft = {
  megaShippingRate: string;
  dotMShippingRate: string;
  mpShippingRate: string;
};

function costKey(market: string, assetId: string) {
  return `${market}\x00${assetId}`;
}

function emptyAssetShippingDraft(): AssetShippingDraft {
  return {
    megaShippingRate: '0',
    dotMShippingRate: '0',
    mpShippingRate: '0',
  };
}

export function ShippingCostSettingsScreen({ onBack, tenantId }: ShippingCostSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [marketFilter, setMarketFilter] = useState('all');
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [rates, setRates] = useState<MarketShippingRateRecord[]>([]);
  const [assetCosts, setAssetCosts] = useState<MarketAssetShippingCostRecord[]>([]);
  const [globalPosterBoxPrice, setGlobalPosterBoxPrice] = useState('0');
  const [globalPostersPerBox, setGlobalPostersPerBox] = useState('60');
  const [globalDirty, setGlobalDirty] = useState(false);
  const [draftsByAsset, setDraftsByAsset] = useState<Record<string, AssetShippingDraft>>({});
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});

  const isSuperAdmin = session?.user.role === 'super_admin';

  const marketOptions = useMemo(
    () => [...new Set(mappings.map((mapping) => mapping.market))].sort((a, b) => a.localeCompare(b)),
    [mappings],
  );
  const filteredMappings = useMemo(
    () => (marketFilter === 'all' ? mappings : mappings.filter((mapping) => mapping.market === marketFilter)),
    [mappings, marketFilter],
  );
  const maintenanceAssetIds = useMemo(
    () => new Set(mappings.map((mapping) => mapping.maintenanceAssetId).filter((assetId): assetId is string => Boolean(assetId))),
    [mappings],
  );
  const parentByMaintenanceKey = useMemo(() => {
    const map = new Map<string, CalculatorMappingRecord>();
    mappings.forEach((mapping) => {
      if (mapping.maintenanceAssetId) {
        map.set(costKey(mapping.market, mapping.maintenanceAssetId), mapping);
      }
    });
    return map;
  }, [mappings]);
  const visibleMappings = useMemo(
    () => filteredMappings.filter((mapping) => !maintenanceAssetIds.has(mapping.id) && mapping.quantities.Mega > 0),
    [filteredMappings, maintenanceAssetIds],
  );
  const dirtyRowKeys = useMemo(
    () => Object.keys(dirtyRows).filter((key) => dirtyRows[key]),
    [dirtyRows],
  );
  const rateByMarket = useMemo(
    () => new Map(rates.map((rate) => [rate.market, rate])),
    [rates],
  );

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
    if (!isSuperAdmin || !selectedTenantId) return;
    const tenant = selectedTenantId;

    async function loadData() {
      try {
        setLoading(true);
        setError('');
        const [mappingResponse, rateResponse, assetCostResponse] = await Promise.all([
          fetchCalculatorMappings(tenant),
          fetchMarketShippingRates(tenant),
          fetchMarketAssetShippingCosts(tenant),
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
        setRates(rateResponse.rates);
        setAssetCosts(assetCostResponse.costs);

        const posterRates = rateResponse.rates.map((rate) => String(rate.shippingRate));
        const postersPerBoxValues = rateResponse.rates.map((rate) => String(rate.postersPerBox));
        const defaultPosterRate = posterRates[0] ?? '0';
        const defaultPostersPerBox = postersPerBoxValues[0] ?? '60';
        setGlobalPosterBoxPrice(posterRates.every((value) => value === defaultPosterRate) ? defaultPosterRate : '');
        setGlobalPostersPerBox(postersPerBoxValues.every((value) => value === defaultPostersPerBox) ? defaultPostersPerBox : '');
        setGlobalDirty(false);

        const byAssetKey = new Map(assetCostResponse.costs.map((entry) => [costKey(entry.market, entry.assetId), entry]));
        const nextDrafts: Record<string, AssetShippingDraft> = {};
        sortedMappings.forEach((mapping) => {
          const existing = byAssetKey.get(costKey(mapping.market, mapping.id));
          nextDrafts[costKey(mapping.market, mapping.id)] = {
            megaShippingRate: String(existing?.megaShippingRate ?? 0),
            dotMShippingRate: String(existing?.dotMShippingRate ?? 0),
            mpShippingRate: String(existing?.mpShippingRate ?? 0),
          };
        });
        setDraftsByAsset(nextDrafts);
        setDirtyRows({});
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load shipping costs');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadData();
    return () => {
      active = false;
    };
  }, [isSuperAdmin, selectedTenantId]);

  useEffect(() => {
    if (marketOptions.length === 0) {
      setMarketFilter('all');
      return;
    }
    if (marketFilter !== 'all' && !marketOptions.includes(marketFilter)) {
      setMarketFilter('all');
    }
  }, [marketFilter, marketOptions]);

  function updateAssetDraft(market: string, assetId: string, key: keyof AssetShippingDraft, value: string) {
    const rowKey = costKey(market, assetId);
    setDraftsByAsset((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || emptyAssetShippingDraft()),
        [key]: value,
      },
    }));
    setDirtyRows((current) => ({
      ...current,
      [rowKey]: true,
    }));
  }

  async function saveGlobalPosterSettings() {
    if (!selectedTenantId) return;
    const parsedPosterBoxPrice = Number(globalPosterBoxPrice);
    const parsedPostersPerBox = Math.floor(Number(globalPostersPerBox));
    if (!Number.isFinite(parsedPosterBoxPrice) || parsedPosterBoxPrice < 0) {
      throw new Error('Poster Box Price must be a valid number greater than or equal to 0.');
    }
    if (!Number.isFinite(parsedPostersPerBox) || parsedPostersPerBox <= 0) {
      throw new Error('Posters Per Box must be a whole number greater than 0.');
    }

    const nextRates: MarketShippingRateRecord[] = [];
    for (const market of marketOptions) {
      const existing = rateByMarket.get(market);
      const response = await upsertMarketShippingRate({
        market,
        shippingRate: parsedPosterBoxPrice,
        postersPerBox: parsedPostersPerBox,
        megaShippingRate: existing?.megaShippingRate ?? 0,
        dotMShippingRate: existing?.dotMShippingRate ?? 0,
        mpShippingRate: existing?.mpShippingRate ?? 0,
      }, selectedTenantId);
      nextRates.push(response.rate);
    }
    if (nextRates.length > 0) {
      setRates(nextRates.sort((a, b) => a.market.localeCompare(b.market)));
    }
    setGlobalDirty(false);
  }

  async function saveAssetMegaSettings() {
    if (!selectedTenantId || dirtyRowKeys.length === 0) return;

    const keysToSave = new Set(dirtyRowKeys);
    dirtyRowKeys.forEach((rowKey) => {
      const parent = parentByMaintenanceKey.get(rowKey);
      if (parent?.maintenanceAssetId) {
        keysToSave.add(costKey(parent.market, parent.maintenanceAssetId));
      }
    });

    const payload: MarketAssetShippingCostInput[] = mappings
      .filter((mapping) => keysToSave.has(costKey(mapping.market, mapping.id)))
      .map((mapping) => {
        const rowKey = costKey(mapping.market, mapping.id);
        const sourceMapping = maintenanceAssetIds.has(mapping.id) ? parentByMaintenanceKey.get(rowKey) ?? mapping : mapping;
        const sourceDraft = draftsByAsset[costKey(sourceMapping.market, sourceMapping.id)] || emptyAssetShippingDraft();
        return {
          market: mapping.market,
          assetId: mapping.id,
          megaShippingRate: Math.max(0, Number(sourceDraft.megaShippingRate) || 0),
          dotMShippingRate: Math.max(0, Number(sourceDraft.dotMShippingRate) || 0),
          mpShippingRate: Math.max(0, Number(sourceDraft.mpShippingRate) || 0),
        };
      });

    if (payload.length === 0) return;
    const response = await upsertMarketAssetShippingCosts({ costs: payload }, selectedTenantId);
    setAssetCosts(response.costs);
    setDirtyRows((current) => {
      const next = { ...current };
      dirtyRowKeys.forEach((rowKey) => {
        delete next[rowKey];
      });
      return next;
    });
  }

  useEffect(() => {
    if (!selectedTenantId || loading || saving || (!globalDirty && dirtyRowKeys.length === 0)) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        setSaving(true);
        setError('');
        try {
          if (globalDirty) {
            await saveGlobalPosterSettings();
          }
          if (dirtyRowKeys.length > 0) {
            await saveAssetMegaSettings();
          }
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : 'Unable to save shipping costs');
        } finally {
          setSaving(false);
        }
      })();
    }, 700);

    return () => {
      window.clearTimeout(timer);
    };
  }, [dirtyRowKeys, draftsByAsset, globalDirty, globalPosterBoxPrice, globalPostersPerBox, loading, saving, selectedTenantId]);

  if (!isSuperAdmin) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <Card>
          <CardHeader className="p-6">
            <CardTitle className="flex items-center gap-3"><Shield className="h-5 w-5 text-violet-300" /> Shipping Costs</CardTitle>
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
          <Truck className="h-3.5 w-3.5" />
          Shipping Cost Admin
        </Badge>
      </header>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      <Card>
        <CardHeader className="p-5 pb-0">
          <CardTitle>Scope and Poster Settings</CardTitle>
          <CardDescription>
            Poster Box Price and Posters Per Box are global for the tenant. Mega shipping prices are per asset.
            {saving ? ' Saving...' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="shipping-cost-tenant">Tenant</Label>
            <select
              id="shipping-cost-tenant"
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
            <Label htmlFor="shipping-cost-market-filter">Market</Label>
            <select
              id="shipping-cost-market-filter"
              className="h-11 w-full rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-100"
              value={marketFilter}
              onChange={(event) => setMarketFilter(event.target.value)}
            >
              <option value="all">All markets</option>
              {marketOptions.map((market) => (
                <option key={`shipping-cost-market-${market}`} value={market}>{market}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="poster-box-price">Poster Box Price</Label>
            <Input
              id="poster-box-price"
              className="h-11"
              inputMode="decimal"
              type="number"
              min={0}
              step="0.01"
              value={globalPosterBoxPrice}
              onChange={(event) => {
                setGlobalPosterBoxPrice(event.target.value);
                setGlobalDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="posters-per-box">Posters Per Box</Label>
            <Input
              id="posters-per-box"
              className="h-11"
              inputMode="numeric"
              type="number"
              min={1}
              step="1"
              value={globalPostersPerBox}
              onChange={(event) => {
                setGlobalPostersPerBox(event.target.value);
                setGlobalDirty(true);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-5 pb-0">
          <CardTitle>Mega Shipping Price Per Asset</CardTitle>
          <CardDescription>Set separate shipping price for Mega, DOT M, and MP per asset.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-5">
          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
              <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
              Loading shipping costs...
            </div>
          ) : visibleMappings.length === 0 ? (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-6 text-sm text-slate-400">
              No assets found for the selected scope.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60">
              <table className="w-full border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Market</th>
                    <th className="border border-slate-700 px-2 py-2 text-left sm:px-3">Asset</th>
                    <th className="border border-slate-700 px-2 py-2 text-center sm:px-3">Mega Price</th>
                    <th className="border border-slate-700 px-2 py-2 text-center sm:px-3">DOT M Price</th>
                    <th className="border border-slate-700 px-2 py-2 text-center sm:px-3">MP Price</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMappings.map((mapping) => {
                    const rowKey = costKey(mapping.market, mapping.id);
                    const draft = draftsByAsset[rowKey] || emptyAssetShippingDraft();
                    return (
                      <tr key={`shipping-asset-row-${mapping.id}`} className="border-t border-slate-700/70 bg-slate-800/65">
                        <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{mapping.market}</td>
                        <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">
                          <p className="truncate font-semibold">{mapping.label || mapping.asset}</p>
                          <p className="truncate text-[10px] text-slate-400 sm:text-xs">{mapping.asset}</p>
                        </td>
                        <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                          <Input className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm" type="number" min={0} step="0.01" value={draft.megaShippingRate} onChange={(event) => updateAssetDraft(mapping.market, mapping.id, 'megaShippingRate', event.target.value)} />
                        </td>
                        <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                          <Input className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm" type="number" min={0} step="0.01" value={draft.dotMShippingRate} onChange={(event) => updateAssetDraft(mapping.market, mapping.id, 'dotMShippingRate', event.target.value)} />
                        </td>
                        <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                          <Input className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm" type="number" min={0} step="0.01" value={draft.mpShippingRate} onChange={(event) => updateAssetDraft(mapping.market, mapping.id, 'mpShippingRate', event.target.value)} />
                        </td>
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
