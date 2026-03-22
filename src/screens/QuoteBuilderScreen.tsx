import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { createCampaignLine, defaultFormValues } from '../constants';
import { useAuth } from '../context/AuthContext';
import { calculateCampaign, fetchCalculatorMetadata } from '../services/calculatorApi';
import { fetchQuoteOptions, operationOptionToChoice, searchProcessOptions, searchStockOptions } from '../services/printiqOptionsApi';
import { submitQuoteForPricing } from '../services/quoteApi';
import { CampaignCalculationSummary, CampaignLine, MarketMetadata, OperationOption, OrderFormValues, PrintIqStockOption, QuantityBreakdown, formatKeys } from '../types';
import { buildDefaultJobDescription, buildPrintIqPayload } from '../utils/printiq';

const steps = [
  { key: 'schedule', title: 'Schedule' },
  { key: 'totals', title: 'Totals' },
  { key: 'quote', title: 'Quote' },
] as const;

const webDateInputStyle: CSSProperties = {
  borderRadius: 16,
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: '#cad8e7',
  backgroundColor: '#ffffff',
  minHeight: '50px',
  padding: '0 14px',
  fontSize: 16,
  color: '#0d2033',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

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

function parseDateInput(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
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
  const [showNativePicker, setShowNativePicker] = useState(false);
  const currentDate = useMemo(() => parseDateInput(value), [value]);
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

  if (Platform.OS === 'web') {
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
          style: webDateInputStyle,
        })}
      </View>
    );
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.input} onPress={() => setShowNativePicker(true)}>
        <Text style={styles.dateTriggerText}>{value}</Text>
      </Pressable>
      {showNativePicker && (
        <DateTimePicker
          value={currentDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event: DateTimePickerEvent, selectedDate?: Date) => {
            if (Platform.OS !== 'ios') {
              setShowNativePicker(false);
            }
            if (event.type === 'set' && selectedDate) {
              onChange(selectedDate.toISOString().slice(0, 10));
            }
          }}
        />
      )}
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
  const isWeb = Platform.OS === 'web';
  const isSearchablePicker = ['asset', 'market'].includes(label.toLowerCase());
  const selectedLabel = items.find((item) => item.value === selectedValue)?.label || placeholder || 'Select';
  const sheetTitle = placeholder || `Choose a ${label.toLowerCase()}`;
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

    if (!isWeb || typeof window === 'undefined') {
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
  }, [filteredItems, isWeb, onValueChange, open]);

  const webPanelWidth = anchor ? Math.min(Math.max(anchor.width, 360), 520, width - 32) : Math.min(width - 32, 520);
  const webPanelLeft = anchor ? Math.max(16, Math.min(anchor.x, width - webPanelWidth - 16)) : 16;
  const spaceBelow = anchor ? height - (anchor.y + anchor.height) - 16 : height - 104;
  const spaceAbove = anchor ? anchor.y - 16 : 72;
  const openAbove = !!anchor && spaceBelow < 320 && spaceAbove > spaceBelow;
  const webPanelMaxHeight = Math.max(220, Math.min(420, openAbove ? spaceAbove - 8 : spaceBelow - 8));
  const webPanelTop = anchor && !openAbove ? anchor.y + anchor.height + 8 : 88;
  const webPanelBottom = anchor && openAbove ? Math.max(16, height - anchor.y + 8) : undefined;

  function openPicker() {
    if (isWeb && triggerRef.current?.measureInWindow) {
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
          {selectedLabel}
        </Text>
        <Text style={styles.dropdownChevron}>{open ? '^' : 'v'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.dropdownOverlay, isWeb ? styles.dropdownOverlayWeb : styles.dropdownOverlayMobile]} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.dropdownSurface,
              isWeb ? styles.dropdownSurfaceWeb : styles.dropdownSurfaceMobile,
              isWeb ? { width: webPanelWidth, left: webPanelLeft, top: openAbove ? undefined : webPanelTop, bottom: webPanelBottom, maxHeight: webPanelMaxHeight } : null,
            ]}
            onPress={() => undefined}
          >
            <View style={styles.dropdownSheetHeader}>
              <Text style={styles.dropdownSheetLabel}>{label}</Text>
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
                  autoFocus={isWeb}
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
  const isWeb = Platform.OS === 'web';
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
    if (isWeb && triggerRef.current?.measureInWindow) {
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
        <Pressable style={[styles.dropdownOverlay, isWeb ? styles.dropdownOverlayWeb : styles.dropdownOverlayMobile]} onPress={() => setOpen(false)}>
          <Pressable
            style={[
              styles.dropdownSurface,
              isWeb ? styles.dropdownSurfaceWeb : styles.dropdownSurfaceMobile,
              isWeb ? { width: webPanelWidth, left: webPanelLeft, top: openAbove ? undefined : webPanelTop, bottom: webPanelBottom, maxHeight: webPanelMaxHeight } : null,
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
                autoFocus={isWeb}
              />
            </View>
            {loading ? (
              <View style={styles.dropdownEmptyState}>
                <ActivityIndicator color="#2a6e98" />
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
              <Switch value={enabled} onValueChange={() => onToggle(option.id)} trackColor={{ false: '#c8d1de', true: '#34c3ff' }} />
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
          <Pressable key={week} onPress={() => onToggle(week)} style={[styles.pill, selected && styles.pillSelected]}>
            <Text style={[styles.pillText, selected && styles.pillTextSelected]}>Week {week}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function normalizeCampaignLines(campaignLines: CampaignLine[], maxWeeks: number) {
  return campaignLines.map((line) => ({
    ...line,
    selectedWeeks: [...new Set(line.selectedWeeks.filter((week) => week >= 1 && week <= maxWeeks))].sort((a, b) => a - b),
  }));
}

export function QuoteBuilderScreen({ onOpenAdmin }: { onOpenAdmin?: () => void }) {
  const { session, logout } = useAuth();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 1080;
  const [values, setValues] = useState<OrderFormValues>(defaultFormValues);
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [summary, setSummary] = useState<CampaignCalculationSummary | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteResponseMessage, setQuoteResponseMessage] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quantityManuallyEdited, setQuantityManuallyEdited] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [jobOperationOptions, setJobOperationOptions] = useState<OperationOption[]>([]);
  const [sectionOperationOptions, setSectionOperationOptions] = useState<OperationOption[]>([]);
  const [selectedStockOption, setSelectedStockOption] = useState<PrintIqStockOption | null>(null);
  const [selectedFrontProcessOption, setSelectedFrontProcessOption] = useState<{ label: string; value: string } | null>(null);
  const [selectedReverseProcessOption, setSelectedReverseProcessOption] = useState<{ label: string; value: string } | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

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
  }, []);

  const payload = useMemo(() => buildPrintIqPayload(values, summary), [summary, values]);
  const activeMarketSummaries = useMemo(
    () => (summary ? summary.perMarket.filter((market) => market.activeAssets > 0 || market.activeRuns > 0 || market.totalUnits > 0) : []),
    [summary]
  );
  const numberOfWeeks = Math.max(1, Math.min(20, Number(values.numberOfWeeks) || 1));
  const currentStep = steps[stepIndex];
  const progressPercent = ((stepIndex + 1) / steps.length) * 100;

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, stepIndex]);

  useEffect(() => {
    setValues((current) => {
      const normalizedLines = normalizeCampaignLines(current.campaignLines, numberOfWeeks);
      const changed = normalizedLines.some((line, index) => line.selectedWeeks.join(',') !== current.campaignLines[index]?.selectedWeeks.join(','));

      return changed
        ? {
            ...current,
            campaignLines: normalizedLines,
          }
        : current;
    });
  }, [numberOfWeeks]);

  useEffect(() => {
    if (loadingMetadata || metadataError) {
      return;
    }

    let active = true;
    const timeoutId = setTimeout(async () => {
      try {
        setCalculating(true);
        const result = await calculateCampaign(values.campaignLines);
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
  }, [loadingMetadata, metadataError, quantityManuallyEdited, values.campaignLines]);

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

  function updateCampaignLine(lineId: string, updater: (line: CampaignLine) => CampaignLine) {
    setValues((current) => ({
      ...current,
      campaignLines: current.campaignLines.map((line) => (line.id === lineId ? updater(line) : line)),
    }));
  }

  function addCampaignLine() {
    setValues((current) => ({
      ...current,
      campaignLines: [...current.campaignLines, createCampaignLine(`line-${Date.now()}`)],
    }));
  }

  function removeCampaignLine(lineId: string) {
    setValues((current) => ({
      ...current,
      campaignLines: current.campaignLines.length === 1
        ? current.campaignLines
        : current.campaignLines.filter((line) => line.id !== lineId),
    }));
  }

  function assetsForMarket(marketName: string) {
    return markets.find((market) => market.name === marketName)?.assets ?? [];
  }

  async function handleCalculate() {
    setStepIndex(1);
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

  function applySuggestedDescription() {
    updateField('jobDescription', buildDefaultJobDescription(values, summary));
  }

  function continueToQuote() {
    if (summary) {
      setQuantityManuallyEdited(false);
      updateField('quantity', String(summary.grandTotal.totalUnits));
      setNotice(`Quote quantity set to ${summary.grandTotal.totalUnits}.`);
    }
    setStepIndex(2);
  }

  function nextStep() {
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  }

  function previousStep() {
    setStepIndex((current) => Math.max(current - 1, 0));
  }

  function renderCurrentStep() {
    if (currentStep.key === 'schedule') {
      return (
        <View style={styles.card}>
          <View style={styles.panelHeader}>
            <Text style={styles.cardTitle}>Campaign Planning</Text>
            <Text style={styles.cardSubtitle}>Set the run window, choose assets by market, and select the active weeks for each line.</Text>
          </View>

          <View style={styles.row}>
              <View style={styles.rowItem}>
                <DateField label="Campaign start date" value={values.campaignStartDate} onChange={(value) => updateField('campaignStartDate', value)} />
              </View>
            <View style={styles.rowItem}>
              <Field label="Number of weeks" value={values.numberOfWeeks} onChangeText={(value) => updateField('numberOfWeeks', value)} keyboardType="numeric" />
            </View>
          </View>

            {loadingMetadata && <ActivityIndicator color="#00b7ff" />}
            {!!metadataError && <Text style={styles.errorText}>{metadataError}</Text>}
            {!!notice && <Text style={styles.noticeText}>{notice}</Text>}

          {values.campaignLines.map((line, index) => {
            const assets = assetsForMarket(line.market);
            return (
              <View key={line.id} style={styles.lineCard}>
                <View style={styles.lineHeader}>
                  <Text style={styles.lineTitle}>Line {index + 1}</Text>
                  <Pressable onPress={() => removeCampaignLine(line.id)}>
                    <Text style={styles.removeText}>Remove</Text>
                  </Pressable>
                </View>

                <PickerField
                  label="Market"
                  selectedValue={line.market}
                  items={markets.map((market) => ({
                    label: market.name,
                    value: market.name,
                  }))}
                  onValueChange={(value) =>
                    updateCampaignLine(line.id, (current) => ({
                      ...current,
                      market: value,
                      assetId: '',
                      assetSearch: '',
                    }))
                  }
                />

                <PickerField
                  label="Asset"
                  selectedValue={line.assetId}
                  items={[
                    ...assets.map((asset) => ({
                      label: asset.label,
                      value: asset.id,
                    })),
                  ]}
                  placeholder={assets.length ? 'Choose an asset' : 'No assets available'}
                  onValueChange={(value) =>
                    updateCampaignLine(line.id, (current) => ({
                      ...current,
                      assetId: value,
                      assetSearch: assets.find((asset) => asset.id === value)?.label ?? '',
                    }))
                  }
                />

                <View style={styles.field}>
                  <Text style={styles.label}>Active weeks</Text>
                  <WeekSelector
                    weekCount={numberOfWeeks}
                    selectedWeeks={line.selectedWeeks}
                    onToggle={(week) =>
                      updateCampaignLine(line.id, (current) => ({
                        ...current,
                        selectedWeeks: current.selectedWeeks.includes(week)
                          ? current.selectedWeeks.filter((value) => value !== week)
                          : [...current.selectedWeeks, week].sort((a, b) => a - b),
                      }))
                    }
                  />
                </View>
              </View>
            );
          })}

          <View style={styles.buttonRow}>
              <Pressable style={styles.secondaryButton} onPress={addCampaignLine}>
                <Text style={styles.secondaryButtonText}>Add Line</Text>
              </Pressable>
              <Pressable style={[styles.primaryButton, calculating && styles.buttonDisabled]} onPress={handleCalculate} disabled={calculating}>
                <Text style={styles.primaryButtonText}>{calculating ? 'Refreshing...' : 'Review Totals'}</Text>
              </Pressable>
            </View>
        </View>
      );
    }

    if (currentStep.key === 'totals') {
      return (
        <View style={styles.card}>
          <View style={styles.panelHeader}>
            <Text style={styles.cardTitle}>Workbook Totals</Text>
            <Text style={styles.cardSubtitle}>These totals are generated from the workbook mappings and your selected campaign lines.</Text>
          </View>

          {summary ? (
            <>
                {activeMarketSummaries.map((market) => (
                  <View key={market.market} style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>{market.market}</Text>
                    <Text style={styles.summaryMeta}>
                    {market.activeAssets} active assets, {market.activeRuns} runs, {market.posterTotal} posters, {market.frameTotal} frames
                  </Text>
                  <BreakdownTable breakdown={market.breakdown} />
                </View>
              ))}
              <View style={styles.summaryCardDark}>
                <Text style={styles.summaryTitleDark}>All Markets</Text>
                <Text style={styles.summaryMetaDark}>
                  {summary.grandTotal.posterTotal} posters, {summary.grandTotal.frameTotal} frames, {summary.grandTotal.specialFormatTotal} special-format units
                </Text>
                <BreakdownTable breakdown={summary.grandTotal.breakdown} inverse />
                </View>
                <View style={styles.buttonRow}>
                  <Pressable style={styles.primaryButton} onPress={continueToQuote}>
                    <Text style={styles.primaryButtonText}>Continue To Quote</Text>
                  </Pressable>
                </View>
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateTitle}>No totals yet</Text>
              <Text style={styles.mutedText}>Go back to Schedule and run the workbook calculation first.</Text>
            </View>
          )}
        </View>
      );
    }

    if (currentStep.key === 'quote') {
      return (
        <View style={styles.card}>
          <View style={styles.panelHeader}>
            <Text style={styles.cardTitle}>Quote Setup</Text>
            <Text style={styles.cardSubtitle}>Fine-tune the PrintIQ job fields, operations, and contact details, then create the quote from this step.</Text>
          </View>

          <Field label="Customer code" value={values.customerCode} onChangeText={(value) => updateField('customerCode', value)} />
          <Field label="Customer reference" value={values.customerReference} onChangeText={(value) => updateField('customerReference', value)} />
          <Field label="Job title" value={values.jobTitle} onChangeText={(value) => updateField('jobTitle', value)} />
          <Field label="Kind name / SKU" value={values.kindName} onChangeText={(value) => updateField('kindName', value)} />
          <Field
            label="Quote quantity"
            value={values.quantity}
            onChangeText={(value) => {
              setQuantityManuallyEdited(true);
              updateField('quantity', value);
            }}
            keyboardType="numeric"
          />

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field label="Finish width (mm)" value={values.finishWidth} onChangeText={(value) => updateField('finishWidth', value)} keyboardType="numeric" />
            </View>
            <View style={styles.rowItem}>
              <Field label="Finish height (mm)" value={values.finishHeight} onChangeText={(value) => updateField('finishHeight', value)} keyboardType="numeric" />
            </View>
          </View>

          <AsyncPickerField
            label="Stock code"
            selectedValue={values.stockCode}
            selectedLabel={selectedStockOption?.label}
            placeholder="Choose a stock code"
            loadOptions={searchStockOptions}
            onValueChange={(value) => {
              updateField('stockCode', value);
              setSelectedStockOption({ value, label: value });
            }}
          />
          <AsyncPickerField
            label="Front process"
            selectedValue={values.processFront}
            selectedLabel={selectedFrontProcessOption?.label}
            placeholder="Choose a front process"
            loadOptions={searchProcessOptions}
            onValueChange={(value) => {
              updateField('processFront', value);
              setSelectedFrontProcessOption({ value, label: value });
            }}
          />
          <AsyncPickerField
            label="Reverse process"
            selectedValue={values.processReverse}
            selectedLabel={selectedReverseProcessOption?.label}
            placeholder="Choose a reverse process"
            loadOptions={async (query) => [{ label: 'None', value: '' }, ...(await searchProcessOptions(query))]}
            onValueChange={(value) => {
              updateField('processReverse', value);
              setSelectedReverseProcessOption(value ? { value, label: value } : { value: '', label: 'None' });
            }}
          />
          <Field label="Target freight price" value={values.targetFreightPrice} onChangeText={(value) => updateField('targetFreightPrice', value)} keyboardType="numeric" />
          <Field label="Job description" value={values.jobDescription} onChangeText={(value) => updateField('jobDescription', value)} multiline />
            <Pressable style={styles.secondaryButton} onPress={applySuggestedDescription}>
              <Text style={styles.secondaryButtonText}>Generate Description</Text>
            </Pressable>
            <Field label="Notes" value={values.notes} onChangeText={(value) => updateField('notes', value)} multiline />
            {!!notice && <Text style={styles.noticeText}>{notice}</Text>}

          <ToggleList
            label="Job operations"
            options={jobOperationOptions.map(operationOptionToChoice)}
            selected={values.selectedJobOperations}
            onToggle={(id) => toggleSelection('selectedJobOperations', id)}
          />
          <ToggleList
            label="Section operations"
            options={sectionOperationOptions.map(operationOptionToChoice)}
            selected={values.selectedSectionOperations}
            onToggle={(id) => toggleSelection('selectedSectionOperations', id)}
          />

          <Field label="Title" value={values.contact.title} onChangeText={(value) => updateContactField('title', value)} />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field label="First name" value={values.contact.firstName} onChangeText={(value) => updateContactField('firstName', value)} />
            </View>
            <View style={styles.rowItem}>
              <Field label="Surname" value={values.contact.surname} onChangeText={(value) => updateContactField('surname', value)} />
            </View>
          </View>
          <Field label="Email" value={values.contact.email} onChangeText={(value) => updateContactField('email', value)} keyboardType="email-address" />
          <Pressable style={[styles.primaryButton, submitting && styles.buttonDisabled]} onPress={handleSubmitQuote} disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? 'Submitting...' : 'Create Quote In PrintIQ'}</Text>
          </Pressable>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          {!!quoteResponseMessage && <Text style={styles.noticeText}>{quoteResponseMessage}</Text>}
        </View>
      );
    }

    return null;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <View style={styles.backgroundGlowTop} />
      <View style={styles.backgroundGlowBottom} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Print Workflow Studio</Text>
          <Text style={styles.title}>FlowIQ</Text>
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
          <Text style={styles.progressText}>
            {stepIndex + 1} / {steps.length} complete
          </Text>
        </View>

        <View style={styles.stepRail}>
          {steps.map((step, index) => {
            const active = index === stepIndex;
            const complete = index < stepIndex;
            return (
              <Pressable key={step.key} onPress={() => setStepIndex(index)} style={[styles.stepItem, active && styles.stepItemActive]}>
                <View style={[styles.stepDot, active && styles.stepDotActive, complete && styles.stepDotComplete]}>
                  <Text style={styles.stepDotText}>{index + 1}</Text>
                </View>
                <Text style={[styles.stepText, active && styles.stepTextActive]}>{step.title}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.pageHeader}>
          <Text style={styles.pageEyebrow}>Step {stepIndex + 1}</Text>
          <Text style={styles.pageTitle}>{currentStep.title}</Text>
        </View>

        <View style={[styles.layoutRow, !isWideLayout && styles.layoutRowStack]}>
          <Animated.View
            style={[
              styles.mainColumn,
              {
                opacity: fadeAnim,
                transform: [
                  {
                    translateY: fadeAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [18, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            {renderCurrentStep()}
          </Animated.View>

          <View style={[styles.sideColumn, !isWideLayout && styles.sideColumnStack]}>
            <View style={styles.sideCard}>
              <Text style={styles.sideEyebrow}>Live Summary</Text>
              <Text style={styles.sideTitle}>Campaign Snapshot</Text>
              <Text style={styles.sideMeta}>{values.campaignLines.length} lines configured</Text>

              {summary ? (
                <>
                  <View style={styles.metricGrid}>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Posters</Text>
                      <Text style={styles.metricValue}>{summary.grandTotal.posterTotal}</Text>
                    </View>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Frames</Text>
                      <Text style={styles.metricValue}>{summary.grandTotal.frameTotal}</Text>
                    </View>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Special</Text>
                      <Text style={styles.metricValue}>{summary.grandTotal.specialFormatTotal}</Text>
                    </View>
                    <View style={styles.metricCard}>
                      <Text style={styles.metricLabel}>Quote Qty</Text>
                      <Text style={styles.metricValue}>{values.quantity || summary.grandTotal.totalUnits}</Text>
                    </View>
                  </View>
                  <BreakdownTable breakdown={summary.grandTotal.breakdown} />
                </>
              ) : (
                <Text style={styles.sideMeta}>Run the schedule calculation to see totals here.</Text>
              )}

              <View style={styles.sideDivider} />
              <Text style={styles.sideSectionTitle}>Current Step</Text>
              <Text style={styles.sideBody}>{currentStep.title}</Text>
              <Text style={styles.sideSectionTitle}>Job Title</Text>
              <Text style={styles.sideBody}>{values.jobTitle || 'Untitled quote'}</Text>
              <Text style={styles.sideSectionTitle}>Customer Ref</Text>
              <Text style={styles.sideBody}>{values.customerReference || 'Not set'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footerNav}>
          <Pressable onPress={previousStep} disabled={stepIndex === 0} style={[styles.footerButton, stepIndex === 0 && styles.footerButtonDisabled]}>
            <Text style={[styles.footerButtonText, stepIndex === 0 && styles.footerButtonTextDisabled]}>Back</Text>
          </Pressable>
          {stepIndex < steps.length - 1 && currentStep.key !== 'totals' && (
            <Pressable onPress={nextStep} style={styles.footerButtonPrimary}>
              <Text style={styles.footerButtonPrimaryText}>Next</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0d1620',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -140,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#4a79a8',
    opacity: 0.14,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#5bb4a8',
    opacity: 0.12,
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
    color: '#8fd2e5',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: {
    color: '#f5f9fc',
    fontSize: 40,
    fontWeight: '900',
  },
  subtitle: {
    color: '#bfd0df',
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
    color: '#9cb3c9',
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
    borderColor: '#35546e',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(18, 34, 49, 0.78)',
  },
  sessionButtonText: {
    color: '#f5f9fc',
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
    backgroundColor: '#1a2a39',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#5d96bf',
  },
  progressText: {
    color: '#93abc0',
    fontWeight: '700',
  },
  stepRail: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    gap: 10,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(18, 34, 49, 0.78)',
    borderWidth: 1,
    borderColor: '#244057',
  },
  stepItemActive: {
    backgroundColor: '#18324a',
    borderColor: '#5d96bf',
  },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#274760',
  },
  stepDotActive: {
    backgroundColor: '#5d96bf',
  },
  stepDotComplete: {
    backgroundColor: '#5bb4a8',
  },
  stepDotText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  stepText: {
    color: '#94aec2',
    fontWeight: '700',
  },
  stepTextActive: {
    color: '#f5f9fc',
  },
  pageHeader: {
    gap: 4,
  },
  pageEyebrow: {
    color: '#8fd2e5',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  pageTitle: {
    color: '#f5f9fc',
    fontSize: 28,
    fontWeight: '800',
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
    backgroundColor: '#f8fbff',
    borderRadius: 28,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#d7e5f3',
  },
  panelHeader: {
    gap: 6,
  },
  cardTitle: {
    color: '#0d2033',
    fontSize: 24,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: '#5f7288',
    lineHeight: 22,
  },
  lineCard: {
      borderWidth: 1,
      borderColor: '#d9e4f0',
      borderRadius: 20,
      padding: 14,
      gap: 10,
      backgroundColor: '#ffffff',
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
    color: '#0d2033',
  },
  removeText: {
    color: '#e24f5f',
    fontWeight: '800',
  },
  field: {
    gap: 6,
  },
  label: {
    color: '#26415e',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
      borderRadius: 16,
      borderWidth: 1,
    borderColor: '#cad8e7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
      color: '#0d2033',
    },
    dateTriggerText: {
      color: '#0d2033',
      fontSize: 16,
    },
  dropdownTrigger: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cad8e7',
    backgroundColor: '#ffffff',
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownTriggerOpen: {
    borderColor: '#5d96bf',
    shadowColor: '#5d96bf',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  dropdownTriggerText: {
    color: '#0d2033',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    paddingRight: 12,
  },
  dropdownPlaceholder: {
    color: '#6f7e93',
    fontWeight: '500',
  },
  dropdownChevron: {
    color: '#46627e',
    fontSize: 11,
    fontWeight: '800',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(8, 17, 26, 0.38)',
    alignItems: 'center',
    padding: 16,
  },
  dropdownOverlayWeb: {
    justifyContent: 'flex-start',
  },
  dropdownOverlayMobile: {
    justifyContent: 'flex-end',
  },
  dropdownSurface: {
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#cad8e7',
    shadowColor: '#0d2033',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  dropdownSurfaceWeb: {
    position: 'absolute',
    borderRadius: 24,
    maxHeight: 520,
  },
  dropdownSurfaceMobile: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxHeight: '78%',
    width: '100%',
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
    color: '#26415e',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dropdownSheetClose: {
    color: '#4c84ab',
    fontSize: 14,
    fontWeight: '700',
  },
  dropdownSheetValue: {
    color: '#0d2033',
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
    borderColor: '#cad8e7',
    backgroundColor: '#f5f9fd',
    color: '#0d2033',
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
    borderBottomColor: '#edf2f7',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownItemActive: {
    backgroundColor: '#eef6fb',
  },
  dropdownItemLast: {
    borderBottomWidth: 0,
  },
  dropdownItemText: {
    color: '#0d2033',
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownOptionTextWrap: {
    flex: 1,
    gap: 2,
    paddingRight: 12,
  },
  dropdownItemHint: {
    color: '#6f7e93',
    fontSize: 12,
  },
  dropdownItemTextActive: {
    color: '#1d4f73',
  },
  dropdownItemCheck: {
    color: '#2a6e98',
    fontSize: 16,
    fontWeight: '800',
  },
  dropdownEmptyState: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  dropdownEmptyText: {
    color: '#6f7e93',
    fontSize: 14,
    textAlign: 'center',
  },
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
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
    borderColor: '#cad8e7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#eff6ff',
  },
  pillSelected: {
    backgroundColor: '#0f5ef7',
    borderColor: '#0f5ef7',
  },
  pillText: {
    color: '#20415f',
    fontSize: 13,
    fontWeight: '800',
  },
  pillTextSelected: {
    color: '#ffffff',
  },
  toggleList: {
    gap: 10,
  },
  toggleRow: {
    borderWidth: 1,
    borderColor: '#dbe6f1',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
  },
  toggleText: {
    flex: 1,
    color: '#20364f',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    gap: 10,
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#0f5ef7',
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#13d9c8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#edfffc',
  },
  secondaryButtonText: {
    color: '#047a7f',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  summaryCard: {
    borderRadius: 20,
    backgroundColor: '#eef7ff',
    padding: 14,
    gap: 8,
  },
  summaryCardDark: {
    borderRadius: 20,
    backgroundColor: '#0c2236',
    padding: 14,
    gap: 8,
  },
  summaryTitle: {
    color: '#0d2033',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryTitleDark: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  summaryMeta: {
    color: '#55708c',
  },
  summaryMetaDark: {
    color: '#b5cbe3',
  },
  breakdownTable: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  breakdownCell: {
    minWidth: 92,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 10,
    gap: 4,
  },
  breakdownCellInverse: {
    backgroundColor: '#13385a',
  },
  breakdownLabel: {
    color: '#64809c',
    fontSize: 12,
    fontWeight: '800',
  },
  breakdownLabelInverse: {
    color: '#9fd3ff',
  },
  breakdownValue: {
    color: '#0d2033',
    fontSize: 16,
    fontWeight: '900',
  },
  breakdownValueInverse: {
    color: '#ffffff',
  },
  sideCard: {
    backgroundColor: '#132332',
    borderRadius: 28,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#28445c',
  },
  sideEyebrow: {
    color: '#8fd2e5',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sideTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  sideMeta: {
    color: '#b6cadc',
    lineHeight: 20,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '47%',
    backgroundColor: '#1d3448',
    borderRadius: 18,
    padding: 12,
    gap: 4,
  },
  metricLabel: {
    color: '#a8c5dc',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  sideDivider: {
    height: 1,
    backgroundColor: '#2a455e',
  },
  sideSectionTitle: {
    color: '#8fd2e5',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sideBody: {
    color: '#f8fafc',
    lineHeight: 22,
  },
  helperText: {
    color: '#68839f',
    fontSize: 12,
  },
  previewText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 18,
    color: '#11263b',
    backgroundColor: '#eef7ff',
    borderRadius: 18,
    padding: 14,
  },
  emptyState: {
    borderRadius: 20,
    backgroundColor: '#eef7ff',
    padding: 20,
    gap: 6,
  },
  emptyStateTitle: {
    color: '#0d2033',
    fontWeight: '800',
    fontSize: 18,
  },
  mutedText: {
    color: '#68839f',
  },
  footerNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
  },
  footerButton: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: '#dce7f3',
  },
  footerButtonDisabled: {
    backgroundColor: '#a8b7c7',
    opacity: 0.6,
  },
  footerButtonText: {
    color: '#15304a',
    fontWeight: '800',
  },
  footerButtonTextDisabled: {
    color: '#5e7488',
  },
  footerButtonPrimary: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: '#13d9c8',
  },
  footerButtonPrimaryText: {
    color: '#082432',
    fontWeight: '900',
  },
  errorText: {
    color: '#d64056',
    fontWeight: '800',
  },
  noticeText: {
    color: '#2b6f48',
    fontWeight: '800',
  },
});
