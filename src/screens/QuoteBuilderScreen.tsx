import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { defaultFormValues, jobOperationOptions, processOptions, sectionOperationOptions, stockOptions } from '../constants';
import { submitQuoteForPricing } from '../services/quoteApi';
import { CalculationSummary, OrderFormValues } from '../types';
import { buildCalculationSummary } from '../utils/calculations';
import { buildDefaultJobDescription, buildPrintIqPayload } from '../utils/printiq';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-AU', {
    maximumFractionDigits: 2,
  }).format(value);
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        multiline={multiline}
        numberOfLines={multiline ? 4 : 1}
        placeholder={placeholder}
        keyboardType={keyboardType}
        value={value}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.inputMultiline]}
        placeholderTextColor="#6b7785"
      />
    </View>
  );
}

function SelectPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pillWrap}>
        {options.map((option) => {
          const selected = option === value;
          const pillLabel = option || 'No reverse print';
          return (
            <Pressable
              key={pillLabel}
              onPress={() => onChange(option)}
              style={[styles.pill, selected && styles.pillSelected]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{pillLabel}</Text>
            </Pressable>
          );
        })}
      </View>
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
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.toggleList}>
        {options.map((option) => {
          const enabled = selected.includes(option);
          return (
            <View key={option} style={styles.toggleRow}>
              <Text style={styles.toggleText}>{option}</Text>
              <Switch value={enabled} onValueChange={() => onToggle(option)} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function SummaryCard({ summary }: { summary: CalculationSummary }) {
  return (
    <View style={styles.summaryGrid}>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryLabel}>Finished area</Text>
        <Text style={styles.summaryValue}>{formatNumber(summary.finishAreaSqm)} sqm</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryLabel}>Chargeable area</Text>
        <Text style={styles.summaryValue}>{formatNumber(summary.chargeableAreaSqm)} sqm</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryLabel}>Run hours</Text>
        <Text style={styles.summaryValue}>{formatNumber(summary.estimatedRunHours)} hrs</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryLabel}>Estimated total</Text>
        <Text style={styles.summaryValue}>{formatCurrency(summary.estimatedTotal)}</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryLabel}>Material</Text>
        <Text style={styles.summaryValue}>{formatCurrency(summary.materialCost)}</Text>
      </View>
      <View style={styles.summaryItem}>
        <Text style={styles.summaryLabel}>Print</Text>
        <Text style={styles.summaryValue}>{formatCurrency(summary.printCost)}</Text>
      </View>
    </View>
  );
}

export function QuoteBuilderScreen() {
  const [values, setValues] = useState<OrderFormValues>(defaultFormValues);
  const [submitting, setSubmitting] = useState(false);
  const [quoteResponse, setQuoteResponse] = useState('');
  const [error, setError] = useState('');

  const calculation = useMemo(() => buildCalculationSummary(values), [values]);
  const payload = useMemo(() => buildPrintIqPayload(values, calculation), [values, calculation]);

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

  function toggleListValue(field: 'selectedJobOperations' | 'selectedSectionOperations', value: string) {
    setValues((current) => {
      const nextValues = current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value];

      return {
        ...current,
        [field]: nextValues,
      };
    });
  }

  function applySuggestedDescription() {
    updateField('jobDescription', buildDefaultJobDescription(values));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    setQuoteResponse('');

    try {
      const response = await submitQuoteForPricing(payload);
      setQuoteResponse(JSON.stringify(response, null, 2));
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unknown submission error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.select({ ios: 'padding', default: undefined })}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>ADS Australia x Revolution360</Text>
          <Text style={styles.title}>FlowIQ Quote Builder</Text>
          <Text style={styles.subtitle}>
            Shared Expo app for web and mobile that captures order inputs, runs local quote calculations,
            and sends the final job payload to PrintIQ.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer & Job</Text>
          <Field label="Customer code" value={values.customerCode} onChangeText={(value) => updateField('customerCode', value)} />
          <Field
            label="Customer reference"
            value={values.customerReference}
            onChangeText={(value) => updateField('customerReference', value)}
          />
          <Field label="Job title" value={values.jobTitle} onChangeText={(value) => updateField('jobTitle', value)} />
          <Field label="Kind name / SKU" value={values.kindName} onChangeText={(value) => updateField('kindName', value)} />
          <Field
            label="Job description"
            value={values.jobDescription}
            onChangeText={(value) => updateField('jobDescription', value)}
            multiline
          />
          <Pressable style={styles.secondaryButton} onPress={applySuggestedDescription}>
            <Text style={styles.secondaryButtonText}>Generate suggested description</Text>
          </Pressable>
          <Field label="Notes" value={values.notes} onChangeText={(value) => updateField('notes', value)} multiline />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Product Spec</Text>
          <Field label="Quantity" value={values.quantity} onChangeText={(value) => updateField('quantity', value)} keyboardType="numeric" />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field
                label="Finished width (mm)"
                value={values.finishWidth}
                onChangeText={(value) => updateField('finishWidth', value)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.rowItem}>
              <Field
                label="Finished height (mm)"
                value={values.finishHeight}
                onChangeText={(value) => updateField('finishHeight', value)}
                keyboardType="numeric"
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field
                label="Section width (mm)"
                value={values.sectionWidth}
                onChangeText={(value) => updateField('sectionWidth', value)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.rowItem}>
              <Field
                label="Section height (mm)"
                value={values.sectionHeight}
                onChangeText={(value) => updateField('sectionHeight', value)}
                keyboardType="numeric"
              />
            </View>
          </View>
          <Field label="Pages" value={values.pages} onChangeText={(value) => updateField('pages', value)} keyboardType="numeric" />
          <SelectPills
            label="Stock"
            value={values.stockCode}
            options={stockOptions.map((option) => option.stockCode)}
            onChange={(value) => updateField('stockCode', value)}
          />
          <SelectPills
            label="Front process"
            value={values.processFront}
            options={processOptions.map((option) => option.label)}
            onChange={(value) => updateField('processFront', value)}
          />
          <SelectPills
            label="Reverse process"
            value={values.processReverse}
            options={['', ...processOptions.map((option) => option.label)]}
            onChange={(value) => updateField('processReverse', value)}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Operations & Costs</Text>
          <Field
            label="Waste %"
            value={values.wastePercent}
            onChangeText={(value) => updateField('wastePercent', value)}
            keyboardType="numeric"
          />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field
                label="Setup cost"
                value={values.setupCost}
                onChangeText={(value) => updateField('setupCost', value)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.rowItem}>
              <Field
                label="Cut cost / unit"
                value={values.cutCostPerUnit}
                onChangeText={(value) => updateField('cutCostPerUnit', value)}
                keyboardType="numeric"
              />
            </View>
          </View>
          <Field
            label="Target freight price"
            value={values.targetFreightPrice}
            onChangeText={(value) => updateField('targetFreightPrice', value)}
            keyboardType="numeric"
          />
          <ToggleList
            label="Job operations"
            options={jobOperationOptions.map((option) => option.name)}
            selected={values.selectedJobOperations}
            onToggle={(value) => toggleListValue('selectedJobOperations', value)}
          />
          <ToggleList
            label="Section operations"
            options={sectionOperationOptions.map((option) => option.name)}
            selected={values.selectedSectionOperations}
            onToggle={(value) => toggleListValue('selectedSectionOperations', value)}
          />
          <SummaryCard summary={calculation} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quote Contact</Text>
          <Field label="Title" value={values.contact.title} onChangeText={(value) => updateContactField('title', value)} />
          <View style={styles.row}>
            <View style={styles.rowItem}>
              <Field
                label="First name"
                value={values.contact.firstName}
                onChangeText={(value) => updateContactField('firstName', value)}
              />
            </View>
            <View style={styles.rowItem}>
              <Field
                label="Surname"
                value={values.contact.surname}
                onChangeText={(value) => updateContactField('surname', value)}
              />
            </View>
          </View>
          <Field
            label="Email"
            value={values.contact.email}
            onChangeText={(value) => updateContactField('email', value)}
            keyboardType="email-address"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>PrintIQ Payload Preview</Text>
          <Text style={styles.previewText}>{JSON.stringify(payload, null, 2)}</Text>
          <Pressable style={[styles.primaryButton, submitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.primaryButtonText}>{submitting ? 'Submitting...' : 'Create Quote In PrintIQ'}</Text>
          </Pressable>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          {!!quoteResponse && <Text style={styles.previewText}>{quoteResponse}</Text>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4efe7',
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1100,
    gap: 16,
  },
  hero: {
    paddingTop: 28,
    paddingBottom: 8,
    gap: 8,
  },
  eyebrow: {
    color: '#8b4c2f',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  title: {
    color: '#13212f',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#445468',
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 820,
  },
  card: {
    backgroundColor: '#fffdf9',
    borderRadius: 24,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#e8dfd0',
    shadowColor: '#7d5b46',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardTitle: {
    color: '#13212f',
    fontSize: 22,
    fontWeight: '700',
  },
  field: {
    gap: 6,
  },
  label: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d6cbb8',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    color: '#13212f',
  },
  inputMultiline: {
    minHeight: 108,
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
    borderColor: '#d6cbb8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  pillSelected: {
    backgroundColor: '#13212f',
    borderColor: '#13212f',
  },
  pillText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#fff',
  },
  toggleList: {
    gap: 10,
  },
  toggleRow: {
    borderWidth: 1,
    borderColor: '#eadfce',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
  },
  toggleText: {
    flex: 1,
    color: '#243447',
    fontSize: 14,
    fontWeight: '600',
  },
  summaryGrid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryItem: {
    minWidth: 150,
    flexGrow: 1,
    backgroundColor: '#13212f',
    borderRadius: 18,
    padding: 14,
    gap: 4,
  },
  summaryLabel: {
    color: '#d0dbeb',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: '#fff8ef',
    fontSize: 18,
    fontWeight: '800',
  },
  previewText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 18,
    color: '#223247',
    backgroundColor: '#f5efe5',
    borderRadius: 16,
    padding: 14,
  },
  primaryButton: {
    borderRadius: 16,
    backgroundColor: '#bf5a2a',
    paddingHorizontal: 18,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bf5a2a',
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#bf5a2a',
    fontSize: 14,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  errorText: {
    color: '#b42318',
    fontWeight: '700',
  },
});
