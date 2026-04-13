import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronUp, CircleAlert, LayoutGrid, LoaderCircle, LogOut, Pencil, Plus, Shield, Trash2, Upload, X } from 'lucide-react';
import {
  CampaignAsset,
  CampaignPrintImage,
  CampaignRecord,
  CampaignCalculationSummary,
  CampaignLine,
  CampaignMarket,
  CampaignTotals,
  MarketMetadata,
  MarketDeliveryAddressRecord,
  MarketShippingRateRecord,
  OrderFormValues,
  QuantityBreakdown,
  buildPrintIqPayload,
  createCampaignAsset,
  createCampaignMarket,
  createDefaultFormValues,
  formatKeys,
} from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Textarea, cn } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { buildApiUrl } from '../services/apiBase';
import { createCampaign, fetchCampaign, submitCampaignToPrintIQ, updateCampaign as updateStoredCampaign } from '../services/campaignApi';
import { uploadCampaignImage } from '../services/campaignImageApi';
import { calculateCampaign, fetchCalculatorMetadata } from '../services/calculatorApi';
import { fetchCampaignMarketDeliveryAddresses, fetchCampaignMarketShippingRates } from '../services/marketDeliveryApi';
import { fetchQuoteOptions } from '../services/printiqOptionsApi';
import { uploadPurchaseOrderFile } from '../services/purchaseOrderApi';

const steps = [
  { key: 'creative', title: 'Creative' },
  { key: 'schedule', title: 'Schedule' },
  { key: 'review', title: 'Review' },
  { key: 'finalize', title: 'Finalise' },
] as const;

const ACTIVE_CAMPAIGN_ID_KEY = 'adsconnect-active-campaign-id';

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
  setValues(normalizeFormValues(campaign.values));
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

function buildReviewRows(totals: CampaignTotals) {
  const frameBreakdown: QuantityBreakdown = {
    '8-sheet': totals.breakdown['8-sheet'] / 4,
    '6-sheet': totals.breakdown['6-sheet'] / 3,
    '4-sheet': totals.breakdown['4-sheet'] / 2,
    '2-sheet': totals.breakdown['2-sheet'],
    QA0: totals.breakdown.QA0 / 4,
    Mega: 0,
    'DOT M': 0,
    MP: 0,
  };

  return [
    { label: 'Posters', breakdown: totals.breakdown, total: totals.posterTotal, shippingCost: 0 },
    { label: 'Frames', breakdown: frameBreakdown, total: totals.frameTotal, shippingCost: null },
  ] as const;
}

function totalUnitsForBreakdown(breakdown: QuantityBreakdown) {
  return formatKeys.reduce((total, key) => total + (breakdown[key] ?? 0), 0);
}

function calculateShippingCost(units: number, perBoxPrice: number, postersPerBox: number) {
  const safePostersPerBox = Math.max(1, Math.floor(postersPerBox || 60));
  const boxCount = Math.max(1, Math.ceil(units / safePostersPerBox));
  return boxCount * perBoxPrice;
}

function formatKeyLabel(key: (typeof formatKeys)[number]) {
  if (key === 'Mega') return 'Megasite';
  if (key === 'DOT M') return 'DOT Megasite';
  if (key === 'MP') return 'Mega Portrait';
  return key;
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

function createAllWeeks(weekCount: number) {
  const safeWeekCount = Math.max(1, Math.floor(weekCount || 1));
  return Array.from({ length: safeWeekCount }, (_, index) => index + 1);
}

function toFileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '');
}

function normalizeFormValues(values: OrderFormValues): OrderFormValues {
  return {
    ...values,
    printImages: (values.printImages ?? []).map((image) => ({
      id: image.id,
      name: image.name,
      fileName: image.fileName,
      mimeType: image.mimeType,
      storedName: image.storedName,
      imageUrl:
        image.imageUrl && image.imageUrl.startsWith('/uploads/campaign-images/')
          ? image.imageUrl.replace('/uploads/campaign-images/', '/api/campaign-images/')
          : image.imageUrl,
    })),
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDocumentDate(value: string) {
  const parsed = parseDateOnly(value);
  if (!parsed) return 'TBC';
  return parsed.toLocaleDateString('en-AU');
}

function toOrdinalDay(day: number) {
  const remainder = day % 10;
  const teens = day % 100;
  if (teens >= 11 && teens <= 13) return `${day}th`;
  if (remainder === 1) return `${day}st`;
  if (remainder === 2) return `${day}nd`;
  if (remainder === 3) return `${day}rd`;
  return `${day}th`;
}

function formatDeliveryDeadline(value: string) {
  const parsed = parseDateOnly(value);
  if (!parsed) return 'the due date';
  const weekday = parsed.toLocaleDateString('en-AU', { weekday: 'long' });
  const month = parsed.toLocaleDateString('en-AU', { month: 'long' });
  return `${weekday} the ${toOrdinalDay(parsed.getDate())} of ${month}`;
}

function formatDeliveryAddressOptionLabel(address: string) {
  const lines = address
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const name = lines[0] || 'Address';
  const localityLine = lines.find((line) => /\b\d{4}\b/.test(line)) || '';
  const postcodeMatch = localityLine.match(/\b(\d{4})\b/);
  const postcode = postcodeMatch ? postcodeMatch[1] : '';
  return postcode ? `${name} - ${postcode}` : name;
}

type AddressFormState = {
  name: string;
  unitStreetNumber: string;
  suburb: string;
  state: string;
  postcode: string;
  phoneNumber: string;
  deliveryTime: string;
  deliveryPoint: string;
  deliveryNotes: string;
};

function emptyAddressForm(): AddressFormState {
  return {
    name: '',
    unitStreetNumber: '',
    suburb: '',
    state: '',
    postcode: '',
    phoneNumber: '',
    deliveryTime: '',
    deliveryPoint: '',
    deliveryNotes: '',
  };
}

function formatAddressLine(form: AddressFormState) {
  return form.unitStreetNumber.trim();
}

function formatDeliveryAddress(form: AddressFormState) {
  const lines = [
    form.name.trim(),
    formatAddressLine(form),
    [form.suburb.trim(), form.state.trim(), form.postcode.trim()].filter(Boolean).join(' '),
    `Phone: ${form.phoneNumber.trim()}`,
    `Delivery time: ${form.deliveryTime.trim()}`,
    `Delivery point: ${form.deliveryPoint.trim()}`,
    `Notes: ${form.deliveryNotes.trim().replaceAll('\n', ' ')}`,
    'Australia',
  ];
  return lines.join('\n');
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Unable to read image blob'));
    reader.readAsDataURL(blob);
  });
}

function toAbsoluteUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window !== 'undefined') {
    try {
      return new URL(trimmed, window.location.origin).toString();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

async function pdfFirstPageToDataUrl(blob: Blob, maxWidth = 560) {
  const pdfjs = await (new Function("return import('/pdf.min.mjs')")() as Promise<any>);
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    '/pdf.worker.min.mjs';

  const objectUrl = URL.createObjectURL(blob);
  try {
    const loadingTask = pdfjs.getDocument({ url: objectUrl });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1, maxWidth / initialViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
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
  actionLabel,
  onAction,
  actionDisabled = false,
}: {
  label: string;
  selectedValue: string;
  selectedLabel?: string;
  items: Array<{ label: string; value: string }>;
  onValueChange: (value: string) => void;
  placeholder: string;
  emptyMessage: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
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
            {actionLabel && onAction ? (
              <Button
                className="w-full"
                disabled={actionDisabled}
                onClick={() => {
                  onAction();
                  setOpen(false);
                }}
                type="button"
                variant="secondary"
              >
                <Plus className="h-4 w-4" />
                {actionLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WeekSelector({
  weekCount,
  selectedWeeks,
  startDate,
  compact = false,
  readOnly = false,
  onToggleWeek,
}: {
  weekCount: number;
  selectedWeeks: number[];
  startDate: string;
  compact?: boolean;
  readOnly?: boolean;
  onToggleWeek?: (week: number) => void;
}) {
  return (
    <div className={cn('flex gap-2', compact ? 'flex-nowrap whitespace-nowrap' : 'flex-wrap')}>
      {Array.from({ length: weekCount }, (_, index) => index + 1).map((week) => {
        const selected = selectedWeeks.includes(week);
        return (
          <button
            key={week}
            className={cn(
              'rounded-full border font-semibold transition',
              compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              selected ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-slate-500',
            )}
            aria-pressed={selected}
            disabled={readOnly}
            onClick={() => onToggleWeek?.(week)}
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
  const allWeeks = createAllWeeks(maxWeeks);
  return campaignMarkets.map((market) => ({
    ...market,
    assets: market.assets.map((asset) => ({
      ...asset,
      creativeImageId: asset.creativeImageId || '',
      deliveryAddress: asset.deliveryAddress || '',
      selectedWeeks: allWeeks,
    })),
  }));
}

const defaultValues = createDefaultFormValues();
const defaultValuesSerialized = JSON.stringify(defaultValues);

export function QuoteBuilderScreen({
  campaignId: selectedCampaignId,
  startFresh = false,
  onBack,
  onOpenAdmin,
}: {
  campaignId?: string | null;
  startFresh?: boolean;
  onBack?: () => void;
  onOpenAdmin?: () => void;
}) {
  const { session, logout } = useAuth();
  const [values, setValues] = useState<OrderFormValues>(() => defaultValues);
  const [campaignId, setCampaignId] = useState<string | null>(selectedCampaignId ?? null);
  const [campaignStatus, setCampaignStatus] = useState<CampaignRecord['status']>('draft');
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [marketDeliveryAddresses, setMarketDeliveryAddresses] = useState<MarketDeliveryAddressRecord[]>([]);
  const [marketShippingRates, setMarketShippingRates] = useState<MarketShippingRateRecord[]>([]);
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
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [replacingImageId, setReplacingImageId] = useState<string | null>(null);
  const [newAddressDialogOpen, setNewAddressDialogOpen] = useState(false);
  const [newAddressTarget, setNewAddressTarget] = useState<{ marketId: string; assetId: string; marketName: string } | null>(null);
  const [newAddressForm, setNewAddressForm] = useState<AddressFormState>(() => emptyAddressForm());
  const [newAddressError, setNewAddressError] = useState('');
  const imageUploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceImageInputRef = useRef<HTMLInputElement | null>(null);
  const purchaseOrderInputRef = useRef<HTMLInputElement | null>(null);
  const campaignHydratedRef = useRef(false);
  const lastPersistedValuesRef = useRef('');

  useEffect(() => {
    let active = true;

    async function bootstrapCampaign() {
      try {
        const storedCampaignId = startFresh ? null : selectedCampaignId || (await getStoredCampaignId());
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
        setValues(defaultValues);
        setSummary(null);
        setUploadedPurchaseOrderName('');
        setCampaignId(null);
        setCampaignStatus('draft');
        lastPersistedValuesRef.current = defaultValuesSerialized;
        campaignHydratedRef.current = true;
        await setStoredCampaignId(null);
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
  }, [selectedCampaignId, startFresh]);

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
    let active = true;
    async function loadMarketAddresses() {
      try {
        const response = await fetchCampaignMarketDeliveryAddresses();
        if (!active) return;
        setMarketDeliveryAddresses(response.addresses);
      } catch {
        if (!active) return;
        setMarketDeliveryAddresses([]);
      }
    }
    void loadMarketAddresses();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadMarketShippingRates() {
      try {
        const response = await fetchCampaignMarketShippingRates();
        if (!active) return;
        setMarketShippingRates(response.rates);
      } catch {
        if (!active) return;
        setMarketShippingRates([]);
      }
    }
    void loadMarketShippingRates();
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
  const canAddAddressInFinalize = session?.user.role === 'admin' || session?.user.role === 'super_admin';
  const numberOfWeeks = Math.max(1, Math.min(20, Math.floor(Number(values.numberOfWeeks) || 1)));
  const currentStep = steps[stepIndex];
  const progressPercent = ((stepIndex + 1) / steps.length) * 100;
  const marketNames = useMemo(() => markets.map((market) => market.name), [markets]);
  const creativeImageOptions = useMemo(
    () => [{ label: 'No artwork attached', value: '' }, ...values.printImages.map((image) => ({ label: image.name, value: image.id }))],
    [values.printImages],
  );
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
  const marketSummaryByName = useMemo(() => {
    if (!summary) return new Map<string, CampaignCalculationSummary['perMarket'][number]>();
    return new Map(summary.perMarket.map((entry) => [entry.market, entry]));
  }, [summary]);
  const selectedCampaignMarketNames = useMemo(
    () => new Set(values.campaignMarkets.map((market) => market.market.trim()).filter(Boolean)),
    [values.campaignMarkets],
  );
  const visibleReviewMarkets = useMemo(
    () => (summary ? summary.perMarket.filter((entry) => selectedCampaignMarketNames.has(entry.market)) : []),
    [selectedCampaignMarketNames, summary],
  );
  const visibleReviewFormatKeys = useMemo(
    () =>
      formatKeys.filter((key) => visibleReviewMarkets.some((marketSummary) => (marketSummary.breakdown[key] ?? 0) > 0)),
    [visibleReviewMarkets],
  );
  const shippingRateByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.shippingRate])),
    [marketShippingRates],
  );
  const postersPerBoxByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.postersPerBox])),
    [marketShippingRates],
  );
  const preferredDeliveryAddressByMarket = useMemo(() => {
    const byMarket = new Map<string, string>();
    marketDeliveryAddresses.forEach((entry) => {
      if (entry.isDefault) {
        byMarket.set(entry.market, entry.deliveryAddress);
        return;
      }
      if (!byMarket.has(entry.market)) {
        byMarket.set(entry.market, entry.deliveryAddress);
      }
    });
    return byMarket;
  }, [marketDeliveryAddresses]);
  const hasUnsavedChanges = !loadingCampaign && JSON.stringify(values) !== lastPersistedValuesRef.current;
  const hasMappedCreatives = values.campaignMarkets.some((market) => market.assets.some((asset) => Boolean(asset.creativeImageId)));
  const hasUploadedPurchaseOrder = uploadedPurchaseOrderName.trim().length > 0;
  const hasCampaignStartDate = values.campaignStartDate.trim().length > 0;
  const hasDeliveryDueDate = values.dueDate.trim().length > 0;
  const canAdvanceFromCreative = hasCampaignStartDate && hasDeliveryDueDate;

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
    if (loadingCampaign) return;
    if (preferredDeliveryAddressByMarket.size === 0) return;

    setValues((current) => {
      let changed = false;
      const nextCampaignMarkets = current.campaignMarkets.map((market) => {
        const preferredAddress = preferredDeliveryAddressByMarket.get(market.market);
        if (!preferredAddress) return market;

        let marketChanged = false;
        const nextAssets = market.assets.map((asset) => {
          if (asset.deliveryAddress) return asset;
          changed = true;
          marketChanged = true;
          return {
            ...asset,
            deliveryAddress: preferredAddress,
          };
        });

        return marketChanged ? { ...market, assets: nextAssets } : market;
      });

      return changed ? { ...current, campaignMarkets: nextCampaignMarkets } : current;
    });
  }, [loadingCampaign, preferredDeliveryAddressByMarket]);

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

  function updateField<K extends keyof OrderFormValues>(field: K, value: OrderFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function validateCreativeStepRequirements() {
    if (canAdvanceFromCreative) return true;
    setError('Please select both Campaign start date and Delivery Due Date to continue.');
    return false;
  }

  function navigateToStep(nextStepIndex: number) {
    if (nextStepIndex <= stepIndex) {
      setStepIndex(nextStepIndex);
      return;
    }
    if (stepIndex === 0 && !validateCreativeStepRequirements()) return;
    setError('');
    setStepIndex(nextStepIndex);
  }

  function updateWeekCount(nextValue: number) {
    const normalized = Math.max(1, Math.min(20, Math.floor(nextValue)));
    updateField('numberOfWeeks', String(normalized));
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
      const preferredAddress = preferredDeliveryAddressByMarket.get(nextMarketName) || '';
      return {
        ...current,
        campaignMarkets: [
          ...current.campaignMarkets,
          {
            ...nextMarket,
            market: nextMarketName,
            assets: nextMarket.assets.map((asset) => ({ ...asset, deliveryAddress: preferredAddress, selectedWeeks: createAllWeeks(numberOfWeeks) })),
          },
        ],
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
      const preferredAddress = preferredDeliveryAddressByMarket.get(market.market) || '';

      return {
        ...market,
        assets: [
          ...market.assets,
          {
            ...createCampaignAsset(`asset-${Date.now()}`, numberOfWeeks),
            assetId: nextAsset.id,
            assetSearch: nextAsset.label,
            deliveryAddress: preferredAddress,
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

  function toggleCampaignAssetWeek(marketId: string, assetId: string, week: number) {
    updateCampaignAsset(marketId, assetId, (asset) => {
      const selectedWeekSet = new Set(asset.selectedWeeks);
      if (selectedWeekSet.has(week)) selectedWeekSet.delete(week);
      else selectedWeekSet.add(week);
      const nextSelectedWeeks = Array.from(selectedWeekSet).sort((left, right) => left - right);
      return { ...asset, selectedWeeks: nextSelectedWeeks };
    });
  }

  function assetsForMarket(marketName: string) {
    return (markets.find((market) => market.name === marketName)?.assets ?? []).filter((asset) => !asset.isMaintenance);
  }

  function assetOptionsFor(market: CampaignMarket, assetId: string, selectedAssetId: string) {
    const selectedInOtherRows = new Set(market.assets.filter((asset) => asset.id !== assetId).map((asset) => asset.assetId).filter(Boolean));
    const marketAssets = markets.find((entry) => entry.name === market.market)?.assets ?? [];
    return marketAssets
      .filter((asset) => asset.id === selectedAssetId || (!asset.isMaintenance && !selectedInOtherRows.has(asset.id)))
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

  function deliveryAddressOptionsFor(marketName: string) {
    const savedOptions = marketDeliveryAddresses
      .filter((entry) => entry.market === marketName)
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
      .map((entry) => ({
        label: entry.isDefault ? `${formatDeliveryAddressOptionLabel(entry.deliveryAddress)} (Default)` : formatDeliveryAddressOptionLabel(entry.deliveryAddress),
        value: entry.deliveryAddress,
      }));
    const campaignOnlyOptions = values.campaignMarkets
      .filter((market) => market.market === marketName)
      .flatMap((market) => market.assets.map((asset) => asset.deliveryAddress.trim()).filter(Boolean))
      .map((deliveryAddress) => ({
        label: formatDeliveryAddressOptionLabel(deliveryAddress),
        value: deliveryAddress,
      }));
    return [...new Map([...campaignOnlyOptions, ...savedOptions].map((option) => [option.value, option])).values()];
  }

  function openAddAddressDialog(marketId: string, assetId: string, marketName: string) {
    if (!canAddAddressInFinalize || !marketName.trim()) return;
    setNewAddressTarget({ marketId, assetId, marketName });
    setNewAddressForm(emptyAddressForm());
    setNewAddressError('');
    setNewAddressDialogOpen(true);
  }

  function handleSaveNewAddress() {
    if (!newAddressTarget) return;
    const requiredFields: Array<{ label: string; value: string }> = [
      { label: 'Name', value: newAddressForm.name },
      { label: 'Unit/Street Number', value: newAddressForm.unitStreetNumber },
      { label: 'Suburb', value: newAddressForm.suburb },
      { label: 'State', value: newAddressForm.state },
      { label: 'Postcode', value: newAddressForm.postcode },
      { label: 'Phone number', value: newAddressForm.phoneNumber },
      { label: 'Delivery time', value: newAddressForm.deliveryTime },
      { label: 'Delivery point', value: newAddressForm.deliveryPoint },
      { label: 'Delivery notes', value: newAddressForm.deliveryNotes },
    ];
    const missingField = requiredFields.find((field) => !field.value.trim());
    if (missingField) {
      setNewAddressError(`${missingField.label} is required`);
      return;
    }
    const nextAddress = formatDeliveryAddress(newAddressForm);
    setNewAddressError('');

    updateCampaignAsset(newAddressTarget.marketId, newAddressTarget.assetId, (current) => ({
      ...current,
      deliveryAddress: nextAddress,
    }));
    setNewAddressDialogOpen(false);
    setNewAddressTarget(null);
    setNewAddressForm(emptyAddressForm());
    setNewAddressError('');
  }

  async function appendPrintImages(files: File[]) {
    if (files.length === 0) {
      setError('Please choose at least one valid file');
      return;
    }

    try {
      const uploadedImages: CampaignPrintImage[] = [];
      for (const [index, file] of files.entries()) {
        const uploadResult = await uploadCampaignImage(file);
        uploadedImages.push({
          id: `print-image-${Date.now()}-${index}`,
          name: toFileBaseName(file.name),
          fileName: uploadResult.originalName || file.name,
          mimeType: uploadResult.mimeType || file.type || 'application/octet-stream',
          storedName: uploadResult.storedName,
          imageUrl: uploadResult.url,
        });
      }
      setValues((current) => ({ ...current, printImages: [...current.printImages, ...uploadedImages] }));
      setError('');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload file(s)');
    }
  }

  function handlePickPrintImages() {
    imageUploadInputRef.current?.click();
  }

  async function handlePrintImageSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = event.target.files ? Array.from(event.target.files) : [];
    if (selectedFiles.length > 0) await appendPrintImages(selectedFiles);
    event.target.value = '';
  }

  function updatePrintImage(imageId: string, updater: (image: CampaignPrintImage) => CampaignPrintImage) {
    setValues((current) => ({
      ...current,
      printImages: current.printImages.map((image) => (image.id === imageId ? updater(image) : image)),
    }));
  }

  function removePrintImage(imageId: string) {
    setValues((current) => ({
      ...current,
      printImages: current.printImages.filter((image) => image.id !== imageId),
    }));
  }

  function beginReplacePrintImage(imageId: string) {
    setReplacingImageId(imageId);
    replaceImageInputRef.current?.click();
  }

  async function handleReplacePrintImage(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile || !replacingImageId) {
      setReplacingImageId(null);
      event.target.value = '';
      return;
    }

    try {
      const uploadResult = await uploadCampaignImage(selectedFile);
      updatePrintImage(replacingImageId, (current) => ({
        ...current,
        fileName: uploadResult.originalName || selectedFile.name,
        mimeType: uploadResult.mimeType || selectedFile.type || current.mimeType,
        name: current.name.trim() ? current.name : toFileBaseName(selectedFile.name),
        storedName: uploadResult.storedName,
        imageUrl: uploadResult.url,
      }));
      setError('');
    } catch (replaceError) {
      setError(replaceError instanceof Error ? replaceError.message : 'Unable to replace file');
    } finally {
      setReplacingImageId(null);
      event.target.value = '';
    }
  }

  async function saveCampaignDraft() {
    if (campaignId && !hasUnsavedChanges) return campaignId;

    setSavingCampaign(true);
    setError('');
    try {
      if (!campaignId) {
        const response = await createCampaign({ values });
        applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
        lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
        await setStoredCampaignId(response.campaign.id);
        return response.campaign.id;
      }

      const response = await updateStoredCampaign(campaignId, { values });
      setCampaignStatus(response.campaign.status);
      setUploadedPurchaseOrderName(response.campaign.purchaseOrder?.originalName || '');
      lastPersistedValuesRef.current = JSON.stringify(response.campaign.values);
      return campaignId;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save campaign draft');
      return null;
    } finally {
      setSavingCampaign(false);
    }
  }

  useEffect(() => {
    if (loadingCampaign || savingCampaign || !hasUnsavedChanges) return;

    const timeoutId = window.setTimeout(() => {
      void saveCampaignDraft();
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [campaignId, hasUnsavedChanges, loadingCampaign, savingCampaign, values]);

  async function handleBackToDashboard() {
    if (!onBack) return;
    if (!hasUnsavedChanges) {
      onBack();
      return;
    }
    setUnsavedDialogOpen(true);
  }

  async function handleSaveAndLeave() {
    const savedCampaignId = await saveCampaignDraft();
    if (!savedCampaignId) return;
    setUnsavedDialogOpen(false);
    onBack?.();
  }

  function handleDiscardAndLeave() {
    setUnsavedDialogOpen(false);
    onBack?.();
  }

  async function handleSubmitQuote() {
    setSubmitting(true);
    setError('');
    setQuoteResponseMessage('');

    try {
      const savedCampaignId = await saveCampaignDraft();
      if (!savedCampaignId) return;
      const response = await submitCampaignToPrintIQ(savedCampaignId);
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

    setUploadingPurchaseOrder(true);
    setError('');
    try {
      const savedCampaignId = await saveCampaignDraft();
      if (!savedCampaignId) return;
      const response = await uploadPurchaseOrderFile(selectedPurchaseOrderFile, savedCampaignId);
      setUploadedPurchaseOrderName(response.originalName);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload purchase order');
    } finally {
      setUploadingPurchaseOrder(false);
    }
  }

  function calculateMarketShippingCost(marketName: string) {
    const perBoxPrice = shippingRateByMarket.get(marketName) ?? 0;
    const postersPerBox = postersPerBoxByMarket.get(marketName) ?? 60;
    const marketLines = summary?.lines.filter((line) => line.market === marketName) ?? [];
    return marketLines.reduce((total, line) => {
      const units = totalUnitsForBreakdown(line.breakdown);
      return total + calculateShippingCost(units, perBoxPrice, postersPerBox);
    }, 0);
  }

  async function reviewTotals() {
    if (!summary) {
      setError('No totals yet');
      return;
    }
    setError('');
    setStepIndex(2);
  }

  async function downloadArtworkWordDocument() {
    if (!hasUploadedPurchaseOrder) {
      setError('Upload a purchase order file before downloading visuals');
      return;
    }

    const defaultDeliveryAddressByMarket = new Map<string, string>();
    marketDeliveryAddresses.forEach((entry) => {
      if (entry.isDefault) {
        defaultDeliveryAddressByMarket.set(entry.market, entry.deliveryAddress);
        return;
      }
      if (!defaultDeliveryAddressByMarket.has(entry.market)) {
        defaultDeliveryAddressByMarket.set(entry.market, entry.deliveryAddress);
      }
    });
    const lineByAssetId = new Map((summary?.lines ?? []).map((line) => [line.id, line]));
    const posterDivisors: Record<string, number> = {
      '8-sheet': 4,
      '6-sheet': 3,
      '4-sheet': 2,
      '2-sheet': 1,
      QA0: 4,
      Mega: 1,
      'DOT M': 1,
      MP: 1,
    };
    const posterLabels: Record<string, string> = {
      '8-sheet': 'posters',
      '6-sheet': 'posters',
      '4-sheet': 'posters',
      '2-sheet': 'posters',
      QA0: 'A0 sized posters',
      Mega: 'Mega',
      'DOT M': 'DOT Mega',
      MP: 'Mega Portrait',
    };

    function emptyBreakdown(): QuantityBreakdown {
      return { '8-sheet': 0, '6-sheet': 0, '4-sheet': 0, '2-sheet': 0, QA0: 0, Mega: 0, 'DOT M': 0, MP: 0 };
    }

    function addBreakdown(target: QuantityBreakdown, source: QuantityBreakdown) {
      formatKeys.forEach((key) => {
        target[key] += source[key] || 0;
      });
    }

    function breakdownToEmailText(breakdown: QuantityBreakdown) {
      const parts: string[] = [];
      formatKeys.forEach((key) => {
        const qty = breakdown[key];
        if (!qty) return;
        if (key === 'Mega' || key === 'DOT M' || key === 'MP') {
          parts.push(`${qty} x ${posterLabels[key]}`);
          return;
        }
        const sheetRuns = qty / posterDivisors[key];
        parts.push(`${qty} ${posterLabels[key]} (${sheetRuns} x ${key})`);
      });
      return parts.join(' & ');
    }

    function creativeTypeLabel(breakdown: QuantityBreakdown) {
      if (breakdown.MP > 0) return 'Mega Portrait';
      if (breakdown.Mega > 0 || breakdown['DOT M'] > 0) return 'Mega';
      if (breakdown['8-sheet'] > 0) return '8 sheet';
      if (breakdown['6-sheet'] > 0) return '6 sheet';
      if (breakdown['4-sheet'] > 0) return '4 sheet';
      if (breakdown['2-sheet'] > 0) return '2 sheet';
      if (breakdown.QA0 > 0) return 'QA0';
      return 'Artwork';
    }

    const creativeBreakdowns = new Map<string, QuantityBreakdown>();
    const creativeBreakdownsByMarket = new Map<string, Map<string, QuantityBreakdown>>();

    values.campaignMarkets.forEach((market) => {
      market.assets.forEach((asset) => {
        if (!asset.creativeImageId) return;
        const line = lineByAssetId.get(asset.id);
        if (!line) return;

        const totalBucket = creativeBreakdowns.get(asset.creativeImageId) ?? emptyBreakdown();
        addBreakdown(totalBucket, line.breakdown);
        creativeBreakdowns.set(asset.creativeImageId, totalBucket);

        const marketMap = creativeBreakdownsByMarket.get(market.market) ?? new Map<string, QuantityBreakdown>();
        const marketBucket = marketMap.get(asset.creativeImageId) ?? emptyBreakdown();
        addBreakdown(marketBucket, line.breakdown);
        marketMap.set(asset.creativeImageId, marketBucket);
        creativeBreakdownsByMarket.set(market.market, marketMap);
      });
    });

    const mappedCreatives = values.printImages
      .map((image, index) => {
        const breakdown = creativeBreakdowns.get(image.id);
        if (!breakdown) return null;
        const quantitiesText = breakdownToEmailText(breakdown);
        if (!quantitiesText) return null;
        return { image, creativeNumber: index + 1, breakdown, quantitiesText };
      })
      .filter((entry): entry is { image: (typeof values.printImages)[number]; creativeNumber: number; breakdown: QuantityBreakdown; quantitiesText: string } => Boolean(entry));
    const creativeNumberByImageID = new Map(mappedCreatives.map((entry) => [entry.image.id, entry.creativeNumber]));

    const creativeCountText = mappedCreatives.length
      ? `${mappedCreatives.length} creatives attached`
      : 'No creatives attached';

    const postersToPrintLines = mappedCreatives
      .map((entry) => `Creative ${entry.creativeNumber} (${creativeTypeLabel(entry.breakdown)}): ${entry.quantitiesText}`)
      .join('<br/>');

    const creativeImageDataUrls = new Map<string, string>();
    await Promise.all(
      mappedCreatives.map(async (entry) => {
        const image = entry.image;
        const mimeType = image.mimeType.toLowerCase();
        const isPdf = mimeType === 'application/pdf' || image.fileName.toLowerCase().endsWith('.pdf');
        const isImage = mimeType.startsWith('image/');
        if (!image.imageUrl || (!isImage && !isPdf)) {
          return;
        }
        try {
          const response = await fetch(toAbsoluteUrl(buildApiUrl(image.imageUrl)));
          if (!response.ok) return;
          const blob = await response.blob();
          const dataUrl = isPdf ? await pdfFirstPageToDataUrl(blob, 420) : await blobToDataUrl(blob);
          if (dataUrl) creativeImageDataUrls.set(image.id, dataUrl);
        } catch {
          // Skip image embedding when image fetch fails.
        }
      }),
    );

    const artworkNameLines = mappedCreatives
      .map((entry) => {
        const image = entry.image;
        const index = entry.creativeNumber;
        const embedded = creativeImageDataUrls.get(image.id);
        const artworkUrl = image.imageUrl ? toAbsoluteUrl(buildApiUrl(image.imageUrl)) : '';
        const linkLine = artworkUrl
          ? `<br/><a href="${escapeHtml(artworkUrl)}" style="color:#1d4ed8;text-decoration:underline;">Open artwork file (${escapeHtml(image.fileName || image.name)})</a>`
          : '<br/><span style="color:#6b7280;">Artwork file link unavailable</span>';
        return `Creative ${index}: ${escapeHtml(image.name)}${
          embedded ? `<br/><img src="${embedded}" alt="${escapeHtml(image.name)}" style="max-width:560px;max-height:320px;border:1px solid #d1d5db;margin:6px 0 12px 0;display:block;" />` : ''
        }${linkLine}<br/>`;
      })
      .join('<br/>');

    type parsedDeliveryAddress = {
      recipient: string;
      street: string;
      locality: string;
      country: string;
      phone: string;
      deliveryTime: string;
      deliveryPoint: string;
      notes: string;
    };
    function parseDeliveryAddress(rawAddress: string): parsedDeliveryAddress {
      const lines = rawAddress
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const firstLine = lines[0] || '';
      const street = lines[1] || '';
      const locality = lines[2] || '';
      const phoneLine = lines.find((line) => /^phone\s*[:\-–]/i.test(line)) || '';
      const deliveryTimeLine = lines.find((line) => /^delivery time\s*[:\-–]/i.test(line)) || '';
      const deliveryPointLine = lines.find((line) => /^delivery point\s*[:\-–]/i.test(line)) || '';
      const notesLine = lines.find((line) => /^notes?\s*[:\-–]/i.test(line)) || '';
      const country = lines.find((line) => !line.includes(':') && line.toLowerCase() === 'australia') || '';
      const recipientWithPhoneMatch = firstLine.match(/^(.+?)\s*[-–]\s*(.+)$/);
      const recipient = recipientWithPhoneMatch ? recipientWithPhoneMatch[1].trim() : firstLine;
      const phoneFromRecipient = recipientWithPhoneMatch ? recipientWithPhoneMatch[2].trim() : '';

      function extractLabeledValue(value: string) {
        return value.replace(/^[^:\-–]+[:\-–]\s*/i, '').trim();
      }

      return {
        recipient,
        street,
        locality,
        country,
        phone: phoneLine ? extractLabeledValue(phoneLine) : phoneFromRecipient,
        deliveryTime: deliveryTimeLine ? extractLabeledValue(deliveryTimeLine) : '',
        deliveryPoint: deliveryPointLine ? extractLabeledValue(deliveryPointLine) : '',
        notes: notesLine ? extractLabeledValue(notesLine) : '',
      };
    }

    function addressCore(rawAddress: string) {
      const parsed = parseDeliveryAddress(rawAddress);
      return [parsed.recipient, parsed.street, parsed.locality]
        .map((value) => value.trim().toLowerCase())
        .join('|');
    }

    const deliveryDeadline = formatDeliveryDeadline(values.dueDate);
    const deliveriesByAddress = new Map<string, { parsed: parsedDeliveryAddress; lines: string[] }>();

    values.campaignMarkets.forEach((market) => {
      const marketAddressRecords = marketDeliveryAddresses
        .filter((entry) => entry.market === market.market)
        .map((entry) => entry.deliveryAddress);

      market.assets.forEach((asset) => {
        const line = lineByAssetId.get(asset.id);
        if (!line) return;
        const quantitiesText = breakdownToEmailText(line.breakdown);
        if (!quantitiesText) return;

        const selectedOrDefaultAddress = asset.deliveryAddress || defaultDeliveryAddressByMarket.get(market.market) || '';
        if (!selectedOrDefaultAddress) return;
        const canonicalAddress =
          marketAddressRecords.find((entry) => addressCore(entry) === addressCore(selectedOrDefaultAddress)) || selectedOrDefaultAddress;
        const resolvedAddress = canonicalAddress;
        if (!resolvedAddress) return;

        const creativeNumber = asset.creativeImageId ? creativeNumberByImageID.get(asset.creativeImageId) : undefined;
        const assetLabel = asset.assetSearch || asset.assetId || 'Asset';
        const creativeLabel = creativeNumber ? `Creative ${creativeNumber} (${assetLabel})` : `${assetLabel} (${creativeTypeLabel(line.breakdown)})`;
        const deliveryLine = `${escapeHtml(creativeLabel)}: ${quantitiesText}`;

        const existing = deliveriesByAddress.get(resolvedAddress);
        if (existing) {
          existing.lines.push(deliveryLine);
          return;
        }

        deliveriesByAddress.set(resolvedAddress, {
          parsed: parseDeliveryAddress(resolvedAddress),
          lines: [deliveryLine],
        });
      });
    });

    const deliveryGroups = Array.from(deliveriesByAddress.entries()).map(([rawAddress, group]) => {
      const recipient = group.parsed.recipient || rawAddress;
      return {
        rawAddress,
        recipient,
        parsed: group.parsed,
        lines: group.lines,
      };
    });

    const deliverySection = deliveryGroups
      .map((group) => `
          <p><strong>Please deliver to ${escapeHtml(group.recipient)} by ${escapeHtml(deliveryDeadline)} by COB:</strong><br/><br/>
          ${group.lines.join('<br/>')}</p>
        `)
      .join('');

    const deliveryNotesSection = deliveryGroups
      .map((group) => {
        const recipientLine = group.parsed.recipient
          ? `${escapeHtml(group.parsed.recipient)}${group.parsed.phone ? ` - ${escapeHtml(group.parsed.phone)}` : ''}`
          : group.parsed.phone
            ? escapeHtml(group.parsed.phone)
            : '';
        const addressLine = [group.parsed.street, group.parsed.locality].filter(Boolean).join(', ');

        if (!recipientLine && !addressLine && !group.parsed.deliveryTime && !group.parsed.deliveryPoint && !group.parsed.notes) {
          return '';
        }

        const noteLines: string[] = [];
        if (recipientLine) noteLines.push(recipientLine);
        if (addressLine) noteLines.push(`Deliver address &ndash; ${escapeHtml(addressLine)}`);
        if (group.parsed.deliveryTime) noteLines.push(`Delivery time &ndash; ${escapeHtml(group.parsed.deliveryTime)}`);
        if (group.parsed.deliveryPoint) noteLines.push(`Delivery point &ndash; ${escapeHtml(group.parsed.deliveryPoint)}`);
        if (group.parsed.notes) noteLines.push(escapeHtml(group.parsed.notes));

        return `<p><strong>Please note:</strong><br/>${noteLines.join('<br/>')}</p>`;
      })
      .filter(Boolean)
      .join('');

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Artwork Brief</title>
</head>
<body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111827;">
  <p><strong>Creative -</strong> ${escapeHtml(creativeCountText)}</p>

  <p><strong>No. of posters to print -</strong><br/>
  ${postersToPrintLines || 'No creative quantities linked yet.'}</p>

  <p>${artworkNameLines || 'No artwork names available.'}</p>

  <p><strong>Delivery -</strong></p>
  ${deliverySection || '<p>No delivery details available.</p>'}
  ${deliveryNotesSection}
</body>
</html>`;

    const blob = new Blob([html], { type: 'application/msword' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const baseName = (values.campaignName || 'Campaign').trim() || 'Campaign';
    anchor.href = url;
    anchor.download = `${baseName} Creatives.doc`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }

  function openPurchaseOrderPicker() {
    purchaseOrderInputRef.current?.click();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
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
                <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">ADS CONNECT</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Build campaign schedules, review calculated totals, and create PrintIQ-ready quotes with a cleaner browser-first workflow.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
                  {loadingCampaign ? 'Loading draft' : savingCampaign ? 'Auto-saving' : hasUnsavedChanges ? 'Unsaved changes' : `All changes saved · ${campaignStatus.replace('_', ' ')}`}
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
                  <Button disabled={savingCampaign} onClick={() => void handleBackToDashboard()} size="sm" variant="ghost">
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
            <div className="grid gap-2 sm:grid-cols-4">
              {steps.map((step, index) => {
                const active = index === stepIndex;
                return (
                  <button
                    key={step.key}
                    className={cn('rounded-2xl border px-4 py-2.5 text-left text-sm font-semibold transition', active ? 'border-violet-400 bg-violet-500/10 text-white' : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-slate-500')}
                    onClick={() => navigateToStep(index)}
                    type="button"
                  >
                    <span className="block text-base leading-tight">{step.title}</span>
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

      <div className="grid gap-6">
        <section className="space-y-6">
          {currentStep.key === 'creative' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Campaign Setup</CardTitle>
                <CardDescription>Set campaign details and upload one or more campaign artworks before planning markets.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(320px,1.4fr)_220px_220px_160px]">
                  <TextField id="campaign-name" label="Campaign Name" value={values.campaignName} onChange={(value) => updateField('campaignName', value)} />
                  <div className="space-y-2">
                    <Label htmlFor="campaign-start">Campaign start date</Label>
                    <Input
                      className="pr-1 [&::-webkit-calendar-picker-indicator]:-mr-0.5 [&::-webkit-calendar-picker-indicator]:ml-auto"
                      id="campaign-start"
                      type="date"
                      value={values.campaignStartDate}
                      onChange={(event) => updateField('campaignStartDate', event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="due-date">Delivery Due Date</Label>
                    <Input
                      className="pr-1 [&::-webkit-calendar-picker-indicator]:-mr-0.5 [&::-webkit-calendar-picker-indicator]:ml-auto"
                      id="due-date"
                      type="date"
                      value={values.dueDate}
                      onChange={(event) => updateField('dueDate', event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="week-count">Number of weeks</Label>
                    <div className="flex h-11 overflow-hidden rounded-xl border border-slate-600 bg-slate-800">
                      <Input
                        className="h-11 rounded-none border-0 pr-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        id="week-count"
                        inputMode="numeric"
                        min={1}
                        onChange={(event) => {
                          const rawValue = event.target.value.trim();
                          const parsedValue = Number(rawValue);
                          updateWeekCount(Number.isFinite(parsedValue) ? parsedValue : 1);
                        }}
                        type="number"
                        value={numberOfWeeks}
                      />
                      <div className="flex h-11 w-10 flex-col border-l border-slate-600">
                        <Button
                          className="h-[22px] w-10 rounded-none border-b border-slate-600 px-0"
                          onClick={() => updateWeekCount(numberOfWeeks + 1)}
                          type="button"
                          variant="ghost"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          className="h-[22px] w-10 rounded-none px-0"
                          disabled={numberOfWeeks <= 1}
                          onClick={() => updateWeekCount(numberOfWeeks - 1)}
                          type="button"
                          variant="ghost"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                {!canAdvanceFromCreative ? (
                  <p className="text-sm font-medium text-amber-200">Campaign start date and Delivery Due Date are required before continuing.</p>
                ) : null}

                <div className="space-y-4 rounded-[24px] border border-slate-700 bg-slate-900/50 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-base font-semibold text-white">Campaign Artworks</p>
                      <p className="text-sm text-slate-400">Upload one or multiple files. You can edit the name, replace the file, or remove rows.</p>
                    </div>
                    <Button onClick={handlePickPrintImages} type="button" variant="secondary">
                      <Upload className="h-4 w-4" />
                      Upload Artworks
                    </Button>
                  </div>
                  <input
                    ref={imageUploadInputRef}
                    className="hidden"
                    multiple
                    onChange={(event) => void handlePrintImageSelection(event)}
                    type="file"
                  />
                  <input ref={replaceImageInputRef} className="hidden" onChange={(event) => void handleReplacePrintImage(event)} type="file" />

                  {values.printImages.length > 0 ? (
                    <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/70">
                      <table className="min-w-[860px] w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                            <th className="border border-slate-700 px-4 py-3 text-left">Preview</th>
                            <th className="border border-slate-700 px-4 py-3 text-left">Name</th>
                            <th className="border border-slate-700 px-4 py-3 text-left">File</th>
                            <th className="border border-slate-700 px-4 py-3 text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {values.printImages.map((image) => (
                            <tr key={image.id} className="border-t border-slate-700/70 bg-slate-800/60">
                              <td className="border border-slate-700 px-4 py-3">
                                <div className="h-14 w-20 overflow-hidden rounded-lg border border-slate-600 bg-slate-900">
                                  {image.imageUrl &&
                                  (image.mimeType.toLowerCase().startsWith('image/') ||
                                    image.mimeType.toLowerCase() === 'application/pdf' ||
                                    image.fileName.toLowerCase().endsWith('.pdf')) ? (
                                    image.mimeType.toLowerCase().startsWith('image/') ? (
                                    <img alt={image.name} className="h-full w-full object-cover" src={buildApiUrl(image.imageUrl)} />
                                    ) : (
                                      <iframe
                                        className="h-full w-full bg-white"
                                        src={`${buildApiUrl(image.imageUrl)}#toolbar=0&navpanes=0&scrollbar=0`}
                                        title={`${image.name} preview`}
                                      />
                                    )
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                      File
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="border border-slate-700 px-4 py-3">
                                <Input value={image.name} onChange={(event) => updatePrintImage(image.id, (current) => ({ ...current, name: event.target.value }))} />
                              </td>
                              <td className="border border-slate-700 px-4 py-3 text-slate-200">{image.fileName}</td>
                              <td className="border border-slate-700 px-4 py-3">
                                <div className="flex items-center justify-center gap-1">
                                  <Button className="h-8 w-8" onClick={() => beginReplacePrintImage(image.id)} size="icon" type="button" variant="ghost">
                                    <Pencil className="h-4 w-4 text-slate-200" />
                                  </Button>
                                  <Button className="h-8 w-8" onClick={() => removePrintImage(image.id)} size="icon" type="button" variant="ghost">
                                    <Trash2 className="h-4 w-4 text-rose-300" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-6 text-center text-sm text-slate-400">
                      No artworks uploaded yet.
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button disabled={!canAdvanceFromCreative} onClick={() => navigateToStep(1)} type="button">
                    Continue To Schedule
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {currentStep.key === 'schedule' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Market Planning</CardTitle>
                <CardDescription>Select markets and assets, then let quantity mappings update totals automatically.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
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
                    const marketSummary = marketSummaryByName.get(market.market);
                    const visibleMarketFormatKeys = marketSummary
                      ? formatKeys.filter((key) => (marketSummary.breakdown[key] ?? 0) > 0)
                      : formatKeys;
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
                                            updateCampaignMarket(market.id, (current) => {
                                              const preferredAddress = preferredDeliveryAddressByMarket.get(value) || '';
                                              return {
                                                ...current,
                                                market: value,
                                                assets: current.assets.map((asset) => ({
                                                  ...asset,
                                                  assetId: '',
                                                  assetSearch: '',
                                                  deliveryAddress: preferredAddress,
                                                  selectedWeeks: createAllWeeks(numberOfWeeks),
                                                })),
                                              };
                                            })
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
                            <p className="text-xs text-slate-400">Attach the assets you want to run in this market. All campaign weeks are selected automatically.</p>
                          </div>
                          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/45 lg:overflow-visible">
                            <div className="overflow-x-auto lg:overflow-visible">
                              <table className="min-w-[780px] w-full border-collapse">
                              <colgroup>
                                <col />
                                <col className="w-[1%]" />
                                <col className="w-[24px]" />
                              </colgroup>
                              <thead>
                                <tr className="border-b border-slate-700/80 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                  <th className="px-4 py-3 text-left">Asset</th>
                                  <th className="px-4 py-3 text-left">Active Weeks</th>
                                  <th className="px-3 py-3 text-center">
                                    <span className="sr-only">Actions</span>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {market.assets.map((asset) => {
                                  const canRemoveAsset = market.assets.length > 1;
                                  const availableAssetOptions = assetOptionsFor(market, asset.id, asset.assetId);
                                  return (
                                    <tr key={asset.id} className="border-b border-slate-700/70 align-top last:border-b-0">
                                      <td className="px-4 py-3">
                                        <SearchableSelect
                                          emptyMessage={availableAssets.length ? 'No assets available for this row.' : 'No assets available for this market.'}
                                          items={availableAssetOptions}
                                          label=""
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
                                      </td>
                                      <td className="px-2 py-3">
                                        <div className="flex justify-end">
                                          <WeekSelector
                                            compact
                                            weekCount={numberOfWeeks}
                                            startDate={values.campaignStartDate}
                                            onToggleWeek={(week) => toggleCampaignAssetWeek(market.id, asset.id, week)}
                                            selectedWeeks={asset.selectedWeeks}
                                          />
                                        </div>
                                      </td>
                                      <td className="px-1 py-3 text-center">
                                        {canRemoveAsset ? (
                                          <Button className="h-7 w-7" onClick={() => removeCampaignAsset(market.id, asset.id)} size="icon" type="button" variant="ghost">
                                            <X className="h-3.5 w-3.5 text-rose-300" />
                                          </Button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              </table>
                            </div>
                          </div>

                          <div title={canAddAssetForMarket(market) ? 'Add another asset' : addAssetDisabledReasonForMarket(market)}>
                            <Button disabled={!canAddAssetForMarket(market)} onClick={() => addCampaignAsset(market.id)} type="button" variant="outline">
                              <Plus className="h-4 w-4" />
                              Add Asset
                            </Button>
                          </div>

                          {marketSummary ? (
                            <div className="space-y-3">
                              <p className="text-sm font-semibold text-white">Market Totals</p>
                              <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-slate-900/65">
                                <table className="min-w-[860px] w-full border-collapse text-sm">
                                  <thead>
                                    <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                                      <th className="border border-slate-700 px-4 py-3 text-left">Type</th>
                                      {visibleMarketFormatKeys.map((key) => (
                                        <th key={`schedule-market-head-${market.id}-${key}`} className="border border-slate-700 px-4 py-3 text-center">{formatKeyLabel(key)}</th>
                                      ))}
                                      <th className="border border-slate-700 px-4 py-3 text-center">Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {buildReviewRows(marketSummary).map((row) => (
                                      <tr key={`schedule-market-row-${market.id}-${row.label}`} className="bg-slate-800/70 border-t border-slate-700/70">
                                        <th className="border border-slate-700 px-4 py-3 text-left font-semibold text-slate-100">{row.label}</th>
                                        {visibleMarketFormatKeys.map((key) => (
                                          <td key={`schedule-market-cell-${market.id}-${row.label}-${key}`} className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">
                                            {row.breakdown[key]}
                                          </td>
                                        ))}
                                        <td className="border border-slate-700 px-4 py-3 text-center font-black text-white">{row.total}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-violet-500/10 border-t border-violet-400/30">
                                      <th colSpan={visibleMarketFormatKeys.length + 1} className="border border-violet-300/30 px-4 py-3 text-right font-black uppercase tracking-[0.12em] text-violet-100">
                                        Total
                                      </th>
                                      <td className="border border-violet-300/30 px-4 py-3 text-center font-black text-violet-100">
                                        {marketSummary.posterTotal + marketSummary.frameTotal}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm leading-6 text-slate-400">Configure assets in this market to see its sheet-level mix and totals here.</p>
                          )}
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
                    <div className="overflow-x-auto rounded-[24px] border border-slate-700 bg-slate-900/70">
                      <table className="min-w-[1120px] w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                            <th className="border border-slate-700 px-4 py-3 text-left">Market</th>
                            <th className="border border-slate-700 px-4 py-3 text-left">Type</th>
                            {visibleReviewFormatKeys.map((key) => (
                              <th key={`review-head-${key}`} className="border border-slate-700 px-4 py-3 text-center">{formatKeyLabel(key)}</th>
                            ))}
                            <th className="border border-slate-700 px-4 py-3 text-center">Total</th>
                            <th className="border border-slate-700 px-4 py-3 text-center">Shipping Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleReviewMarkets.map((marketSummary) => {
                            const marketShippingCost = calculateMarketShippingCost(marketSummary.market);
                            const rows = buildReviewRows(marketSummary).map((row) =>
                              row.label === 'Posters'
                                ? { ...row, shippingCost: marketShippingCost }
                                : row,
                            );
                            return rows.map((row, rowIndex) => (
                              <tr key={`review-row-${marketSummary.market}-${row.label}`} className={cn('bg-slate-800/70', rowIndex > 0 ? 'border-t border-slate-700/70' : 'border-t-2 border-slate-600')}>
                                {rowIndex === 0 ? (
                                  <th rowSpan={rows.length} className="border border-slate-700 px-4 py-3 text-left text-base font-black text-white">
                                    {marketSummary.market}
                                  </th>
                                ) : null}
                                <th className="border border-slate-700 px-4 py-3 text-left font-semibold text-slate-100">{row.label}</th>
                                {visibleReviewFormatKeys.map((key) => (
                                  <td key={`review-cell-${marketSummary.market}-${row.label}-${key}`} className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">
                                    {row.breakdown[key]}
                                  </td>
                                ))}
                                <td className="border border-slate-700 px-4 py-3 text-center font-black text-white">{row.total}</td>
                                <td className="border border-slate-700 px-4 py-3 text-center font-black text-white">
                                  {row.shippingCost === null ? '—' : row.shippingCost.toFixed(2)}
                                </td>
                              </tr>
                            ));
                          })}

                          {(() => {
                            const grandPosterShippingCost = visibleReviewMarkets.reduce((total, marketSummary) => total + calculateMarketShippingCost(marketSummary.market), 0);
                            const grandRows = buildReviewRows(summary.grandTotal).map((row) =>
                              row.label === 'Posters' ? { ...row, shippingCost: grandPosterShippingCost } : row,
                            );

                            return grandRows.map((row, rowIndex, allRows) => (
                              <tr key={`review-grand-${row.label}`} className={cn('bg-violet-500/10', rowIndex === 0 ? 'border-t-4 border-violet-400/40' : 'border-t border-violet-400/20')}>
                                {rowIndex === 0 ? (
                                  <th rowSpan={allRows.length} className="border border-violet-300/30 px-4 py-3 text-left text-base font-black text-violet-100">
                                    All Markets
                                  </th>
                                ) : null}
                                <th className="border border-violet-300/30 px-4 py-3 text-left font-semibold text-violet-100">{row.label}</th>
                                {visibleReviewFormatKeys.map((key) => (
                                  <td key={`review-grand-cell-${row.label}-${key}`} className="border border-violet-300/30 px-4 py-3 text-center font-semibold text-violet-100">
                                    {row.breakdown[key]}
                                  </td>
                                ))}
                                <td className="border border-violet-300/30 px-4 py-3 text-center font-black text-violet-100">{row.total}</td>
                                <td className="border border-violet-300/30 px-4 py-3 text-center font-black text-violet-100">
                                  {row.shippingCost === null ? '—' : row.shippingCost.toFixed(2)}
                                </td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-3">
                      <Button onClick={() => setStepIndex(3)} type="button">
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
                <CardTitle>Creative & Delivery Mapping</CardTitle>
                <CardDescription>Assign artworks and delivery addresses for each asset before exporting.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                {values.campaignMarkets.map((market) => {
                  const deliveryAddressOptions = deliveryAddressOptionsFor(market.market);
                  return (
                    <div key={`finalize-map-${market.id}`} className="space-y-3 rounded-2xl border border-slate-700 bg-slate-900/45 p-4">
                      <div>
                        <p className="text-sm font-semibold text-white">{market.market || 'Select a market in Schedule first'}</p>
                        <p className="text-xs text-slate-400">Map each asset to an artwork and delivery address.</p>
                      </div>
                      <div className="overflow-visible">
                        <table className="w-full border-collapse table-fixed">
                          <thead>
                            <tr className="border-b border-slate-700/80 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                              <th className="px-4 py-3 text-left">Asset</th>
                              <th className="px-4 py-3 text-left">Creative</th>
                              <th className="px-4 py-3 text-left">Delivery Address</th>
                            </tr>
                          </thead>
                          <tbody>
                            {market.assets.map((asset) => (
                              <tr key={`finalize-map-row-${asset.id}`} className="border-b border-slate-700/70 align-top last:border-b-0">
                                <td className="px-4 py-3">
                                  <p className="text-sm font-semibold text-white">{asset.assetSearch || asset.assetId || 'Asset not selected'}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <SearchableSelect
                                    emptyMessage={values.printImages.length ? 'No matching artworks found.' : 'No artworks uploaded in Creative step.'}
                                    items={creativeImageOptions}
                                    label=""
                                    onValueChange={(value) =>
                                      updateCampaignAsset(market.id, asset.id, (current) => ({
                                        ...current,
                                        creativeImageId: value,
                                      }))
                                    }
                                    placeholder={values.printImages.length ? 'Attach artwork' : 'No artworks available'}
                                    selectedLabel={values.printImages.find((image) => image.id === asset.creativeImageId)?.name}
                                    selectedValue={asset.creativeImageId || ''}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <SearchableSelect
                                    actionDisabled={!market.market}
                                    actionLabel={canAddAddressInFinalize ? 'Add new address' : undefined}
                                    emptyMessage={deliveryAddressOptions.length ? 'No matching addresses found.' : 'No addresses saved for this market yet.'}
                                    items={deliveryAddressOptions}
                                    label=""
                                    onAction={() => openAddAddressDialog(market.id, asset.id, market.market)}
                                    onValueChange={(value) =>
                                      updateCampaignAsset(market.id, asset.id, (current) => ({
                                        ...current,
                                        deliveryAddress: value,
                                      }))
                                    }
                                    placeholder={deliveryAddressOptions.length ? 'Choose delivery address' : 'No addresses available'}
                                    selectedLabel={asset.deliveryAddress || ''}
                                    selectedValue={asset.deliveryAddress || ''}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {currentStep.key === 'finalize' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Purchase Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 p-6">
                <div className="space-y-3">
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
              </CardContent>
            </Card>
          ) : null}

          {currentStep.key === 'finalize' ? (
            <Card>
              <CardHeader className="p-6 pb-0">
                <CardTitle>Export For ADS</CardTitle>
                <CardDescription>Export the details to send to ADS.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-6 sm:flex-row">
                <Button disabled={!hasMappedCreatives || !hasUploadedPurchaseOrder} onClick={() => void downloadArtworkWordDocument()} type="button" variant="outline">
                  Download Visuals
                </Button>
                <div className="cursor-not-allowed" title={hasUploadedPurchaseOrder ? 'Under construction' : 'Upload purchase order before sending to ADS'}>
                  <Button className="border-slate-700 bg-slate-900/45 text-slate-500 hover:border-slate-700 hover:bg-slate-900/45 hover:text-slate-500 disabled:opacity-100" disabled type="button" variant="secondary">
                    Send Email To ADS
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {currentStep.key === 'finalize' ? (
            <Card>
              <CardContent className="space-y-6 p-6">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    className="border-slate-700 bg-slate-900/45 text-slate-500 hover:border-slate-700 hover:bg-slate-900/45 hover:text-slate-500 disabled:opacity-100"
                    disabled
                    type="button"
                    variant="secondary"
                  >
                    Create Quote In PrintIQ (Coming Soon)
                  </Button>
                  {onBack ? (
                    <Button disabled={savingCampaign || submitting} onClick={() => void handleBackToDashboard()} type="button" variant="outline">
                      Go To Dashboard
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </section>

      </div>

      <Dialog
        open={newAddressDialogOpen}
        onOpenChange={(open) => {
          setNewAddressDialogOpen(open);
          if (!open) {
            setNewAddressTarget(null);
            setNewAddressForm(emptyAddressForm());
            setNewAddressError('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Delivery Address</DialogTitle>
            <DialogDescription>
              Add a new delivery address for {newAddressTarget?.marketName || 'this market'}. This option is available to admin users only.
            </DialogDescription>
          </DialogHeader>
          {newAddressError ? (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
              {newAddressError}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="addr-name">Name</Label>
              <Input id="addr-name" value={newAddressForm.name} onChange={(event) => setNewAddressForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-unit-street-number">Unit/Street Number</Label>
              <Input
                id="addr-unit-street-number"
                value={newAddressForm.unitStreetNumber}
                onChange={(event) => setNewAddressForm((current) => ({ ...current, unitStreetNumber: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-suburb">Suburb</Label>
              <Input id="addr-suburb" value={newAddressForm.suburb} onChange={(event) => setNewAddressForm((current) => ({ ...current, suburb: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-state">State</Label>
              <Input id="addr-state" value={newAddressForm.state} onChange={(event) => setNewAddressForm((current) => ({ ...current, state: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-postcode">Postcode</Label>
              <Input id="addr-postcode" value={newAddressForm.postcode} onChange={(event) => setNewAddressForm((current) => ({ ...current, postcode: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-phone-number">Phone Number</Label>
              <Input id="addr-phone-number" value={newAddressForm.phoneNumber} onChange={(event) => setNewAddressForm((current) => ({ ...current, phoneNumber: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-delivery-time">Delivery Time</Label>
              <Input id="addr-delivery-time" value={newAddressForm.deliveryTime} onChange={(event) => setNewAddressForm((current) => ({ ...current, deliveryTime: event.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="addr-delivery-point">Delivery Point</Label>
              <Input id="addr-delivery-point" value={newAddressForm.deliveryPoint} onChange={(event) => setNewAddressForm((current) => ({ ...current, deliveryPoint: event.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="addr-delivery-notes">Delivery Notes</Label>
              <Textarea id="addr-delivery-notes" rows={4} value={newAddressForm.deliveryNotes} onChange={(event) => setNewAddressForm((current) => ({ ...current, deliveryNotes: event.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              onClick={() => {
                setNewAddressDialogOpen(false);
                setNewAddressTarget(null);
                setNewAddressForm(emptyAddressForm());
                setNewAddressError('');
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button onClick={handleSaveNewAddress} type="button">
              Save Address
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unsavedDialogOpen}
        onOpenChange={(open) => {
          if (open) setUnsavedDialogOpen(true);
        }}
      >
        <DialogContent
          className="[&>button]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Save before going to dashboard, or discard and continue.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button disabled={savingCampaign} onClick={handleDiscardAndLeave} type="button" variant="ghost">
              Discard
            </Button>
            <Button disabled={savingCampaign} onClick={() => void handleSaveAndLeave()} type="button">
              {savingCampaign ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {savingCampaign ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
