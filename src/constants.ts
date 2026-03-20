import { CampaignLine, OperationOption, OrderFormValues } from './types';

export const stockOptions = [
  { label: '3mm Corflute', stockCode: 'ARTBOARD005' },
  { label: '5mm Corflute', stockCode: 'ARTBOARD006' },
  { label: 'Foam Board 5mm', stockCode: 'FOAMBOARD005' },
];

export const processOptions = [
  'Standard/Heavy CMYK (160sqm/hr)',
  'Standard CMYK (220sqm/hr)',
  'Heavy CMYK + White (120sqm/hr)',
];

export const jobOperationOptions: OperationOption[] = [
  { id: 'preflight', label: 'Preflight', operationName: 'Preflight', enabledByDefault: true },
  { id: 'proof-pdf', label: 'Proof PDF', operationName: '* PROOF PDF', enabledByDefault: true },
  { id: 'file-setup', label: 'File Setup', operationName: '*FILE SETUP ADS', enabledByDefault: true },
  { id: 'auto-press', label: 'Auto to Press', operationName: 'Auto to Press', enabledByDefault: true },
  {
    id: 'pack-wrap',
    label: 'Standard Pack and Wrap',
    operationName: '* Standard Pack and Wrap',
    enabledByDefault: true,
  },
];

export const sectionOperationOptions: OperationOption[] = [
  {
    id: 'cut-kongsberg',
    label: 'Cut - Kongsberg Table Cutter',
    operationName: 'CUT - Kongsberg Table Cutter',
    enabledByDefault: true,
  },
  { id: 'trim', label: 'Trim to Size', operationName: 'Trim to Size' },
  { id: 'drill', label: 'Drill Holes', operationName: 'Drill Holes' },
  { id: 'round-corners', label: 'Round Corners', operationName: 'Round Corners' },
];

export function createCampaignLine(id: string): CampaignLine {
  return {
    id,
    market: 'Sydney',
    assetId: '',
    assetSearch: '',
    selectedWeeks: [1],
  };
}

export const defaultFormValues: OrderFormValues = {
  customerCode: 'C00014',
  customerReference: 'Q14259:1.0',
  jobTitle: 'Campaign Print Order',
  jobDescription: '',
  notes: '',
  productCategory: '',
  sectionType: 'Single-Section',
  foldCatalog: 'Flat Product',
  stockCode: 'ARTBOARD005',
  processFront: 'Standard/Heavy CMYK (160sqm/hr)',
  processReverse: '',
  targetFreightPrice: '',
  quantity: '',
  finishWidth: '80',
  finishHeight: '420',
  sectionWidth: '80',
  sectionHeight: '420',
  pages: '2',
  kindName: 'Campaign-01',
  campaignStartDate: new Date().toISOString().slice(0, 10),
  numberOfWeeks: '3',
  campaignLines: [createCampaignLine('line-1')],
  contact: {
    title: 'Accounts Payable',
    firstName: 'Accounts',
    surname: 'Team',
    email: 'accounts@example.com',
  },
  selectedJobOperations: jobOperationOptions
    .filter((operation) => operation.enabledByDefault)
    .map((operation) => operation.id),
  selectedSectionOperations: sectionOperationOptions
    .filter((operation) => operation.enabledByDefault)
    .map((operation) => operation.id),
};
