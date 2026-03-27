import { formatKeys, QuantityBreakdown } from './types';

export function createEmptyBreakdown(): QuantityBreakdown {
  return {
    '8-sheet': 0,
    '6-sheet': 0,
    '4-sheet': 0,
    '2-sheet': 0,
    QA0: 0,
    Mega: 0,
    'DOT M': 0,
    MP: 0,
  };
}

export function sumBreakdowns(values: QuantityBreakdown[]): QuantityBreakdown {
  return values.reduce((totals, current) => {
    const next = { ...totals };
    for (const key of formatKeys) {
      next[key] += current[key];
    }
    return next;
  }, createEmptyBreakdown());
}

export function posterTotal(breakdown: QuantityBreakdown) {
  return breakdown['8-sheet'] + breakdown['6-sheet'] + breakdown['4-sheet'] + breakdown['2-sheet'] + breakdown.QA0;
}

export function frameTotal(breakdown: QuantityBreakdown) {
  return (
    breakdown['8-sheet'] / 4 +
    breakdown['6-sheet'] / 3 +
    breakdown['4-sheet'] / 2 +
    breakdown['2-sheet'] +
    breakdown.QA0 / 4
  );
}

export function specialFormatTotal(breakdown: QuantityBreakdown) {
  return breakdown.Mega + breakdown['DOT M'] + breakdown.MP;
}

export function totalUnits(breakdown: QuantityBreakdown) {
  return posterTotal(breakdown) + specialFormatTotal(breakdown);
}
