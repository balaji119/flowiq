import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { HoverablePressable as Pressable } from '../components/HoverablePressable';
import { createCampaignAsset, createCampaignMarket, createDefaultFormValues } from '../constants';
import { useAuth } from '../context/AuthContext';
import { calculateCampaign, fetchCalculatorMetadata } from '../services/calculatorApi';
import { fetchQuoteOptions, operationOptionToChoice, searchProcessOptions, searchStockOptions } from '../services/printiqOptionsApi';
import { uploadPurchaseOrderFile } from '../services/purchaseOrderApi';
import { submitQuoteForPricing } from '../services/quoteApi';
import { CampaignAsset, CampaignCalculationSummary, CampaignLine, CampaignMarket, MarketMetadata, OperationOption, OrderFormValues, PrintIqStockOption, QuantityBreakdown, formatKeys } from '../types';
import { buildDefaultJobDescription, buildPrintIqPayload } from '../utils/printiq';



const steps = [
  { key: 'schedule', title: 'Schedule' },
  { key: 'review', title: 'Review' },
  { key: 'finalize', title: 'Finalise' },
] as const;

const QUOTE_BUILDER_DRAFT_KEY = 'adsconnect-quote-builder-draft';
const COLORS = {
  page: '#313B4D',
  card: '#242B36',
  cardStrong: '#1C1F26',
  panel: '#232733',
  input: '#38455B',
  inputBorder: '#4F5C73',
  cardBorder: '#3F4A5F',
  panelBorder: '#4B556A',
  sectionBorder: '#46526A',
  progressTrack: '#5C6B84',
  step: '#56647C',
  stepBorder: '#697892',
  stepActive: '#2A3548',
  textMuted: '#A7B0C0',
  textSoft: '#C3CBD8',
  textPlaceholder: '#6F7E93',
  textDim: '#8894A7',
  accent: '#8B5CF6',
} as const;

const webDateInputStyle: CSSProperties = {
  borderRadius: 16,
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: COLORS.inputBorder,
  backgroundColor: COLORS.input,
  minHeight: '50px',
  padding: '0 14px',
  fontSize: 16,
  color: '#F0F0F0',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const liveSummaryPrimaryKeys = ['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'QA0', 'Mega', 'DOT M', 'MP'] as const;
const liveSummarySecondaryKeys = [
  { key: 'posters', label: 'Posters' },
  { key: 'frames', label: 'Frames' },
  { key: 'special', label: 'Special' },
  { key: 'quoteQty', label: 'Quote Qty' },
] as const;

function BreakdownTable({ breakdown, inverse = false }: { breakdown: QuantityBreakdown; inverse?: boolean }) {
  return (
    <View style={styles.breakdownTable}>
      {formatKeys.map((key) => (
        <View key={key} style={[styles.breakdownCell, inverse && styles.breakdownCellInverse]}>
          <Text style={[styles.breakdownLabel, inverse && styles.breakdownLabelInverse]}>{key}</Text>
          <Text style={[styles.breakdownValue, inverse && styles.breakdownValueInverse]}>{breakdown[key]}</Text>
        </View>
      ))}
    </View>
  );
}

function LiveSummarySection({
  items,
  highlightValues = false,
}: {
  items: ReadonlyArray<{ key: string; label: string; value: number | string }>;
  highlightValues?: boolean;
}) {
  return (
    <View style={styles.liveSummarySection}>
      <View style={styles.liveSummaryGrid}>
        {items.map((item) => (
          <View key={item.key} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{item.label}</Text>
            <Text style={[styles.metricValue, highlightValues && styles.metricValueHighlight]}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.inputMultiline]}
        placeholderTextColor="#6f7e93"
      />
    </View>
  );
}

async function setStoredDraft(value: string | null) {
  if (typeof window === 'undefined') {
    return;
  }

  if (value === null) {
    window.localStorage.removeItem(QUOTE_BUILDER_DRAFT_KEY);
  } else {
    window.localStorage.setItem(QUOTE_BUILDER_DRAFT_KEY, value);
  }
}

async function getStoredDraft() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(QUOTE_BUILDER_DRAFT_KEY);
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const webInputRef = useRef<HTMLInputElement | null>(null);

  function openWebDatePicker() {
    const input = webInputRef.current;
    if (!input) {
      return;
    }

    input.focus();
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    }
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {createElement('input', {
        ref: webInputRef,
        type: 'date',
        value,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        onClick: openWebDatePicker,
        onFocus: openWebDatePicker,
        style: {
          ...webDateInputStyle,
          color: value ? '#F0F0F0' : '#6f7e93',
        },
      })}
    </View>
  );
}

function PickerField({
  label,
  selectedValue,
  items,
  onValueChange,
  placeholder,
}: {
  label: string;
  selectedValue: string;
  items: Array<{ label: string; value: string }>;
  onValueChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const isSearchablePicker = !!label && ['asset', 'market'].includes(label.toLowerCase());
  const selectedLabel = items.find((item) => item.value === selectedValue)?.label || placeholder || 'Select';
  const sheetTitle = placeholder || (label ? `Choose a ${label.toLowerCase()}` : 'Choose an option');
  const filteredItems = useMemo(() => {
    if (!isSearchablePicker || !searchQuery.trim()) {
      return items;
    }

    const query = searchQuery.trim().toLowerCase();
    return items.filter((item) => item.label.toLowerCase().includes(query));
  }, [isSearchablePicker, items, searchQuery]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }

      if (event.key === 'Enter' && filteredItems.length > 0) {
        event.preventDefault();
        onValueChange(filteredItems[0].value);
        setOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, onValueChange, open]);

  const webPanelWidth = anchor ? Math.min(Math.max(anchor.width, 360), 520, width - 32) : Math.min(width - 32, 520);
  const webPanelLeft = anchor ? Math.max(16, Math.min(anchor.x, width - webPanelWidth - 16)) : 16;
  const spaceBelow = anchor ? height - (anchor.y + anchor.height) - 16 : height - 104;
  const spaceAbove = anchor ? anchor.y - 16 : 72;
  const openAbove = !!anchor && spaceBelow < 320 && spaceAbove > spaceBelow;
  const webPanelMaxHeight = Math.max(220, Math.min(420, openAbove ? spaceAbove - 8 : spaceBelow - 8));
  const webPanelTop = anchor && !openAbove ? anchor.y + anchor.height + 8 : 88;
  const webPanelBottom = anchor && openAbove ? Math.max(16, height - anchor.y + 8) : undefined;

  function openPicker() {
    if (triggerRef.current?.measureInWindow) {
      triggerRef.current.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
        setOpen(true);
      });
      return;
    }

    setOpen(true);
  }

  return (
    <View style={styles.field}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <Pressable ref={triggerRef} style={[styles.dropdownTrigger, open && styles.dropdownTriggerOpen]} onPress={openPicker}>
        <Text style={[styles.dropdownTriggerText, !selectedValue && styles.dropdownPlaceholder]} numberOfLines={1}>
          {selectedLabel}
        </Text>
        <Text style={styles.dropdownChevron}>{open ? '^' : 'v'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.dropdownOverlay, styles.dropdownOverlayWeb]} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.dropdownSurface,
              styles.dropdownSurfaceWeb,
              { width: webPanelWidth, left: webPanelLeft, top: openAbove ? undefined : webPanelTop, bottom: webPanelBottom, maxHeight: webPanelMaxHeight },
            ]}
            onPress={() => undefined}
          >
            <View style={styles.dropdownSheetHeader}>
              {!!label && <Text style={styles.dropdownSheetLabel}>{label}</Text>}
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.dropdownSheetClose}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.dropdownSheetValue}>{sheetTitle}</Text>
            {isSearchablePicker ? (
              <View style={styles.dropdownSearchWrap}>
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={`Search ${label.toLowerCase()}s`}
                  placeholderTextColor="#6f7e93"
                  style={styles.dropdownSearchInput}
                  autoFocus
                />
              </View>
            ) : null}
            <ScrollView nestedScrollEnabled style={styles.dropdownScroll}>
              {filteredItems.map((item, index) => {
                const active = item.value === selectedValue;
                return (
                  <Pressable
                    key={item.value || item.label}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive, index === filteredItems.length - 1 && styles.dropdownItemLast]}
                    onPress={() => {
                      onValueChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>{item.label}</Text>
                    {active ? <Text style={styles.dropdownItemCheck}>✓</Text> : null}
                  </Pressable>
                );
              })}
              {filteredItems.length === 0 ? (
                <View style={styles.dropdownEmptyState}>
                  <Text style={styles.dropdownEmptyText}>No matching assets</Text>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function AsyncPickerField({
  label,
  selectedValue,
  selectedLabel,
  placeholder,
  onValueChange,
  loadOptions,
}: {
  label: string;
  selectedValue: string;
  selectedLabel?: string;
  placeholder: string;
  onValueChange: (value: string) => void;
  loadOptions: (query: string) => Promise<Array<{ label: string; value: string; description?: string }>>;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [options, setOptions] = useState<Array<{ label: string; value: string; description?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<View>(null);
  const { width, height } = useWindowDimensions();
  const displayLabel = selectedLabel || selectedValue || placeholder;

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setOptions([]);
      setError('');
      return;
    }

    let active = true;
    const timeoutId = setTimeout(async () => {
      setLoading(true);
      setError('');

      try {
        const nextOptions = await loadOptions(searchQuery);
        if (active) {
          setOptions(nextOptions);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : `Unable to load ${label.toLowerCase()} options`);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [label, loadOptions, open, searchQuery]);

  const webPanelWidth = anchor ? Math.min(Math.max(anchor.width, 360), 520, width - 32) : Math.min(width - 32, 520);
  const webPanelLeft = anchor ? Math.max(16, Math.min(anchor.x, width - webPanelWidth - 16)) : 16;
  const spaceBelow = anchor ? height - (anchor.y + anchor.height) - 16 : height - 104;
  const spaceAbove = anchor ? anchor.y - 16 : 72;
  const openAbove = !!anchor && spaceBelow < 320 && spaceAbove > spaceBelow;
  const webPanelMaxHeight = Math.max(220, Math.min(420, openAbove ? spaceAbove - 8 : spaceBelow - 8));
  const webPanelTop = anchor && !openAbove ? anchor.y + anchor.height + 8 : 88;
  const webPanelBottom = anchor && openAbove ? Math.max(16, height - anchor.y + 8) : undefined;

  function openPicker() {
    if (triggerRef.current?.measureInWindow) {
      triggerRef.current.measureInWindow((x, y, measuredWidth, measuredHeight) => {
        setAnchor({ x, y, width: measuredWidth, height: measuredHeight });
        setOpen(true);
      });
      return;
    }

    setOpen(true);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable ref={triggerRef} style={[styles.dropdownTrigger, open && styles.dropdownTriggerOpen]} onPress={openPicker}>
        <Text style={[styles.dropdownTriggerText, !selectedValue && styles.dropdownPlaceholder]} numberOfLines={1}>
          {displayLabel}
        </Text>
        <Text style={styles.dropdownChevron}>{open ? '^' : 'v'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.dropdownOverlay, styles.dropdownOverlayWeb]} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.dropdownSurface,
              styles.dropdownSurfaceWeb,
              { width: webPanelWidth, left: webPanelLeft, top: openAbove ? undefined : webPanelTop, bottom: webPanelBottom, maxHeight: webPanelMaxHeight },
            ]}
            onPress={() => undefined}
          >
            <View style={styles.dropdownSheetHeader}>
              <Text style={styles.dropdownSheetLabel}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={styles.dropdownSheetClose}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.dropdownSheetValue}>{placeholder}</Text>
            <View style={styles.dropdownSearchWrap}>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={`Search ${label.toLowerCase()}s`}
                placeholderTextColor="#6f7e93"
                style={styles.dropdownSearchInput}
                autoFocus
              />
            </View>
            {loading ? (
              <View style={styles.dropdownEmptyState}>
                <ActivityIndicator color="#8B5CF6" />
              </View>
            ) : null}
            {error ? (
              <View style={styles.dropdownEmptyState}>
                <Text style={styles.dropdownEmptyText}>{error}</Text>
              </View>
            ) : null}
            <ScrollView nestedScrollEnabled style={styles.dropdownScroll}>
              {options.map((item, index) => {
                const active = item.value === selectedValue;
                return (
                  <Pressable
                    key={item.value}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive, index === options.length - 1 && styles.dropdownItemLast]}
                    onPress={() => {
                      onValueChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.dropdownOptionTextWrap}>
                      <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>{item.label}</Text>
                      {item.description ? <Text style={styles.dropdownItemHint}>{item.description}</Text> : null}
                    </View>
                    {active ? <Text style={styles.dropdownItemCheck}>✓</Text> : null}
                  </Pressable>
                );
              })}
              {!loading && !error && options.length === 0 ? (
                <View style={styles.dropdownEmptyState}>
                  <Text style={styles.dropdownEmptyText}>No matching options</Text>
                </View>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function ToggleList({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.toggleList}>
        {options.map((option) => {
          const enabled = selected.includes(option.id);
          return (
            <View key={option.id} style={styles.toggleRow}>
              <Text style={styles.toggleText}>{option.label}</Text>
              <Switch value={enabled} onValueChange={() => onToggle(option.id)} trackColor={{ false: '#333333', true: '#8B5CF6' }} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function WeekSelector({
  weekCount,
  selectedWeeks,
  onToggle,
}: {
  weekCount: number;
  selectedWeeks: number[];
  onToggle: (week: number) => void;
}) {
  return (
    <View style={styles.pillWrap}>
      {Array.from({ length: weekCount }, (_, index) => index + 1).map((week) => {
        const selected = selectedWeeks.includes(week);
        return (
          <Pressable
            key={week}
            onPress={() => onToggle(week)}
            style={[styles.pill, selected && styles.pillSelected]}
            // @ts-ignore
            title={`Week ${week}`}
          >
            <Text style={[styles.pillText, selected && styles.pillTextSelected]}>Week {week}</Text>
          </Pressable>
        );
      })}
    </View>
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

export function QuoteBuilderScreen({ onOpenAdmin }: { onOpenAdmin?: () => void }) {
  const { session, logout } = useAuth();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 1080;
  const [values, setValues] = useState<OrderFormValues>(() => createDefaultFormValues());
  const [draftReady, setDraftReady] = useState(false);
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [summary, setSummary] = useState<CampaignCalculationSummary | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteResponseMessage, setQuoteResponseMessage] = useState('');
  const [error, setError] = useState('');
  const [quantityManuallyEdited, setQuantityManuallyEdited] = useState(false);
  const [jobOperationOptions, setJobOperationOptions] = useState<OperationOption[]>([]);
  const [sectionOperationOptions, setSectionOperationOptions] = useState<OperationOption[]>([]);
  const [selectedStockOption, setSelectedStockOption] = useState<PrintIqStockOption | null>(null);
  const [selectedFrontProcessOption, setSelectedFrontProcessOption] = useState<{ label: string; value: string } | null>(null);
  const [selectedReverseProcessOption, setSelectedReverseProcessOption] = useState<{ label: string; value: string } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedPurchaseOrderFile, setSelectedPurchaseOrderFile] = useState<File | null>(null);
  const [uploadingPurchaseOrder, setUploadingPurchaseOrder] = useState(false);
  const [uploadedPurchaseOrderName, setUploadedPurchaseOrderName] = useState('');
  const purchaseOrderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;

    async function hydrateDraft() {
      try {
        const stored = await getStoredDraft();
        if (!stored || !active) {
          return;
        }

        const parsed = JSON.parse(stored) as {
          values?: Partial<OrderFormValues>;
          quantityManuallyEdited?: boolean;
        };
        const defaults = createDefaultFormValues();
        const nextValues = {
          ...defaults,
          ...parsed.values,
          contact: {
            ...defaults.contact,
            ...(parsed.values?.contact || {}),
          },
          campaignMarkets:
            Array.isArray(parsed.values?.campaignMarkets) && parsed.values.campaignMarkets.length > 0
              ? parsed.values.campaignMarkets
              : defaults.campaignMarkets,
          selectedJobOperations: Array.isArray(parsed.values?.selectedJobOperations) ? parsed.values.selectedJobOperations : defaults.selectedJobOperations,
          selectedSectionOperations: Array.isArray(parsed.values?.selectedSectionOperations)
            ? parsed.values.selectedSectionOperations
            : defaults.selectedSectionOperations,
        };

        setValues(nextValues);
        setQuantityManuallyEdited(Boolean(parsed.quantityManuallyEdited));
      } catch {
        await setStoredDraft(null);
      } finally {
        if (active) {
          setDraftReady(true);
        }
      }
    }

    hydrateDraft();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadMetadata() {
      try {
        const response = await fetchCalculatorMetadata();
        if (!active) {
          return;
        }
        setMarkets(response.markets);
      } catch (loadError) {
        if (!active) {
          return;
        }
        setMetadataError(loadError instanceof Error ? loadError.message : 'Unable to load campaign metadata');
      } finally {
        if (active) {
          setLoadingMetadata(false);
        }
      }
    }

    loadMetadata();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    let active = true;

    async function loadQuoteOptions() {
      try {
        const response = await fetchQuoteOptions();
        if (!active) {
          return;
        }

        setJobOperationOptions(response.jobOperations);
        setSectionOperationOptions(response.sectionOperations);
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
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load PrintIQ quote options');
      }
    }

    loadQuoteOptions();

    return () => {
      active = false;
    };
  }, [draftReady]);

  const payload = useMemo(() => buildPrintIqPayload(values, summary), [summary, values]);
  const activeMarketSummaries = useMemo(
    () => (summary ? summary.perMarket.filter((market) => market.activeAssets > 0 || market.activeRuns > 0 || market.totalUnits > 0) : []),
    [summary]
  );
  const numberOfWeeks = Math.max(1, Math.min(20, Number(values.numberOfWeeks) || 1));
  const currentStep = steps[stepIndex];
  const progressPercent = ((stepIndex + 1) / steps.length) * 100;

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    setValues((current) => {
      const normalizedMarkets = normalizeCampaignMarkets(current.campaignMarkets, numberOfWeeks);
      const flattenWeeks = (markets: CampaignMarket[]) => markets.flatMap(m => m.assets.flatMap(a => a.selectedWeeks)).join(',');
      const changed = flattenWeeks(normalizedMarkets) !== flattenWeeks(current.campaignMarkets);

      return changed
        ? {
          ...current,
          campaignMarkets: normalizedMarkets,
        }
        : current;
    });
  }, [draftReady, numberOfWeeks]);

  useEffect(() => {
    if (!draftReady || loadingMetadata || metadataError) {
      return;
    }

    let active = true;
    const timeoutId = setTimeout(async () => {
      try {
        setCalculating(true);
        const flatLines: CampaignLine[] = values.campaignMarkets.flatMap((market) =>
          market.assets.map((asset) => ({
            ...asset,
            market: market.market,
          }))
        );

        const result = await calculateCampaign(flatLines);
        if (!active) {
          return;
        }
        setSummary(result);
        if (!quantityManuallyEdited) {
          setValues((current) => ({
            ...current,
            quantity: String(result.grandTotal.totalUnits),
          }));
        }
        setError('');
      } catch (calculationError) {
        if (!active) {
          return;
        }
        setError(calculationError instanceof Error ? calculationError.message : 'Unable to calculate campaign');
      } finally {
        if (active) {
          setCalculating(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [draftReady, loadingMetadata, metadataError, quantityManuallyEdited, values.campaignMarkets]);

  useEffect(() => {
    if (!draftReady) {
      return;
    }

    void setStoredDraft(JSON.stringify({
      values,
      quantityManuallyEdited,
    }));
  }, [draftReady, quantityManuallyEdited, values]);

  function updateField<K extends keyof OrderFormValues>(field: K, value: OrderFormValues[K]) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateContactField(field: keyof OrderFormValues['contact'], value: string) {
    setValues((current) => ({
      ...current,
      contact: {
        ...current.contact,
        [field]: value,
      },
    }));
  }

  function toggleSelection(field: 'selectedJobOperations' | 'selectedSectionOperations', id: string) {
    setValues((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((value) => value !== id)
        : [...current[field], id],
    }));
  }

  function updateCampaignMarket(marketId: string, updater: (market: CampaignMarket) => CampaignMarket) {
    setValues((current) => ({
      ...current,
      campaignMarkets: current.campaignMarkets.map((m) => (m.id === marketId ? updater(m) : m)),
    }));
  }

  function addCampaignMarket() {
    setValues((current) => ({
      ...current,
      campaignMarkets: [...current.campaignMarkets, createCampaignMarket(`market-${Date.now()}`)],
    }));
  }

  function removeCampaignMarket(marketId: string) {
    setValues((current) => ({
      ...current,
      campaignMarkets: current.campaignMarkets.length === 1
        ? current.campaignMarkets
        : current.campaignMarkets.filter((m) => m.id !== marketId),
    }));
  }

  function addCampaignAsset(marketId: string) {
    updateCampaignMarket(marketId, (market) => ({
      ...market,
      assets: [...market.assets, createCampaignAsset(`asset-${Date.now()}`)],
    }));
  }

  function removeCampaignAsset(marketId: string, assetId: string) {
    updateCampaignMarket(marketId, (market) => ({
      ...market,
      assets: market.assets.length === 1 ? market.assets : market.assets.filter((a) => a.id !== assetId),
    }));
  }

  function updateCampaignAsset(marketId: string, assetId: string, updater: (asset: CampaignAsset) => CampaignAsset) {
    updateCampaignMarket(marketId, (market) => ({
      ...market,
      assets: market.assets.map((a) => (a.id === assetId ? updater(a) : a)),
    }));
  }

  function assetsForMarket(marketName: string) {
    return markets.find((market) => market.name === marketName)?.assets ?? [];
  }

  async function handleSubmitQuote() {
    setSubmitting(true);
    setError('');
    setQuoteResponseMessage('');

    try {
      const response = await submitQuoteForPricing(payload);
      const amount =
        response.amount === null || response.amount === undefined || response.amount === ''
          ? 'N/A'
          : String(response.amount);
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
      const response = await uploadPurchaseOrderFile(selectedPurchaseOrderFile);
      setUploadedPurchaseOrderName(response.originalName);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload purchase order');
    } finally {
      setUploadingPurchaseOrder(false);
    }
  }

  function reviewTotals() {
    setStepIndex(1);
  }

  function handleStartNewSchedule() {
    setValues(createDefaultFormValues());
    setSummary(null);
    setError('');
    setQuoteResponseMessage('');
    setQuantityManuallyEdited(false);
    setSelectedStockOption(null);
    setSelectedFrontProcessOption(null);
    setSelectedReverseProcessOption(null);
    setSelectedPurchaseOrderFile(null);
    setUploadedPurchaseOrderName('');
    setStepIndex(0);
  }

  function openPurchaseOrderPicker() {
    const input = purchaseOrderInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.click();
  }

  return (
    <View style={styles.screen}>
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Print Workflow Studio</Text>
          <Text style={styles.title}>ADS CONNECT</Text>
          <Text style={styles.subtitle}>Build campaign schedules, calculate workbook totals, and prepare PrintIQ-ready quotes.</Text>
          <View style={styles.sessionRow}>
            <Text style={styles.sessionText}>
              {session?.user.name} · {session?.user.role.replace('_', ' ')} · {session?.user.tenantName || 'Global'}
            </Text>
            <View style={styles.sessionActions}>
              {onOpenAdmin ? (
                <Pressable onPress={onOpenAdmin} style={styles.sessionButton}>
                  <Text style={styles.sessionButtonText}>Admin</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => void logout()} style={styles.sessionButton}>
                <Text style={styles.sessionButtonText}>Sign Out</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.progressShell}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        <View style={styles.stepRail}>
          {steps.map((step, index) => {
            const active = index === stepIndex;
            return (
              <Pressable key={step.key} onPress={() => setStepIndex(index)} style={[styles.stepItem, active && styles.stepItemActive]}>
                <Text style={[styles.stepText, active && styles.stepTextActive]}>{step.title}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.layoutRow, !isWideLayout && styles.layoutRowStack]}>
          <View style={styles.mainColumn}>
            {currentStep.key === 'schedule' ? (
              <View style={styles.card}>
                <View style={styles.panelHeader}>
                  <Text style={styles.cardTitle}>Campaign Planning</Text>
                </View>

                <Field label="Campaign Name" value={values.campaignName} onChangeText={(value) => updateField('campaignName', value)} />

                <View style={styles.row}>
                  <View style={styles.rowItem}>
                    <DateField label="Campaign start date" value={values.campaignStartDate} onChange={(value) => updateField('campaignStartDate', value)} />
                  </View>
                  <View style={styles.rowItem}>
                    <DateField label="Due Date" value={values.dueDate} onChange={(value) => updateField('dueDate', value)} />
                  </View>
                  <View style={styles.rowItem}>
                    <Field label="Number of weeks" value={values.numberOfWeeks} onChangeText={(value) => updateField('numberOfWeeks', value)} keyboardType="numeric" />
                  </View>
                </View>

                {loadingMetadata && <ActivityIndicator color="#8B5CF6" />}
                {!!metadataError && <Text style={styles.errorText}>{metadataError}</Text>}

                {values.campaignMarkets.map((market) => {
                  const availableAssets = assetsForMarket(market.market);
                  const canRemoveMarket = values.campaignMarkets.length > 1;
                  return (
                    <View key={market.id} style={styles.lineCard}>
                      <View style={styles.lineHeader}>
                        <View style={{ flex: 1, marginRight: 12 }}>
                          <PickerField
                            label="Market"
                            selectedValue={market.market}
                            items={markets.map((m) => ({
                              label: m.name,
                              value: m.name,
                            }))}
                            onValueChange={(value) =>
                              updateCampaignMarket(market.id, (m) => ({
                                ...m,
                                market: value,
                                assets: m.assets.map(a => ({ ...a, assetId: '', assetSearch: '' })),
                              }))
                            }
                          />
                        </View>
                        {canRemoveMarket && (
                          <Pressable onPress={() => removeCampaignMarket(market.id)} style={styles.cardCloseBtn}>
                            <Text style={styles.closeBtnText}>×</Text>
                          </Pressable>
                        )}
                      </View>

                      <View style={styles.assetsContainer}>
                        <Text style={styles.assetGroupLabel}>Assets</Text>
                        {market.assets.map((asset) => {
                          const canRemoveAsset = market.assets.length > 1;
                          return (
                            <View key={asset.id} style={styles.assetRow}>
                              <View style={styles.assetPickerWrap}>
                                <PickerField
                                  label=""
                                  selectedValue={asset.assetId}
                                  items={availableAssets.map((a) => ({
                                    label: a.label,
                                    value: a.id,
                                  }))}
                                  placeholder={availableAssets.length ? 'Choose asset' : 'No assets'}
                                  onValueChange={(value) =>
                                    updateCampaignAsset(market.id, asset.id, (current) => ({
                                      ...current,
                                      assetId: value,
                                      assetSearch: availableAssets.find((a) => a.id === value)?.label ?? '',
                                    }))
                                  }
                                />
                              </View>
                              <View style={styles.assetWeeksWrap}>
                                <WeekSelector
                                  weekCount={numberOfWeeks}
                                  selectedWeeks={asset.selectedWeeks}
                                  onToggle={(week) =>
                                    updateCampaignAsset(market.id, asset.id, (current) => ({
                                      ...current,
                                      selectedWeeks: current.selectedWeeks.includes(week)
                                        ? current.selectedWeeks.filter((v) => v !== week)
                                        : [...current.selectedWeeks, week].sort((a, b) => a - b),
                                    }))
                                  }
                                />
                              </View>
                              <View style={{ width: 32, alignItems: 'center' }}>
                                {canRemoveAsset && (
                                  <Pressable onPress={() => removeCampaignAsset(market.id, asset.id)} style={styles.assetRemoveBtn}>
                                    <Text style={styles.removeText}>×</Text>
                                  </Pressable>
                                )}
                              </View>
                            </View>
                          );
                        })}
                        <Pressable style={styles.addAssetBtn} onPress={() => addCampaignAsset(market.id)}>
                          <Text style={styles.addAssetBtnText}>+ Add Asset</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}

                <Pressable style={styles.secondaryButton} onPress={addCampaignMarket}>
                  <Text style={styles.secondaryButtonText}>Add Market</Text>
                </Pressable>

                <Pressable style={[styles.primaryButton, calculating && styles.buttonDisabled]} onPress={reviewTotals} disabled={calculating}>
                  <Text style={styles.primaryButtonText}>{calculating ? 'Calculating...' : 'Review Totals'}</Text>
                </Pressable>
                {!!error && <Text style={styles.errorText}>{error}</Text>}
              </View>
            ) : currentStep.key === 'review' ? (
              <View style={styles.card}>
                <View style={styles.panelHeader}>
                  <Text style={styles.cardTitle}>Review Totals</Text>
                  <Text style={styles.cardSubtitle}>Confirm workbook totals before finalising your quote.</Text>
                </View>

                {summary ? (
                  <>
                    {activeMarketSummaries.map((marketSummary) => (
                      <View key={marketSummary.market} style={styles.summaryCard}>
                        <Text style={styles.summaryTitle}>{marketSummary.market}</Text>
                        <Text style={styles.summaryMeta}>
                          {marketSummary.activeAssets} active assets, {marketSummary.activeRuns} runs, {marketSummary.posterTotal} posters, {marketSummary.frameTotal} frames
                        </Text>
                        <BreakdownTable breakdown={marketSummary.breakdown} />
                      </View>
                    ))}
                    <View style={styles.summaryCardDark}>
                      <Text style={styles.summaryTitleDark}>All Markets</Text>
                      <Text style={styles.summaryMetaDark}>
                        {summary.grandTotal.posterTotal} posters, {summary.grandTotal.frameTotal} frames, {summary.grandTotal.specialFormatTotal} special-format units
                      </Text>
                      <BreakdownTable breakdown={summary.grandTotal.breakdown} inverse />
                    </View>
                    <Pressable style={styles.primaryButton} onPress={() => setStepIndex(2)}>
                      <Text style={styles.primaryButtonText}>Continue To Finalise</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyStateTitle}>No totals yet</Text>
                    <Text style={styles.mutedText}>Go back to Schedule and configure campaign assets first.</Text>
                  </View>
                )}

                {!summary && <Text style={styles.helperText}>Complete schedule setup first to continue to finalise.</Text>}
              </View>
            ) : (
              <View style={styles.card}>
                <View style={styles.panelHeader}>
                  <Text style={styles.cardTitle}>Finalise Quote</Text>
                  <Text style={styles.cardSubtitle}>Upload the purchase order, then create the PrintIQ quote.</Text>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Purchase Order File</Text>
                  <View style={styles.uploadShell}>
                    <Pressable style={styles.uploadButton} onPress={openPurchaseOrderPicker}>
                      <Text style={styles.uploadButtonText}>{selectedPurchaseOrderFile ? 'Change File' : 'Choose File'}</Text>
                    </Pressable>
                    <View style={styles.uploadFileInfo}>
                      <Text style={styles.uploadFileInfoText} numberOfLines={1}>
                        {selectedPurchaseOrderFile ? selectedPurchaseOrderFile.name : 'No file selected'}
                      </Text>
                    </View>
                    {createElement('input', {
                      ref: purchaseOrderInputRef,
                      type: 'file',
                      onChange: (event: { target: { files?: FileList | null } }) => {
                        const nextFile = event.target.files?.[0] ?? null;
                        setSelectedPurchaseOrderFile(nextFile);
                      },
                      style: styles.hiddenFileInput as unknown as CSSProperties,
                    })}
                  </View>
                  {!!uploadedPurchaseOrderName && <Text style={styles.noticeText}>Uploaded: {uploadedPurchaseOrderName}</Text>}
                </View>

                <Pressable style={[styles.secondaryButton, uploadingPurchaseOrder && styles.buttonDisabled]} onPress={handleUploadPurchaseOrder} disabled={uploadingPurchaseOrder}>
                  <Text style={styles.secondaryButtonText}>{uploadingPurchaseOrder ? 'Uploading...' : 'Upload Purchase Order'}</Text>
                </Pressable>

                <Pressable style={[styles.primaryButton, (submitting || calculating) && styles.buttonDisabled]} onPress={handleSubmitQuote} disabled={submitting || calculating || !summary}>
                  <Text style={styles.primaryButtonText}>{submitting ? 'Submitting...' : calculating ? 'Calculating...' : 'Create Quote In PrintIQ'}</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={handleStartNewSchedule}>
                  <Text style={styles.secondaryButtonText}>Start New Schedule</Text>
                </Pressable>
                {!!error && <Text style={styles.errorText}>{error}</Text>}
                {!!quoteResponseMessage && <Text style={styles.noticeText}>{quoteResponseMessage}</Text>}
              </View>
            )}
          </View>

          <View style={[styles.sideColumn, !isWideLayout && styles.sideColumnStack]}>
            <View style={styles.sideCard}>
              <Text style={styles.sideEyebrow}>Live Summary</Text>
              <Text style={styles.sideTitle}>Campaign Snapshot</Text>
              <Text style={styles.sideMeta}>
                {values.campaignMarkets.reduce((acc, m) => acc + m.assets.length, 0)} assets configured
              </Text>

              {summary ? (
                <>
                  <View style={styles.liveSummaryWrap}>
                    <LiveSummarySection
                      items={liveSummaryPrimaryKeys.map((key) => ({
                        key,
                        label: key,
                        value: summary.grandTotal.breakdown[key],
                      }))}
                    />
                    <View style={styles.liveSummaryDivider} />
                    <LiveSummarySection
                      highlightValues
                      items={[
                        { key: liveSummarySecondaryKeys[0].key, label: liveSummarySecondaryKeys[0].label, value: summary.grandTotal.posterTotal },
                        { key: liveSummarySecondaryKeys[1].key, label: liveSummarySecondaryKeys[1].label, value: summary.grandTotal.frameTotal },
                        { key: liveSummarySecondaryKeys[2].key, label: liveSummarySecondaryKeys[2].label, value: summary.grandTotal.specialFormatTotal },
                        { key: liveSummarySecondaryKeys[3].key, label: liveSummarySecondaryKeys[3].label, value: values.quantity || summary.grandTotal.totalUnits },
                      ]}
                    />
                  </View>
                </>
              ) : (
                <Text style={styles.sideMeta}>Configure campaign assets to see totals here.</Text>
              )}

            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#313B4D',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -140,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#8B5CF6',
    opacity: 0.08,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#8B5CF6',
    opacity: 0.06,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1240,
    gap: 16,
  },
  hero: {
    paddingTop: 28,
    gap: 10,
  },
  eyebrow: {
    color: '#8B5CF6',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '900',
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 720,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  sessionText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  sessionActions: {
    flexDirection: 'row',
    gap: 8,
  },
  sessionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.cardStrong,
  },
  sessionButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  progressShell: {
    gap: 8,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: COLORS.progressTrack,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#8B5CF6',
  },
  stepRail: {
    flexDirection: 'row',
    gap: 10,
  },
  stepItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.step,
    borderWidth: 1,
    borderColor: COLORS.stepBorder,
    alignItems: 'center',
  },
  stepItemActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.stepActive,
  },
  stepText: {
    color: '#D2D8E2',
    fontWeight: '800',
  },
  stepTextActive: {
    color: '#FFFFFF',
  },
  layoutRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  layoutRowStack: {
    flexDirection: 'column',
  },
  mainColumn: {
    flex: 1,
  },
  sideColumn: {
    width: 320,
  },
  sideColumnStack: {
    width: '100%',
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 28,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  panelHeader: {
    gap: 6,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: COLORS.textMuted,
    lineHeight: 22,
  },
  lineCard: {
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    borderRadius: 20,
    padding: 14,
    gap: 10,
    backgroundColor: COLORS.panel,
    overflow: 'visible',
  },
  lineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  removeText: {
    color: '#FF6B7A',
    fontWeight: '800',
  },
  field: {
    gap: 6,
  },
  label: {
    color: COLORS.textSoft,
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: COLORS.input,
    color: '#F0F0F0',
  },
  dropdownTrigger: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.input,
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownTriggerOpen: {
    borderColor: COLORS.accent,
    shadowColor: COLORS.accent,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  dropdownTriggerText: {
    color: '#F0F0F0',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    paddingRight: 12,
  },
  dropdownPlaceholder: {
    color: COLORS.textPlaceholder,
    fontWeight: '500',
  },
  dropdownChevron: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '800',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    padding: 16,
  },
  dropdownOverlayWeb: {
    justifyContent: 'flex-start',
  },
  dropdownSurface: {
    backgroundColor: COLORS.cardStrong,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    shadowColor: '#0F172A',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  dropdownSurfaceWeb: {
    position: 'absolute',
    borderRadius: 24,
    maxHeight: 520,
  },
  dropdownSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  dropdownSheetLabel: {
    color: COLORS.textSoft,
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dropdownSheetClose: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownSheetValue: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  dropdownSearchWrap: {
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  dropdownSearchInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.input,
    color: '#F0F0F0',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
  },
  dropdownScroll: {
    maxHeight: 360,
  },
  dropdownItem: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#3F4A5F',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownItemActive: {
    backgroundColor: COLORS.panel,
  },
  dropdownItemLast: {
    borderBottomWidth: 0,
  },
  dropdownItemText: {
    color: '#F0F0F0',
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownOptionTextWrap: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  dropdownItemHint: {
    color: COLORS.textPlaceholder,
    fontSize: 12,
  },
  dropdownItemTextActive: {
    color: COLORS.accent,
  },
  dropdownItemCheck: {
    color: COLORS.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  dropdownEmptyState: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  dropdownEmptyText: {
    color: COLORS.textPlaceholder,
    fontSize: 14,
    textAlign: 'center',
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  rowItem: {
    flex: 1,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.panel,
  },
  pillSelected: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  pillText: {
    color: COLORS.textSoft,
    fontSize: 13,
    fontWeight: '800',
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },
  toggleList: {
    gap: 10,
  },
  toggleRow: {
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: COLORS.cardStrong,
  },
  toggleText: {
    flex: 1,
    color: '#D0D0D0',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.panel,
  },
  secondaryButtonText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  summaryCard: {
    borderRadius: 20,
    backgroundColor: COLORS.panel,
    padding: 14,
    gap: 8,
  },
  summaryCardDark: {
    borderRadius: 20,
    backgroundColor: COLORS.panel,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
  },
  summaryTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryTitleDark: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryMeta: {
    color: COLORS.textMuted,
  },
  summaryMetaDark: {
    color: COLORS.accent,
  },
  breakdownTable: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  breakdownCell: {
    minWidth: 92,
    borderRadius: 16,
    backgroundColor: COLORS.input,
    padding: 10,
    gap: 4,
  },
  breakdownCellInverse: {
    backgroundColor: COLORS.panel,
  },
  breakdownLabel: {
    color: COLORS.textSoft,
    fontSize: 12,
    fontWeight: '800',
  },
  breakdownLabelInverse: {
    color: '#8B5CF6',
  },
  breakdownValue: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  breakdownValueInverse: {
    color: '#ffffff',
  },
  sideCard: {
    backgroundColor: COLORS.card,
    borderRadius: 28,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  sideEyebrow: {
    color: '#8B5CF6',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sideTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  sideMeta: {
    color: COLORS.textMuted,
    lineHeight: 20,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  liveSummaryWrap: {
    gap: 14,
  },
  liveSummarySection: {
    borderWidth: 1,
    borderColor: COLORS.sectionBorder,
    borderRadius: 20,
    backgroundColor: COLORS.cardStrong,
    padding: 12,
  },
  liveSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  liveSummaryDivider: {
    height: 1,
    backgroundColor: COLORS.sectionBorder,
    opacity: 0.9,
  },
  metricCard: {
    width: '47%',
    backgroundColor: COLORS.panel,
    borderRadius: 18,
    padding: 12,
    gap: 4,
  },
  metricLabel: {
    color: COLORS.textSoft,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  metricValueHighlight: {
    color: '#8B5CF6',
  },
  helperText: {
    color: COLORS.textPlaceholder,
    fontSize: 12,
  },
  previewText: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: '#D0D0D0',
    backgroundColor: COLORS.panel,
    borderRadius: 18,
    padding: 14,
  },
  emptyState: {
    borderRadius: 20,
    backgroundColor: COLORS.panel,
    padding: 20,
    gap: 6,
  },
  emptyStateTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 18,
  },
  mutedText: {
    color: COLORS.textMuted,
  },
  errorText: {
    color: '#FF6B7A',
    fontWeight: '800',
  },
  noticeText: {
    color: '#6EE7B7',
    fontWeight: '800',
  },
  assetsContainer: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: COLORS.sectionBorder,
    paddingTop: 12,
    marginTop: 4,
  },
  assetGroupLabel: {
    color: COLORS.textSoft,
    fontSize: 14,
    fontWeight: '800',
  },
  assetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: -4,
  },
  assetHeaderLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardCloseBtn: {
    padding: 8,
    marginTop: 18,
  },
  closeBtnText: {
    color: COLORS.textPlaceholder,
    fontSize: 24,
    fontWeight: '300',
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  assetPickerWrap: {
    flex: 1.2,
  },
  assetWeeksWrap: {
    flex: 1,
  },
  assetRemoveBtn: {
    padding: 8,
  },
  addAssetBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    marginTop: 4,
  },
  addAssetBtnText: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '800',
  },
  uploadShell: {
    gap: 10,
  },
  uploadButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.panel,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: COLORS.accent,
    fontSize: 14,
    fontWeight: '800',
  },
  uploadFileInfo: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.panelBorder,
    backgroundColor: COLORS.panel,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  uploadFileInfoText: {
    color: '#D0D0D0',
    fontSize: 13,
    fontWeight: '600',
  },
  hiddenFileInput: {
    display: 'none',
  },
});
