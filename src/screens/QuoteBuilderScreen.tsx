import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
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
import { createCampaignLine, defaultFormValues, jobOperationOptions, processOptions, sectionOperationOptions, stockOptions } from '../constants';
import { calculateCampaign, fetchCalculatorMetadata } from '../services/calculatorApi';
import { submitQuoteForPricing } from '../services/quoteApi';
import {
  CampaignCalculationSummary,
  CampaignLine,
  MarketAssetOption,
  MarketMetadata,
  OrderFormValues,
  QuantityBreakdown,
  formatKeys,
} from '../types';
import { buildDefaultJobDescription, buildPrintIqPayload } from '../utils/printiq';

const steps = [
  { key: 'schedule', title: 'Schedule' },
  { key: 'totals', title: 'Totals' },
  { key: 'quote', title: 'Quote' },
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

function AssetSearch({
  line,
  assets,
  onSelectAsset,
  onSearchChange,
}: {
  line: CampaignLine;
  assets: MarketAssetOption[];
  onSelectAsset: (asset: MarketAssetOption) => void;
  onSearchChange: (value: string) => void;
}) {
  const query = line.assetSearch.trim().toLowerCase();
  const matches = query
    ? assets.filter((asset) => asset.label.toLowerCase().includes(query)).slice(0, 8)
    : assets.slice(0, 8);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Asset</Text>
      <TextInput value={line.assetSearch} onChangeText={onSearchChange} style={styles.input} placeholder="Search asset" placeholderTextColor="#6f7e93" />
      <View style={styles.suggestionList}>
        {matches.map((asset) => {
          const selected = asset.id === line.assetId;
          return (
            <Pressable
              key={asset.id}
              onPress={() => onSelectAsset(asset)}
              style={[styles.suggestionItem, selected && styles.suggestionSelected]}
            >
              <Text style={[styles.suggestionTitle, selected && styles.suggestionTitleSelected]}>{asset.label}</Text>
              <Text style={[styles.suggestionMeta, selected && styles.suggestionMetaSelected]}>{asset.state}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function QuoteBuilderScreen() {
  const { width } = useWindowDimensions();
  const isWideLayout = width >= 1080;
  const [values, setValues] = useState<OrderFormValues>(defaultFormValues);
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [metadataError, setMetadataError] = useState('');
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [summary, setSummary] = useState<CampaignCalculationSummary | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteResponse, setQuoteResponse] = useState('');
  const [error, setError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
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

  const payload = useMemo(() => buildPrintIqPayload(values, summary), [summary, values]);
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
    setCalculating(true);
    setError('');

    try {
      const result = await calculateCampaign(values.campaignLines);
      setSummary(result);
      setStepIndex(1);
    } catch (calculationError) {
      setError(calculationError instanceof Error ? calculationError.message : 'Unable to calculate campaign');
    } finally {
      setCalculating(false);
    }
  }

  async function handleSubmitQuote() {
    setSubmitting(true);
    setError('');
    setQuoteResponse('');

    try {
      const response = await submitQuoteForPricing(payload);
      setQuoteResponse(JSON.stringify(response, null, 2));
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to create quote');
    } finally {
      setSubmitting(false);
    }
  }

  function applySuggestedDescription() {
    updateField('jobDescription', buildDefaultJobDescription(values, summary));
  }

  function useCalculatedQuantity() {
    if (summary) {
      updateField('quantity', String(summary.grandTotal.totalUnits));
    }
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
              <Field label="Campaign start date" value={values.campaignStartDate} onChangeText={(value) => updateField('campaignStartDate', value)} />
            </View>
            <View style={styles.rowItem}>
              <Field label="Number of weeks" value={values.numberOfWeeks} onChangeText={(value) => updateField('numberOfWeeks', value)} keyboardType="numeric" />
            </View>
          </View>

          {loadingMetadata && <ActivityIndicator color="#00b7ff" />}
          {!!metadataError && <Text style={styles.errorText}>{metadataError}</Text>}

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

                <Text style={styles.label}>Market</Text>
                <View style={styles.pillWrap}>
                  {markets.map((market) => {
                    const selected = line.market === market.name;
                    return (
                      <Pressable
                        key={market.name}
                        onPress={() =>
                          updateCampaignLine(line.id, (current) => ({
                            ...current,
                            market: market.name,
                            assetId: '',
                            assetSearch: '',
                          }))
                        }
                        style={[styles.pill, selected && styles.pillSelected]}
                      >
                        <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{market.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <AssetSearch
                  line={line}
                  assets={assets}
                  onSearchChange={(value) => updateCampaignLine(line.id, (current) => ({ ...current, assetSearch: value }))}
                  onSelectAsset={(asset) =>
                    updateCampaignLine(line.id, (current) => ({
                      ...current,
                      assetId: asset.id,
                      assetSearch: asset.label,
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
              <Text style={styles.primaryButtonText}>{calculating ? 'Calculating...' : 'Calculate Totals'}</Text>
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
              {summary.perMarket.map((market) => (
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
                <Pressable style={styles.secondaryButton} onPress={useCalculatedQuantity}>
                  <Text style={styles.secondaryButtonText}>Use Total Units For Quote Quantity</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={nextStep}>
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
          <Field label="Quote quantity" value={values.quantity} onChangeText={(value) => updateField('quantity', value)} keyboardType="numeric" />

          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field label="Finish width (mm)" value={values.finishWidth} onChangeText={(value) => updateField('finishWidth', value)} keyboardType="numeric" />
            </View>
            <View style={styles.rowItem}>
              <Field label="Finish height (mm)" value={values.finishHeight} onChangeText={(value) => updateField('finishHeight', value)} keyboardType="numeric" />
            </View>
          </View>

          <Field label="Stock code" value={values.stockCode} onChangeText={(value) => updateField('stockCode', value)} />
          <Text style={styles.helperText}>Suggested stock codes: {stockOptions.map((option) => option.stockCode).join(', ')}</Text>
          <Field label="Front process" value={values.processFront} onChangeText={(value) => updateField('processFront', value)} />
          <Text style={styles.helperText}>Suggested processes: {processOptions.join(' | ')}</Text>
          <Field label="Reverse process" value={values.processReverse} onChangeText={(value) => updateField('processReverse', value)} />
          <Field label="Target freight price" value={values.targetFreightPrice} onChangeText={(value) => updateField('targetFreightPrice', value)} keyboardType="numeric" />
          <Field label="Job description" value={values.jobDescription} onChangeText={(value) => updateField('jobDescription', value)} multiline />
          <Pressable style={styles.secondaryButton} onPress={applySuggestedDescription}>
            <Text style={styles.secondaryButtonText}>Generate Description</Text>
          </Pressable>
          <Field label="Notes" value={values.notes} onChangeText={(value) => updateField('notes', value)} multiline />

          <ToggleList
            label="Job operations"
            options={jobOperationOptions.map((option) => ({ id: option.id, label: option.label }))}
            selected={values.selectedJobOperations}
            onToggle={(id) => toggleSelection('selectedJobOperations', id)}
          />
          <ToggleList
            label="Section operations"
            options={sectionOperationOptions.map((option) => ({ id: option.id, label: option.label }))}
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
          {!!quoteResponse && <Text style={styles.previewText}>{quoteResponse}</Text>}
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
  suggestionList: {
    gap: 8,
  },
  suggestionItem: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe6f1',
    padding: 10,
    backgroundColor: '#f6fbff',
  },
  suggestionSelected: {
    borderColor: '#13d9c8',
    backgroundColor: '#0f5ef7',
  },
  suggestionTitle: {
    color: '#0d2033',
    fontWeight: '800',
  },
  suggestionTitleSelected: {
    color: '#ffffff',
  },
  suggestionMeta: {
    color: '#64809c',
    fontSize: 12,
  },
  suggestionMetaSelected: {
    color: '#d7f7ff',
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
});
