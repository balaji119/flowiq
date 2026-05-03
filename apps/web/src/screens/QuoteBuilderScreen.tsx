import { Fragment, type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronUp, CircleAlert, Eye, LoaderCircle, Maximize2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  CampaignAsset,
  CampaignPrintImage,
  CampaignRecord,
  CampaignCalculationSummary,
  CampaignLine,
  CampaignMarket,
  MarketAssetPrintingCostRecord,
  MarketAssetShippingCostRecord,
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
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Label, Textarea, cn } from '@flowiq/ui';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { buildApiUrl } from '../services/apiBase';
import { acquireCampaignEditLock, createCampaign, fetchCampaign, releaseCampaignEditLock, submitCampaignToPrintIQ, updateCampaign as updateStoredCampaign } from '../services/campaignApi';
import { deleteCampaignImage, uploadCampaignImage } from '../services/campaignImageApi';
import { calculateCampaign, fetchCalculatorMetadata } from '../services/calculatorApi';
import { sendEmailToAds } from '../services/finalizeApi';
import { fetchCampaignMarketAssetPrintingCosts, fetchCampaignMarketAssetShippingCosts, fetchCampaignMarketDeliveryAddresses, fetchCampaignMarketShippingRates } from '../services/marketDeliveryApi';
import { fetchQuoteOptions } from '../services/printiqOptionsApi';
import { uploadPurchaseOrderFile } from '../services/purchaseOrderApi';
import ExcelJS from 'exceljs';
import { Document as WordDocument, ExternalHyperlink, ImageRun, LineRuleType, Packer, Paragraph, TextRun, UnderlineType } from 'docx';

const ACTIVE_CAMPAIGN_ID_KEY = 'adsconnect-active-campaign-id';
const VISUALS_EXPORT_MODE = parseVisualsExportMode(process.env.EXPORT_EXCEL);

type VisualsExportMode = 'excel' | 'word';

type GeneratedVisualExportFile = {
  fileName: string;
  blob: Blob;
  mimeType: string;
};

function parseVisualsExportMode(value: string | undefined): VisualsExportMode {
  const normalized = (value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized) ? 'excel' : 'word';
}

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
        <div key={key} className={cn('rounded-md border px-4 py-3', inverse ? 'border-slate-700 bg-slate-900' : 'border-slate-700/70 bg-slate-800/80')}>
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

function calculateShippingCost(units: number, perBoxPrice: number, postersPerBox: number) {
  if (units <= 0 || perBoxPrice <= 0) return 0;
  const safePostersPerBox = Math.max(1, Math.floor(postersPerBox || 60));
  const boxCount = Math.ceil(units / safePostersPerBox);
  return boxCount * perBoxPrice;
}

function calculatePosterShippingForSheeter(posters: number, pricePerBox: number, postersPerSet: number, setsPerBox: number) {
  if (posters <= 0 || pricePerBox <= 0) return 0;
  const safePostersPerSet = Math.max(1, Math.floor(postersPerSet || 1));
  const safeSetsPerBox = Math.max(1, Math.floor(setsPerBox || 15));
  const sets = posters / safePostersPerSet;
  const boxes = Math.ceil(sets / safeSetsPerBox);
  return boxes * pricePerBox;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatKeyLabel(key: (typeof formatKeys)[number]) {
  if (key === 'Mega') return 'Megasite';
  if (key === 'DOT M') return 'DOT Megasite';
  if (key === 'MP') return 'Mega Portrait';
  return key;
}

const creativeFormatKeys = ['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'Mega', 'DOT M', 'MP'] as const;
type CreativeFormatKey = (typeof creativeFormatKeys)[number];

function creativeFormatLabel(key: CreativeFormatKey) {
  if (key === '8-sheet') return '8-sheet / QA0';
  return formatKeyLabel(key);
}

function toCreativeFormatKey(key: keyof QuantityBreakdown): CreativeFormatKey {
  if (key === 'QA0') return '8-sheet';
  return key as CreativeFormatKey;
}

function normalizeCreativeImageIds(asset: CampaignAsset): Partial<Record<CreativeFormatKey, string>> {
  const normalized: Partial<Record<CreativeFormatKey, string>> = {};
  creativeFormatKeys.forEach((key) => {
    const mapped = (asset.creativeImageIds?.[key] || '').trim();
    if (mapped) {
      normalized[key] = mapped;
    }
  });

  const legacyCreativeId = (asset.creativeImageId || '').trim();
  if (legacyCreativeId && Object.keys(normalized).length === 0) {
    creativeFormatKeys.forEach((key) => {
      normalized[key] = legacyCreativeId;
    });
  }
  return normalized;
}

function getCreativeImageIdForFormat(asset: CampaignAsset, format: CreativeFormatKey) {
  const mapped = (asset.creativeImageIds?.[format] || '').trim();
  if (mapped) return mapped;
  const hasExplicitFormatMappings = Object.values(asset.creativeImageIds ?? {}).some((value) => (value || '').trim().length > 0);
  if (hasExplicitFormatMappings) return '';
  return (asset.creativeImageId || '').trim();
}

function getCreativeFormatsForBreakdown(breakdown: QuantityBreakdown | null | undefined) {
  const formats = new Set<CreativeFormatKey>();
  if (!breakdown) return [];
  (Object.keys(breakdown) as Array<keyof QuantityBreakdown>).forEach((key) => {
    if ((breakdown[key] ?? 0) > 0) {
      formats.add(toCreativeFormatKey(key));
    }
  });
  return Array.from(formats);
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

function getTodayDateInputValue() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDateBeforeToday(value: string) {
  const parsed = parseDateOnly(value);
  if (!parsed) return false;
  parsed.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
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

function isPdfFile(file: File) {
  const lowerName = file.name.toLowerCase();
  return file.type === 'application/pdf' || lowerName.endsWith('.pdf');
}

function normalizeFormValues(values: OrderFormValues): OrderFormValues {
  const normalizeCampaignImageUrl = (url?: string) =>
    url && url.startsWith('/uploads/campaign-images/')
      ? url.replace('/uploads/campaign-images/', '/api/campaign-images/')
      : url;

  return {
    ...values,
    campaignMarkets: (values.campaignMarkets ?? []).map((market) => ({
      ...market,
      assets: (market.assets ?? []).map((asset) => {
        const creativeImageIds = normalizeCreativeImageIds(asset);
        return {
          ...asset,
          creativeImageIds,
          creativeImageId: getCreativeImageIdForFormat({ ...asset, creativeImageIds }, '8-sheet') || asset.creativeImageId || '',
        };
      }),
    })),
    printImages: (values.printImages ?? []).map((image) => ({
      id: image.id,
      name: image.name,
      fileName: image.fileName,
      mimeType: image.mimeType,
      storedName: image.storedName,
      imageUrl: normalizeCampaignImageUrl(image.imageUrl),
      thumbnailFileName: image.thumbnailFileName,
      thumbnailStoredName: image.thumbnailStoredName,
      thumbnailUrl: normalizeCampaignImageUrl(image.thumbnailUrl),
      sourcePdfFileName: image.sourcePdfFileName,
      sourcePdfStoredName: image.sourcePdfStoredName,
      sourcePdfUrl: normalizeCampaignImageUrl(image.sourcePdfUrl),
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

const exportStates = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'] as const;
type ExportState = (typeof exportStates)[number];

function normalizeExportState(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized.includes('NSW') || normalized.includes('SYD')) return 'NSW' as const;
  if (normalized.includes('VIC') || normalized.includes('MEL')) return 'VIC' as const;
  if (normalized.includes('QLD') || normalized.includes('BRIS')) return 'QLD' as const;
  if (normalized.includes('WA') || normalized.includes('PERTH')) return 'WA' as const;
  if (normalized.includes('SA') || normalized.includes('ADELAIDE')) return 'SA' as const;
  if (normalized.includes('TAS') || normalized.includes('HOBART')) return 'TAS' as const;
  if (normalized.includes('ACT') || normalized.includes('CANBERRA')) return 'ACT' as const;
  if (normalized.includes('NT') || normalized.includes('DARWIN')) return 'NT' as const;
  return null;
}

function inferStateFromMarket(marketName: string) {
  return normalizeExportState(marketName);
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '').trim();
}

function buildCreativeCode(state: ExportState, creativeNumber: number) {
  const prefixByState: Record<ExportState, string> = {
    NSW: 'CS',
    VIC: 'CM',
    QLD: 'CB',
    WA: 'CW',
    SA: 'CA',
    TAS: 'CT',
    ACT: 'CC',
    NT: 'CN',
  };
  const prefix = prefixByState[state] ?? 'CS';
  return `${prefix}${creativeNumber}`;
}

function getCreativeNumberFromCode(creativeCode: string) {
  const numeric = creativeCode.replace(/^[A-Z]+/, '');
  const parsed = Number.parseInt(numeric, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function downloadBlobWithFileName(blob: Blob, fileName: string) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  // Some browsers need a small delay before revoking object URLs, otherwise
  // the saved file may end up with a temporary name/extension.
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
    anchor.remove();
  }, 1500);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Unable to read image blob'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const meta = dataUrl.slice(0, commaIndex).toLowerCase();
  const encoded = dataUrl.slice(commaIndex + 1);
  if (!meta.includes(';base64')) return null;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const extension = meta.includes('image/jpeg') || meta.includes('image/jpg') ? 'jpg' : 'png';
  return { bytes, extension } as const;
}

const WORD_FOLDER_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAqklEQVR4AeyWSwqAIBRFrf3UOCKifUWjaAW1oCiIdlUq+AYS+E0nN7r+8HM8I0uW+csP0LbN45kzhrwQAx0HD4YggH0/mG3meVGXFxC+BuU6AlA7pq4JYBh6ZptpGiVnVdXW1nS7cgNeEABvO/3i8HXdnNZ8TSYAndDUj3G4ACIA0ckRAMAADMAADMAADMAADJAB2xdxrHnq+UcAaiB1XV7XXeTM7wZMRl8AAAD//5quy1QAAAAGSURBVAMANKD4Qc3tQ0sAAAAASUVORK5CYII=';
const WORD_PDF_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAB0klEQVR4AcyXT04CMRTGyyxm58pjTHBt0DEY74BXwEROYFgRT4CJ4AVE7mAkTiQewB7DlQfAfk0eKa9l2mmGGQgf/fO+tr++Ngwkgr16vfNNpAo2VVDTAgga5TZdKvDKEHsBVqtPESLGUhliLwCb2Nvsds/IUwmiNoDp9EnEQNQGgO3HQNQKEANRO0BVCAtgvf7uQGmadkIEL8S98/mLngcxpRxgLlkALtMh+5Lf/GLTptrPAKX35P1DNCla93gyQET9/pUwNZs9U0iXZozq3AMjxcwS/VzODEwmj/pBhFJKKfgC6KcHFerwjEb3fG6BGPlQWgbV4QRQ/fqd57kYDG7FYvGq264PePAVjBgHRZ9PpQC+wWbcB2p6zboXYLl8M59y5lhvXcoffXzITFG4f6s4AcbjB4EzxQXCKpRi1KtIqvtDfqlgqG6WTgA815FSXJzQxbEAxpmTY47h8E6QzBjVnQAYiMtFppASFzXLshDrjscJsOPwNHC+OC7sHjv12K1wFADuCO4HJNU5Y+ehR8UJLACce1n6ETeFhV07h6dsHgKxACjQVLkF+Lu5Fk2KNrgFoI6my+S0+Oq0qfYzwFOu/mDG/jsOGsfXO3gG+IK8/Q8AAP//tC16dwAAAAZJREFUAwClos9YP/kZEAAAAABJRU5ErkJggg==';
const WORD_FOLDER_ICON = dataUrlToBytes(WORD_FOLDER_ICON_DATA_URL);
const WORD_PDF_ICON = dataUrlToBytes(WORD_PDF_ICON_DATA_URL);

function createWordIconRun(kind: 'folder' | 'pdf') {
  const icon = kind === 'folder' ? WORD_FOLDER_ICON : WORD_PDF_ICON;
  if (!icon) return null;
  return new ImageRun({
    type: icon.extension,
    data: icon.bytes,
    transformation: { width: 16, height: 16 },
  });
}

function createWordIconChildren(kind: 'folder' | 'pdf'): Array<ImageRun | TextRun> {
  const iconRun = createWordIconRun(kind);
  if (!iconRun) return [];
  return [iconRun, new TextRun(' ')];
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

function detectStateMarkerColumns(sheet: any, headerRow: number, fromColumn: number, toColumn: number) {
  const markerColumnByState = new Map<ExportState, number>();
  for (let col = fromColumn; col <= toColumn; col += 1) {
    const cell = sheet.getCell(headerRow, col);
    const text = String(cell?.text ?? cell?.value ?? '').trim();
    const state = normalizeExportState(text);
    if (state && !markerColumnByState.has(state)) {
      markerColumnByState.set(state, col);
    }
  }
  return markerColumnByState;
}

function stripSharedFormulaClones(workbook: any) {
  workbook.worksheets.forEach((sheet: any) => {
    sheet.eachRow({ includeEmpty: true }, (row: any) => {
      row.eachCell({ includeEmpty: true }, (cell: any) => {
        const value = cell.value as
          | {
              sharedFormula?: string;
              result?: unknown;
            }
          | null;
        if (!value || typeof value !== 'object') return;
        if (!('sharedFormula' in value) || !value.sharedFormula) return;
        // Shared-formula clones in templates can break after row inserts.
        // Keep export stable by materializing clone results as static values.
        cell.value = value.result ?? null;
      });
    });
  });
}

async function pdfFirstPageToDataUrl(blob: Blob, maxWidth = 560) {
  const pdfjs = await loadPdfJsRuntime();

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

async function loadPdfJsRuntime() {
  const pdfjs = await (new Function("return import('/pdf.min.mjs')")() as Promise<any>);
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    '/pdf.worker.min.mjs';
  return pdfjs;
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to render artwork image'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function buildArtworkPageFileName(fileName: string, pageNumber: number, totalPages: number) {
  const baseName = toFileBaseName(fileName);
  if (totalPages <= 1) {
    return `${baseName}.png`;
  }
  const digits = Math.max(2, String(totalPages).length);
  return `${baseName}-page-${String(pageNumber).padStart(digits, '0')}.png`;
}

function buildArtworkThumbnailFileName(fileName: string, pageNumber: number, totalPages: number) {
  const baseName = toFileBaseName(fileName);
  if (totalPages <= 1) {
    return `${baseName}.thumb.webp`;
  }
  const digits = Math.max(2, String(totalPages).length);
  return `${baseName}-page-${String(pageNumber).padStart(digits, '0')}.thumb.webp`;
}

async function convertPdfToArtworkPages(
  pdfFile: File,
  uploadMaxWidth = 2400,
  thumbnailMaxWidth = 320,
): Promise<Array<{ file: File; thumbnailFile: File; pageNumber: number; totalPages: number }>> {
  const pdfjs = await loadPdfJsRuntime();
  const objectUrl = URL.createObjectURL(pdfFile);
  try {
    const loadingTask = pdfjs.getDocument({ url: objectUrl });
    const pdf = await loadingTask.promise;
    const totalPages = Number(pdf.numPages ?? 0);
    const pages: Array<{ file: File; thumbnailFile: File; pageNumber: number; totalPages: number }> = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });

      const uploadScale = Math.min(1, uploadMaxWidth / Math.max(baseViewport.width, 1));
      const uploadViewport = page.getViewport({ scale: uploadScale });
      const uploadCanvas = document.createElement('canvas');
      uploadCanvas.width = Math.max(1, Math.ceil(uploadViewport.width));
      uploadCanvas.height = Math.max(1, Math.ceil(uploadViewport.height));
      const uploadContext = uploadCanvas.getContext('2d');
      if (!uploadContext) {
        throw new Error('Unable to prepare artwork upload');
      }
      await page.render({ canvasContext: uploadContext, viewport: uploadViewport }).promise;
      const uploadBlob = await canvasToBlob(uploadCanvas);
      const uploadFile = new File([uploadBlob], buildArtworkPageFileName(pdfFile.name, pageNumber, totalPages), { type: 'image/png' });

      const thumbnailScale = Math.min(1, thumbnailMaxWidth / Math.max(uploadCanvas.width, 1));
      const thumbnailCanvas = document.createElement('canvas');
      thumbnailCanvas.width = Math.max(1, Math.ceil(uploadCanvas.width * thumbnailScale));
      thumbnailCanvas.height = Math.max(1, Math.ceil(uploadCanvas.height * thumbnailScale));
      const thumbnailContext = thumbnailCanvas.getContext('2d');
      if (!thumbnailContext) {
        throw new Error('Unable to prepare artwork thumbnail');
      }
      thumbnailContext.drawImage(uploadCanvas, 0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
      const thumbnailBlob = await canvasToBlob(thumbnailCanvas, 'image/webp', 0.7);
      const thumbnailFile = new File(
        [thumbnailBlob],
        buildArtworkThumbnailFileName(pdfFile.name, pageNumber, totalPages),
        { type: 'image/webp' },
      );

      pages.push({
        file: uploadFile,
        thumbnailFile,
        pageNumber,
        totalPages,
      });
    }
    return pages;
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
  triggerClassName,
  menuItemClassName,
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
  triggerClassName?: string;
  menuItemClassName?: string;
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
        className={cn('flex h-10 w-full items-center justify-between rounded-md border border-slate-600 bg-slate-800 px-3 text-left text-sm text-slate-100 transition hover:border-slate-500', triggerClassName)}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={cn('truncate', !selectedValue && !selectedLabel ? 'text-slate-500' : 'text-slate-50')}>{displayLabel}</span>
        <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 rounded-md border border-slate-700 bg-slate-950 p-4 shadow-2xl shadow-slate-950/60">
          <div className="space-y-3">
            <Input autoFocus placeholder={`Search ${label || 'items'}`} value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
              {filteredItems.map((item) => {
                const active = item.value === selectedValue;
                return (
                  <button
                    key={item.value}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm transition',
                      active ? 'border-violet-400 bg-violet-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500',
                      menuItemClassName,
                    )}
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
              {filteredItems.length === 0 ? <p className="rounded-md border border-slate-700 bg-slate-900 px-4 py-6 text-center text-sm text-slate-400">{emptyMessage}</p> : null}
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
  small = false,
  readOnly = false,
  onToggleWeek,
}: {
  weekCount: number;
  selectedWeeks: number[];
  startDate: string;
  compact?: boolean;
  small?: boolean;
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
              compact ? 'px-2.5 py-1 text-[11px]' : small ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs',
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

function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirming = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !confirming) onCancel();
      }}
    >
      <DialogContent className="[&>button]:hidden" style={{ width: 'min(calc(100vw - 2rem), 30rem)' }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>This action is permanent and cannot be undone.</p>
        </div>
        <div className="flex justify-end gap-3">
          <Button disabled={confirming} onClick={onCancel} type="button" variant="ghost">
            {cancelLabel}
          </Button>
          <Button disabled={confirming} onClick={onConfirm} type="button" variant="destructive">
            {confirming ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {confirming ? 'Deleting...' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function normalizeCampaignMarkets(campaignMarkets: CampaignMarket[], maxWeeks: number): CampaignMarket[] {
  const allWeeks = createAllWeeks(maxWeeks);
  return campaignMarkets.map((market) => ({
    ...market,
    assets: market.assets.map((asset) => {
      const creativeImageIds = normalizeCreativeImageIds(asset);
      const normalizedSelectedWeeks = Array.isArray(asset.selectedWeeks)
        ? Array.from(
            new Set(
              asset.selectedWeeks
                .map((week) => Number(week))
                .filter((week) => Number.isInteger(week) && week >= 1 && week <= maxWeeks),
            ),
          ).sort((left, right) => left - right)
        : allWeeks;
      return {
        ...asset,
        creativeImageId: getCreativeImageIdForFormat({ ...asset, creativeImageIds }, '8-sheet') || '',
        creativeImageIds,
        deliveryAddress: asset.deliveryAddress || '',
        selectedWeeks: normalizedSelectedWeeks,
      };
    }),
  }));
}

const defaultValues = createDefaultFormValues();
function toStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toStableValue(item));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .forEach((key) => {
        sorted[key] = toStableValue(record[key]);
      });
    return sorted;
  }
  return value;
}

function stableSerialize(value: unknown) {
  return JSON.stringify(toStableValue(value));
}

const defaultValuesSerialized = stableSerialize(defaultValues);

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
  const { session } = useAuth();
  const [values, setValues] = useState<OrderFormValues>(() => defaultValues);
  const [campaignId, setCampaignId] = useState<string | null>(selectedCampaignId ?? null);
  const [campaignStatus, setCampaignStatus] = useState<CampaignRecord['status']>('draft');
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [marketDeliveryAddresses, setMarketDeliveryAddresses] = useState<MarketDeliveryAddressRecord[]>([]);
  const [marketShippingRates, setMarketShippingRates] = useState<MarketShippingRateRecord[]>([]);
  const [marketAssetPrintingCosts, setMarketAssetPrintingCosts] = useState<MarketAssetPrintingCostRecord[]>([]);
  const [marketAssetShippingCosts, setMarketAssetShippingCosts] = useState<MarketAssetShippingCostRecord[]>([]);
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
  const [exportingTemplates, setExportingTemplates] = useState(false);
  const [sendingAdsEmail, setSendingAdsEmail] = useState(false);
  const [exportProgressMessage, setExportProgressMessage] = useState('');
  const [selectedPurchaseOrderFile, setSelectedPurchaseOrderFile] = useState<File | null>(null);
  const [uploadingPurchaseOrder, setUploadingPurchaseOrder] = useState(false);
  const [uploadedPurchaseOrderName, setUploadedPurchaseOrderName] = useState('');
  const [purchaseOrderUploadSuccessOpen, setPurchaseOrderUploadSuccessOpen] = useState(false);
  const [purchaseOrderUploadSuccessMessage, setPurchaseOrderUploadSuccessMessage] = useState('');
  const [assignArtworkDialogOpen, setAssignArtworkDialogOpen] = useState(false);
  const [assignArtworkTarget, setAssignArtworkTarget] = useState<{ marketId: string; assetId: string; formatKey: CreativeFormatKey } | null>(null);
  const [previewArtworkDialogOpen, setPreviewArtworkDialogOpen] = useState(false);
  const [previewArtworkTarget, setPreviewArtworkTarget] = useState<{ marketId: string; assetId: string; formatKey: CreativeFormatKey } | null>(null);
  const [previewArtworkFullLoaded, setPreviewArtworkFullLoaded] = useState(false);
  const [uploadingArtworkPages, setUploadingArtworkPages] = useState(false);
  const [artworkUploadSuccessOpen, setArtworkUploadSuccessOpen] = useState(false);
  const [artworkUploadSuccessMessage, setArtworkUploadSuccessMessage] = useState('');
  const [deletingArtworkIds, setDeletingArtworkIds] = useState<string[]>([]);
  const [deleteArtworkCandidate, setDeleteArtworkCandidate] = useState<CampaignPrintImage | null>(null);
  const [confirmingArtworkDelete, setConfirmingArtworkDelete] = useState(false);
  const [artworkDialogError, setArtworkDialogError] = useState('');
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [newAddressDialogOpen, setNewAddressDialogOpen] = useState(false);
  const [addMarketDialogOpen, setAddMarketDialogOpen] = useState(false);
  const [draftMarket, setDraftMarket] = useState<CampaignMarket | null>(null);
  const [draftMarketSummary, setDraftMarketSummary] = useState<CampaignCalculationSummary['perMarket'][number] | null>(null);
  const [draftMarketCalculating, setDraftMarketCalculating] = useState(false);
  const [editingMarketId, setEditingMarketId] = useState<string | null>(null);
  const [hiddenInlineMarketIds, setHiddenInlineMarketIds] = useState<string[]>([]);
  const [treatDefaultMarketAsPlaceholder, setTreatDefaultMarketAsPlaceholder] = useState(false);
  const [marketPopupManagedFlow, setMarketPopupManagedFlow] = useState(false);
  const [hasSavedMarketViaPopup, setHasSavedMarketViaPopup] = useState(false);
  const [postersExpandedOpen, setPostersExpandedOpen] = useState(false);
  const [newAddressTarget, setNewAddressTarget] = useState<{ marketId: string; assetId: string; marketName: string } | null>(null);
  const [newAddressForm, setNewAddressForm] = useState<AddressFormState>(() => emptyAddressForm());
  const [newAddressError, setNewAddressError] = useState('');
  const [topBarCenterHost, setTopBarCenterHost] = useState<HTMLElement | null>(null);
  const [topBarActionsHost, setTopBarActionsHost] = useState<HTMLElement | null>(null);
  const [bottomBarHost, setBottomBarHost] = useState<HTMLElement | null>(null);
  const purchaseOrderInputRef = useRef<HTMLInputElement | null>(null);
  const artworkPdfInputRef = useRef<HTMLInputElement | null>(null);
  const campaignHydratedRef = useRef(false);
  const lastPersistedValuesRef = useRef('');
  const lastAutoSaveFailedValuesRef = useRef<string | null>(null);

  async function releaseActiveCampaignLock(targetCampaignId?: string | null) {
    const id = targetCampaignId ?? campaignId;
    if (!id) return;
    try {
      await releaseCampaignEditLock(id);
    } catch {
      // Best-effort cleanup only; lock will also expire automatically.
    }
  }

  useEffect(() => {
    let active = true;

    async function bootstrapCampaign() {
      try {
        const storedCampaignId = startFresh ? null : selectedCampaignId || (await getStoredCampaignId());
        if (!active) return;

        if (storedCampaignId) {
          try {
            await acquireCampaignEditLock(storedCampaignId);
            if (!active) return;
            const response = await fetchCampaign(storedCampaignId);
            if (!active) return;
            applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
            setTreatDefaultMarketAsPlaceholder(false);
            setMarketPopupManagedFlow(false);
            setHasSavedMarketViaPopup(true);
            lastPersistedValuesRef.current = stableSerialize(response.campaign.values);
            campaignHydratedRef.current = true;
            await setStoredCampaignId(response.campaign.id);
            return;
          } catch (loadError) {
            if (!active) return;
            const message = loadError instanceof Error ? loadError.message : 'Unable to load campaign draft';
            setError(message);
            if (selectedCampaignId) {
              await setStoredCampaignId(null);
              setLoadingCampaign(false);
              onBack?.();
              return;
            }
            await setStoredCampaignId(null);
          }
        }
        setValues(defaultValues);
        setSummary(null);
        setUploadedPurchaseOrderName('');
        setCampaignId(null);
        setCampaignStatus('draft');
        setTreatDefaultMarketAsPlaceholder(true);
        setMarketPopupManagedFlow(true);
        setHasSavedMarketViaPopup(false);
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
  }, [onBack, selectedCampaignId, startFresh]);

  useEffect(() => {
    if (!campaignId) return;

    let active = true;
    const intervalId = window.setInterval(async () => {
      try {
        await acquireCampaignEditLock(campaignId);
      } catch (lockError) {
        if (!active) return;
        setError(lockError instanceof Error ? lockError.message : 'Campaign lock expired');
      }
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    return () => {
      void releaseCampaignEditLock(campaignId).catch(() => {
        // Best-effort cleanup only; lock will also expire automatically.
      });
    };
  }, [campaignId]);

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
    async function loadMarketAssetShippingCosts() {
      try {
        const response = await fetchCampaignMarketAssetShippingCosts();
        if (!active) return;
        setMarketAssetShippingCosts(response.costs);
      } catch {
        if (!active) return;
        setMarketAssetShippingCosts([]);
      }
    }
    void loadMarketAssetShippingCosts();
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
    let active = true;
    async function loadMarketAssetPrintingCosts() {
      try {
        const response = await fetchCampaignMarketAssetPrintingCosts();
        if (!active) return;
        setMarketAssetPrintingCosts(response.costs);
      } catch {
        if (!active) return;
        setMarketAssetPrintingCosts([]);
      }
    }
    void loadMarketAssetPrintingCosts();
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
  const marketNames = useMemo(() => markets.map((market) => market.name), [markets]);
  const isDefaultPlaceholderMarket = useMemo(
    () => (market: CampaignMarket) => {
      if (!treatDefaultMarketAsPlaceholder) return false;
      if (market.market !== 'Sydney') return false;
      if (market.assets.length !== 1) return false;
      const onlyAsset = market.assets[0];
      return !onlyAsset.assetId && !onlyAsset.assetSearch && !onlyAsset.deliveryAddress;
    },
    [treatDefaultMarketAsPlaceholder],
  );
  const effectiveCampaignMarkets = useMemo(
    () => values.campaignMarkets.filter((market) => !isDefaultPlaceholderMarket(market)),
    [isDefaultPlaceholderMarket, values.campaignMarkets],
  );
  const selectedMarketsForPopup = useMemo(() => {
    if (marketPopupManagedFlow && !hasSavedMarketViaPopup) return [];
    return effectiveCampaignMarkets;
  }, [effectiveCampaignMarkets, hasSavedMarketViaPopup, marketPopupManagedFlow]);
  const remainingMarketNames = useMemo(() => {
    const selectedMarketNames = new Set(selectedMarketsForPopup.map((market) => market.market));
    return marketNames.filter((marketName) => !selectedMarketNames.has(marketName));
  }, [marketNames, selectedMarketsForPopup]);
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
  const hiddenInlineMarketIdSet = useMemo(
    () => new Set([...hiddenInlineMarketIds, ...values.campaignMarkets.map((market) => market.id)]),
    [hiddenInlineMarketIds, values.campaignMarkets],
  );
  const visiblePlanningMarkets = useMemo(
    () => values.campaignMarkets.filter((market) => !hiddenInlineMarketIdSet.has(market.id)),
    [hiddenInlineMarketIdSet, values.campaignMarkets],
  );
  const marketSummaryByName = useMemo(() => {
    if (!summary) return new Map<string, CampaignCalculationSummary['perMarket'][number]>();
    return new Map(summary.perMarket.map((entry) => [entry.market, entry]));
  }, [summary]);
  const selectedCampaignMarketNames = useMemo(
    () => new Set(effectiveCampaignMarkets.map((market) => market.market.trim()).filter(Boolean)),
    [effectiveCampaignMarkets],
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
  const twoSheeterPriceByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.twoSheeterPrice ?? 0])),
    [marketShippingRates],
  );
  const fourSheeterPriceByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.fourSheeterPrice ?? 0])),
    [marketShippingRates],
  );
  const sixSheeterPriceByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.sixSheeterPrice ?? 0])),
    [marketShippingRates],
  );
  const eightSheeterPriceByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.eightSheeterPrice ?? 0])),
    [marketShippingRates],
  );
  const twoSheeterSetsPerBoxByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.twoSheeterSetsPerBox ?? entry.sheeterSetsPerBox ?? 15])),
    [marketShippingRates],
  );
  const fourSheeterSetsPerBoxByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.fourSheeterSetsPerBox ?? entry.sheeterSetsPerBox ?? 15])),
    [marketShippingRates],
  );
  const sixSheeterSetsPerBoxByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.sixSheeterSetsPerBox ?? entry.sheeterSetsPerBox ?? 15])),
    [marketShippingRates],
  );
  const eightSheeterSetsPerBoxByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.eightSheeterSetsPerBox ?? entry.sheeterSetsPerBox ?? 15])),
    [marketShippingRates],
  );
  const useFlatRateByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.useFlatRate ?? false])),
    [marketShippingRates],
  );
  const printingCostByMarketAsset = useMemo(
    () => new Map(marketAssetPrintingCosts.map((entry) => [`${entry.market}\x00${entry.assetId}`, entry.costs])),
    [marketAssetPrintingCosts],
  );
  const selectedAssetByLineId = useMemo(() => {
    const byLineId = new Map<string, { market: string; assetId: string }>();
    values.campaignMarkets.forEach((market) => {
      market.assets.forEach((asset) => {
        byLineId.set(asset.id, { market: market.market, assetId: asset.assetId });
      });
    });
    return byLineId;
  }, [values.campaignMarkets]);
  const summaryLineByAssetId = useMemo(() => new Map((summary?.lines ?? []).map((line) => [line.id, line])), [summary]);
  const megasPerBoxByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.megasPerBox ?? 1])),
    [marketShippingRates],
  );
  const megaShippingRateByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.megaShippingRate ?? 0])),
    [marketShippingRates],
  );
  const dotMShippingRateByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.dotMShippingRate ?? 0])),
    [marketShippingRates],
  );
  const mpShippingRateByMarket = useMemo(
    () => new Map(marketShippingRates.map((entry) => [entry.market, entry.mpShippingRate ?? 0])),
    [marketShippingRates],
  );
  const shippingCostByMarketAsset = useMemo(
    () => new Map(marketAssetShippingCosts.map((entry) => [`${entry.market}\x00${entry.assetId}`, entry])),
    [marketAssetShippingCosts],
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
  const hasUnsavedChanges = !loadingCampaign && stableSerialize(values) !== lastPersistedValuesRef.current;
  const hasMappedCreatives = useMemo(() => {
    return values.campaignMarkets.some((market) =>
      market.assets.some((asset) => {
        const hasFormatMapping = Object.values(normalizeCreativeImageIds(asset)).some((imageId) => Boolean((imageId || '').trim()));
        if (hasFormatMapping) return true;
        return Boolean((asset.creativeImageId || '').trim());
      }),
    );
  }, [values.campaignMarkets]);
  const hasUploadedPurchaseOrder = uploadedPurchaseOrderName.trim().length > 0;
  const hasCampaignStartDate = values.campaignStartDate.trim().length > 0;
  const hasDeliveryDueDate = values.dueDate.trim().length > 0;
  const isCampaignStartDatePast = hasCampaignStartDate && isDateBeforeToday(values.campaignStartDate);
  const isDeliveryDueDatePast = hasDeliveryDueDate && isDateBeforeToday(values.dueDate);
  const hasValidCampaignStartDate = hasCampaignStartDate && !isCampaignStartDatePast;
  const hasValidDeliveryDueDate = hasDeliveryDueDate && !isDeliveryDueDatePast;
  const canAdvanceFromCreative = hasValidCampaignStartDate && hasValidDeliveryDueDate;
  const minSelectableDate = getTodayDateInputValue();
  const activeCampaignName = values.campaignName.trim() || (campaignId ? `Untitled Campaign ${campaignId.slice(0, 6)}` : 'Untitled Campaign');
  const selectedArtworkImageIdForTarget = useMemo(() => {
    if (!assignArtworkTarget) return '';
    const targetMarket = values.campaignMarkets.find((market) => market.id === assignArtworkTarget.marketId);
    const targetAsset = targetMarket?.assets.find((asset) => asset.id === assignArtworkTarget.assetId);
    if (!targetAsset) return '';
    return getCreativeImageIdForFormat(targetAsset, assignArtworkTarget.formatKey);
  }, [assignArtworkTarget, values.campaignMarkets]);
  const previewArtworkImage = useMemo(() => {
    if (!previewArtworkTarget) return null;
    const targetMarket = values.campaignMarkets.find((market) => market.id === previewArtworkTarget.marketId);
    const targetAsset = targetMarket?.assets.find((asset) => asset.id === previewArtworkTarget.assetId);
    if (!targetAsset) return null;
    const assignedImageId = getCreativeImageIdForFormat(targetAsset, previewArtworkTarget.formatKey);
    if (!assignedImageId) return null;
    return values.printImages.find((image) => image.id === assignedImageId) ?? null;
  }, [previewArtworkTarget, values.campaignMarkets, values.printImages]);
  const previewArtworkThumbnailSrc = useMemo(
    () => (previewArtworkImage?.thumbnailUrl ? buildApiUrl(previewArtworkImage.thumbnailUrl) : ''),
    [previewArtworkImage],
  );
  const previewArtworkFullSrc = useMemo(
    () => (previewArtworkImage?.imageUrl ? buildApiUrl(previewArtworkImage.imageUrl) : ''),
    [previewArtworkImage],
  );
  const assignedArtworkIdSet = useMemo(() => {
    const assignedIds = new Set<string>();
    values.campaignMarkets.forEach((market) => {
      market.assets.forEach((asset) => {
        const mappedCreativeImageIds = normalizeCreativeImageIds(asset);
        creativeFormatKeys.forEach((formatKey) => {
          const mappedId = (mappedCreativeImageIds[formatKey] || '').trim();
          if (mappedId) assignedIds.add(mappedId);
        });
        const legacyMappedId = (asset.creativeImageId || '').trim();
        if (legacyMappedId) assignedIds.add(legacyMappedId);
      });
    });
    return assignedIds;
  }, [values.campaignMarkets]);

  useEffect(() => {
    setTopBarCenterHost(document.getElementById('workspace-topbar-center-slot'));
    setTopBarActionsHost(document.getElementById('workspace-topbar-actions-slot'));
    setBottomBarHost(document.getElementById('workspace-bottom-bar-slot'));
  }, []);

  useEffect(() => {
    const normalizedError = error.trim().toLowerCase();
    const hasPastDateError =
      normalizedError.includes('campaign start date cannot be in the past')
      || normalizedError.includes('delivery due date cannot be in the past');
    const hasMissingDueDateActionError =
      normalizedError.includes('add a due date before downloading visuals')
      || normalizedError.includes('add a due date before sending email to ads');
    if (hasPastDateError && !isCampaignStartDatePast && !isDeliveryDueDatePast) {
      setError('');
    }
    if (hasMissingDueDateActionError && hasDeliveryDueDate) {
      setError('');
    }
  }, [error, hasDeliveryDueDate, isCampaignStartDatePast, isDeliveryDueDatePast]);

  useEffect(() => {
    setPreviewArtworkFullLoaded(false);
  }, [previewArtworkImage?.id]);

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
    if (values.campaignMarkets.length === 0) {
      setSummary(null);
      setCalculating(false);
      setValues((current) => ({ ...current, quantity: '0' }));
      setError('');
      return;
    }

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
    if (!addMarketDialogOpen || !draftMarket || loadingCampaign || loadingMetadata || metadataError) {
      setDraftMarketCalculating(false);
      return;
    }

    let active = true;
    setDraftMarketCalculating(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const allMarkets = editingMarketId
          ? values.campaignMarkets.map((market) => (market.id === editingMarketId ? draftMarket : market))
          : [...values.campaignMarkets, draftMarket];
        const flatLines: CampaignLine[] = allMarkets.flatMap((market) => market.assets.map((asset) => ({ ...asset, market: market.market })));
        const result = await calculateCampaign(flatLines);
        if (!active) return;
        const nextSummary = result.perMarket.find((entry) => entry.market === draftMarket.market) ?? null;
        setDraftMarketSummary(nextSummary);
      } catch {
        if (active) setDraftMarketSummary(null);
      } finally {
        if (active) setDraftMarketCalculating(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [addMarketDialogOpen, draftMarket, editingMarketId, loadingCampaign, loadingMetadata, metadataError, values.campaignMarkets]);

  function updateField<K extends keyof OrderFormValues>(field: K, value: OrderFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function updateWeekCount(nextValue: number) {
    const normalized = Math.max(1, Math.min(20, Math.floor(nextValue)));
    updateField('numberOfWeeks', String(normalized));
  }

  function updateCampaignMarket(marketId: string, updater: (market: CampaignMarket) => CampaignMarket) {
    setValues((current) => ({ ...current, campaignMarkets: current.campaignMarkets.map((market) => (market.id === marketId ? updater(market) : market)) }));
  }

  function openAddMarketDialog() {
    if (!canAddMarket) return;
    const nextMarketName = remainingMarketNames[0] || '';
    const nextMarket = createCampaignMarket(`market-draft-${Date.now()}`);
    const preferredAddress = preferredDeliveryAddressByMarket.get(nextMarketName) || '';
    setDraftMarket({
      ...nextMarket,
      market: nextMarketName,
      assets: nextMarket.assets.map((asset) => ({
        ...asset,
        deliveryAddress: preferredAddress,
        selectedWeeks: createAllWeeks(numberOfWeeks),
      })),
    });
    setEditingMarketId(null);
    setDraftMarketSummary(null);
    setAddMarketDialogOpen(true);
  }

  function openEditMarketDialog(marketId: string) {
    const targetMarket = values.campaignMarkets.find((market) => market.id === marketId);
    if (!targetMarket) return;
    setDraftMarket({
      ...targetMarket,
      assets: targetMarket.assets.map((asset) => ({
        ...asset,
        selectedWeeks: [...asset.selectedWeeks],
        creativeImageIds: { ...(asset.creativeImageIds ?? {}) },
      })),
    });
    setEditingMarketId(marketId);
    setDraftMarketSummary(null);
    setAddMarketDialogOpen(true);
  }

  function handleSaveAddMarket() {
    if (!draftMarket) return;
    const savedDraftMarketId = draftMarket.id;
    setValues((current) => {
      const realMarkets = current.campaignMarkets.filter((market) => !isDefaultPlaceholderMarket(market));

      if (editingMarketId) {
        const selectedInOtherMarkets = new Set(realMarkets.filter((market) => market.id !== editingMarketId).map((market) => market.market));
        if (!draftMarket.market.trim() || selectedInOtherMarkets.has(draftMarket.market)) return current;
        const hasTarget = realMarkets.some((market) => market.id === editingMarketId);
        const nextMarkets = hasTarget
          ? realMarkets.map((market) => (market.id === editingMarketId ? draftMarket : market))
          : [...realMarkets, draftMarket];
        return {
          ...current,
          campaignMarkets: nextMarkets,
        };
      }

      if (!canAddMarket) return current;
      const selectedMarketNames = new Set(
        marketPopupManagedFlow && !hasSavedMarketViaPopup ? [] : realMarkets.map((market) => market.market),
      );
      if (!draftMarket.market.trim() || selectedMarketNames.has(draftMarket.market)) return current;
      return {
        ...current,
        campaignMarkets: marketPopupManagedFlow && !hasSavedMarketViaPopup ? [draftMarket] : [...realMarkets, draftMarket],
      };
    });
    setHiddenInlineMarketIds((current) => (current.includes(savedDraftMarketId) ? current : [...current, savedDraftMarketId]));
    setTreatDefaultMarketAsPlaceholder(false);
    setHasSavedMarketViaPopup(true);
    setEditingMarketId(null);
    setAddMarketDialogOpen(false);
    setDraftMarket(null);
    setDraftMarketSummary(null);
  }

  function handleDeleteEditingMarket() {
    if (!editingMarketId) return;
    const remainingRealMarketsCount = values.campaignMarkets.filter((market) => !isDefaultPlaceholderMarket(market) && market.id !== editingMarketId).length;
    setValues((current) => ({
      ...current,
      campaignMarkets: current.campaignMarkets.filter((market) => market.id !== editingMarketId),
    }));
    setHiddenInlineMarketIds((current) => current.filter((id) => id !== editingMarketId));
    if (remainingRealMarketsCount === 0) {
      setHasSavedMarketViaPopup(false);
    }
    setAddMarketDialogOpen(false);
    setEditingMarketId(null);
    setDraftMarket(null);
    setDraftMarketSummary(null);
  }

  function updateDraftMarket(updater: (market: CampaignMarket) => CampaignMarket) {
    setDraftMarket((current) => (current ? updater(current) : current));
  }

  function updateDraftAsset(assetId: string, updater: (asset: CampaignAsset) => CampaignAsset) {
    updateDraftMarket((market) => ({
      ...market,
      assets: market.assets.map((asset) => (asset.id === assetId ? updater(asset) : asset)),
    }));
  }

  function toggleDraftAssetWeek(assetId: string, week: number) {
    updateDraftAsset(assetId, (asset) => {
      const selectedWeekSet = new Set(asset.selectedWeeks);
      if (selectedWeekSet.has(week)) selectedWeekSet.delete(week);
      else selectedWeekSet.add(week);
      return { ...asset, selectedWeeks: Array.from(selectedWeekSet).sort((left, right) => left - right) };
    });
  }

  function addDraftAsset() {
    updateDraftMarket((market) => {
      const availableAssets = assetsForMarket(market.market);
      const nextAsset = availableAssets[0];
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

  function removeDraftAsset(assetId: string) {
    updateDraftMarket((market) => ({
      ...market,
      assets: market.assets.length === 1 ? market.assets : market.assets.filter((asset) => asset.id !== assetId),
    }));
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
      const nextAsset = availableAssets[0];
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

  function openAssignArtworkDialog(marketId: string, assetId: string, formatKey: CreativeFormatKey) {
    setAssignArtworkTarget({ marketId, assetId, formatKey });
    setArtworkDialogError('');
    setAssignArtworkDialogOpen(true);
  }

  function openArtworkPreviewDialog(marketId: string, assetId: string, formatKey: CreativeFormatKey) {
    setPreviewArtworkTarget({ marketId, assetId, formatKey });
    setPreviewArtworkFullLoaded(false);
    setPreviewArtworkDialogOpen(true);
  }

  function closeArtworkPreviewDialog() {
    setPreviewArtworkDialogOpen(false);
    setPreviewArtworkTarget(null);
    setPreviewArtworkFullLoaded(false);
  }

  function openChangeArtworkFromPreview() {
    if (!previewArtworkTarget) return;
    const { marketId, assetId, formatKey } = previewArtworkTarget;
    openAssignArtworkDialog(marketId, assetId, formatKey);
  }

  function openArtworkManagerDialog() {
    setAssignArtworkTarget(null);
    setArtworkDialogError('');
    setAssignArtworkDialogOpen(true);
  }

  function removeArtworkFromPreview() {
    if (!previewArtworkTarget) return;
    const { marketId, assetId, formatKey } = previewArtworkTarget;
    assignArtworkToFormat(marketId, assetId, formatKey, '');
    closeArtworkPreviewDialog();
  }

  function closeAssignArtworkDialog() {
    setAssignArtworkDialogOpen(false);
    setAssignArtworkTarget(null);
    setArtworkDialogError('');
    if (artworkPdfInputRef.current) {
      artworkPdfInputRef.current.value = '';
    }
  }

  function assignArtworkImageToTarget(imageId: string) {
    if (!assignArtworkTarget) return;
    const { marketId, assetId, formatKey } = assignArtworkTarget;
    assignArtworkToFormat(marketId, assetId, formatKey, imageId);
    closeAssignArtworkDialog();
    closeArtworkPreviewDialog();
  }

  function assignArtworkToFormat(marketId: string, assetId: string, formatKey: CreativeFormatKey, imageId: string) {
    updateCampaignAsset(marketId, assetId, (current) => {
      const nextCreativeImageIds = {
        ...normalizeCreativeImageIds(current),
        [formatKey]: imageId,
      };
      if (!imageId) {
        delete nextCreativeImageIds[formatKey];
      }
      const nextLegacyCreativeImageId =
        nextCreativeImageIds['8-sheet']
        || nextCreativeImageIds['6-sheet']
        || nextCreativeImageIds['4-sheet']
        || nextCreativeImageIds['2-sheet']
        || nextCreativeImageIds.Mega
        || nextCreativeImageIds['DOT M']
        || nextCreativeImageIds.MP
        || '';
      return {
        ...current,
        creativeImageIds: nextCreativeImageIds,
        creativeImageId: nextLegacyCreativeImageId,
      };
    });
  }

  function isDeleteNotFoundError(error: unknown) {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes('(404)') || message.includes('not found');
  }

  function handleDeleteArtwork(image: CampaignPrintImage) {
    if (deletingArtworkIds.includes(image.id)) return;
    if (assignedArtworkIdSet.has(image.id)) {
      setArtworkDialogError('Cannot delete artwork that is assigned to an asset category.');
      return;
    }
    setDeleteArtworkCandidate(image);
  }

  function cancelDeleteArtwork() {
    if (confirmingArtworkDelete) return;
    setDeleteArtworkCandidate(null);
  }

  async function confirmDeleteArtwork() {
    const image = deleteArtworkCandidate;
    if (!image) return;

    setConfirmingArtworkDelete(true);
    setDeletingArtworkIds((current) => [...current, image.id]);
    setArtworkDialogError('');
    try {
      const storedNames = Array.from(
        new Set(
          [image.storedName, image.thumbnailStoredName]
            .map((value) => (value || '').trim())
            .filter(Boolean),
        ),
      );
      if (storedNames.length === 0) {
        throw new Error('Unable to delete artwork because storage info is missing.');
      }

      await Promise.all(
        storedNames.map(async (storedName) => {
          try {
            await deleteCampaignImage(storedName);
          } catch (deleteError) {
            if (isDeleteNotFoundError(deleteError)) return;
            throw deleteError;
          }
        }),
      );

      setValues((current) => ({
        ...current,
        printImages: current.printImages.filter((entry) => entry.id !== image.id),
      }));

      if (previewArtworkImage?.id === image.id) {
        closeArtworkPreviewDialog();
      }
      setDeleteArtworkCandidate(null);
    } catch (deleteError) {
      setArtworkDialogError(deleteError instanceof Error ? deleteError.message : 'Unable to delete artwork.');
    } finally {
      setConfirmingArtworkDelete(false);
      setDeletingArtworkIds((current) => current.filter((id) => id !== image.id));
    }
  }

  async function uploadArtworkPdfFiles(files: File[]) {
    if (!files.length) return;
    const nonPdfFile = files.find((file) => !isPdfFile(file));
    if (nonPdfFile) {
      setArtworkDialogError('Only PDF files are allowed.');
      return;
    }

    setUploadingArtworkPages(true);
    setArtworkDialogError('');
    setArtworkUploadSuccessOpen(false);
    setArtworkUploadSuccessMessage('');
    try {
      const savedCampaignId = await saveCampaignDraft();
      if (!savedCampaignId) {
        setArtworkDialogError('Save the campaign before uploading artwork.');
        return;
      }

      const uploadedImages: CampaignPrintImage[] = [];
      for (const pdfFile of files) {
        const sourcePdfUpload = await uploadCampaignImage(pdfFile);
        const pageImages = await convertPdfToArtworkPages(pdfFile);
        for (const pageImage of pageImages) {
          const [uploadResponse, thumbnailUploadResponse] = await Promise.all([
            uploadCampaignImage(pageImage.file),
            uploadCampaignImage(pageImage.thumbnailFile),
          ]);
          const baseName = toFileBaseName(pdfFile.name) || 'Artwork';
          const imageName = pageImage.totalPages > 1
            ? `${baseName} (Page ${pageImage.pageNumber})`
            : baseName;
          uploadedImages.push({
            id: uploadResponse.storedName,
            name: imageName,
            fileName: uploadResponse.originalName || pageImage.file.name,
            mimeType: uploadResponse.mimeType || pageImage.file.type || 'image/png',
            storedName: uploadResponse.storedName,
            imageUrl: uploadResponse.url || `/api/campaign-images/${uploadResponse.storedName}`,
            thumbnailFileName: thumbnailUploadResponse.originalName || pageImage.thumbnailFile.name,
            thumbnailStoredName: thumbnailUploadResponse.storedName,
            thumbnailUrl: thumbnailUploadResponse.url || `/api/campaign-images/${thumbnailUploadResponse.storedName}`,
            sourcePdfFileName: sourcePdfUpload.originalName || pdfFile.name,
            sourcePdfStoredName: sourcePdfUpload.storedName,
            sourcePdfUrl: sourcePdfUpload.url || `/api/campaign-images/${sourcePdfUpload.storedName}`,
          });
        }
      }

      if (uploadedImages.length > 0) {
        setValues((current) => {
          const byId = new Map<string, CampaignPrintImage>();
          current.printImages.forEach((image) => byId.set(image.id, image));
          uploadedImages.forEach((image) => byId.set(image.id, image));
          return {
            ...current,
            printImages: Array.from(byId.values()),
          };
        });
        setArtworkUploadSuccessMessage(`${uploadedImages.length} artwork file${uploadedImages.length === 1 ? '' : 's'} uploaded successfully.`);
        setArtworkUploadSuccessOpen(true);
      }
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Unable to upload artwork PDFs';
      setArtworkDialogError(message);
      setError(message);
    } finally {
      setUploadingArtworkPages(false);
      if (artworkPdfInputRef.current) {
        artworkPdfInputRef.current.value = '';
      }
    }
  }

  function handleArtworkPickerFiles(fileList: FileList | null) {
    const nextFiles = Array.from(fileList ?? []);
    if (!nextFiles.length) return;
    void uploadArtworkPdfFiles(nextFiles);
  }

  function handleArtworkActionButtonClick() {
    if (uploadingArtworkPages) {
      openArtworkManagerDialog();
      return;
    }
    if (values.printImages.length > 0) {
      openArtworkManagerDialog();
      return;
    }
    openArtworkPdfPicker();
  }

  function assetsForMarket(marketName: string) {
    return (markets.find((market) => market.name === marketName)?.assets ?? []).filter((asset) => !asset.isMaintenance);
  }

  function assetOptionsFor(market: CampaignMarket, assetId: string, selectedAssetId: string) {
    const marketAssets = markets.find((entry) => entry.name === market.market)?.assets ?? [];
    return marketAssets
      .filter((asset) => asset.id === selectedAssetId || !asset.isMaintenance)
      .map((asset) => ({ label: asset.label, value: asset.id }));
  }

  function canAddAssetForMarket(market: CampaignMarket) {
    const availableAssets = assetsForMarket(market.market);
    return availableAssets.length > 0;
  }

  function addAssetDisabledReasonForMarket(market: CampaignMarket) {
    const availableAssets = assetsForMarket(market.market);
    if (!market.market) return 'Choose a market before adding assets.';
    if (availableAssets.length === 0) return 'No assets are available for this market.';
    return '';
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

  async function saveCampaignDraft(options?: { fromAutoSave?: boolean }) {
    const fromAutoSave = options?.fromAutoSave ?? false;
    const currentValuesSerialized = stableSerialize(values);
    if (fromAutoSave && lastAutoSaveFailedValuesRef.current === currentValuesSerialized) {
      return null;
    }
    if (campaignId && !hasUnsavedChanges) return campaignId;

    setSavingCampaign(true);
    if (!fromAutoSave) setError('');
    try {
      if (!campaignId) {
        const response = await createCampaign({ values });
        applyCampaignToScreen(response.campaign, setValues, setSummary, setUploadedPurchaseOrderName, setCampaignId, setCampaignStatus);
            lastPersistedValuesRef.current = stableSerialize(response.campaign.values);
        lastAutoSaveFailedValuesRef.current = null;
        await setStoredCampaignId(response.campaign.id);
        return response.campaign.id;
      }

      const response = await updateStoredCampaign(campaignId, { values });
      setCampaignStatus(response.campaign.status);
      setUploadedPurchaseOrderName(response.campaign.purchaseOrder?.originalName || '');
        lastPersistedValuesRef.current = stableSerialize(response.campaign.values);
      lastAutoSaveFailedValuesRef.current = null;
      return campaignId;
    } catch (saveError) {
      if (fromAutoSave) {
        lastAutoSaveFailedValuesRef.current = currentValuesSerialized;
      }
      setError(saveError instanceof Error ? saveError.message : 'Unable to save campaign draft');
      return null;
    } finally {
      setSavingCampaign(false);
    }
  }

  useEffect(() => {
    if (loadingCampaign || savingCampaign || !hasUnsavedChanges) return;

    const timeoutId = window.setTimeout(() => {
      void saveCampaignDraft({ fromAutoSave: true });
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [campaignId, hasUnsavedChanges, loadingCampaign, savingCampaign, values]);

  async function handleBackToDashboard() {
    if (!onBack) return;
    if (isCampaignStartDatePast || isDeliveryDueDatePast) {
      await releaseActiveCampaignLock();
      onBack();
      return;
    }
    if (!hasUnsavedChanges) {
      await releaseActiveCampaignLock();
      onBack();
      return;
    }
    const savedCampaignId = await saveCampaignDraft();
    if (savedCampaignId) {
      await releaseActiveCampaignLock(savedCampaignId);
      onBack();
      return;
    }
    setUnsavedDialogOpen(true);
  }

  async function handleSaveAndLeave() {
    const savedCampaignId = await saveCampaignDraft();
    if (!savedCampaignId) return;
    setUnsavedDialogOpen(false);
    await releaseActiveCampaignLock(savedCampaignId);
    onBack?.();
  }

  async function handleDiscardAndLeave() {
    setUnsavedDialogOpen(false);
    await releaseActiveCampaignLock();
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
      lastPersistedValuesRef.current = stableSerialize(response.campaign.values);
      setQuoteResponseMessage(`Quote created successfully. Amount: ${amount}`);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to create quote');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadPurchaseOrder(fileToUpload?: File | null) {
    const purchaseOrderFile = fileToUpload ?? selectedPurchaseOrderFile;
    if (!purchaseOrderFile) {
      setError('Please choose a purchase order file to upload');
      return;
    }

    setUploadingPurchaseOrder(true);
    setError('');
    try {
      const savedCampaignId = await saveCampaignDraft();
      if (!savedCampaignId) return;
      const response = await uploadPurchaseOrderFile(purchaseOrderFile, savedCampaignId);
      setUploadedPurchaseOrderName(response.originalName);
      setPurchaseOrderUploadSuccessMessage(`Purchase order file uploaded successfully: ${response.originalName}`);
      setPurchaseOrderUploadSuccessOpen(true);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to upload purchase order');
    } finally {
      setUploadingPurchaseOrder(false);
    }
  }

  function calculateMarketShippingCost(marketName: string) {
    const twoSheeterPrice = twoSheeterPriceByMarket.get(marketName) ?? 0;
    const fourSheeterPrice = fourSheeterPriceByMarket.get(marketName) ?? 0;
    const sixSheeterPrice = sixSheeterPriceByMarket.get(marketName) ?? 0;
    const eightSheeterPrice = eightSheeterPriceByMarket.get(marketName) ?? 0;
    const twoSheeterSetsPerBox = twoSheeterSetsPerBoxByMarket.get(marketName) ?? 15;
    const fourSheeterSetsPerBox = fourSheeterSetsPerBoxByMarket.get(marketName) ?? 15;
    const sixSheeterSetsPerBox = sixSheeterSetsPerBoxByMarket.get(marketName) ?? 15;
    const eightSheeterSetsPerBox = eightSheeterSetsPerBoxByMarket.get(marketName) ?? 15;
    const megasPerBox = megasPerBoxByMarket.get(marketName) ?? 1;
    const marketLines = summary?.lines.filter((line) => line.market === marketName) ?? [];
    const useFlatRate = useFlatRateByMarket.get(marketName) ?? false;

    if (useFlatRate) {
      const hasTwoSheet = marketLines.some((line) => (line.breakdown['2-sheet'] ?? 0) > 0);
      const hasFourSheet = marketLines.some((line) => (line.breakdown['4-sheet'] ?? 0) > 0);
      const hasSixSheet = marketLines.some((line) => (line.breakdown['6-sheet'] ?? 0) > 0);
      const hasEightSheet = marketLines.some((line) => ((line.breakdown['8-sheet'] ?? 0) + (line.breakdown.QA0 ?? 0)) > 0);

      const posterShipping = (hasTwoSheet ? twoSheeterPrice : 0)
        + (hasFourSheet ? fourSheeterPrice : 0)
        + (hasSixSheet ? sixSheeterPrice : 0)
        + (hasEightSheet ? eightSheeterPrice : 0);

      const megaShipping = marketLines.reduce((total, line) => {
        const selectedAsset = selectedAssetByLineId.get(line.id);
        if (!selectedAsset) return total;

        const assetShippingCosts = shippingCostByMarketAsset.get(`${selectedAsset.market}\x00${selectedAsset.assetId}`);
        const megaRate = assetShippingCosts?.megaShippingRate ?? (megaShippingRateByMarket.get(marketName) ?? 0);
        const dotMRate = assetShippingCosts?.dotMShippingRate ?? (dotMShippingRateByMarket.get(marketName) ?? 0);
        const mpRate = assetShippingCosts?.mpShippingRate ?? (mpShippingRateByMarket.get(marketName) ?? 0);

        return total
          + ((line.breakdown.Mega ?? 0) > 0 ? megaRate : 0)
          + ((line.breakdown['DOT M'] ?? 0) > 0 ? dotMRate : 0)
          + ((line.breakdown.MP ?? 0) > 0 ? mpRate : 0);
      }, 0);

      return posterShipping + megaShipping;
    }

    const totalTwoSheet = marketLines.reduce((total, line) => total + (line.breakdown['2-sheet'] ?? 0), 0);
    const totalFourSheet = marketLines.reduce((total, line) => total + (line.breakdown['4-sheet'] ?? 0), 0);
    const totalSixSheet = marketLines.reduce((total, line) => total + (line.breakdown['6-sheet'] ?? 0), 0);
    const totalEightAndQa0 = marketLines.reduce((total, line) => total + (line.breakdown['8-sheet'] ?? 0) + (line.breakdown.QA0 ?? 0), 0);
    const posterShipping = calculatePosterShippingForSheeter(totalEightAndQa0, eightSheeterPrice, 4, eightSheeterSetsPerBox)
      + calculatePosterShippingForSheeter(totalSixSheet, sixSheeterPrice, 3, sixSheeterSetsPerBox)
      + calculatePosterShippingForSheeter(totalFourSheet, fourSheeterPrice, 2, fourSheeterSetsPerBox)
      + calculatePosterShippingForSheeter(totalTwoSheet, twoSheeterPrice, 1, twoSheeterSetsPerBox);

    const megaShipping = marketLines.reduce((total, line) => {
      const selectedAsset = selectedAssetByLineId.get(line.id);
      if (!selectedAsset) return total;

      const assetShippingCosts = shippingCostByMarketAsset.get(`${selectedAsset.market}\x00${selectedAsset.assetId}`);
      const megaRate = assetShippingCosts?.megaShippingRate ?? (megaShippingRateByMarket.get(marketName) ?? 0);
      const dotMRate = assetShippingCosts?.dotMShippingRate ?? (dotMShippingRateByMarket.get(marketName) ?? 0);
      const mpRate = assetShippingCosts?.mpShippingRate ?? (mpShippingRateByMarket.get(marketName) ?? 0);

      return total
        + calculateShippingCost(line.breakdown.Mega ?? 0, megaRate, megasPerBox)
        + calculateShippingCost(line.breakdown['DOT M'] ?? 0, dotMRate, megasPerBox)
        + calculateShippingCost(line.breakdown.MP ?? 0, mpRate, megasPerBox);
    }, 0);

    return posterShipping + megaShipping;
  }

  function calculateLinePrintingCost(line: CampaignCalculationSummary['lines'][number]) {
    const selectedAsset = selectedAssetByLineId.get(line.id);
    if (!selectedAsset) return 0;
    const costs = printingCostByMarketAsset.get(`${selectedAsset.market}\x00${selectedAsset.assetId}`);
    if (!costs) return 0;
    const qa0Units = line.breakdown.QA0 ?? 0;
    const eightSheetRate = costs['8-sheet'] ?? 0;
    return formatKeys.reduce((total, key) => {
      if (key === 'QA0') return total;
      return total + (line.breakdown[key] ?? 0) * (costs[key] ?? 0);
    }, 0) + qa0Units * eightSheetRate;
  }

  function calculateMarketPrintingCost(marketName: string) {
    const marketLines = summary?.lines.filter((line) => line.market === marketName) ?? [];
    return marketLines.reduce((total, line) => total + calculateLinePrintingCost(line), 0);
  }

  async function generateArtworkTemplates(downloadFiles: boolean, exportMode: VisualsExportMode): Promise<GeneratedVisualExportFile[]> {
    try {
      const ExcelJSRuntime = ExcelJS as any;
      const baseName = sanitizeFileName((values.campaignName || 'Campaign').trim() || 'Campaign');
      const campaignNumber = values.customerReference.trim() || campaignId || '';
      const weekCommencing = parseDateOnly(values.campaignStartDate);
      const weekCount = Math.max(1, Number.parseInt(values.numberOfWeeks || '1', 10) || 1);
      const shouldGenerateExcel = exportMode === 'excel';

      const lineByAssetId = new Map((summary?.lines ?? []).map((line) => [line.id, line]));
      const defaultDeliveryAddressByMarket = new Map<string, string>();
      marketDeliveryAddresses.forEach((entry) => {
        if (!defaultDeliveryAddressByMarket.has(entry.market) || entry.isDefault) {
          defaultDeliveryAddressByMarket.set(entry.market, entry.deliveryAddress);
        }
      });

      const imageById = new Map(values.printImages.map((image, index) => [image.id, { image, creativeNumber: index + 1 }]));
      const printRows = new Map<
        string,
        {
          creativeCode: string;
          creativeNumber: number;
          creativeImageId: string;
          fileName: string;
          state: ExportState;
          quantities: Record<number, number>;
        }
      >();
      const deliveryRows = new Map<string, {
        creativeCode: string;
        fileName: string;
        state: ExportState;
        typeLabel: string;
        quantity: number;
        deliveredTo: string;
        rolled: boolean;
      }>();
      const creativeSummary = new Map<number, QuantityBreakdown>();
      const deliveryInfoBlocks: string[] = [];
      const seenDeliveryInfo = new Set<string>();
      const pushDeliveryInfo = (address: string, marketName: string, stateHint?: ExportState | null) => {
        const normalizedAddress = address.trim().replace(/\r\n/g, '\n');
        if (!normalizedAddress) return;
        const state = stateHint ?? normalizeExportState(marketName);
        const heading = state ? `VIM ${state}` : `VIM ${marketName.trim().toUpperCase()}`;
        const block = normalizedAddress.toUpperCase().startsWith('VIM ') ? normalizedAddress : `${heading}\n${normalizedAddress}`;
        if (seenDeliveryInfo.has(block)) return;
        seenDeliveryInfo.add(block);
        deliveryInfoBlocks.push(block);
      };

      const updateSummary = (creativeNumber: number, key: keyof QuantityBreakdown, quantity: number) => {
        if (quantity <= 0) return;
        const bucket = creativeSummary.get(creativeNumber) ?? { '8-sheet': 0, '6-sheet': 0, '4-sheet': 0, '2-sheet': 0, QA0: 0, Mega: 0, 'DOT M': 0, MP: 0 };
        bucket[key] += quantity;
        creativeSummary.set(creativeNumber, bucket);
      };

      const getPrintColumn = (state: ExportState, key: keyof QuantityBreakdown) => {
        if (state === 'QLD') {
          if (key === '8-sheet') return 14;
          if (key === '6-sheet') return 15;
          if (key === '4-sheet') return 16;
          if (key === '2-sheet') return 17;
        }
        if (key === '8-sheet') return 9;
        if (key === '6-sheet') return 10;
        if (key === '4-sheet') return 11;
        if (key === '2-sheet') return 12;
        if (key === 'QA0') return 13;
        if (key === 'Mega') return 18;
        if (key === 'DOT M') return 19;
        return 20;
      };

      const getDeliveryTypeLabel = (state: ExportState, key: keyof QuantityBreakdown) => {
        if (state === 'QLD') {
          if (key === '8-sheet') return 'BRIS 8 SHEET';
          if (key === '6-sheet') return 'BRIS 6 SHEET';
          if (key === '4-sheet') return 'BRIS 4 SHEET';
          if (key === '2-sheet') return 'BRIS 2 SHEET';
        }
        if (key === '8-sheet') return '8 SHEET';
        if (key === '6-sheet') return '6 SHEET';
        if (key === '4-sheet') return '4 SHEET';
        if (key === '2-sheet') return '2 SHEET';
        if (key === 'QA0') return 'QA0';
        if (key === 'Mega') return 'FERRO';
        if (key === 'DOT M') return 'REFLECTIVE';
        return 'MEGA PORT';
      };

      const posterDivisors: Record<keyof QuantityBreakdown, number> = {
        '8-sheet': 4,
        '6-sheet': 3,
        '4-sheet': 2,
        '2-sheet': 1,
        QA0: 4,
        Mega: 1,
        'DOT M': 1,
        MP: 1,
      };
      const summaryLabels: Record<keyof QuantityBreakdown, string> = {
        '8-sheet': 'posters',
        '6-sheet': 'posters',
        '4-sheet': 'posters',
        '2-sheet': 'posters',
        QA0: 'A0 sized posters',
        Mega: 'Mega',
        'DOT M': 'DOT Mega',
        MP: 'Mega Portrait',
      };

      // Collect delivery addresses from campaign data regardless of mapped creatives.
      values.campaignMarkets.forEach((market) => {
        market.assets.forEach((asset) => {
          pushDeliveryInfo(asset.deliveryAddress || defaultDeliveryAddressByMarket.get(market.market) || '', market.market);
        });
      });
      if (deliveryInfoBlocks.length === 0) {
        values.campaignMarkets.forEach((market) => {
          pushDeliveryInfo(defaultDeliveryAddressByMarket.get(market.market) || '', market.market);
        });
      }

      values.campaignMarkets.forEach((market) => {
        market.assets.forEach((asset) => {
          const line = lineByAssetId.get(asset.id);
          if (!line) return;

          const state = normalizeExportState(line.state) ?? inferStateFromMarket(market.market);
          if (!state) return;
          (Object.keys(line.breakdown) as Array<keyof QuantityBreakdown>).forEach((key) => {
            const quantity = line.breakdown[key] ?? 0;
            if (quantity <= 0) return;

            const creativeFormat = toCreativeFormatKey(key);
            const creativeImageId = getCreativeImageIdForFormat(asset, creativeFormat);
            if (!creativeImageId) return;
            const creative = imageById.get(creativeImageId);
            if (!creative) return;

            const creativeCode = buildCreativeCode(state, creative.creativeNumber);
            const fileName = toFileBaseName(creative.image.fileName || creative.image.name || asset.assetSearch || asset.assetId || 'Artwork');
            const printRowKey = `${creativeCode}\x00${fileName}`;
            const printRow = printRows.get(printRowKey) ?? {
              creativeCode,
              creativeNumber: creative.creativeNumber,
              creativeImageId: creative.image.id,
              fileName,
              state,
              quantities: {},
            };

            const column = getPrintColumn(state, key);
            printRow.quantities[column] = (printRow.quantities[column] ?? 0) + quantity;
            printRows.set(printRowKey, printRow);

            const typeLabel = getDeliveryTypeLabel(state, key);
            const deliveredTo = `VIM ${state}`;
            const rolled = state !== 'NSW';
            const deliveryKey = `${creativeCode}\x00${fileName}\x00${typeLabel}\x00${deliveredTo}`;
            const existingDeliveryRow = deliveryRows.get(deliveryKey);
            if (existingDeliveryRow) {
              existingDeliveryRow.quantity += quantity;
            } else {
              deliveryRows.set(deliveryKey, {
                creativeCode,
                fileName,
                state,
                typeLabel,
                quantity,
                deliveredTo,
                rolled,
              });
            }

            updateSummary(creative.creativeNumber, key, quantity);
          });

          pushDeliveryInfo(asset.deliveryAddress || defaultDeliveryAddressByMarket.get(market.market) || '', market.market, state);
        });
      });

      const creativeSummaryText = Array.from(creativeSummary.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([creativeNumber, breakdown]) => {
          const parts: string[] = [];
          formatKeys.forEach((key) => {
            const quantity = breakdown[key] ?? 0;
            if (quantity <= 0) return;
            if (key === 'Mega' || key === 'DOT M' || key === 'MP') {
              parts.push(`${quantity} x ${summaryLabels[key]}`);
              return;
            }
            parts.push(`${quantity} ${summaryLabels[key]} (${quantity / posterDivisors[key]} x ${key})`);
          });
          return parts.length ? `Creative ${creativeNumber}: ${parts.join(' & ')}` : '';
        })
        .filter(Boolean)
        .join('\n');

      const imageRecordById = new Map(values.printImages.map((image) => [image.id, image]));
      const creativeImageDataUrlById = new Map<string, string>();
      const creativeImageByCreativeFileKey = new Map<string, string>();
      Array.from(printRows.values()).forEach((row) => {
        creativeImageByCreativeFileKey.set(`${row.creativeCode}\x00${row.fileName}`, row.creativeImageId);
      });

      const requiredCreativeImageIds = new Set(Array.from(printRows.values()).map((row) => row.creativeImageId));
      const creativePreviewById = new Map<string, { bytes: Uint8Array; extension: 'png' | 'jpg' }>();
      const detectImageExtension = (mimeType: string, fileName: string): 'png' | 'jpg' => {
        const mime = mimeType.toLowerCase();
        const lowerName = fileName.toLowerCase();
        if (mime.includes('png') || lowerName.endsWith('.png')) return 'png';
        if (mime.includes('jpg') || mime.includes('jpeg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'jpg';
        return 'png';
      };
      const normalizePreviewBlobForWord = async (
        previewBlob: Blob,
        mimeType: string,
        fileName: string,
      ): Promise<{ bytes: Uint8Array; extension: 'png' | 'jpg' }> => {
        const resolvedMime = (previewBlob.type || mimeType || '').toLowerCase();
        const isWordSafeRaster = resolvedMime.includes('png') || resolvedMime.includes('jpg') || resolvedMime.includes('jpeg');
        if (isWordSafeRaster) {
          const bytes = new Uint8Array(await previewBlob.arrayBuffer());
          return {
            bytes,
            extension: detectImageExtension(resolvedMime, fileName),
          };
        }

        const bitmap = await createImageBitmap(previewBlob);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.ceil(bitmap.width));
          canvas.height = Math.max(1, Math.ceil(bitmap.height));
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('Unable to prepare artwork thumbnail preview');
          }
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const pngBlob = await canvasToBlob(canvas, 'image/png');
          const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
          return {
            bytes: pngBytes,
            extension: 'png',
          };
        } finally {
          bitmap.close();
        }
      };

      if (shouldGenerateExcel || exportMode === 'word') {
        setExportProgressMessage('Preparing artwork previews...');
        await Promise.all(
          Array.from(requiredCreativeImageIds).map(async (imageId) => {
            const image = imageRecordById.get(imageId);
            if (!image?.imageUrl) return;
            const mimeType = (image.mimeType || '').toLowerCase();
            const isPdf = mimeType === 'application/pdf' || image.fileName.toLowerCase().endsWith('.pdf');
            const isImage = mimeType.startsWith('image/');
            try {
              const sourceUrl = toAbsoluteUrl(buildApiUrl(image.imageUrl));
              if (!sourceUrl) return;
              const response = await fetch(sourceUrl);
              if (!response.ok) return;
              const blob = await response.blob();

              if (shouldGenerateExcel && (isPdf || isImage)) {
                const dataUrl = isPdf ? await pdfFirstPageToDataUrl(blob, 420) : await blobToDataUrl(blob);
                if (dataUrl) creativeImageDataUrlById.set(imageId, dataUrl);
              }

              if (exportMode === 'word') {
                if (isPdf) {
                  const previewDataUrl = await pdfFirstPageToDataUrl(blob, 560);
                  const parsed = previewDataUrl ? dataUrlToBytes(previewDataUrl) : null;
                  if (parsed) creativePreviewById.set(imageId, parsed);
                } else if (isImage) {
                  const previewUrl = image.thumbnailUrl ? toAbsoluteUrl(buildApiUrl(image.thumbnailUrl)) : '';
                  const previewResponse = previewUrl ? await fetch(previewUrl) : response;
                  const previewBlob = previewResponse.ok ? await previewResponse.blob() : blob;
                  const normalizedPreview = await normalizePreviewBlobForWord(
                    previewBlob,
                    mimeType,
                    image.thumbnailFileName || image.fileName || image.name || '',
                  );
                  creativePreviewById.set(imageId, normalizedPreview);
                }
              }
            } catch {
              // Skip image embedding when image fetch fails.
            }
          }),
        );
      }
      const fillWordDocument = async (): Promise<GeneratedVisualExportFile> => {
        setExportProgressMessage('Generating Word document...');

        const printRowsSorted = Array.from(printRows.values()).sort(
          (a, b) => a.creativeNumber - b.creativeNumber || a.fileName.localeCompare(b.fileName) || a.state.localeCompare(b.state),
        );

        const rowsByCreative = new Map<number, typeof printRowsSorted>();
        printRowsSorted.forEach((row) => {
          const bucket = rowsByCreative.get(row.creativeNumber) ?? [];
          bucket.push(row);
          rowsByCreative.set(row.creativeNumber, bucket);
        });

        const quantityColumns = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
        const rowTotals = (creativeRows: typeof printRowsSorted) => {
          const totals = new Map<number, number>();
          creativeRows.forEach((row) => {
            Object.entries(row.quantities).forEach(([column, quantity]) => {
              const numericColumn = Number(column);
              totals.set(numericColumn, (totals.get(numericColumn) ?? 0) + quantity);
            });
          });
          return totals;
        };

        const inferCreativeTypeLabel = (creativeRows: typeof printRowsSorted) => {
          const totals = rowTotals(creativeRows);
          const hasEightSheet = (totals.get(9) ?? 0) > 0 || (totals.get(14) ?? 0) > 0;
          const hasSixSheet = (totals.get(10) ?? 0) > 0 || (totals.get(15) ?? 0) > 0;
          const hasQuad = (totals.get(11) ?? 0) > 0 || (totals.get(16) ?? 0) > 0;
          const hasTwoSheet = (totals.get(12) ?? 0) > 0 || (totals.get(17) ?? 0) > 0;
          const hasQa0 = (totals.get(13) ?? 0) > 0;
          const hasPosterSizes = hasEightSheet || hasSixSheet || hasQuad || hasTwoSheet || hasQa0;
          const hasMegaPortrait = (totals.get(20) ?? 0) > 0;
          const hasDotMega = (totals.get(19) ?? 0) > 0;
          const hasMega = (totals.get(18) ?? 0) > 0;
          const lowerNames = creativeRows.map((row) => row.fileName.toLowerCase()).join(' ');
          const hasNonPosterSizes = hasMegaPortrait || hasDotMega || hasMega;

          if (hasQa0 && !hasEightSheet && !hasSixSheet && !hasQuad && !hasTwoSheet && !hasNonPosterSizes) return 'QA0';
          if (hasQuad) return '4-sheet';
          if (hasEightSheet && !hasSixSheet && !hasTwoSheet && !hasQa0 && !hasNonPosterSizes) return '8-sheet';
          if (hasSixSheet && !hasEightSheet && !hasTwoSheet && !hasQa0 && !hasNonPosterSizes) return '6-sheet';
          if (hasTwoSheet && !hasEightSheet && !hasSixSheet && !hasQa0 && !hasNonPosterSizes) return '2-sheet';
          if (hasMegaPortrait && !hasPosterSizes && !hasDotMega && !hasMega) return 'Mega Portrait';
          if (hasDotMega && !hasPosterSizes && !hasMegaPortrait && !hasMega) return 'DOT Mega';
          if (hasMega && !hasPosterSizes && !hasMegaPortrait && !hasDotMega) return lowerNames.includes('mini') ? 'Mini Mega' : 'Mega';
          if (hasEightSheet && !hasQuad && !hasQa0) return '8-sheet';
          if (hasSixSheet && !hasQuad && !hasQa0) return '6-sheet';
          if (hasTwoSheet && !hasQuad && !hasQa0) return '2-sheet';
          if (hasQa0 && !hasQuad) return 'QA0';
          if (hasMegaPortrait) return 'Mega Portrait';
          if (hasDotMega) return 'DOT Mega';
          if (hasMega) return lowerNames.includes('mini') ? 'Mini Mega' : 'Mega';
          return 'Artwork';
        };

        const typeCounts = new Map<string, number>();
        const creativeTypeByNumber = new Map<number, string>();
        Array.from(rowsByCreative.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([creativeNumber, creativeRows]) => {
            const typeLabel = inferCreativeTypeLabel(creativeRows);
            creativeTypeByNumber.set(creativeNumber, typeLabel);
            typeCounts.set(typeLabel, (typeCounts.get(typeLabel) ?? 0) + 1);
          });

        const pluralizeTypeLabel = (label: string, count: number) => {
          if (count === 1) return label;
          if (label === '4-sheet') return '4-sheet';
          if (label === 'QA0') return 'QA0';
          if (label === 'Mini Mega') return 'Mini Megas';
          if (label === 'Mega Portrait') return 'Mega Portraits';
          if (label === 'DOT Mega') return 'DOT Megas';
          if (label === 'Mega') return 'Megas';
          return `${label}s`;
        };

        const creativeHeadline = Array.from(typeCounts.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([label, count]) => `${count} x ${pluralizeTypeLabel(label, count)}`)
          .join(', ') || 'No mapped creatives';

        const quantityLabelForColumn = (column: number, creativeTypeLabel: string) => {
          if (column === 9) return '8-sheet posters';
          if (column === 10) return '6-sheet posters';
          if (column === 11) return '4-sheet posters';
          if (column === 12) return '2-sheet posters';
          if (column === 13) return creativeTypeLabel === 'QA0' ? 'QA0' : 'A0 sized 4-sheet posters';
          if (column === 14) return 'Brisbane sized 8-sheet posters';
          if (column === 15) return 'Brisbane sized 6-sheet posters';
          if (column === 16) return 'Brisbane sized 4-sheet posters';
          if (column === 17) return 'Brisbane sized 2-sheet posters';
          if (column === 18) return creativeTypeLabel === 'Mini Mega' ? 'Mini Mega' : 'Mega';
          if (column === 19) return 'DOT Mega';
          return 'Mega Portrait';
        };

        const resolveCreativeFileName = (creativeImageId: string, fallbackBaseName: string) => {
          const imageRecord = imageRecordById.get(creativeImageId);
          const rawPdfFileName = (imageRecord?.sourcePdfFileName || '').trim();
          if (rawPdfFileName) {
            return /\.pdf$/i.test(rawPdfFileName) ? rawPdfFileName : `${rawPdfFileName}.pdf`;
          }
          const rawName = (imageRecord?.name || '').trim().replace(/\s*\(Page\s+\d+\)\s*$/i, '').trim();
          if (rawName) {
            return /\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`;
          }
          const rawFileName = (imageRecord?.fileName || '').trim();
          if (rawFileName) {
            const base = rawFileName.replace(/\.[^.]+$/, '').replace(/-page-\d+$/i, '').trim();
            if (base) return `${base}.pdf`;
          }
          const fallbackBase = fallbackBaseName.replace(/\.[^.]+$/, '').replace(/-page-\d+$/i, '').trim();
          return `${fallbackBase || 'Artwork'}.pdf`;
        };

        const quantityPartsByCreative = new Map<number, string[]>();
        Array.from(rowsByCreative.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([creativeNumber, creativeRows]) => {
            const totals = rowTotals(creativeRows);
            const creativeTypeLabel = creativeTypeByNumber.get(creativeNumber) ?? 'Artwork';
            const parts = quantityColumns
              .map((column) => {
                const quantity = totals.get(column) ?? 0;
                if (quantity <= 0) return '';
                return `${quantity} x ${quantityLabelForColumn(column, creativeTypeLabel)}`;
              })
              .filter(Boolean);
            quantityPartsByCreative.set(creativeNumber, parts);
          });

        const miniMegaPageByCreativeNumber = new Map<number, number>();
        const miniMegaGroups = new Map<string, number[]>();
        Array.from(rowsByCreative.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([creativeNumber, creativeRows]) => {
            const creativeTypeLabel = creativeTypeByNumber.get(creativeNumber);
            if (creativeTypeLabel !== 'Mini Mega') return;
            const firstFileName = creativeRows[0]?.fileName || '';
            if (!firstFileName) return;
            const bucket = miniMegaGroups.get(firstFileName) ?? [];
            bucket.push(creativeNumber);
            miniMegaGroups.set(firstFileName, bucket);
          });
        miniMegaGroups.forEach((creativeNumbers) => {
          creativeNumbers.forEach((creativeNumber, index) => {
            miniMegaPageByCreativeNumber.set(creativeNumber, index + 1);
          });
        });

        const getStoredNameFromUrl = (url: string) => {
          const resolved = toAbsoluteUrl(buildApiUrl(url || ''));
          if (!resolved) return '';
          try {
            const parsed = new URL(resolved, window.location.origin);
            const segments = parsed.pathname.split('/').filter(Boolean);
            const storedName = segments[segments.length - 1] || '';
            return decodeURIComponent(storedName);
          } catch {
            const segments = resolved.split('/').filter(Boolean);
            return decodeURIComponent(segments[segments.length - 1] || '');
          }
        };

        const buildCampaignImageDownloadUrl = (creativeImageId: string) => {
          const imageRecord = imageRecordById.get(creativeImageId);
          if (!imageRecord) return '';
          const sourcePdfUrl = imageRecord.sourcePdfUrl || imageRecord.imageUrl || '';
          const storedName = imageRecord.sourcePdfStoredName || getStoredNameFromUrl(sourcePdfUrl);
          const rawFileName = resolveCreativeFileName(creativeImageId, imageRecord.name || 'Artwork');
          if (!storedName) return toAbsoluteUrl(buildApiUrl(sourcePdfUrl));
          const downloadUrl = new URL(toAbsoluteUrl(buildApiUrl(`/api/campaign-images/${encodeURIComponent(storedName)}/download`)));
          downloadUrl.searchParams.set('filename', rawFileName);
          return downloadUrl.toString();
        };

        const artworkFolderUrl = campaignId
          ? toAbsoluteUrl(`/?view=artwork&campaignId=${encodeURIComponent(campaignId)}`)
          : '';

        const bodySpacing = {
          after: 120,
          line: 276,
          lineRule: LineRuleType.AUTO,
        } as const;

        const makeParagraph = (
          children: Array<TextRun | ExternalHyperlink | ImageRun>,
          options?: any,
        ) =>
          new Paragraph({
            children,
            spacing: bodySpacing,
            ...(options || {}),
          });

        const paragraphs: Paragraph[] = [];
        const pushBlank = () => paragraphs.push(new Paragraph({ text: '', spacing: bodySpacing }));

        paragraphs.push(
          makeParagraph([
            new TextRun({ text: 'Artwork - ', underline: { type: UnderlineType.SINGLE } }),
            new TextRun(values.campaignName.trim() || 'Artwork'),
            new TextRun('  '),
            ...(artworkFolderUrl
              ? [
                  new ExternalHyperlink({
                    children: [
                      ...createWordIconChildren('folder'),
                      new TextRun({ text: 'Artwork', style: 'Hyperlink' }),
                    ],
                    link: artworkFolderUrl,
                  }),
                ]
              : [
                  ...createWordIconChildren('folder'),
                  new TextRun('Artwork'),
                ]),
          ]),
        );
        paragraphs.push(
          makeParagraph([
            new TextRun({ text: 'Creative - ', underline: { type: UnderlineType.SINGLE } }),
            new TextRun(creativeHeadline),
          ]),
        );
        paragraphs.push(
          makeParagraph([new TextRun({ text: 'No. of posters to print -', underline: { type: UnderlineType.SINGLE } })]),
        );
        pushBlank();

        Array.from(rowsByCreative.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([creativeNumber]) => {
            const creativeTypeLabel = creativeTypeByNumber.get(creativeNumber) ?? 'Artwork';
            const labelText = `Creative ${creativeNumber} (${creativeTypeLabel}): `;
            const summary = (quantityPartsByCreative.get(creativeNumber) ?? []).join(' & ');
            paragraphs.push(
              makeParagraph(
                [
                  new TextRun({ text: labelText, bold: true }),
                  new TextRun(summary || 'No mapped quantities'),
                ],
                { bullet: { level: 0 } },
              ),
            );
          });

        pushBlank();
        Array.from(rowsByCreative.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([creativeNumber, creativeRows]) => {
            const creativeTypeLabel = creativeTypeByNumber.get(creativeNumber) ?? 'Artwork';
            const headerText = `Creative ${creativeNumber} (${creativeTypeLabel}):`;
            const pageNumber = miniMegaPageByCreativeNumber.get(creativeNumber);
            const firstCreativeImageId = creativeRows[0]?.creativeImageId || '';
            const preview = creativePreviewById.get(firstCreativeImageId);

            if (creativeTypeLabel === 'Mini Mega' && creativeRows.length > 0) {
              const fileName = resolveCreativeFileName(firstCreativeImageId, creativeRows[0].fileName);
              const pageSuffix = pageNumber ? ` PAGE ${pageNumber}` : '';
              paragraphs.push(
                makeParagraph([
                  new TextRun({ text: `${headerText} `, bold: true }),
                  new ExternalHyperlink({
                    children: [
                      ...createWordIconChildren('pdf'),
                      new TextRun({ text: `${fileName}${pageSuffix}`, style: 'Hyperlink' }),
                    ],
                    link: buildCampaignImageDownloadUrl(firstCreativeImageId),
                  }),
                ]),
              );
              if (preview) {
                paragraphs.push(
                  makeParagraph([
                    new ImageRun({
                      type: preview.extension,
                      data: preview.bytes,
                      transformation: { width: 430, height: 130 },
                    }),
                  ]),
                );
              }
              pushBlank();
              return;
            }

            paragraphs.push(makeParagraph([new TextRun({ text: headerText, bold: true })]));
            creativeRows.forEach((row) => {
              const fileName = resolveCreativeFileName(row.creativeImageId, row.fileName);
              paragraphs.push(
                makeParagraph([
                  new TextRun({ text: `${row.state}: `, bold: true }),
                  new ExternalHyperlink({
                    children: [
                      ...createWordIconChildren('pdf'),
                      new TextRun({ text: fileName, style: 'Hyperlink' }),
                    ],
                    link: buildCampaignImageDownloadUrl(row.creativeImageId),
                  }),
                ]),
              );
            });
            if (preview) {
              paragraphs.push(
                makeParagraph([
                  new ImageRun({
                    type: preview.extension,
                    data: preview.bytes,
                    transformation: { width: 430, height: 130 },
                  }),
                ]),
              );
            }
            pushBlank();
          });

        paragraphs.push(
          makeParagraph([new TextRun({ text: 'Delivery -', underline: { type: UnderlineType.SINGLE } })]),
        );
        pushBlank();

        const deliveryByDestination = new Map<string, {
          creativeNumber: number;
          creativeTypeLabel: string;
          quantityByTypeLabel: Map<string, number>;
        }[]>();
        const deliveryLabelFromType = (typeLabel: string) => {
          const normalized = typeLabel.trim().toUpperCase();
          if (normalized === '8 SHEET') return '8-sheet posters';
          if (normalized === '6 SHEET') return '6-sheet posters';
          if (normalized === '4 SHEET') return '4-sheet posters';
          if (normalized === '2 SHEET') return '2-sheet posters';
          if (normalized === 'QA0') return 'QA0';
          if (normalized === 'BRIS 8 SHEET') return 'Brisbane sized 8-sheet posters';
          if (normalized === 'BRIS 6 SHEET') return 'Brisbane sized 6-sheet posters';
          if (normalized === 'BRIS 4 SHEET') return 'Brisbane sized 4-sheet posters';
          if (normalized === 'BRIS 2 SHEET') return 'Brisbane sized 2-sheet posters';
          if (normalized === 'FERRO') return 'Mega';
          if (normalized === 'REFLECTIVE') return 'DOT Mega';
          return 'Mega Portrait';
        };

        Array.from(deliveryRows.values()).forEach((row) => {
          const creativeNumber = getCreativeNumberFromCode(row.creativeCode);
          const creativeTypeLabel = creativeTypeByNumber.get(creativeNumber) ?? 'Artwork';
          const destinationKey = row.deliveredTo || 'DELIVERY';
          const creativeBucket = deliveryByDestination.get(destinationKey) ?? [];
          let creativeEntry = creativeBucket.find((entry) => entry.creativeNumber === creativeNumber);
          if (!creativeEntry) {
            creativeEntry = {
              creativeNumber,
              creativeTypeLabel,
              quantityByTypeLabel: new Map<string, number>(),
            };
            creativeBucket.push(creativeEntry);
          }
          const quantityLabel = deliveryLabelFromType(row.typeLabel);
          creativeEntry.quantityByTypeLabel.set(
            quantityLabel,
            (creativeEntry.quantityByTypeLabel.get(quantityLabel) ?? 0) + row.quantity,
          );
          deliveryByDestination.set(destinationKey, creativeBucket);
        });

        const deadlineText = formatDeliveryDeadline(values.dueDate);
        Array.from(deliveryByDestination.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([destination, entries]) => {
            const destinationBlock = deliveryInfoBlocks.find((block) => block.toUpperCase().startsWith(destination.toUpperCase()));
            const destinationLines = destinationBlock
              ? destinationBlock.split('\n').map((line) => line.trim()).filter(Boolean)
              : [];
            const destinationName = destinationLines.length > 1 ? destinationLines[1] : destination;
            paragraphs.push(
              makeParagraph([new TextRun(`Please deliver to ${destinationName} by ${deadlineText} by COB:`)]),
            );
            pushBlank();
            entries
              .sort((a, b) => a.creativeNumber - b.creativeNumber)
              .forEach((entry) => {
                const parts = Array.from(entry.quantityByTypeLabel.entries()).map(
                  ([quantityLabel, quantity]) => `${quantity} x ${quantityLabel}`,
                );
                paragraphs.push(
                  makeParagraph([
                    new TextRun({ text: `Creative ${entry.creativeNumber} (${entry.creativeTypeLabel}): `, bold: true }),
                    new TextRun(parts.join(' & ') || 'No mapped quantities'),
                  ], { bullet: { level: 0 } }),
                );
              });
            pushBlank();
          });

        const wordDocument = new WordDocument({
          styles: {
            default: {
              document: {
                run: {
                  font: 'Calibri',
                  size: 22,
                },
                paragraph: {
                  spacing: bodySpacing,
                },
              },
            },
          },
          sections: [
            {
              properties: {
                page: {
                  margin: {
                    top: 284,
                    right: 284,
                    bottom: 284,
                    left: 284,
                    header: 708,
                    footer: 708,
                    gutter: 0,
                  },
                },
              },
              children: paragraphs,
            },
          ],
        });

        const blob = await Packer.toBlob(wordDocument);
        const fileName = `${baseName} - Visuals.docx`;
        if (downloadFiles) {
          downloadBlobWithFileName(blob, fileName);
        }
        return {
          fileName,
          blob,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
      };

      const fillPrintWorkbook = async () => {
        setExportProgressMessage('Generating Print Quantities file...');
        const response = await fetch('/templates/26-233_PrintQuantities.xlsx');
        if (!response.ok) throw new Error('Unable to load print quantities template');
        const arrayBuffer = await response.arrayBuffer();
        const workbook = new ExcelJSRuntime.Workbook();
        await workbook.xlsx.load(arrayBuffer as ArrayBuffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('Print quantities sheet is missing');
        sheet.getColumn(2).width = 33.83203125;
        // Keep the purchase-order instruction header block aligned with template sizing.
        const purchaseOrderHeaderHeights: Array<[number, number]> = [
          [2, 34],
          [3, 27],
          [4, 27],
          [5, 27],
          [6, 27],
          [7, 157],
          [8, 27],
        ];
        purchaseOrderHeaderHeights.forEach(([row, height]) => {
          sheet.getRow(row).height = height;
        });
        sheet.views = [
          {
            state: 'frozen',
            ySplit: 10,
            topLeftCell: 'A11',
            activeCell: 'A1',
          },
        ];

        sheet.getCell('C3').value = values.campaignName || '';
        sheet.getCell('C4').value = campaignNumber;
        if (weekCommencing) sheet.getCell('C5').value = weekCommencing;
        sheet.getCell('C7').value = creativeSummaryText;
        const masterArtworkFolderCell = sheet.getCell('B8');
        const masterArtworkFolderLabel = (masterArtworkFolderCell.text || '').trim() || 'MASTER ARTWORK FOLDER';
        const artworkFolderUrl = campaignId
          ? toAbsoluteUrl(`/?view=artwork&campaignId=${encodeURIComponent(campaignId)}`)
          : '';
        // Keep template styling while wiring the campaign artwork-folder link when campaign id is available.
        masterArtworkFolderCell.value = artworkFolderUrl
          ? { text: masterArtworkFolderLabel, hyperlink: artworkFolderUrl }
          : masterArtworkFolderLabel;
        const worksheetModel = sheet.model as { hyperlinks?: Array<{ ref?: string }> };
        if (Array.isArray(worksheetModel.hyperlinks)) {
          worksheetModel.hyperlinks = worksheetModel.hyperlinks.filter((entry) => {
            const ref = (entry.ref || '').toUpperCase();
            return ref !== 'B8' && ref !== 'B8:I8';
          });
        }
        if (artworkFolderUrl) {
          const hyperlinks = Array.isArray(worksheetModel.hyperlinks) ? worksheetModel.hyperlinks : [];
          hyperlinks.push({ ref: 'B8', target: artworkFolderUrl } as { ref?: string; target?: string });
          worksheetModel.hyperlinks = hyperlinks;
        }

        const rows = Array.from(printRows.values()).sort((a, b) => a.creativeCode.localeCompare(b.creativeCode));
        const usedQuantityColumns = new Set<number>();
        const columnTotals = new Map<number, number>();
        for (let col = 9; col <= 20; col += 1) {
          columnTotals.set(col, 0);
        }
        const stateMarkerColumnByState = detectStateMarkerColumns(sheet, 10, 1, 30);
        const stateMarkerColumns = Array.from(new Set([...stateMarkerColumnByState.values()]));
        const baseDataRows = 3;
        const startRow = 11;
        const templateTotalsRow = 15;
        const rowDelta = rows.length - baseDataRows;
        if (rowDelta > 0) {
          sheet.spliceRows(templateTotalsRow, 0, ...Array.from({ length: rowDelta }, () => []));
        }

        const dataEndRow = Math.max(startRow + rows.length - 1, startRow + baseDataRows - 1);
        for (let row = startRow; row <= dataEndRow; row += 1) {
          sheet.getRow(row).height = 141;
          // Keep template stable: hide unused template data rows instead of deleting them.
          sheet.getRow(row).hidden = row >= startRow + rows.length && row < startRow + baseDataRows;
          sheet.getCell(row, 2).value = null;
          sheet.getCell(row, 3).value = null;
          sheet.getCell(row, 4).value = null;
          sheet.getCell(row, 5).value = null;
          sheet.getCell(row, 6).value = null;
          sheet.getCell(row, 7).value = null;
          for (let col = 9; col <= 20; col += 1) sheet.getCell(row, col).value = null;
        }

        rows.forEach((entry, index) => {
          const row = startRow + index;
          sheet.getCell(row, 2).value = entry.creativeCode;
          sheet.getCell(row, 4).value = entry.fileName;
          (stateMarkerColumns.length > 0 ? stateMarkerColumns : [5, 6, 7]).forEach((col) => {
            sheet.getCell(row, col).value = null;
          });
          const stateMarkerColumn = stateMarkerColumnByState.get(entry.state);
          if (stateMarkerColumn) {
            const stateMarkerCell = sheet.getCell(row, stateMarkerColumn);
            stateMarkerCell.value = '\u2605';
            stateMarkerCell.font = {
              ...(stateMarkerCell.font ?? {}),
              name: 'Segoe UI Symbol',
              size: 14,
              color: { argb: 'FFC9A227' },
            };
            stateMarkerCell.alignment = {
              ...(stateMarkerCell.alignment ?? {}),
              horizontal: 'center',
              vertical: 'middle',
            };
          }
          const dataUrl = creativeImageDataUrlById.get(entry.creativeImageId);
          if (dataUrl) {
            try {
              const imageRecord = imageRecordById.get(entry.creativeImageId);
              const extension = detectImageExtension(imageRecord?.mimeType ?? '', imageRecord?.fileName ?? '');
              const imageId = workbook.addImage({ base64: dataUrl, extension });
              sheet.addImage(imageId, {
                tl: { col: 2.1, row: row - 1 + 0.05 },
                ext: { width: 140, height: 130 },
              });
            } catch (imageError) {
              console.error('Unable to embed creative image in print sheet', imageError);
            }
          }
          Object.entries(entry.quantities).forEach(([column, quantity]) => {
            const numericColumn = Number(column);
            sheet.getCell(row, numericColumn).value = quantity;
            if (quantity > 0) {
              usedQuantityColumns.add(numericColumn);
            }
            columnTotals.set(numericColumn, (columnTotals.get(numericColumn) ?? 0) + quantity);
          });
        });

        // Show only quantity columns that actually contain values in this export.
        for (let col = 9; col <= 20; col += 1) {
          sheet.getColumn(col).hidden = !usedQuantityColumns.has(col);
        }

        const renderedDataRows = Math.max(rows.length, baseDataRows);
        const totalRow = startRow + renderedDataRows + 1;
        const setsRow = totalRow + 1;
        const lastDataRow = Math.max(startRow, startRow + rows.length - 1);
        const setsDivisorByColumn = new Map<number, number>([
          // NSW/VIC/WA/SA/TAS/ACT/NT poster columns.
          [9, 4],  // 8-sheet
          [10, 3], // 6-sheet
          [11, 2], // 4-sheet
          [12, 1], // 2-sheet
          [13, 4], // QA0
          // QLD poster columns.
          [14, 4], // 8-sheet
          [15, 3], // 6-sheet
          [16, 2], // 4-sheet
          [17, 1], // 2-sheet
          // Mega formats are already in sets.
          [18, 1], // Mega
          [19, 1], // DOT M
          [20, 1], // MP
        ]);
        for (let col = 9; col <= 20; col += 1) {
          const columnLetter = sheet.getColumn(col).letter;
          const totalValue = columnTotals.get(col) ?? 0;
          const setDivisor = setsDivisorByColumn.get(col) ?? 1;
          sheet.getCell(totalRow, col).value = {
            formula: `SUM(${columnLetter}${startRow}:${columnLetter}${lastDataRow})`,
            result: totalValue,
          };
          sheet.getCell(setsRow, col).value = {
            formula: `${columnLetter}${totalRow}/${setDivisor}`,
            result: totalValue / setDivisor,
          };
        }

        stripSharedFormulaClones(workbook);
        const outputBuffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([outputBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `${baseName} - Print Quantities.xlsx`;
        if (downloadFiles) {
          downloadBlobWithFileName(blob, fileName);
        }
        return {
          fileName,
          blob,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      };

      const fillDeliveryWorkbook = async () => {
        setExportProgressMessage('Generating Delivery Instructions file...');
        const response = await fetch('/templates/26-233_Delivery_Instructions.xlsx');
        if (!response.ok) throw new Error('Unable to load delivery instructions template');
        const arrayBuffer = await response.arrayBuffer();
        const workbook = new ExcelJSRuntime.Workbook();
        await workbook.xlsx.load(arrayBuffer as ArrayBuffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error('Delivery instructions sheet is missing');
        sheet.getColumn(2).width = 33.83203125;
        // Match Delivery Instructions template header sizing for the purchase-order section.
        const purchaseOrderHeaderHeights: Array<[number, number]> = [
          [2, 34],
          [3, 27],
          [4, 27],
          [5, 27],
          [6, 27],
          [7, 27],
          [8, 126],
        ];
        purchaseOrderHeaderHeights.forEach(([row, height]) => {
          sheet.getRow(row).height = height;
        });
        sheet.views = [
          {
            state: 'frozen',
            ySplit: 10,
            topLeftCell: 'A11',
            activeCell: 'A1',
          },
        ];

        const stateMarkerColumnByState = detectStateMarkerColumns(sheet, 10, 1, 30);
        const stateMarkerColumns = Array.from(new Set([...stateMarkerColumnByState.values()]));

        sheet.getCell('C3').value = values.campaignName || '';
        sheet.getCell('C4').value = campaignNumber;
        sheet.getCell('C5').value = `${weekCount} WEEK${weekCount === 1 ? '' : 'S'}`;
        if (weekCommencing) sheet.getCell('C6').value = weekCommencing;
        sheet.getCell('C8').value = creativeSummaryText;

        const rows = Array.from(deliveryRows.values()).sort((a, b) => a.creativeCode.localeCompare(b.creativeCode) || a.typeLabel.localeCompare(b.typeLabel));
        const baseDataRows = 5;
        const startRow = 11;
        const templateInfoHeaderRow = 17;
        const rowDelta = rows.length - baseDataRows;
        if (rowDelta > 0) {
          sheet.spliceRows(templateInfoHeaderRow, 0, ...Array.from({ length: rowDelta }, () => []));
        }

        const dataEndRow = Math.max(startRow + rows.length - 1, startRow + baseDataRows - 1);
        for (let row = startRow; row <= dataEndRow; row += 1) {
          sheet.getRow(row).height = 102;
          // Keep template stable: hide unused template data rows instead of deleting them.
          sheet.getRow(row).hidden = row >= startRow + rows.length && row < startRow + baseDataRows;
          sheet.getCell(row, 2).value = null;
          sheet.getCell(row, 3).value = null;
          sheet.getCell(row, 4).value = null;
          sheet.getCell(row, 5).value = null;
          sheet.getCell(row, 7).value = null;
          sheet.getCell(row, 8).value = null;
          sheet.getCell(row, 9).value = null;
          sheet.getCell(row, 11).value = null;
          sheet.getCell(row, 12).value = null;
          sheet.getCell(row, 13).value = null;
          sheet.getCell(row, 14).value = null;
        }

        rows.forEach((entry, index) => {
          const row = startRow + index;
          sheet.getCell(row, 2).value = entry.creativeCode;
          (stateMarkerColumns.length > 0 ? stateMarkerColumns : [3, 4, 5]).forEach((col) => {
            const markerCell = sheet.getCell(row, col);
            markerCell.value = null;
          });
          const stateMarkerColumn = stateMarkerColumnByState.get(entry.state);
          if (stateMarkerColumn) {
            const selectedMarkerCell = sheet.getCell(row, stateMarkerColumn);
            selectedMarkerCell.value = '\u2605';
            selectedMarkerCell.font = {
              ...(selectedMarkerCell.font ?? {}),
              name: 'Segoe UI Symbol',
              size: 14,
              color: { argb: 'FFC9A227' },
            };
            selectedMarkerCell.alignment = {
              ...(selectedMarkerCell.alignment ?? {}),
              horizontal: 'center',
              vertical: 'middle',
            };
          }
          const creativeImageId = creativeImageByCreativeFileKey.get(`${entry.creativeCode}\x00${entry.fileName}`);
          if (creativeImageId) {
            const dataUrl = creativeImageDataUrlById.get(creativeImageId);
            if (dataUrl) {
              try {
                const imageRecord = imageRecordById.get(creativeImageId);
                const extension = detectImageExtension(imageRecord?.mimeType ?? '', imageRecord?.fileName ?? '');
                const imageId = workbook.addImage({ base64: dataUrl, extension });
                sheet.addImage(imageId, {
                  tl: { col: 6.1, row: row - 1 + 0.05 },
                  ext: { width: 120, height: 92 },
                });
              } catch (imageError) {
                console.error('Unable to embed creative image in delivery sheet', imageError);
              }
            }
          }
          sheet.getCell(row, 8).value = entry.fileName;
          sheet.getCell(row, 9).value = entry.typeLabel;
          sheet.getCell(row, 11).value = entry.quantity;
          sheet.getCell(row, 12).value = entry.rolled;
          sheet.getCell(row, 13).value = entry.deliveredTo;
        });

        const infoHeaderRow = templateInfoHeaderRow + Math.max(0, rowDelta);
        const infoStartRow = infoHeaderRow + 1;
        const infoTemplateRow = 18;
        const infoTemplateRowHeight = sheet.getRow(infoTemplateRow).height ?? 134;
        const baseInfoRows = 3;
        const requiredInfoRows = Math.max(baseInfoRows, deliveryInfoBlocks.length);
        if (requiredInfoRows > baseInfoRows) {
          sheet.spliceRows(infoStartRow + baseInfoRows, 0, ...Array.from({ length: requiredInfoRows - baseInfoRows }, () => []));
        }
        sheet.getCell(infoHeaderRow, 2).value = 'DELIVERY INFORMATION:';
        for (let offset = 0; offset < requiredInfoRows; offset += 1) {
          const row = infoStartRow + offset;
          sheet.getRow(row).hidden = false;
          sheet.getRow(row).height = infoTemplateRowHeight;
          const mergeRef = `B${row}:P${row}`;
          try {
            sheet.mergeCells(mergeRef);
          } catch {
            // Ignore when already merged in template rows.
          }
          for (let col = 2; col <= 16; col += 1) {
            sheet.getCell(row, col).value = null;
          }
        }
        deliveryInfoBlocks.forEach((block, index) => {
          const row = infoStartRow + index;
          const cell = sheet.getCell(row, 2);
          cell.value = block;
          cell.alignment = {
            ...(cell.alignment ?? {}),
            wrapText: true,
            vertical: 'top',
          };
        });

        stripSharedFormulaClones(workbook);
        const outputBuffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([outputBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const fileName = `${baseName} - Delivery Instructions.xlsx`;
        if (downloadFiles) {
          downloadBlobWithFileName(blob, fileName);
        }
        return {
          fileName,
          blob,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
      };

      if (!shouldGenerateExcel) {
        const wordFile = await fillWordDocument();
        return [wordFile];
      }

      const printWorkbookFile = await fillPrintWorkbook();
      const deliveryWorkbookFile = await fillDeliveryWorkbook();
      return [printWorkbookFile, deliveryWorkbookFile];
    } catch (exportError) {
      throw exportError instanceof Error ? exportError : new Error('Unable to generate export files. Please try again.');
    }
  }

  async function downloadArtworkVisuals() {
    if (exportingTemplates || sendingAdsEmail) return;
    if (!hasDeliveryDueDate) {
      setError('Add a due date before downloading visuals.');
      return;
    }
    if (!hasUploadedPurchaseOrder) {
      setError('Upload a purchase order file before downloading visuals');
      return;
    }
    if (!hasMappedCreatives) {
      setError('Map at least one creative to a market asset before downloading visuals');
      return;
    }

    setError('');
    setExportingTemplates(true);
    setExportProgressMessage('Preparing export...');

    try {
      await generateArtworkTemplates(true, VISUALS_EXPORT_MODE);
      setExportProgressMessage('Download started. Check your browser download bar.');
      setError('');
    } catch (exportError) {
      const message = exportError instanceof Error ? exportError.message : 'Unable to download visual export. Please try again.';
      setError(message);
      setExportProgressMessage('');
    } finally {
      setExportingTemplates(false);
    }
  }

  async function sendArtworkEmailToAds() {
    if (sendingAdsEmail || exportingTemplates) return;
    if (!hasDeliveryDueDate) {
      setError('Add a due date before sending email to ADS.');
      return;
    }
    if (!hasUploadedPurchaseOrder) {
      setError('Upload a purchase order file before sending email to ADS');
      return;
    }
    if (!hasMappedCreatives) {
      setError('Map at least one creative to a market asset before sending email to ADS');
      return;
    }

    setError('');
    setSendingAdsEmail(true);
    setExportProgressMessage('Preparing export for email...');

    try {
      const generatedFiles = await generateArtworkTemplates(false, 'excel');
      const files = generatedFiles.map(
        (generatedFile) =>
          new File([generatedFile.blob], generatedFile.fileName, {
            type: generatedFile.mimeType,
          }),
      );
      const usedCreativeImageIds = new Set(
        values.campaignMarkets.flatMap((market) =>
          market.assets.flatMap((asset) => {
            const mapped = creativeFormatKeys
              .map((format) => getCreativeImageIdForFormat(asset, format))
              .filter((imageId) => Boolean(imageId.trim()));
            return Array.from(new Set(mapped));
          }),
        ),
      );
      const creativeLinks = values.printImages
        .filter((image) => usedCreativeImageIds.has(image.id))
        .map((image) => ({
          name: image.name || image.fileName || 'Creative',
          url: toAbsoluteUrl(buildApiUrl(image.imageUrl || '')),
        }))
        .filter((link) => Boolean(link.url.trim()));
      setExportProgressMessage('Sending email to ADS...');
      await sendEmailToAds(files, values.campaignName, creativeLinks);
      setExportProgressMessage('Email sent to ADS.');
      setError('');
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Unable to send email to ADS. Please try again.';
      setError(message);
      setExportProgressMessage('');
    } finally {
      setSendingAdsEmail(false);
    }
  }

  function openPurchaseOrderPicker() {
    purchaseOrderInputRef.current?.click();
  }

  function openArtworkPdfPicker() {
    artworkPdfInputRef.current?.click();
  }

  return (
    <main className="dense-main flex min-h-0 w-full flex-col gap-6">
      {topBarCenterHost
        ? createPortal(
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300" title={activeCampaignName}>
              {activeCampaignName}
            </p>,
            topBarCenterHost,
          )
        : null}
      {topBarActionsHost && onBack
        ? createPortal(
            <Button disabled={savingCampaign} onClick={() => void handleBackToDashboard()} size="sm" variant="ghost">
              <ArrowLeft className="h-4 w-4" />
              Campaigns
            </Button>,
            topBarActionsHost,
          )
        : null}
      {(error || metadataError) ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error || metadataError}</div>
      ) : null}
      {quoteResponseMessage ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{quoteResponseMessage}</div> : null}

      <div className="grid gap-6 pb-0">
        <section>
          <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
            <div className="space-y-6 lg:col-span-2">
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_226px_226px_136px]">
              <div className="flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex w-32 shrink-0 items-center whitespace-nowrap border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">Campaign Name</span>
                <Input
                  className="h-10 rounded-none border-0 bg-transparent"
                  id="campaign-name"
                  type="text"
                  value={values.campaignName}
                  onChange={(event) => updateField('campaignName', event.target.value)}
                />
              </div>
              <div className="flex h-10 w-[226px] overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex items-center whitespace-nowrap border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">Start Date</span>
                <Input
                  className="h-10 w-[148px] flex-none rounded-none border-0 bg-transparent px-2 pr-2 [&::-webkit-calendar-picker-indicator]:ml-auto [&::-webkit-calendar-picker-indicator]:block [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100"
                  id="campaign-start"
                  min={minSelectableDate}
                  type="date"
                  value={values.campaignStartDate}
                  onChange={(event) => updateField('campaignStartDate', event.target.value)}
                />
              </div>
              <div className="flex h-10 w-[226px] overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex items-center whitespace-nowrap border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">Due Date</span>
                <Input
                  className="h-10 w-[148px] flex-none rounded-none border-0 bg-transparent px-2 pr-2 [&::-webkit-calendar-picker-indicator]:ml-auto [&::-webkit-calendar-picker-indicator]:block [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-100"
                  id="due-date"
                  min={minSelectableDate}
                  type="date"
                  value={values.dueDate}
                  onChange={(event) => updateField('dueDate', event.target.value)}
                />
              </div>
              <div className="flex h-10 w-[136px] overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                <span className="inline-flex items-center whitespace-nowrap border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">Weeks</span>
                <Input
                  className="h-10 w-10 flex-none rounded-none border-0 bg-transparent px-0 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
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
                <div className="flex h-10 w-8 flex-col border-l border-slate-600">
                  <Button
                    className="h-[22px] w-8 rounded-none border-b border-slate-600 px-0"
                    onClick={() => updateWeekCount(numberOfWeeks + 1)}
                    type="button"
                    variant="ghost"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    className="h-[22px] w-8 rounded-none px-0"
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
                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_226px_226px_136px]">
                  <div className="flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                    <span className="inline-flex w-32 shrink-0 items-center whitespace-nowrap border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">Purchase Order</span>
                    <button
                      className="h-10 min-w-0 flex-1 truncate border-0 bg-transparent px-3 text-left text-sm font-semibold text-slate-100 transition hover:bg-slate-700/40"
                      disabled={uploadingPurchaseOrder}
                      onClick={openPurchaseOrderPicker}
                      type="button"
                    >
                      {uploadingPurchaseOrder
                        ? 'Uploading...'
                        : uploadedPurchaseOrderName
                          ? `Uploaded: ${uploadedPurchaseOrderName}`
                          : 'Choose File'}
                    </button>
                    <input
                      ref={purchaseOrderInputRef}
                      accept="application/pdf,.pdf"
                      className="hidden"
                      onChange={(event) => {
                        const nextFile = event.target.files?.[0] ?? null;
                        if (nextFile && !isPdfFile(nextFile)) {
                          setError('Only PDF files are allowed');
                          return;
                        }
                        setSelectedPurchaseOrderFile(nextFile);
                        if (nextFile) {
                          void handleUploadPurchaseOrder(nextFile);
                        }
                      }}
                      type="file"
                    />
                  </div>
                  <input
                    ref={artworkPdfInputRef}
                    accept="application/pdf,.pdf"
                    className="hidden"
                    multiple
                    onChange={(event) => {
                      handleArtworkPickerFiles(event.target.files);
                    }}
                    type="file"
                  />
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-black tracking-tight text-white">Market Planning</h3>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      className="h-10 min-w-[180px] px-5 text-base"
                      onClick={handleArtworkActionButtonClick}
                      type="button"
                      variant="outline"
                    >
                      {uploadingArtworkPages ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploadingArtworkPages ? 'Uploading Artwork...' : values.printImages.length > 0 ? 'Manage Artwork' : 'Upload Artwork'}
                    </Button>
                    <div title={canAddMarket ? 'Add another market' : addMarketDisabledReason}>
                      <Button className="h-10 min-w-[160px] px-5 text-base" disabled={!canAddMarket} onClick={openAddMarketDialog} type="button" variant="secondary">
                        <Plus className="h-4 w-4" />
                        Add Market
                      </Button>
                    </div>
                  </div>
                </div>
                {loadingMetadata ? (
                  <div className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
                    <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                    Loading campaign mappings…
                  </div>
                ) : null}

                <div className="space-y-4">
                  {visiblePlanningMarkets.map((market, marketIndex) => {
                    const availableAssets = assetsForMarket(market.market);
                    const canRemoveMarket = visiblePlanningMarkets.length > 1;
                    const availableMarkets = marketOptionsFor(market.id, market.market);
                    const isActiveMarket = market.id === activeMarket?.id;
                    const marketSummary = marketSummaryByName.get(market.market);
                    const visibleMarketFormatKeys = marketSummary
                      ? formatKeys.filter((key) => (marketSummary.breakdown[key] ?? 0) > 0)
                      : formatKeys;
                    return (
                      <div
                        key={market.id}
                        className={cn('rounded-md border bg-slate-800/60 p-4 sm:p-5', isActiveMarket ? 'border-violet-400/60 shadow-[0_0_0_1px_rgba(167,139,250,0.25)]' : 'border-slate-700')}
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
                          <div className="rounded-md border border-slate-700/80 bg-slate-900/45 lg:overflow-visible">
                            <div className="overflow-x-auto lg:overflow-visible">
                              <table className="dense-table min-w-[780px] w-full border-collapse">
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
                            <Button className="h-10 min-w-[132px] px-4 text-[15px]" disabled={!canAddAssetForMarket(market)} onClick={() => addCampaignAsset(market.id)} type="button" variant="secondary">
                              <Plus className="h-4 w-4" />
                              Add Asset
                            </Button>
                          </div>

                          {marketSummary ? (
                            <div className="space-y-3">
                              <p className="text-sm font-semibold text-white">Market Totals</p>
                              <div className="overflow-x-auto rounded-md border border-slate-700 bg-slate-900/65">
                                <table className="dense-table min-w-[860px] w-full border-collapse text-sm">
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

                <div className="space-y-5">
                  {values.campaignMarkets.map((market) => {
                    const deliveryAddressOptions = deliveryAddressOptionsFor(market.market);
                    return (
                      <div key={`finalize-map-${market.id}`} className="relative rounded-md border border-slate-700 bg-slate-900/45">
                        <div className="absolute inset-y-0 left-0 flex w-12 items-center justify-center border-r border-slate-700/70 bg-slate-900/65">
                          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-300 [writing-mode:vertical-rl] rotate-180">
                            {market.market || 'Market'}
                          </span>
                        </div>
                        <Button
                          className="absolute right-2 top-2 h-7 w-7"
                          onClick={() => openEditMarketDialog(market.id)}
                          size="icon"
                          title="Edit market"
                          type="button"
                          variant="ghost"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <div className="space-y-3 p-4 pl-14">
                          <div className="overflow-visible">
                            <table className="dense-table w-full border-collapse table-fixed">
                            <colgroup>
                              <col className="w-[32%]" />
                              <col className="w-[16%]" />
                              <col className="w-[14%]" />
                              <col className="w-[38%]" />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-slate-700/80 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                                <th className="px-4 py-3 text-left">Asset</th>
                                <th className="px-4 py-3 text-left">Category</th>
                                <th className="px-4 py-3 text-left">Creative</th>
                                <th className="px-4 py-3 text-left">Delivery Address</th>
                              </tr>
                            </thead>
                            <tbody>
                              {market.assets.map((asset) => {
                                const line = summaryLineByAssetId.get(asset.id);
                                const requiredFormats = getCreativeFormatsForBreakdown(line?.breakdown);
                                const displayFormats = requiredFormats.length > 0 ? requiredFormats : [null];
                                const rowSpan = displayFormats.length;
                                return (
                                  <Fragment key={`finalize-map-group-${asset.id}`}>
                                    {displayFormats.map((formatKey, index) => {
                                      const selectedCreativeId = formatKey ? getCreativeImageIdForFormat(asset, formatKey) : '';
                                      return (
                                        <tr key={`finalize-map-row-${asset.id}-${formatKey ?? 'none'}-${index}`} className="border-b border-slate-700/70 align-top last:border-b-0">
                                          {index === 0 ? (
                                            <td className="px-4 py-3" rowSpan={rowSpan}>
                                              <p className="text-sm font-semibold text-white">{asset.assetSearch || asset.assetId || 'Asset not selected'}</p>
                                            </td>
                                          ) : null}
                                          <td className="px-4 py-3">
                                            {formatKey ? (
                                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">{creativeFormatLabel(formatKey)}</p>
                                            ) : (
                                              <p className="text-sm text-slate-400">No active quantity formats</p>
                                            )}
                                          </td>
                                          <td className="px-4 py-3">
                                            {formatKey ? (
                                              <div className="flex items-center">
                                                <Button
                                                  className="h-9 w-24 px-3 text-xs font-semibold"
                                                  onClick={() =>
                                                    selectedCreativeId
                                                      ? openArtworkPreviewDialog(market.id, asset.id, formatKey)
                                                      : openAssignArtworkDialog(market.id, asset.id, formatKey)
                                                  }
                                                  type="button"
                                                  variant={selectedCreativeId ? 'outline' : 'secondary'}
                                                >
                                                  {selectedCreativeId ? (
                                                    <>
                                                      <Eye className="h-3.5 w-3.5" />
                                                      Show
                                                    </>
                                                  ) : (
                                                    '+ Assign'
                                                  )}
                                                </Button>
                                              </div>
                                            ) : (
                                              <p className="text-sm text-slate-500">-</p>
                                            )}
                                          </td>
                                          {index === 0 ? (
                                            <td className="px-4 py-3" rowSpan={rowSpan}>
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
                                          ) : null}
                                        </tr>
                                      );
                                    })}
                                  </Fragment>
                                );
                              })}
                            </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            </div>

          <aside className="space-y-3 lg:sticky lg:top-2">
              {summary ? (
                    <>
                    <div className="rounded-md border border-slate-700 bg-slate-900/70">
                      <div className="flex items-center justify-between border-b border-slate-700/70 px-2 py-1.5">
                        <h3 className="px-1 text-lg font-black tracking-tight text-white">Posters</h3>
                        <Button
                          aria-label="Expand posters table"
                          className="h-7 w-7 rounded-sm border border-transparent px-0 transition hover:border-slate-600 hover:bg-slate-800/80 hover:text-white focus-visible:border-slate-500 focus-visible:bg-slate-800/80"
                          onClick={() => setPostersExpandedOpen(true)}
                          title="Expand"
                          type="button"
                          variant="ghost"
                        >
                          <Maximize2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="overflow-x-auto">
                      <table className="dense-table w-max min-w-full border-collapse text-sm">
                        <colgroup>
                          <col className="w-[112px]" />
                          <col className="w-[88px]" />
                          {visibleReviewFormatKeys.map((key) => (
                            <col key={`review-col-${key}`} className="w-[88px]" />
                          ))}
                          <col className="w-[92px]" />
                        </colgroup>
                        <thead>
                          <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                            <th className="sticky left-0 z-40 border border-slate-700 bg-slate-950 px-3 py-2 text-left whitespace-nowrap">Market</th>
                            <th className="sticky left-[112px] z-40 border border-slate-700 bg-slate-950 px-3 py-2 text-left whitespace-nowrap">Type</th>
                            {visibleReviewFormatKeys.map((key) => (
                              <th key={`review-head-${key}`} className="border border-slate-700 px-3 py-2 text-center">{formatKeyLabel(key)}</th>
                            ))}
                            <th className="sticky right-0 z-40 border border-slate-700 bg-slate-950 px-3 py-2 text-center whitespace-nowrap">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleReviewMarkets.map((marketSummary) => {
                            const rows = buildReviewRows(marketSummary);
                            return rows.map((row, rowIndex) => (
                              <tr key={`review-row-${marketSummary.market}-${row.label}`} className={cn('bg-slate-800/70', rowIndex > 0 ? 'border-t border-slate-700/70' : 'border-t-2 border-slate-600')}>
                                {rowIndex === 0 ? (
                                  <th rowSpan={rows.length} className="sticky left-0 z-30 border border-slate-700 bg-slate-800 px-3 py-2 text-left font-semibold text-slate-100">
                                    {marketSummary.market}
                                  </th>
                                ) : null}
                                <th className="sticky left-[112px] z-30 border border-slate-700 bg-slate-800 px-3 py-2 text-left font-semibold text-slate-100">{row.label}</th>
                                {visibleReviewFormatKeys.map((key) => (
                                  <td key={`review-cell-${marketSummary.market}-${row.label}-${key}`} className="border border-slate-700 px-3 py-2 text-center font-semibold text-white">
                                    {row.breakdown[key]}
                                  </td>
                                ))}
                                <td className="sticky right-0 z-30 border border-slate-700 bg-slate-800 px-3 py-2 text-center font-black text-white">{row.total}</td>
                              </tr>
                            ));
                          })}

                          {(() => {
                            const grandRows = buildReviewRows(summary.grandTotal);

                            return grandRows.map((row, rowIndex, allRows) => (
                              <tr key={`review-grand-${row.label}`} className={cn('bg-violet-500/10', rowIndex === 0 ? 'border-t-4 border-violet-400/40' : 'border-t border-violet-400/20')}>
                                {rowIndex === 0 ? (
                                  <th rowSpan={allRows.length} className="sticky left-0 z-30 border border-violet-300/30 bg-[#2a2450] px-3 py-2 text-left font-semibold text-violet-100">
                                    All Markets
                                  </th>
                                ) : null}
                                <th className="sticky left-[112px] z-30 border border-violet-300/30 bg-[#2a2450] px-3 py-2 text-left font-semibold text-violet-100">{row.label}</th>
                                {visibleReviewFormatKeys.map((key) => (
                                  <td key={`review-grand-cell-${row.label}-${key}`} className="border border-violet-300/30 px-3 py-2 text-center font-semibold text-violet-100">
                                    {row.breakdown[key]}
                                  </td>
                                ))}
                                <td className="sticky right-0 z-30 border border-violet-300/30 bg-[#2a2450] px-3 py-2 text-center font-black text-violet-100">{row.total}</td>
                              </tr>
                            ));
                          })()}
                        </tbody>
                      </table>
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-2 text-lg font-black tracking-tight text-white">Cost</h3>
                    </div>
                    <div className="overflow-x-auto rounded-md border border-slate-700 bg-slate-900/70">
                      <table className="dense-table w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                            <th className="border border-slate-700 px-4 py-3 text-left">Market</th>
                            <th className="border border-slate-700 px-4 py-3 text-center">Printing Cost ($)</th>
                            <th className="border border-slate-700 px-4 py-3 text-center">Shipping Cost ($)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleReviewMarkets.map((marketSummary) => (
                            <tr key={`review-cost-${marketSummary.market}`} className="border-t border-slate-700/70 bg-slate-800/70">
                              <th className="border border-slate-700 px-4 py-3 text-left font-semibold text-slate-100">{marketSummary.market}</th>
                              <td className="border border-slate-700 px-4 py-3 text-center font-black text-white">
                                {formatCurrency(calculateMarketPrintingCost(marketSummary.market))}
                              </td>
                              <td className="border border-slate-700 px-4 py-3 text-center font-black text-white">
                                {formatCurrency(calculateMarketShippingCost(marketSummary.market))}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-4 border-violet-400/40 bg-violet-500/10">
                            <th className="border border-violet-300/30 px-4 py-3 text-left font-black text-violet-100">All Markets</th>
                            <td className="border border-violet-300/30 px-4 py-3 text-center font-black text-violet-100">
                              {formatCurrency(
                                visibleReviewMarkets.reduce(
                                  (total, marketSummary) => total + calculateMarketPrintingCost(marketSummary.market),
                                  0,
                                ),
                              )}
                            </td>
                            <td className="border border-violet-300/30 px-4 py-3 text-center font-black text-violet-100">
                              {formatCurrency(
                                visibleReviewMarkets.reduce(
                                  (total, marketSummary) => total + calculateMarketShippingCost(marketSummary.market),
                                  0,
                                ),
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    </>

              ) : (
                  <div className="rounded-md border border-slate-700 bg-slate-800/70 p-6">
                    <div className="flex items-start gap-3">
                      <CircleAlert className="mt-0.5 h-5 w-5 text-amber-300" />
                      <div>
                        <p className="font-semibold text-white">No totals yet</p>
                        <p className="mt-1 text-sm text-slate-400">Configure campaign assets above to generate totals.</p>
                      </div>
                    </div>
                  </div>
              )}
            </aside>
          </div>
        </section>

      </div>

      {(bottomBarHost
        ? createPortal(
            <div className="z-20 border-t border-slate-700/80 bg-slate-950/95 backdrop-blur">
              <div className="flex w-full items-center justify-between gap-4 px-6 py-3">
                <div className="min-h-[20px] text-sm text-slate-300" role="status">
                  {exportProgressMessage || ''}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    className="h-10 min-w-[180px] px-5 text-base"
                    disabled={exportingTemplates || sendingAdsEmail}
                    onClick={() => void downloadArtworkVisuals()}
                    title={!hasUploadedPurchaseOrder ? 'Upload purchase order before downloading visuals' : undefined}
                    type="button"
                    variant="outline"
                  >
                    {exportingTemplates ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {exportingTemplates ? 'Generating Files...' : 'Download Visuals'}
                  </Button>
                  <Button
                    className="h-10 min-w-[210px] px-6 text-base"
                    disabled={exportingTemplates || sendingAdsEmail}
                    onClick={() => void sendArtworkEmailToAds()}
                    title={hasUploadedPurchaseOrder ? undefined : 'Upload purchase order before sending to ADS'}
                    type="button"
                    variant="secondary"
                  >
                    {sendingAdsEmail ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {sendingAdsEmail ? 'Sending Email...' : 'Send Email To ADS'}
                  </Button>
                </div>
              </div>
            </div>,
            bottomBarHost,
          )
        : (
            <div className="z-20 border-t border-slate-700/80 bg-slate-950/95 backdrop-blur">
              <div className="flex w-full items-center justify-between gap-4 px-6 py-3">
                <div className="min-h-[20px] text-sm text-slate-300" role="status">
                  {exportProgressMessage || ''}
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    className="h-10 min-w-[180px] px-5 text-base"
                    disabled={exportingTemplates || sendingAdsEmail}
                    onClick={() => void downloadArtworkVisuals()}
                    title={!hasUploadedPurchaseOrder ? 'Upload purchase order before downloading visuals' : undefined}
                    type="button"
                    variant="outline"
                  >
                    {exportingTemplates ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {exportingTemplates ? 'Generating Files...' : 'Download Visuals'}
                  </Button>
                  <Button
                    className="h-10 min-w-[210px] px-6 text-base"
                    disabled={exportingTemplates || sendingAdsEmail}
                    onClick={() => void sendArtworkEmailToAds()}
                    title={hasUploadedPurchaseOrder ? undefined : 'Upload purchase order before sending to ADS'}
                    type="button"
                    variant="secondary"
                  >
                    {sendingAdsEmail ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    {sendingAdsEmail ? 'Sending Email...' : 'Send Email To ADS'}
                  </Button>
                </div>
              </div>
            </div>
          ))}

      <Dialog open={postersExpandedOpen} onOpenChange={setPostersExpandedOpen}>
        <DialogContent style={{ width: 'min(calc(100vw - 2rem), 82rem)', maxHeight: '90vh' }}>
          <DialogHeader>
            <DialogTitle>Posters</DialogTitle>
          </DialogHeader>
          {summary ? (
            <div className="overflow-auto rounded-md border border-slate-700 bg-slate-900/70">
              <table className="dense-table w-full table-fixed border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-3 py-2 text-left">Market</th>
                    <th className="border border-slate-700 px-3 py-2 text-left">Type</th>
                    {visibleReviewFormatKeys.map((key) => (
                      <th key={`expanded-review-head-${key}`} className="border border-slate-700 px-3 py-2 text-center">{formatKeyLabel(key)}</th>
                    ))}
                    <th className="border border-slate-700 px-3 py-2 text-center">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleReviewMarkets.map((marketSummary) => {
                    const rows = buildReviewRows(marketSummary);
                    return rows.map((row, rowIndex) => (
                      <tr key={`expanded-review-row-${marketSummary.market}-${row.label}`} className={cn('bg-slate-800/70', rowIndex > 0 ? 'border-t border-slate-700/70' : 'border-t-2 border-slate-600')}>
                        {rowIndex === 0 ? (
                          <th rowSpan={rows.length} className="border border-slate-700 px-3 py-2 text-left font-semibold text-slate-100">
                            {marketSummary.market}
                          </th>
                        ) : null}
                        <th className="border border-slate-700 px-3 py-2 text-left font-semibold text-slate-100">{row.label}</th>
                        {visibleReviewFormatKeys.map((key) => (
                          <td key={`expanded-review-cell-${marketSummary.market}-${row.label}-${key}`} className="border border-slate-700 px-3 py-2 text-center font-semibold text-white">
                            {row.breakdown[key]}
                          </td>
                        ))}
                        <td className="border border-slate-700 px-3 py-2 text-center font-black text-white">{row.total}</td>
                      </tr>
                    ));
                  })}
                  {(() => {
                    const grandRows = buildReviewRows(summary.grandTotal);
                    return grandRows.map((row, rowIndex, allRows) => (
                      <tr key={`expanded-review-grand-${row.label}`} className={cn('bg-violet-500/10', rowIndex === 0 ? 'border-t-4 border-violet-400/40' : 'border-t border-violet-400/20')}>
                        {rowIndex === 0 ? (
                          <th rowSpan={allRows.length} className="border border-violet-300/30 px-3 py-2 text-left font-semibold text-violet-100">
                            All Markets
                          </th>
                        ) : null}
                        <th className="border border-violet-300/30 px-3 py-2 text-left font-semibold text-violet-100">{row.label}</th>
                        {visibleReviewFormatKeys.map((key) => (
                          <td key={`expanded-review-grand-cell-${row.label}-${key}`} className="border border-violet-300/30 px-3 py-2 text-center font-semibold text-violet-100">
                            {row.breakdown[key]}
                          </td>
                        ))}
                        <td className="border border-violet-300/30 px-3 py-2 text-center font-black text-violet-100">{row.total}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={addMarketDialogOpen}
        onOpenChange={(open) => {
          setAddMarketDialogOpen(open);
          if (!open) {
            setEditingMarketId(null);
            setDraftMarket(null);
            setDraftMarketSummary(null);
          }
        }}
      >
        <DialogContent
          className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0"
          style={{ width: 'min(calc(100vw - 2rem), 72rem)', maxHeight: '90vh' }}
        >
          <DialogHeader className="shrink-0 border-b border-slate-700 px-5 py-4">
            <DialogTitle>Add Market</DialogTitle>
          </DialogHeader>
          {draftMarket ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-4">
                <div className="flex h-10 w-full overflow-hidden rounded-md border border-slate-600 bg-slate-800">
                  <span className="inline-flex w-32 shrink-0 items-center whitespace-nowrap border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">Market</span>
                  <div className="relative flex-1">
                    <select
                      className="h-10 w-full appearance-none border-0 bg-transparent px-3 pr-10 text-sm text-slate-50 focus:outline-none focus:ring-0"
                      onChange={(event) =>
                        updateDraftMarket((current) => {
                          const value = event.target.value;
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
                      value={draftMarket.market}
                    >
                      {Array.from(new Set([draftMarket.market, ...remainingMarketNames].filter(Boolean))).map((marketName) => (
                        <option
                          key={`draft-market-option-${marketName}`}
                          value={marketName}
                          style={{ backgroundColor: '#1e293b', color: '#f8fafc' }}
                        >
                          {marketName}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-md border border-slate-700/80 bg-slate-900/45">
                    <div className="overflow-visible">
                      <table className="dense-table w-full table-fixed border-collapse">
                        <colgroup>
                          <col className="w-[38%]" />
                          <col className="w-[48%]" />
                          <col className="w-[4%]" />
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
                          {draftMarket.assets.map((asset) => {
                            const canRemoveAsset = draftMarket.assets.length > 1;
                            const availableAssets = assetsForMarket(draftMarket.market);
                            const availableAssetOptions = assetOptionsFor(draftMarket, asset.id, asset.assetId);
                            return (
                              <tr key={asset.id} className="border-b border-slate-700/70 align-top last:border-b-0">
                                <td className="px-4 py-3">
                                  <SearchableSelect
                                    emptyMessage={availableAssets.length ? 'No assets available for this row.' : 'No assets available for this market.'}
                                    items={availableAssetOptions}
                                    label=""
                                    menuItemClassName="text-[11px]"
                                    onValueChange={(value) =>
                                      updateDraftAsset(asset.id, (current) => ({
                                        ...current,
                                        assetId: value,
                                        assetSearch: availableAssets.find((entry) => entry.id === value)?.label ?? '',
                                      }))
                                    }
                                    placeholder={availableAssets.length ? 'Choose an asset' : 'No assets available'}
                                    selectedLabel={asset.assetSearch}
                                    selectedValue={asset.assetId}
                                    triggerClassName="text-[11px]"
                                  />
                                </td>
                                <td className="px-2 py-3">
                                  <div className="flex justify-start">
                                    <WeekSelector
                                      small
                                      weekCount={numberOfWeeks}
                                      startDate={values.campaignStartDate}
                                      onToggleWeek={(week) => toggleDraftAssetWeek(asset.id, week)}
                                      selectedWeeks={asset.selectedWeeks}
                                    />
                                  </div>
                                </td>
                                <td className="px-1 py-3 text-center">
                                  {canRemoveAsset ? (
                                    <Button className="h-7 w-7" onClick={() => removeDraftAsset(asset.id)} size="icon" type="button" variant="ghost">
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

                  <div title={canAddAssetForMarket(draftMarket) ? 'Add another asset' : addAssetDisabledReasonForMarket(draftMarket)}>
                    <Button className="h-10 min-w-[132px] px-4 text-[15px]" disabled={!canAddAssetForMarket(draftMarket)} onClick={addDraftAsset} type="button" variant="secondary">
                      <Plus className="h-4 w-4" />
                      Add Asset
                    </Button>
                  </div>

                  {draftMarketSummary ? (
                    <div className="space-y-3">
                      <p className="text-sm font-semibold text-white">Market Totals</p>
                      <div className="overflow-hidden rounded-md border border-slate-700 bg-slate-900/65">
                        <table className="dense-table w-full table-fixed border-collapse text-sm">
                          <thead>
                            <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                              <th className="border border-slate-700 px-4 py-3 text-left">Type</th>
                              {formatKeys
                                .filter((key) => (draftMarketSummary.breakdown[key] ?? 0) > 0)
                                .map((key) => (
                                  <th key={`draft-market-head-${key}`} className="border border-slate-700 px-4 py-3 text-center">{formatKeyLabel(key)}</th>
                                ))}
                              <th className="border border-slate-700 px-4 py-3 text-center">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {buildReviewRows(draftMarketSummary).map((row) => (
                              <tr key={`draft-market-row-${row.label}`} className="bg-slate-800/70 border-t border-slate-700/70">
                                <th className="border border-slate-700 px-4 py-3 text-left font-semibold text-slate-100">{row.label}</th>
                                {formatKeys
                                  .filter((key) => (draftMarketSummary.breakdown[key] ?? 0) > 0)
                                  .map((key) => (
                                    <td key={`draft-market-cell-${row.label}-${key}`} className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">
                                      {row.breakdown[key]}
                                    </td>
                                  ))}
                                <td className="border border-slate-700 px-4 py-3 text-center font-black text-white">{row.total}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-violet-500/10 border-t border-violet-400/30">
                              <th
                                colSpan={formatKeys.filter((key) => (draftMarketSummary.breakdown[key] ?? 0) > 0).length + 1}
                                className="border border-violet-300/30 px-4 py-3 text-right font-black uppercase tracking-[0.12em] text-violet-100"
                              >
                                Total
                              </th>
                              <td className="border border-violet-300/30 px-4 py-3 text-center font-black text-violet-100">
                                {draftMarketSummary.posterTotal + draftMarketSummary.frameTotal}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  ) : draftMarketCalculating ? (
                    <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/65 px-3 py-2 text-sm text-slate-300">
                      <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
                      Calculating market totals...
                    </div>
                  ) : (
                    <p className="text-sm leading-6 text-slate-400">Configure assets in this market to see its sheet-level mix and totals here.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          <div className="shrink-0 border-t border-slate-700 bg-slate-950 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
            <div>
              {editingMarketId ? (
                <Button
                  className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  onClick={handleDeleteEditingMarket}
                  type="button"
                  variant="ghost"
                >
                  Delete Market
                </Button>
              ) : null}
            </div>
            <div className="flex justify-end gap-3">
            <Button
              onClick={() => {
                setAddMarketDialogOpen(false);
                setEditingMarketId(null);
                setDraftMarket(null);
                setDraftMarketSummary(null);
              }}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={!draftMarket?.market.trim() || (!editingMarketId && !canAddMarket)} onClick={handleSaveAddMarket} type="button">
              Save
            </Button>
            </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
            <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
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
        open={previewArtworkDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setPreviewArtworkDialogOpen(true);
            return;
          }
          closeArtworkPreviewDialog();
        }}
      >
        <DialogContent style={{ width: 'min(calc(100vw - 2rem), 42rem)' }}>
          <DialogHeader>
            <DialogTitle>Artwork</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewArtworkImage ? (
              <>
                <div className="overflow-hidden rounded-md border border-slate-700 bg-slate-900">
                  <div className="max-h-[62vh] overflow-auto bg-slate-950/60 p-2">
                    {previewArtworkThumbnailSrc || previewArtworkFullSrc ? (
                      <div className="relative mx-auto w-fit">
                        {previewArtworkThumbnailSrc ? (
                          <img
                            alt={previewArtworkImage.name}
                            className={cn(
                              'mx-auto h-auto max-w-full rounded-sm transition-opacity duration-150',
                              previewArtworkFullLoaded ? 'opacity-0' : 'opacity-100',
                            )}
                            src={previewArtworkThumbnailSrc}
                          />
                        ) : null}
                        {previewArtworkFullSrc ? (
                          <img
                            alt={previewArtworkImage.name}
                            className={cn(
                              'mx-auto h-auto max-w-full rounded-sm transition-opacity duration-200',
                              previewArtworkThumbnailSrc ? 'absolute inset-0 opacity-0' : '',
                              previewArtworkFullLoaded ? 'opacity-100' : 'opacity-0',
                            )}
                            onLoad={() => setPreviewArtworkFullLoaded(true)}
                            src={previewArtworkFullSrc}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-400">
                        Preview unavailable
                      </div>
                    )}
                  </div>
                  <div className="border-t border-slate-700 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-slate-100">{previewArtworkImage.name || previewArtworkImage.fileName}</p>
                    <p className="truncate text-xs text-slate-400">{previewArtworkImage.fileName}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button onClick={removeArtworkFromPreview} type="button" variant="destructive">
                    Remove
                  </Button>
                  <Button onClick={openChangeArtworkFromPreview} type="button" variant="secondary">
                    Change
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-slate-700 bg-slate-900 px-4 py-6 text-center text-sm text-slate-400">
                No artwork assigned.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assignArtworkDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setAssignArtworkDialogOpen(true);
            return;
          }
          closeAssignArtworkDialog();
        }}
      >
        <DialogContent style={{ width: 'min(calc(100vw - 2rem), 64rem)', maxHeight: '90vh' }}>
          <DialogHeader>
            <DialogTitle>Artwork</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={uploadingArtworkPages} onClick={openArtworkPdfPicker} type="button" variant="secondary">
                {uploadingArtworkPages ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploadingArtworkPages ? 'Uploading Artwork...' : 'Upload Artwork'}
              </Button>
            </div>
            {artworkDialogError ? (
              <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
                {artworkDialogError}
              </div>
            ) : null}
            {values.printImages.length > 0 ? (
              <div className="max-h-[56vh] overflow-auto rounded-md border border-slate-700 bg-slate-900/65 p-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
                  {values.printImages.map((image) => {
                    const thumbnailSrc = image.thumbnailUrl ? buildApiUrl(image.thumbnailUrl) : '';
                    const imageSrc = image.imageUrl ? buildApiUrl(image.imageUrl) : '';
                    const displaySrc = thumbnailSrc || imageSrc;
                    const selected = image.id === selectedArtworkImageIdForTarget;
                    const assigned = assignedArtworkIdSet.has(image.id);
                    const deleting = deletingArtworkIds.includes(image.id);
                    return (
                      <div
                        key={`artwork-thumb-${image.id}`}
                        className={cn(
                          'group relative overflow-hidden rounded-md border text-left transition',
                          selected ? 'border-violet-400 bg-violet-500/10' : 'border-slate-700 bg-slate-950 hover:border-slate-500',
                        )}
                      >
                        <button
                          className="flex w-full flex-col overflow-hidden text-left"
                          disabled={deleting}
                          onClick={() => assignArtworkImageToTarget(image.id)}
                          type="button"
                        >
                          <div className="aspect-[4/3] w-full overflow-hidden bg-slate-900">
                            {displaySrc ? (
                              <img
                                alt={image.name}
                                className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                loading="lazy"
                                src={displaySrc}
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center px-2 text-center text-xs text-slate-400">Preview unavailable</div>
                            )}
                          </div>
                          <div className="space-y-1 px-2 py-2">
                            <p className="truncate text-xs font-semibold text-slate-100">{image.name || image.fileName}</p>
                            <p className="truncate text-[11px] text-slate-400">{image.fileName}</p>
                          </div>
                        </button>
                        <Button
                          className={cn(
                            'absolute right-1.5 top-1.5 h-7 w-7 rounded-full border p-0',
                            assigned
                              ? 'cursor-not-allowed border-slate-800 bg-slate-900/70 text-slate-600 hover:bg-slate-900/70 hover:text-slate-600'
                              : 'border-slate-700 bg-slate-950/90 text-rose-200 hover:bg-rose-500/20 hover:text-rose-100',
                          )}
                          disabled={deleting || assigned}
                          onClick={() => void handleDeleteArtwork(image)}
                          size="icon"
                          title={assigned ? 'Cannot delete while assigned to an asset category' : 'Delete artwork'}
                          type="button"
                          variant="ghost"
                        >
                          {deleting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-slate-700 bg-slate-900 px-4 py-6 text-center text-sm text-slate-400">
                No artwork uploaded yet. Upload PDFs to generate selectable thumbnails.
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={closeAssignArtworkDialog} type="button" variant="ghost">
                Continue
              </Button>
            </div>
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

      <Dialog
        open={purchaseOrderUploadSuccessOpen}
        onOpenChange={setPurchaseOrderUploadSuccessOpen}
      >
        <DialogContent style={{ width: 'min(calc(100vw - 2rem), 30rem)' }}>
          <DialogHeader>
            <DialogTitle>Purchase Order Uploaded</DialogTitle>
            <DialogDescription>{purchaseOrderUploadSuccessMessage || 'Purchase order file uploaded successfully.'}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              onClick={() => setPurchaseOrderUploadSuccessOpen(false)}
              type="button"
              variant="secondary"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={artworkUploadSuccessOpen}
        onOpenChange={setArtworkUploadSuccessOpen}
      >
        <DialogContent style={{ width: 'min(calc(100vw - 2rem), 30rem)' }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-300" />
              Artwork Upload Complete
            </DialogTitle>
            <DialogDescription>{artworkUploadSuccessMessage || 'Artwork files uploaded successfully.'}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              onClick={() => setArtworkUploadSuccessOpen(false)}
              type="button"
              variant="secondary"
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        cancelLabel="Keep Artwork"
        confirmLabel="Delete Artwork"
        confirming={confirmingArtworkDelete}
        description={
          deleteArtworkCandidate
            ? `Delete "${deleteArtworkCandidate.name || deleteArtworkCandidate.fileName || 'this artwork'}"? This permanently removes the file from storage.`
            : ''
        }
        onCancel={cancelDeleteArtwork}
        onConfirm={() => void confirmDeleteArtwork()}
        open={Boolean(deleteArtworkCandidate)}
        title="Delete Artwork"
      />
    </main>
  );
}

