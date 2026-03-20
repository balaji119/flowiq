import { processOptions, stockOptions } from '../constants';
import { CalculationSummary, OrderFormValues } from '../types';

function toNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function findProcessRate(label: string) {
  return processOptions.find((option) => option.label === label)?.ratePerSqm ?? 0;
}

function findProcessSpeed(label: string) {
  const matched = label.match(/(\d+(?:\.\d+)?)\s*sqm\/hr/i);
  return matched ? Number(matched[1]) : 0;
}

function findMaterialRate(stockCode: string) {
  return stockOptions.find((option) => option.stockCode === stockCode)?.materialRatePerSqm ?? 0;
}

export function buildCalculationSummary(values: OrderFormValues): CalculationSummary {
  const quantity = toNumber(values.quantity);
  const width = toNumber(values.finishWidth);
  const height = toNumber(values.finishHeight);
  const wastePercent = toNumber(values.wastePercent);
  const setupCost = toNumber(values.setupCost);
  const cutCostPerUnit = toNumber(values.cutCostPerUnit);
  const finishAreaSqm = (width * height) / 1_000_000;
  const totalAreaSqm = finishAreaSqm * quantity;
  const chargeableAreaSqm = totalAreaSqm * (1 + wastePercent / 100);
  const printSides = values.processReverse ? 2 : 1;
  const processRate = findProcessRate(values.processFront);
  const materialRate = findMaterialRate(values.stockCode);
  const printSpeed = findProcessSpeed(values.processFront);
  const materialCost = chargeableAreaSqm * materialRate;
  const printCost = chargeableAreaSqm * printSides * processRate;
  const finishingCost =
    quantity * cutCostPerUnit +
    values.selectedJobOperations.length * 7.5 +
    values.selectedSectionOperations.length * 12.5;
  const estimatedRunHours = printSpeed > 0 ? (chargeableAreaSqm * printSides) / printSpeed : 0;
  const estimatedTotal = setupCost + materialCost + printCost + finishingCost;

  return {
    quantity,
    finishAreaSqm,
    totalAreaSqm,
    chargeableAreaSqm,
    printSides,
    estimatedRunHours,
    materialCost,
    printCost,
    finishingCost,
    setupCost,
    estimatedTotal,
  };
}
