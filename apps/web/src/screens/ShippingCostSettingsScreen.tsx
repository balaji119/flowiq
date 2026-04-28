import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Shield } from 'lucide-react';
import { CalculatorMappingRecord, MarketAssetShippingCostInput, MarketAssetShippingCostRecord, MarketShippingRateRecord, TenantRecord } from '@flowiq/shared';
import { Card, CardDescription, CardHeader, CardTitle, Input } from '@flowiq/ui';
import { AdminWorkspaceHandlers, AdminWorkspaceShell } from '../components/AdminWorkspaceShell';
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
} & Omit<AdminWorkspaceHandlers, 'onBack' | 'onOpenShippingCosts'>;

type AssetShippingDraft = {
  megaShippingRate: string;
};

function costKey(market: string, assetId: string) {
  return `${market}\x00${assetId}`;
}

function emptyAssetShippingDraft(): AssetShippingDraft {
  return {
    megaShippingRate: '0',
  };
}

export function ShippingCostSettingsScreen({ onBack, onOpenMappings, onOpenPrintingCosts, onOpenShippingSettings, onOpenUsers, tenantId }: ShippingCostSettingsScreenProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(tenantId ?? session?.user.tenantId ?? null);
  const [marketFilter, setMarketFilter] = useState('');
  const [mappings, setMappings] = useState<CalculatorMappingRecord[]>([]);
  const [rates, setRates] = useState<MarketShippingRateRecord[]>([]);
  const [assetCosts, setAssetCosts] = useState<MarketAssetShippingCostRecord[]>([]);
  const [marketTwoSheeterPrice, setMarketTwoSheeterPrice] = useState('0');
  const [marketFourSheeterPrice, setMarketFourSheeterPrice] = useState('0');
  const [marketSixSheeterPrice, setMarketSixSheeterPrice] = useState('0');
  const [marketEightSheeterPrice, setMarketEightSheeterPrice] = useState('0');
  const [marketFlatShippingRate, setMarketFlatShippingRate] = useState('0');
  const [marketTwoSheeterSetsPerBox, setMarketTwoSheeterSetsPerBox] = useState('15');
  const [marketFourSheeterSetsPerBox, setMarketFourSheeterSetsPerBox] = useState('15');
  const [marketSixSheeterSetsPerBox, setMarketSixSheeterSetsPerBox] = useState('15');
  const [marketEightSheeterSetsPerBox, setMarketEightSheeterSetsPerBox] = useState('15');
  const [marketMegasPerBox, setMarketMegasPerBox] = useState('1');
  const [marketUseFlatRate, setMarketUseFlatRate] = useState(false);
  const [marketRateDirty, setMarketRateDirty] = useState(false);
  const [draftsByAsset, setDraftsByAsset] = useState<Record<string, AssetShippingDraft>>({});
  const [dirtyRows, setDirtyRows] = useState<Record<string, boolean>>({});

  const isSuperAdmin = session?.user.role === 'super_admin';

  const marketOptions = useMemo(
    () => [...new Set(mappings.map((mapping) => mapping.market))].sort((a, b) => a.localeCompare(b)),
    [mappings],
  );
  const filteredMappings = useMemo(
    () => mappings.filter((mapping) => mapping.market === marketFilter),
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
  const selectedMarketRate = useMemo(
    () => (marketFilter ? rateByMarket.get(marketFilter) : undefined),
    [marketFilter, rateByMarket],
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
        setMarketRateDirty(false);

        const byAssetKey = new Map(assetCostResponse.costs.map((entry) => [costKey(entry.market, entry.assetId), entry]));
        const nextDrafts: Record<string, AssetShippingDraft> = {};
        sortedMappings.forEach((mapping) => {
          const existing = byAssetKey.get(costKey(mapping.market, mapping.id));
          nextDrafts[costKey(mapping.market, mapping.id)] = {
            megaShippingRate: String(existing?.megaShippingRate ?? 0),
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
      setMarketFilter('');
      return;
    }
    if (!marketFilter || !marketOptions.includes(marketFilter)) {
      setMarketFilter(marketOptions[0]);
    }
  }, [marketFilter, marketOptions]);

  useEffect(() => {
    setMarketTwoSheeterPrice(String(selectedMarketRate?.twoSheeterPrice ?? 0));
    setMarketFourSheeterPrice(String(selectedMarketRate?.fourSheeterPrice ?? 0));
    setMarketSixSheeterPrice(String(selectedMarketRate?.sixSheeterPrice ?? 0));
    setMarketEightSheeterPrice(String(selectedMarketRate?.eightSheeterPrice ?? 0));
    setMarketFlatShippingRate(String(selectedMarketRate?.shippingRate ?? 0));
    setMarketTwoSheeterSetsPerBox(String(selectedMarketRate?.twoSheeterSetsPerBox ?? selectedMarketRate?.sheeterSetsPerBox ?? 15));
    setMarketFourSheeterSetsPerBox(String(selectedMarketRate?.fourSheeterSetsPerBox ?? selectedMarketRate?.sheeterSetsPerBox ?? 15));
    setMarketSixSheeterSetsPerBox(String(selectedMarketRate?.sixSheeterSetsPerBox ?? selectedMarketRate?.sheeterSetsPerBox ?? 15));
    setMarketEightSheeterSetsPerBox(String(selectedMarketRate?.eightSheeterSetsPerBox ?? selectedMarketRate?.sheeterSetsPerBox ?? 15));
    setMarketMegasPerBox(String(selectedMarketRate?.megasPerBox ?? 1));
    setMarketUseFlatRate(Boolean(selectedMarketRate?.useFlatRate));
    setMarketRateDirty(false);
  }, [selectedMarketRate]);

  function updateAssetDraft(market: string, assetId: string, value: string) {
    const rowKey = costKey(market, assetId);
    setDraftsByAsset((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] || emptyAssetShippingDraft()),
        megaShippingRate: value,
      },
    }));
    setDirtyRows((current) => ({
      ...current,
      [rowKey]: true,
    }));
  }

  async function saveMarketPosterSettings() {
    if (!selectedTenantId || !marketFilter) return;
    const parsedTwoSheeterPrice = Number(marketTwoSheeterPrice);
    const parsedFourSheeterPrice = Number(marketFourSheeterPrice);
    const parsedSixSheeterPrice = Number(marketSixSheeterPrice);
    const parsedEightSheeterPrice = Number(marketEightSheeterPrice);
    const parsedFlatShippingRate = Number(marketFlatShippingRate);
    const parsedTwoSheeterSetsPerBox = Number(marketTwoSheeterSetsPerBox);
    const normalizedTwoSheeterSetsPerBox = Math.floor(parsedTwoSheeterSetsPerBox);
    const parsedFourSheeterSetsPerBox = Number(marketFourSheeterSetsPerBox);
    const normalizedFourSheeterSetsPerBox = Math.floor(parsedFourSheeterSetsPerBox);
    const parsedSixSheeterSetsPerBox = Number(marketSixSheeterSetsPerBox);
    const normalizedSixSheeterSetsPerBox = Math.floor(parsedSixSheeterSetsPerBox);
    const parsedEightSheeterSetsPerBox = Number(marketEightSheeterSetsPerBox);
    const normalizedEightSheeterSetsPerBox = Math.floor(parsedEightSheeterSetsPerBox);
    const parsedMegasPerBox = Number(marketMegasPerBox);
    const normalizedMegasPerBox = Math.floor(parsedMegasPerBox);
    if (!Number.isFinite(parsedTwoSheeterPrice) || parsedTwoSheeterPrice < 0) {
      throw new Error('2 Sheeter Price must be a valid number greater than or equal to 0.');
    }
    if (!Number.isFinite(parsedFourSheeterPrice) || parsedFourSheeterPrice < 0) {
      throw new Error('4 Sheeter Price must be a valid number greater than or equal to 0.');
    }
    if (!Number.isFinite(parsedSixSheeterPrice) || parsedSixSheeterPrice < 0) {
      throw new Error('6 Sheeter Price must be a valid number greater than or equal to 0.');
    }
    if (!Number.isFinite(parsedEightSheeterPrice) || parsedEightSheeterPrice < 0) {
      throw new Error('8 Sheeter Price must be a valid number greater than or equal to 0.');
    }
    if (!Number.isFinite(parsedFlatShippingRate) || parsedFlatShippingRate < 0) {
      throw new Error('Flat shipping rate must be a valid number greater than or equal to 0.');
    }
    if (!marketUseFlatRate && (!Number.isFinite(parsedTwoSheeterSetsPerBox) || normalizedTwoSheeterSetsPerBox <= 0)) {
      throw new Error('2 Sheeter sets per shipping box must be a whole number greater than 0.');
    }
    if (!marketUseFlatRate && (!Number.isFinite(parsedFourSheeterSetsPerBox) || normalizedFourSheeterSetsPerBox <= 0)) {
      throw new Error('4 Sheeter sets per shipping box must be a whole number greater than 0.');
    }
    if (!marketUseFlatRate && (!Number.isFinite(parsedSixSheeterSetsPerBox) || normalizedSixSheeterSetsPerBox <= 0)) {
      throw new Error('6 Sheeter sets per shipping box must be a whole number greater than 0.');
    }
    if (!marketUseFlatRate && (!Number.isFinite(parsedEightSheeterSetsPerBox) || normalizedEightSheeterSetsPerBox <= 0)) {
      throw new Error('8 Sheeter sets per shipping box must be a whole number greater than 0.');
    }
    if (!marketUseFlatRate && (!Number.isFinite(parsedMegasPerBox) || normalizedMegasPerBox <= 0)) {
      throw new Error('Mega units per shipping box must be a whole number greater than 0.');
    }
    const existing = rateByMarket.get(marketFilter);
    const response = await upsertMarketShippingRate({
      market: marketFilter,
      useFlatRate: marketUseFlatRate,
      shippingRate: parsedFlatShippingRate,
      postersPerBox: existing?.postersPerBox ?? 60,
      sheeterSetsPerBox: marketUseFlatRate ? (existing?.sheeterSetsPerBox ?? 15) : normalizedTwoSheeterSetsPerBox,
      twoSheeterSetsPerBox: marketUseFlatRate ? (existing?.twoSheeterSetsPerBox ?? existing?.sheeterSetsPerBox ?? 15) : normalizedTwoSheeterSetsPerBox,
      fourSheeterSetsPerBox: marketUseFlatRate ? (existing?.fourSheeterSetsPerBox ?? existing?.sheeterSetsPerBox ?? 15) : normalizedFourSheeterSetsPerBox,
      sixSheeterSetsPerBox: marketUseFlatRate ? (existing?.sixSheeterSetsPerBox ?? existing?.sheeterSetsPerBox ?? 15) : normalizedSixSheeterSetsPerBox,
      eightSheeterSetsPerBox: marketUseFlatRate ? (existing?.eightSheeterSetsPerBox ?? existing?.sheeterSetsPerBox ?? 15) : normalizedEightSheeterSetsPerBox,
      twoSheeterPrice: parsedTwoSheeterPrice,
      fourSheeterPrice: parsedFourSheeterPrice,
      sixSheeterPrice: parsedSixSheeterPrice,
      eightSheeterPrice: parsedEightSheeterPrice,
      megasPerBox: marketUseFlatRate ? (existing?.megasPerBox ?? 1) : normalizedMegasPerBox,
      megaShippingRate: existing?.megaShippingRate ?? 0,
      dotMShippingRate: existing?.dotMShippingRate ?? 0,
      mpShippingRate: existing?.mpShippingRate ?? 0,
    }, selectedTenantId);
    setRates((current) => {
      const withoutSelected = current.filter((rate) => rate.market !== response.rate.market);
      return [...withoutSelected, response.rate].sort((a, b) => a.market.localeCompare(b.market));
    });
    setMarketRateDirty(false);
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
          dotMShippingRate: Math.max(0, Number(sourceDraft.megaShippingRate) || 0),
          mpShippingRate: Math.max(0, Number(sourceDraft.megaShippingRate) || 0),
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
    if (!selectedTenantId || loading || saving || (!marketRateDirty && dirtyRowKeys.length === 0)) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        setSaving(true);
        setError('');
        try {
          if (marketRateDirty) {
            await saveMarketPosterSettings();
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
  }, [dirtyRowKeys, draftsByAsset, loading, marketEightSheeterPrice, marketEightSheeterSetsPerBox, marketFilter, marketFlatShippingRate, marketFourSheeterPrice, marketFourSheeterSetsPerBox, marketMegasPerBox, marketRateDirty, marketSixSheeterPrice, marketSixSheeterSetsPerBox, marketTwoSheeterPrice, marketTwoSheeterSetsPerBox, marketUseFlatRate, saving, selectedTenantId]);

  if (!isSuperAdmin) {
    return (
      <main className="dense-main mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-8">
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
    <AdminWorkspaceShell
      activeSection="shipping-costs"
      canAccessManagement
      canAccessShippingCosts={session?.user.role === 'super_admin'}
      canAccessPrintingCosts={session?.user.role === 'super_admin'}
      pageTitle="Freight Rate Card"
      onBack={onBack}
      onOpenLanding={onBack}
      onOpenMappings={onOpenMappings}
      onOpenPrintingCosts={onOpenPrintingCosts}
      onOpenShippingCosts={() => {}}
      onOpenShippingSettings={onOpenShippingSettings}
      onOpenUsers={onOpenUsers}
    >
    <main className="dense-main flex min-h-screen w-full flex-col gap-6">
      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      <section className="flex flex-wrap gap-4">
        <div className="w-full sm:w-[320px]">
          <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
            <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Tenant</span>
            <select
              id="shipping-cost-tenant"
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
              id="shipping-cost-market-filter"
              className="h-full flex-1 bg-slate-800 px-3 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
              value={marketFilter}
              onChange={(event) => setMarketFilter(event.target.value)}
            >
              {marketOptions.map((market) => (
                <option key={`shipping-cost-market-${market}`} value={market}>{market}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="w-full sm:w-[220px]">
          <div className="inline-flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
            <span className="inline-flex items-center border-r border-slate-600 bg-slate-700/60 px-4 text-sm font-medium text-slate-100">Use flat rate</span>
            <div className="inline-flex h-full flex-1 items-center gap-1 bg-slate-800 p-1">
              <button
                type="button"
                aria-pressed={!marketUseFlatRate}
                className={`h-full flex-1 rounded-md text-sm font-medium transition ${
                  !marketUseFlatRate
                    ? 'bg-slate-600/70 text-white'
                    : 'text-slate-300 hover:bg-slate-700/60'
                }`}
                onClick={() => {
                  setMarketUseFlatRate(false);
                  setMarketRateDirty(true);
                }}
              >
                No
              </button>
              <button
                type="button"
                aria-pressed={marketUseFlatRate}
                className={`h-full flex-1 rounded-md text-sm font-medium transition ${
                  marketUseFlatRate
                    ? 'bg-violet-500/80 text-white'
                    : 'text-slate-300 hover:bg-slate-700/60'
                }`}
                onClick={() => {
                  setMarketUseFlatRate(true);
                  setMarketRateDirty(true);
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
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
          <>
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60">
              <table className="dense-table w-full table-fixed border-collapse text-xs sm:text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                    <th className={marketUseFlatRate ? 'w-1/3 border border-slate-700 px-2 py-2 text-left sm:px-3' : 'w-1/4 border border-slate-700 px-2 py-2 text-left sm:px-3'}>Market</th>
                    <th className={marketUseFlatRate ? 'w-1/3 border border-slate-700 px-2 py-2 text-left sm:px-3' : 'w-1/4 border border-slate-700 px-2 py-2 text-left sm:px-3'}>Sheeters</th>
                    <th className={marketUseFlatRate ? 'w-1/3 border border-slate-700 px-2 py-2 text-center sm:px-3' : 'w-1/4 border border-slate-700 px-2 py-2 text-center sm:px-3'}>Sheeters - Freight ($)</th>
                    {!marketUseFlatRate ? (
                      <th className="w-1/4 border border-slate-700 px-2 py-2 text-center sm:px-3">Sets / Shipping Box</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-700/70 bg-slate-800/65">
                    <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{marketFilter || '-'}</td>
                    <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">2 Sheeter</td>
                    <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-300">$</span>
                        <Input
                          id="two-sheeter-price"
                          className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                          inputMode="decimal"
                          type="number"
                          min={0}
                          step="0.01"
                          value={marketTwoSheeterPrice}
                          onChange={(event) => {
                            setMarketTwoSheeterPrice(event.target.value);
                            setMarketRateDirty(true);
                          }}
                        />
                      </div>
                    </td>
                    {!marketUseFlatRate ? (
                      <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                        <Input
                          className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                          inputMode="numeric"
                          type="number"
                          min={1}
                          step="1"
                          value={marketTwoSheeterSetsPerBox}
                          onChange={(event) => {
                            setMarketTwoSheeterSetsPerBox(event.target.value);
                            setMarketRateDirty(true);
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                  <tr className="border-t border-slate-700/70 bg-slate-800/65">
                    <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{marketFilter || '-'}</td>
                    <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">4 Sheeter</td>
                    <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-300">$</span>
                        <Input
                          id="four-sheeter-price"
                          className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                          inputMode="decimal"
                          type="number"
                          min={0}
                          step="0.01"
                          value={marketFourSheeterPrice}
                          onChange={(event) => {
                            setMarketFourSheeterPrice(event.target.value);
                            setMarketRateDirty(true);
                          }}
                        />
                      </div>
                    </td>
                    {!marketUseFlatRate ? (
                      <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                        <Input
                          className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                          inputMode="numeric"
                          type="number"
                          min={1}
                          step="1"
                          value={marketFourSheeterSetsPerBox}
                          onChange={(event) => {
                            setMarketFourSheeterSetsPerBox(event.target.value);
                            setMarketRateDirty(true);
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                  <tr className="border-t border-slate-700/70 bg-slate-800/65">
                    <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{marketFilter || '-'}</td>
                    <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">6 Sheeter</td>
                    <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-300">$</span>
                        <Input
                          id="six-sheeter-price"
                          className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                          inputMode="decimal"
                          type="number"
                          min={0}
                          step="0.01"
                          value={marketSixSheeterPrice}
                          onChange={(event) => {
                            setMarketSixSheeterPrice(event.target.value);
                            setMarketRateDirty(true);
                          }}
                        />
                      </div>
                    </td>
                    {!marketUseFlatRate ? (
                      <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                        <Input
                          className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                          inputMode="numeric"
                          type="number"
                          min={1}
                          step="1"
                          value={marketSixSheeterSetsPerBox}
                          onChange={(event) => {
                            setMarketSixSheeterSetsPerBox(event.target.value);
                            setMarketRateDirty(true);
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                  <tr className="border-t border-slate-700/70 bg-slate-800/65">
                      <td className="border border-slate-700 px-2 py-2 text-slate-200 sm:px-3">{marketFilter || '-'}</td>
                      <td className="border border-slate-700 px-2 py-2 text-white sm:px-3">8 Sheeter</td>
                      <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-300">$</span>
                          <Input
                            id="eight-sheeter-price"
                            className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                            inputMode="decimal"
                            type="number"
                            min={0}
                            step="0.01"
                            value={marketEightSheeterPrice}
                            onChange={(event) => {
                              setMarketEightSheeterPrice(event.target.value);
                              setMarketRateDirty(true);
                            }}
                          />
                        </div>
                      </td>
                      {!marketUseFlatRate ? (
                        <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                          <Input
                            className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                            inputMode="numeric"
                            type="number"
                            min={1}
                            step="1"
                            value={marketEightSheeterSetsPerBox}
                            onChange={(event) => {
                              setMarketEightSheeterSetsPerBox(event.target.value);
                              setMarketRateDirty(true);
                            }}
                          />
                        </td>
                      ) : null}
                    </tr>
                </tbody>
              </table>
            </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-900/60">
                <table className="dense-table w-full table-fixed border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-slate-950 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-300 sm:text-[11px]">
                      <th className={marketUseFlatRate ? 'w-1/3 border border-slate-700 px-2 py-2 text-left sm:px-3' : 'w-1/4 border border-slate-700 px-2 py-2 text-left sm:px-3'}>Market</th>
                      <th className={marketUseFlatRate ? 'w-1/3 border border-slate-700 px-2 py-2 text-left sm:px-3' : 'w-1/4 border border-slate-700 px-2 py-2 text-left sm:px-3'}>Asset</th>
                      <th className={marketUseFlatRate ? 'w-1/3 border border-slate-700 px-2 py-2 text-center sm:px-3' : 'w-1/4 border border-slate-700 px-2 py-2 text-center sm:px-3'}>MEGA SITES - FREIGHT ($)</th>
                      {!marketUseFlatRate ? (
                        <th className="w-1/4 border border-slate-700 px-2 py-2 text-center sm:px-3">Megas / Shipping Box</th>
                      ) : null}
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
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-300">$</span>
                              <Input className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm" type="number" min={0} step="0.01" value={draft.megaShippingRate} onChange={(event) => updateAssetDraft(mapping.market, mapping.id, event.target.value)} />
                            </div>
                          </td>
                          {!marketUseFlatRate ? (
                            <td className="border border-slate-700 px-1 py-1.5 sm:px-2 sm:py-2">
                              <Input
                                className="h-8 px-1.5 text-xs sm:px-2 sm:text-sm"
                                inputMode="numeric"
                                type="number"
                                min={1}
                                step="1"
                                value={marketMegasPerBox}
                                onChange={(event) => {
                                  setMarketMegasPerBox(event.target.value);
                                  setMarketRateDirty(true);
                                }}
                              />
                            </td>
                          ) : null}
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
    </AdminWorkspaceShell>
  );
}


