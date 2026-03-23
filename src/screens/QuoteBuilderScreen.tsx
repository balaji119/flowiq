import { createElement, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ActivityIndicator,
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



const webDateInputStyle: CSSProperties = {
  borderRadius: 16,
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: '#333333',
  backgroundColor: '#1A1A1A',
  minHeight: '50px',
  padding: '0 14px',
  fontSize: 16,
  color: '#F0F0F0',
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
                <ActivityIndicator color="#6334D1" />
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
               <Switch value={enabled} onValueChange={() => onToggle(option.id)} trackColor={{ false: '#333333', true: '#6334D1' }} />
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
  const [jobOperationOptions, setJobOperationOptions] = useState<OperationOption[]>([]);
  const [sectionOperationOptions, setSectionOperationOptions] = useState<OperationOption[]>([]);
  const [selectedStockOption, setSelectedStockOption] = useState<PrintIqStockOption | null>(null);
  const [selectedFrontProcessOption, setSelectedFrontProcessOption] = useState<{ label: string; value: string } | null>(null);
  const [selectedReverseProcessOption, setSelectedReverseProcessOption] = useState<{ label: string; value: string } | null>(null);

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

        <View style={[styles.layoutRow, !isWideLayout && styles.layoutRowStack]}>
          <View style={styles.mainColumn}>
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

              {loadingMetadata && <ActivityIndicator color="#6334D1" />}
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

              <Pressable style={styles.secondaryButton} onPress={addCampaignLine}>
                <Text style={styles.secondaryButtonText}>Add Line</Text>
              </Pressable>

              <Field label="Job title" value={values.jobTitle} onChangeText={(value) => updateField('jobTitle', value)} />

              <Pressable style={[styles.primaryButton, (submitting || calculating) && styles.buttonDisabled]} onPress={handleSubmitQuote} disabled={submitting || calculating}>
                <Text style={styles.primaryButtonText}>{submitting ? 'Submitting...' : calculating ? 'Calculating...' : 'Create Quote In PrintIQ'}</Text>
              </Pressable>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {!!quoteResponseMessage && <Text style={styles.noticeText}>{quoteResponseMessage}</Text>}
            </View>
          </View>

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
                <Text style={styles.sideMeta}>Configure campaign lines to see totals here.</Text>
              )}

              <View style={styles.sideDivider} />
              <Text style={styles.sideSectionTitle}>Job Title</Text>
              <Text style={styles.sideBody}>{values.jobTitle || 'Untitled quote'}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -140,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: '#6334D1',
    opacity: 0.08,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -120,
    left: -100,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#7C4DFF',
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
    color: '#A78BFA',
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
    color: '#888888',
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
    color: '#777777',
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
    borderColor: '#333333',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1A1A1A',
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
    backgroundColor: '#1A1A1A',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#6334D1',
  },
  progressText: {
    color: '#888888',
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
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  stepItemActive: {
    backgroundColor: '#1A1125',
    borderColor: '#6334D1',
  },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2D1B69',
  },
  stepDotActive: {
    backgroundColor: '#6334D1',
  },
  stepDotComplete: {
    backgroundColor: '#7C4DFF',
  },
  stepDotText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 13,
  },
  stepText: {
    color: '#888888',
    fontWeight: '700',
  },
  stepTextActive: {
    color: '#FFFFFF',
  },
  pageHeader: {
    gap: 4,
  },
  pageEyebrow: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  pageTitle: {
    color: '#FFFFFF',
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
    backgroundColor: '#111111',
    borderRadius: 28,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
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
    color: '#888888',
    lineHeight: 22,
  },
  lineCard: {
      borderWidth: 1,
      borderColor: '#2A2A2A',
      borderRadius: 20,
      padding: 14,
      gap: 10,
      backgroundColor: '#1A1A1A',
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
    color: '#A0A0A0',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
      borderRadius: 16,
      borderWidth: 1,
    borderColor: '#333333',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#1A1A1A',
      color: '#F0F0F0',
    },
    dateTriggerText: {
      color: '#F0F0F0',
      fontSize: 16,
    },
  dropdownTrigger: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#1A1A1A',
    minHeight: 50,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownTriggerOpen: {
    borderColor: '#6334D1',
    shadowColor: '#6334D1',
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
    color: '#666666',
    fontWeight: '500',
  },
  dropdownChevron: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '800',
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
    backgroundColor: '#111111',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    shadowColor: '#000000',
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
    color: '#A0A0A0',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dropdownSheetClose: {
    color: '#A78BFA',
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
    borderColor: '#333333',
    backgroundColor: '#1A1A1A',
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
    borderBottomColor: '#222222',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dropdownItemActive: {
    backgroundColor: '#1A1125',
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
    color: '#666666',
    fontSize: 12,
  },
  dropdownItemTextActive: {
    color: '#A78BFA',
  },
  dropdownItemCheck: {
    color: '#6334D1',
    fontSize: 16,
    fontWeight: '800',
  },
  dropdownEmptyState: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  dropdownEmptyText: {
    color: '#666666',
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
    borderColor: '#333333',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1A1A1A',
  },
  pillSelected: {
    backgroundColor: '#6334D1',
    borderColor: '#6334D1',
  },
  pillText: {
    color: '#A0A0A0',
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
    borderColor: '#2A2A2A',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1A1A1A',
  },
  toggleText: {
    flex: 1,
    color: '#D0D0D0',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: Platform.select({ web: 'row', default: 'column' }),
    gap: 10,
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#6334D1',
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
    borderColor: '#6334D1',
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#1A1125',
  },
  secondaryButtonText: {
    color: '#A78BFA',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  summaryCard: {
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    padding: 14,
    gap: 8,
  },
  summaryCardDark: {
    borderRadius: 20,
    backgroundColor: '#0D0D1A',
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2D1B69',
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
    color: '#888888',
  },
  summaryMetaDark: {
    color: '#A78BFA',
  },
  breakdownTable: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  breakdownCell: {
    minWidth: 92,
    borderRadius: 16,
    backgroundColor: '#222222',
    padding: 10,
    gap: 4,
  },
  breakdownCellInverse: {
    backgroundColor: '#1A1125',
  },
  breakdownLabel: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '800',
  },
  breakdownLabelInverse: {
    color: '#A78BFA',
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
    backgroundColor: '#111111',
    borderRadius: 28,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  sideEyebrow: {
    color: '#A78BFA',
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
    color: '#888888',
    lineHeight: 20,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    width: '47%',
    backgroundColor: '#1A1A1A',
    borderRadius: 18,
    padding: 12,
    gap: 4,
  },
  metricLabel: {
    color: '#A78BFA',
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
    backgroundColor: '#2A2A2A',
  },
  sideSectionTitle: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sideBody: {
    color: '#FFFFFF',
    lineHeight: 22,
  },
  helperText: {
    color: '#666666',
    fontSize: 12,
  },
  previewText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 18,
    color: '#D0D0D0',
    backgroundColor: '#1A1A1A',
    borderRadius: 18,
    padding: 14,
  },
  emptyState: {
    borderRadius: 20,
    backgroundColor: '#1A1A1A',
    padding: 20,
    gap: 6,
  },
  emptyStateTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 18,
  },
  mutedText: {
    color: '#666666',
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
    backgroundColor: '#1A1A1A',
  },
  footerButtonDisabled: {
    backgroundColor: '#111111',
    opacity: 0.6,
  },
  footerButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  footerButtonTextDisabled: {
    color: '#555555',
  },
  footerButtonPrimary: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: '#6334D1',
  },
  footerButtonPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },
  errorText: {
    color: '#FF6B7A',
    fontWeight: '800',
  },
  noticeText: {
    color: '#6EE7B7',
    fontWeight: '800',
  },
});

