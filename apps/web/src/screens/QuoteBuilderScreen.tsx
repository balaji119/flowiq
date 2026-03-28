import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, ChevronDown, CircleAlert, LayoutGrid, LoaderCircle, LogOut, Plus, Shield, Upload, X } from 'lucide-react';
import {
  CampaignAsset,
  CampaignRecord,
  CampaignCalculationSummary,
  CampaignLine,
  CampaignMarket,
  CampaignTotals,
  MarketMetadata,
  OrderFormValues,
  QuantityBreakdown,
  buildPrintIqPayload,
  createCampaignAsset,
  createCampaignMarket,
  createDefaultFormValues,
  formatKeys,
} from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Separator, cn } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { calculatePersistedCampaign, createCampaign, fetchCampaign, submitCampaignToPrintIQ, updateCampaign as updateStoredCampaign } from '../services/campaignApi';
import { calculateCampaign, fetchCalculatorMetadata } from '../services/calculatorApi';
import { fetchQuoteOptions } from '../services/printiqOptionsApi';
import { uploadPurchaseOrderFile } from '../services/purchaseOrderApi';

const steps = [
  { key: 'schedule', title: 'Schedule' },
  { key: 'review', title: 'Review' },
  { key: 'finalize', title: 'Finalise' },
] as const;

const ACTIVE_CAMPAIGN_ID_KEY = 'adsconnect-active-campaign-id';
const liveSummarySecondaryKeys = [
  { key: 'posters', label: 'Posters' },
  { key: 'frames', label: 'Frames' },
  { key: 'special', label: 'Special' },
  { key: 'quoteQty', label: 'Quote Qty' },
] as const;

async function setStoredCampaignId(value: string | null) {
  if (typeof window === 'undefined') return;
  if (value === null) window.localStorage.removeItem(ACTIVE_CAMPAIGN_ID_KEY);
  else window.localStorage.setItem(ACTIVE_CAMPAIGN_ID_KEY, value);
}

async function getStoredCampaignId() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACTIVE_CAMPAIGN_ID_KEY);
}

function applyCampaignToScreen(
  campaign: CampaignRecord,
  setValues: Dispatch<SetStateAction<OrderFormValues>>,
  setSummary: Dispatch<SetStateAction<CampaignCalculationSummary | null>>,
  setUploadedPurchaseOrderName: Dispatch<SetStateAction<string>>,
  setCampaignId: Dispatch<SetStateAction<string | null>>,
  setCampaignStatus: Dispatch<SetStateAction<CampaignRecord['status']>>,
) {
  setValues(campaign.values);
  setSummary(campaign.summary);
  setUploadedPurchaseOrderName(campaign.purchaseOrder?.originalName || '');
  setCampaignId(campaign.id);
  setCampaignStatus(campaign.status);
}

function BreakdownTable({ breakdown, inverse = false }: { breakdown: QuantityBreakdown; inverse?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {formatKeys.map((key) => (
        <div key={key} className={cn('rounded-2xl border px-4 py-3', inverse ? 'border-slate-700 bg-slate-900' : 'border-slate-700/70 bg-slate-800/80')}>
          <p className={cn('text-xs font-bold uppercase tracking-[0.18em]', inverse ? 'text-violet-200' : 'text-slate-300')}>{key}</p>
          <p className="mt-2 text-xl font-black text-white">{breakdown[key]}</p>
        </div>
      ))}
    </div>
  );
}

function parseDateOnly(value: string) {
  if (!value) return null;
  const parts = value.split('-').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null;
  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return null;
  return parsed;
}

function formatWeekLabel(week: number, startDate: string) {
  const parsedStartDate = parseDateOnly(startDate);
  if (!parsedStartDate) return `Week ${week}`;
  const weekDate = new Date(parsedStartDate);
  weekDate.setDate(parsedStartDate.getDate() + (week - 1) * 7);
  return weekDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function LiveSummarySection({
  items,
  highlightValues = false,
  compact = false,
}: {
  items: ReadonlyArray<{ key: string; label: string; value: number | string }>;
  highlightValues?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'grid-cols-2')}>
      {items.map((item) => (
        <div key={item.key} className={cn('rounded-xl border border-slate-700 bg-slate-900/80', compact ? 'flex items-center justify-between gap-3 px-3 py-2' : 'p-3')}>
          <p className={cn('font-bold uppercase tracking-[0.18em] text-slate-400', compact ? 'text-[11px]' : 'text-xs')}>{item.label}</p>
          <p className={cn(compact ? 'text-base font-black leading-none' : 'mt-2 text-xl font-black leading-none sm:text-2xl', highlightValues ? 'text-violet-300' : 'text-white')}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: React.HTMLInputTypeAttribute;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode={inputMode} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SearchableSelect({
  label,
  selectedValue,
  selectedLabel,
  items,
  onValueChange,
  placeholder,
  emptyMessage,
}: {
  label: string;
  selectedValue: string;
  selectedLabel?: string;
  items: Array<{ label: string; value: string }>;
  onValueChange: (value: string) => void;
  placeholder: string;
  emptyMessage: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const displayLabel = selectedLabel || items.find((item) => item.value === selectedValue)?.label || placeholder;
  const filteredItems = useMemo(() => {
    const nextQuery = query.trim().toLowerCase();
    if (!nextQuery) return items;
    return items.filter((item) => item.label.toLowerCase().includes(nextQuery));
  }, [items, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative space-y-2">
      {label ? <Label>{label}</Label> : null}
      <button
        className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-600 bg-slate-800 px-3 text-left text-sm text-slate-100 transition hover:border-slate-500"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={cn('truncate', !selectedValue && !selectedLabel ? 'text-slate-500' : 'text-slate-50')}>{displayLabel}</span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-3xl border border-slate-700 bg-slate-950 p-4 shadow-2xl shadow-slate-950/60">
          <div className="space-y-3">
            <Input autoFocus placeholder={`Search ${label || 'items'}`} value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
              {filteredItems.map((item) => {
                const active = item.value === selectedValue;
                return (
                  <button
                    key={item.value}
                    className={cn('flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition', active ? 'border-violet-400 bg-violet-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500')}
                    onClick={() => {
                      onValueChange(item.value);
                      setOpen(false);
                    }}
                    type="button"
                  >
                    <span>{item.label}</span>
                    {active ? <Check className="h-4 w-4 text-violet-300" /> : null}
                  </button>
                );
              })}
              {filteredItems.length === 0 ? <p className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-6 text-center text-sm text-slate-400">{emptyMessage}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WeekSelector({
  weekCount,
  selectedWeeks,
  onToggle,
  startDate,
}: {
  weekCount: number;
  selectedWeeks: number[];
  onToggle: (week: number) => void;
  startDate: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: weekCount }, (_, index) => index + 1).map((week) => {
        const selected = selectedWeeks.includes(week);
        return (
          <button
            key={week}
            className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', selected ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500')}
            onClick={() => onToggle(week)}
            type="button"
          >
            {formatWeekLabel(week, startDate)}
          </button>
        );
      })}
    </div>
  );
}

function normalizeCampaignMarkets(campaignMarkets: CampaignMarket[], maxWeeks: number): CampaignMarket[] {
  return campaignMarkets.map((market) => ({
    ...market,
    assets: market.assets.map((asset) => ({
      ...asset,
      selectedWeeks: [...new Set(asset.selectedWeeks.filter((week) => week >= 1 && week <= maxWeeks))].sort((a, b) => a - b),
    })),
  }));
}

export function QuoteBuilderScreen({ campaignId: selectedCampaignId, onBack, onOpenAdmin }: { campaignId?: string | null; onBack?: () => void; onOpenAdmin?: () => void }) {
  const { session, logout } = useAuth();
  const [values, setValues] = useState<OrderFormValues>(() => createDefaultFormValues());
  const [campaignId, setCampaignId] = useState<string | null>(selectedCampaignId ?? null);
  const [campaignStatus, setCampaignStatus] = useState<CampaignRecord['status']>('draft');
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [loadingCampaign, setLoadingCampaign] = useState(true);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [summary, setSummary] = useState<CampaignCalculationSummary | null>(null);
  const [activeMarketId, setActiveMarketId] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteResponseMessage, setQuoteResponseMessage] = useState('');
  const [error, setError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedPurchaseOrderFile, setSelectedPurchaseOrderFile] = useState<File | null>(null);
  const [uploadingPurchaseOrder, setUploadingPurchaseOrder] = useState(false);
  const [uploadedPurchaseOrderName, setUploadedPurchaseOrderName] = useState('');
  const purchaseOrderInputRef = useRef<HTMLInputElement | null>(null);
  const campaignHydratedRef = useRef(false);
  const lastPersistedValuesRef = useRef('');

  useEffect(() => {
    let active = true;

    async function bootstrapCampaign() {
      try {
        const storedCampaignId = selectedCampaignId || (await getStoredCampaignId());
        if (!active) return;

        if (storedCampaignId) {
          try {
            const response = await fetchCampaign(storedCampaignId);
            if (!active) return;
            applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
            lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
            campaignHydratedRef.current = true;
            await setStoredCampaignId(response.campaign.id);
            return;
          } catch {
            await setStoredCampaignId(null);
          }
        }

        const response = await createCampaign({ values: createDefaultFormValues() });
        if (!active) return;
        applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
        lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
        campaignHydratedRef.current = true;
        await setStoredCampaignId(response.campaign.id);
      } catch {
        if (active) setError('Unable to load campaign draft');
      } finally {
        if (active) setLoadingCampaign(false);
      }
    }

    void bootstrapCampaign();
    return () => {
      active = false;
    };
  }, [selectedCampaignId]);

  useEffect(() => {
    let active = true;

    async function loadMetadata() {
      try {
        const response = await fetchCalculatorMetadata();
        if (!active) return;
        setMarkets(response.markets);
      } catch (loadError) {
        if (active) setMetadataError(loadError instanceof Error ? loadError.message : 'Unable to load campaign metadata');
      } finally {
        if (active) setLoadingMetadata(false);
      }
    }

    void loadMetadata();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loadingCampaign) return;

    let active = true;

    async function loadQuoteOptions() {
      try {
        const response = await fetchQuoteOptions();
        if (!active) return;

        setValues((current) => ({
          ...current,
          selectedJobOperations:
            current.selectedJobOperations.length > 0
              ? current.selectedJobOperations
              : response.jobOperations.filter((option) => option.enabledByDefault).map((option) => option.operationName),
          selectedSectionOperations:
            current.selectedSectionOperations.length > 0
              ? current.selectedSectionOperations
              : response.sectionOperations.filter((option) => option.enabledByDefault).map((option) => option.operationName),
        }));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load PrintIQ quote options');
      }
    }

    void loadQuoteOptions();
    return () => {
      active = false;
    };
  }, [loadingCampaign]);

  const payload = useMemo(() => buildPrintIqPayload(values, summary), [summary, values]);
  const activeMarketSummaries = useMemo(() => (summary ? summary.perMarket.filter((market) => market.activeAssets > 0 || market.activeRuns > 0 || market.totalUnits > 0) : []), [summary]);
  const numberOfWeeks = Math.max(1, Math.min(20, Number(values.numberOfWeeks) || 1));
  const currentStep = steps[stepIndex];
  const progressPercent = ((stepIndex + 1) / steps.length) * 100;
  const marketNames = useMemo(() => markets.map((market) => market.name), [markets]);
  const remainingMarketNames = useMemo(() => {
    const selectedMarketNames = new Set(values.campaignMarkets.map((market) => market.market));
    return marketNames.filter((marketName) => !selectedMarketNames.has(marketName));
  }, [marketNames, values.campaignMarkets]);
  const canAddMarket = remainingMarketNames.length > 0;
  const addMarketDisabledReason = loadingMetadata
    ? 'Market options are still loading.'
    : markets.length === 0
      ? 'No markets are available.'
      : 'All available markets have already been added.';
  const activeMarket = useMemo(() => {
    if (values.campaignMarkets.length === 0) return null;
    return values.campaignMarkets.find((market) => market.id === activeMarketId) ?? values.campaignMarkets[0];
  }, [activeMarketId, values.campaignMarkets]);
  const activeMarketSummary = useMemo(() => {
    if (!summary || !activeMarket) return null;
    return summary.perMarket.find((entry) => entry.market === activeMarket.market) ?? null;
  }, [activeMarket, summary]);

  useEffect(() => {
    if (loadingCampaign) return;

    setValues((current) => {
      const normalizedMarkets = normalizeCampaignMarkets(current.campaignMarkets, numberOfWeeks);
      const flattenWeeks = (nextMarkets: CampaignMarket[]) => nextMarkets.flatMap((market) => market.assets.flatMap((asset) => asset.selectedWeeks)).join(',');
      const changed = flattenWeeks(normalizedMarkets) !== flattenWeeks(current.campaignMarkets);

      return changed ? { ...current, campaignMarkets: normalizedMarkets } : current;
    });
  }, [loadingCampaign, numberOfWeeks]);

  useEffect(() => {
    if (values.campaignMarkets.length === 0) {
      setActiveMarketId(null);
      return;
    }

    if (!activeMarketId || !values.campaignMarkets.some((market) => market.id === activeMarketId)) {
      setActiveMarketId(values.campaignMarkets[0].id);
    }
  }, [activeMarketId, values.campaignMarkets]);

  useEffect(() => {
    if (loadingCampaign || loadingMetadata || metadataError) return;

    let active = true;
    const timeoutId = setTimeout(async () => {
      try {
        setCalculating(true);
        const flatLines: CampaignLine[] = values.campaignMarkets.flatMap((market) => market.assets.map((asset) => ({ ...asset, market: market.market })));
        const result = await calculateCampaign(flatLines);
        if (!active) return;
        setSummary(result);
        setValues((current) => ({ ...current, quantity: String(result.grandTotal.totalUnits) }));
        setError('');
      } catch (calculationError) {
        if (active) setError(calculationError instanceof Error ? calculationError.message : 'Unable to calculate campaign');
      } finally {
        if (active) setCalculating(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [loadingCampaign, loadingMetadata, metadataError, values.campaignMarkets]);

  useEffect(() => {
    if (loadingCampaign || !campaignId || !campaignHydratedRef.current) return;

    const serializedValues = JSON.stringify(values);
    if (serializedValues === lastPersistedValuesRef.current) return;

    let active = true;
    setSavingCampaign(true);
    const timeoutId = setTimeout(async () => {
      try {
        const response = await updateStoredCampaign(campaignId, { values });
        if (!active) return;
        setCampaignStatus(response.campaign.status);
        setUploadedPurchaseOrderName(response.campaign.purchaseOrder?.originalName || '');
        lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
      } catch (saveError) {
        if (active) setError(saveError instanceof Error ? saveError.message : 'Unable to save campaign draft');
      } finally {
        if (active) setSavingCampaign(false);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timeoutId);
      setSavingCampaign(false);
    };
  }, [campaignId, loadingCampaign, values]);

  function updateField<K extends keyof OrderFormValues>(field: K, value: OrderFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function updateCampaignMarket(marketId: string, updater: (market: CampaignMarket) => CampaignMarket) {
    setValues((current) => ({ ...current, campaignMarkets: current.campaignMarkets.map((market) => (market.id === marketId ? updater(market) : market)) }));
  }

  function addCampaignMarket() {
    if (!canAddMarket) return;

    setValues((current) => {
      const selectedMarketNames = new Set(current.campaignMarkets.map((market) => market.market));
      const nextMarketName = marketNames.find((marketName) => !selectedMarketNames.has(marketName));
      if (!nextMarketName) return current;

      const nextMarket = createCampaignMarket(`market-${Date.now()}`);
      return {
        ...current,
        campaignMarkets: [...current.campaignMarkets, { ...nextMarket, market: nextMarketName }],
      };
    });
  }

  function removeCampaignMarket(marketId: string) {
    setValues((current) => ({
      ...current,
      campaignMarkets: current.campaignMarkets.length === 1 ? current.campaignMarkets : current.campaignMarkets.filter((market) => market.id !== marketId),
    }));
  }

  function addCampaignAsset(marketId: string) {
    updateCampaignMarket(marketId, (market) => {
      const availableAssets = assetsForMarket(market.market);
      const selectedAssetIds = new Set(market.assets.map((asset) => asset.assetId).filter(Boolean));
      const nextAsset = availableAssets.find((asset) => !selectedAssetIds.has(asset.id));
      if (!nextAsset) return market;

      return {
        ...market,
        assets: [
          ...market.assets,
          {
            ...createCampaignAsset(`asset-${Date.now()}`),
            assetId: nextAsset.id,
            assetSearch: nextAsset.label,
          },
        ],
      };
    });
  }

  function removeCampaignAsset(marketId: string, assetId: string) {
    updateCampaignMarket(marketId, (market) => ({ ...market, assets: market.assets.length === 1 ? market.assets : market.assets.filter((asset) => asset.id !== assetId) }));
  }

  function updateCampaignAsset(marketId: string, assetId: string, updater: (asset: CampaignAsset) => CampaignAsset) {
    updateCampaignMarket(marketId, (market) => ({ ...market, assets: market.assets.map((asset) => (asset.id === assetId ? updater(asset) : asset)) }));
  }

  function assetsForMarket(marketName: string) {
    return markets.find((market) => market.name === marketName)?.assets ?? [];
  }

  function assetOptionsFor(market: CampaignMarket, assetId: string, selectedAssetId: string) {
    const selectedInOtherRows = new Set(market.assets.filter((asset) => asset.id !== assetId).map((asset) => asset.assetId).filter(Boolean));
    return assetsForMarket(market.market)
      .filter((asset) => asset.id === selectedAssetId || !selectedInOtherRows.has(asset.id))
      .map((asset) => ({ label: asset.label, value: asset.id }));
  }

  function canAddAssetForMarket(market: CampaignMarket) {
    const availableAssets = assetsForMarket(market.market);
    const selectedAssetIds = new Set(market.assets.map((asset) => asset.assetId).filter(Boolean));
    return availableAssets.some((asset) => !selectedAssetIds.has(asset.id));
  }

  function addAssetDisabledReasonForMarket(market: CampaignMarket) {
    const availableAssets = assetsForMarket(market.market);
    if (!market.market) return 'Choose a market before adding assets.';
    if (availableAssets.length === 0) return 'No assets are available for this market.';
    return 'All available assets for this market have already been added.';
  }

  function marketOptionsFor(marketId: string, selectedMarket: string) {
    const selectedInOtherRows = new Set(values.campaignMarkets.filter((market) => market.id !== marketId).map((market) => market.market));
    return marketNames.filter((marketName) => marketName === selectedMarket || !selectedInOtherRows.has(marketName)).map((marketName) => ({ label: marketName, value: marketName }));
  }

  async function handleSubmitQuote() {
    if (!campaignId) {
      setError('Campaign draft is not ready yet');
      return;
    }

    setSubmitting(true);
    setError('');
    setQuoteResponseMessage('');

    try {
      const response = await submitCampaignToPrintIQ(campaignId);
      const amount = response.amount === null || response.amount === undefined || response.amount === '' ? 'N/A' : String(response.amount);
      applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
      lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
      setQuoteResponseMessage(`Quote created successfully. Amount: ${amount}`);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to create quote');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadPurchaseOrder() {
    if (!selectedPurchaseOrderFile) {
      setError('Please choose a purchase order file to upload');
      return;
    }
    if (!campaignId) {
      setError('Campaign draft is not ready yet');
      return;
    }

    setUploadingPurchaseOrder(true);
    setError('');
    try {
      const response = await uploadPurchaseOrderFile(selectedPurchaseOrderFile, campaignId);
      setUploadedPurchaseOrderName(response.originalName);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload purchase order');
    } finally {
      setUploadingPurchaseOrder(false);
    }
  }

  async function reviewTotals() {
    if (!campaignId) {
      setError('Campaign draft is not ready yet');
      return;
    }

    setCalculating(true);
    setError('');
    try {
      const saved = await updateStoredCampaign(campaignId, { values });
      lastPersistedValuesRef.current = JSON.stringify(saved.campaign.values);
      const response = await calculatePersistedCampaign(campaignId);
      applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
      lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
      setStepIndex(1);
    } catch (calculationError) {
      setError(calculationError instanceof Error ? calculationError.message : 'Unable to calculate campaign');
    } finally {
      setCalculating(false);
    }
  }

  function openPurchaseOrderPicker() {
    purchaseOrderInputRef.current?.click();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-950/70 px-6 py-8 shadow-2xl shadow-slate-950/40">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.2),transparent_52%)]" />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
                <LayoutGrid className="h-3.5 w-3.5" />
                Print Workflow Studio
              </Badge>
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">ADS CONNECT</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Build campaign schedules, review calculated totals, and create PrintIQ-ready quotes with a cleaner browser-first workflow.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                  {loadingCampaign ? 'Loading draft' : savingCampaign ? 'Saving draft' : `Status: ${campaignStatus.replace('_', ' ')}`}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
              <div>
                <p className="font-semibold text-white">{session?.user.name}</p>
                <p className="text-slate-400">
                  {session?.user.role.replace('_', ' ')} • {session?.user.tenantName || 'Global'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {onBack ? (
                  <Button onClick={onBack} size="sm" variant="ghost">
                    <ArrowLeft className="h-4 w-4" />
                    Campaigns
                  </Button>
                ) : null}
                {onOpenAdmin ? (
                  <Button onClick={onOpenAdmin} size="sm" variant="secondary">
                    <Shield className="h-4 w-4" />
                    Admin
                  </Button>
                ) : null}
                <Button onClick={() => void logout()} size="sm" variant="outline">
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-violet-500 transition-all duration-300" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {steps.map((step, index) => {
                const active = index === stepIndex;
                return (
                  <button
                    key={step.key}
                    className={cn('rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition', active ? 'border-violet-400 bg-violet-500/10 text-white' : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500')}
                    onClick={() => setStepIndex(index)}
                    type="button"
                  >
                    <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Step {index + 1}</span>
                    <span className="mt-1 block text-base">{step.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {(error || metadataError) ? (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error || metadataError}</div>
      ) : null}
      {quoteResponseMessage ? <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{quoteResponseMessage}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="space-y-6">
          {currentStep.key === 'schedule' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Campaign Planning</CardTitle>
                <CardDescription>Configure the campaign dates, select markets and assets, and let the quantity mappings update totals automatically.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <TextField id="campaign-name" label="Campaign Name" value={values.campaignName} onChange={(value) => updateField('campaignName', value)} />

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="campaign-start">Campaign start date</Label>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-10" id="campaign-start" type="date" value={values.campaignStartDate} onChange={(event) => updateField('campaignStartDate', event.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="due-date">Due Date</Label>
                    <div className="relative">
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input className="pl-10" id="due-date" type="date" value={values.dueDate} onChange={(event) => updateField('dueDate', event.target.value)} />
                    </div>
                  </div>
                  <TextField id="week-count" inputMode="numeric" label="Number of weeks" value={values.numberOfWeeks} onChange={(value) => updateField('numberOfWeeks', value)} />
                </div>

                {loadingMetadata ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
                    <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                    Loading campaign mappings…
                  </div>
                ) : null}

                <div className="space-y-4">
                  {values.campaignMarkets.map((market, marketIndex) => {
                    const availableAssets = assetsForMarket(market.market);
                    const canRemoveMarket = values.campaignMarkets.length > 1;
                    const availableMarkets = marketOptionsFor(market.id, market.market);
                    const isActiveMarket = market.id === activeMarket?.id;
                    return (
                      <div
                        key={market.id}
                        className={cn('rounded-[24px] border bg-slate-800/60 p-4 sm:p-5', isActiveMarket ? 'border-violet-400/60 shadow-[0_0_0_1px_rgba(167,139,250,0.25)]' : 'border-slate-700')}
                        onClick={() => setActiveMarketId(market.id)}
                        onFocusCapture={() => setActiveMarketId(market.id)}
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div className="flex-1">
                            <SearchableSelect
                              emptyMessage="No markets available for this row."
                              items={availableMarkets}
                              label={`Market ${marketIndex + 1}`}
                              onValueChange={(value) =>
                                updateCampaignMarket(market.id, (current) => ({
                                  ...current,
                                  market: value,
                                  assets: current.assets.map((asset) => ({ ...asset, assetId: '', assetSearch: '' })),
                                }))
                              }
                              placeholder="Choose a market"
                              selectedValue={market.market}
                            />
                          </div>
                          {canRemoveMarket ? (
                            <Button onClick={() => removeCampaignMarket(market.id)} size="icon" type="button" variant="ghost">
                              <X className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>

                        <div className="mt-5 space-y-4">
                          <div>
                            <p className="text-sm font-semibold text-white">Assets</p>
                            <p className="text-xs text-slate-400">Attach the assets you want to run in this market and choose their active weeks.</p>
                          </div>
                          {market.assets.map((asset, assetIndex) => {
                            const canRemoveAsset = market.assets.length > 1;
                            const availableAssetOptions = assetOptionsFor(market, asset.id, asset.assetId);
                            return (
                              <div key={asset.id} className="space-y-3 rounded-2xl border border-slate-700/80 bg-slate-900/70 p-4">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1">
                                    <SearchableSelect
                                      emptyMessage={availableAssets.length ? 'No assets available for this row.' : 'No assets available for this market.'}
                                      items={availableAssetOptions}
                                      label={`Asset ${assetIndex + 1}`}
                                      onValueChange={(value) =>
                                        updateCampaignAsset(market.id, asset.id, (current) => ({
                                          ...current,
                                          assetId: value,
                                          assetSearch: availableAssets.find((entry) => entry.id === value)?.label ?? '',
                                        }))
                                      }
                                      placeholder={availableAssets.length ? 'Choose an asset' : 'No assets available'}
                                      selectedLabel={asset.assetSearch}
                                      selectedValue={asset.assetId}
                                    />
                                  </div>
                                  {canRemoveAsset ? (
                                    <Button onClick={() => removeCampaignAsset(market.id, asset.id)} size="icon" type="button" variant="ghost">
                                      <X className="h-4 w-4 text-rose-300" />
                                    </Button>
                                  ) : null}
                                </div>
                                <div className="space-y-2">
                                  <Label>Active weeks</Label>
                                  <WeekSelector
                                    weekCount={numberOfWeeks}
                                    startDate={values.campaignStartDate}
                                    onToggle={(week) =>
                                      updateCampaignAsset(market.id, asset.id, (current) => ({
                                        ...current,
                                        selectedWeeks: current.selectedWeeks.includes(week)
                                          ? current.selectedWeeks.filter((value) => value !== week)
                                          : [...current.selectedWeeks, week].sort((a, b) => a - b),
                                      }))
                                    }
                                    selectedWeeks={asset.selectedWeeks}
                                  />
                                </div>
                              </div>
                            );
                          })}

                          <div title={canAddAssetForMarket(market) ? 'Add another asset' : addAssetDisabledReasonForMarket(market)}>
                            <Button disabled={!canAddAssetForMarket(market)} onClick={() => addCampaignAsset(market.id)} type="button" variant="outline">
                              <Plus className="h-4 w-4" />
                              Add Asset
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <div title={canAddMarket ? 'Add another market' : addMarketDisabledReason}>
                    <Button disabled={!canAddMarket} onClick={addCampaignMarket} type="button" variant="secondary">
                      <Plus className="h-4 w-4" />
                      Add Market
                    </Button>
                  </div>
                  <Button disabled={calculating} onClick={reviewTotals} type="button">
                    {calculating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {calculating ? 'Calculating…' : 'Review Totals'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {currentStep.key === 'review' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Review Totals</CardTitle>
                <CardDescription>Confirm the calculated totals before creating the quote.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                {summary ? (
                  <>
                    {activeMarketSummaries.map((marketSummary) => (
                      <div key={marketSummary.market} className="space-y-4 rounded-[24px] border border-slate-700 bg-slate-800/70 p-5">
                        <div>
                          <h3 className="text-xl font-black text-white">{marketSummary.market}</h3>
                          <p className="mt-1 text-sm text-slate-400">
                            {marketSummary.activeAssets} active assets, {marketSummary.activeRuns} runs, {marketSummary.posterTotal} posters, {marketSummary.frameTotal} frames
                          </p>
                        </div>
                        <BreakdownTable breakdown={marketSummary.breakdown} />
                      </div>
                    ))}

                    <div className="space-y-4 rounded-[24px] border border-violet-400/30 bg-violet-500/10 p-5">
                      <div>
                        <h3 className="text-xl font-black text-white">All Markets</h3>
                        <p className="mt-1 text-sm text-violet-100/80">
                          {summary.grandTotal.posterTotal} posters, {summary.grandTotal.frameTotal} frames, {summary.grandTotal.specialFormatTotal} special-format units
                        </p>
                      </div>
                      <BreakdownTable breakdown={summary.grandTotal.breakdown} inverse />
                    </div>

                    <div className="flex gap-3">
                      <Button onClick={() => setStepIndex(2)} type="button">
                        Continue To Finalise
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-[24px] border border-slate-700 bg-slate-800/70 p-6">
                    <div className="flex items-start gap-3">
                      <CircleAlert className="mt-0.5 h-5 w-5 text-amber-300" />
                      <div>
                        <p className="font-semibold text-white">No totals yet</p>
                        <p className="mt-1 text-sm text-slate-400">Go back to Schedule and configure campaign assets first.</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {currentStep.key === 'finalize' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Finalise Quote</CardTitle>
                <CardDescription>Upload the purchase order and create the PrintIQ quote without leaving this screen.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="space-y-3">
                  <Label>Purchase Order File</Label>
                  <div className="rounded-[24px] border border-dashed border-slate-600 bg-slate-800/60 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white">{selectedPurchaseOrderFile ? selectedPurchaseOrderFile.name : 'No file selected'}</p>
                        <p className="mt-1 text-sm text-slate-400">PDF upload stays unchanged. This only refreshes the interaction and layout.</p>
                      </div>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button onClick={openPurchaseOrderPicker} type="button" variant="secondary">
                          <Upload className="h-4 w-4" />
                          {selectedPurchaseOrderFile ? 'Change File' : 'Choose File'}
                        </Button>
                        <Button disabled={uploadingPurchaseOrder} onClick={() => void handleUploadPurchaseOrder()} type="button" variant="outline">
                          {uploadingPurchaseOrder ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          {uploadingPurchaseOrder ? 'Uploading…' : 'Upload Purchase Order'}
                        </Button>
                      </div>
                    </div>
                    <input
                      ref={purchaseOrderInputRef}
                      className="hidden"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0] ?? null;
                        setSelectedPurchaseOrderFile(nextFile);
                      }}
                      type="file"
                    />
                  </div>
                  {uploadedPurchaseOrderName ? <p className="text-sm font-medium text-emerald-300">Uploaded: {uploadedPurchaseOrderName}</p> : null}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button disabled={submitting || calculating || !summary} onClick={() => void handleSubmitQuote()} type="button">
                    {submitting || calculating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {submitting ? 'Submitting…' : calculating ? 'Calculating…' : 'Create Quote In PrintIQ'}
                  </Button>
                  {onBack ? (
                    <Button onClick={onBack} type="button" variant="outline">
                      Go To Dashboard
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardHeader className="space-y-2 p-5 pb-0">
              <Badge className="w-fit text-[10px] uppercase tracking-[0.22em]">Market Snapshot</Badge>
              <CardTitle className="text-xl leading-tight">
                {activeMarketSummary ? (
                  <>
                    {activeMarketSummary.market} <span className="text-sm font-medium text-slate-400">({activeMarketSummary.activeAssets} assets)</span>
                  </>
                ) : (
                  activeMarket?.market || 'Selected Market'
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              {activeMarketSummary ? (
                <>
                  <LiveSummarySection
                    compact
                    items={formatKeys.map((key) => ({
                      key: `market-${key}`,
                      label: key,
                      value: activeMarketSummary.breakdown[key],
                    }))}
                  />
                  <Separator />
                  <LiveSummarySection
                    compact
                    highlightValues
                    items={[
                      { key: 'market-posters', label: 'Posters', value: activeMarketSummary.posterTotal },
                      { key: 'market-frames', label: 'Frames', value: activeMarketSummary.frameTotal },
                      { key: 'market-special', label: 'Special', value: activeMarketSummary.specialFormatTotal },
                      { key: 'market-total-units', label: 'Total Units', value: activeMarketSummary.totalUnits },
                    ]}
                  />
                </>
              ) : (
                <p className="text-sm leading-6 text-slate-400">Configure assets in the active market to see its sheet-level mix and totals here.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-2 p-5 pb-0">
              <Badge className="w-fit text-[10px] uppercase tracking-[0.22em]">Campaign Snapshot</Badge>
              <CardTitle className="text-xl leading-tight">
                All Markets{' '}
                <span className="text-sm font-medium text-slate-400">({values.campaignMarkets.reduce((acc, market) => acc + market.assets.length, 0)} assets)</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              {summary ? (
                <>
                  <LiveSummarySection
                    compact
                    items={formatKeys.map((key) => ({
                      key: `campaign-${key}`,
                      label: key,
                      value: summary.grandTotal.breakdown[key],
                    }))}
                  />
                  <Separator />
                  <LiveSummarySection
                    compact
                    highlightValues
                    items={[
                      { key: liveSummarySecondaryKeys[0].key, label: liveSummarySecondaryKeys[0].label, value: summary.grandTotal.posterTotal },
                      { key: liveSummarySecondaryKeys[1].key, label: liveSummarySecondaryKeys[1].label, value: summary.grandTotal.frameTotal },
                      { key: liveSummarySecondaryKeys[2].key, label: liveSummarySecondaryKeys[2].label, value: summary.grandTotal.specialFormatTotal },
                      { key: liveSummarySecondaryKeys[3].key, label: liveSummarySecondaryKeys[3].label, value: values.quantity || summary.grandTotal.totalUnits },
                    ]}
                  />
                </>
              ) : (
                <p className="text-sm leading-6 text-slate-400">Configure campaign assets to see overall totals here.</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  );
}
