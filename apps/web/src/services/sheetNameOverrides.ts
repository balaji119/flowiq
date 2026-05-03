import { FormatKey, SheetNameOverrides } from '@flowiq/shared';

export type SheetNamePresetEntry = {
  key: string;
  label: string;
};

export const sheetNamePresetEntries: SheetNamePresetEntry[] = [
  { key: '8-sheet', label: '8 Sheet' },
  { key: '8-sheet-a0', label: '8 Sheet A0' },
  { key: '6-sheet', label: '6 Sheet' },
  { key: '4-sheet', label: '4 Sheet' },
  { key: '2-sheet', label: '2 Sheet' },
  { key: 'mega', label: 'Mega' },
  { key: 'dot-m', label: 'DOT Mega' },
  { key: 'mega-portrait', label: 'Mega Portrait' },
  { key: 'mini-mega', label: 'Mini Mega' },
];

export const defaultSheetNamePresetOverrides: Record<string, string> = {
  '8-sheet': 'Quad',
  '8-sheet-a0': 'Quad A0',
  '6-sheet': 'Triple',
  '4-sheet': 'Double',
  '2-sheet': 'Single',
};

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function toCanonicalSheetNameKey(value: string) {
  const normalized = normalizeToken(value);
  if (!normalized) return '';

  if (normalized === '8 sheet' || normalized === '8sheet') return '8-sheet';
  if (
    normalized === '8 sheet a0'
    || normalized === '8sheet a0'
    || normalized === 'a0 8 sheet'
    || normalized === 'qa0'
    || normalized === 'qao'
    || normalized === '8 sheet qa0'
    || normalized === 'a0 sized 8 sheet'
    || normalized === 'a0 sized 4 sheet'
  ) {
    return '8-sheet-a0';
  }
  if (normalized === '6 sheet' || normalized === '6sheet') return '6-sheet';
  if (normalized === '4 sheet' || normalized === '4sheet') return '4-sheet';
  if (normalized === '2 sheet' || normalized === '2sheet') return '2-sheet';
  if (normalized === 'mega') return 'mega';
  if (normalized === 'dot m' || normalized === 'dotm' || normalized === 'dot mega' || normalized === 'dot megasite') return 'dot-m';
  if (normalized === 'mega portrait' || normalized === 'mp') return 'mega-portrait';
  if (normalized === 'mini mega') return 'mini-mega';

  return normalized.replace(/\s+/g, '-');
}

export function sanitizeSheetNameOverrides(overrides: SheetNameOverrides | null | undefined): SheetNameOverrides {
  if (!overrides || typeof overrides !== 'object') return {};
  const sanitized: SheetNameOverrides = {};
  Object.entries(overrides).forEach(([rawKey, rawValue]) => {
    const key = toCanonicalSheetNameKey(rawKey);
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!key || !value) return;
    sanitized[key] = value;
  });
  return sanitized;
}

export function defaultFormatDisplayName(key: FormatKey) {
  if (key === 'Mega') return 'Mega';
  if (key === 'DOT M') return 'DOT Mega';
  if (key === 'MP') return 'Mega Portrait';
  if (key === 'QA0') return 'QA0';
  return key;
}

export function canonicalKeyForFormat(key: FormatKey) {
  if (key === '8-sheet') return '8-sheet';
  if (key === '6-sheet') return '6-sheet';
  if (key === '4-sheet') return '4-sheet';
  if (key === '2-sheet') return '2-sheet';
  if (key === 'QA0') return '8-sheet-a0';
  if (key === 'Mega') return 'mega';
  if (key === 'DOT M') return 'dot-m';
  if (key === 'MP') return 'mega-portrait';
  return toCanonicalSheetNameKey(key);
}

export function resolveSheetName(rawName: string, overrides: SheetNameOverrides, fallbackCanonicalKey?: string) {
  const normalizedOverrides = sanitizeSheetNameOverrides(overrides);
  const key = fallbackCanonicalKey || toCanonicalSheetNameKey(rawName);
  if (key && normalizedOverrides[key]) {
    return normalizedOverrides[key];
  }
  return rawName;
}

export function resolveFormatName(key: FormatKey, overrides: SheetNameOverrides) {
  return resolveSheetName(defaultFormatDisplayName(key), overrides, canonicalKeyForFormat(key));
}
