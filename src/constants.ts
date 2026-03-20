import { OperationOption, OrderFormValues, ProcessOption, StockOption } from './types';

export const stockOptions: StockOption[] = [
  {
    label: '3mm Corflute',
    stockCode: 'ARTBOARD005',
    substrateLabel: '3mm Corflute (flute direction long width horizontal)',
    materialRatePerSqm: 6.5,
  },
  {
    label: '5mm Corflute',
    stockCode: 'ARTBOARD006',
    substrateLabel: '5mm Corflute',
    materialRatePerSqm: 7.9,
  },
  {
    label: 'Foam Board 5mm',
    stockCode: 'FOAMBOARD005',
    substrateLabel: 'Foam Board 5mm',
    materialRatePerSqm: 11.5,
  },
];

export const processOptions: ProcessOption[] = [
  {
    label: 'Standard/Heavy CMYK (160sqm/hr)',
    ratePerSqm: 4.4,
  },
  {
    label: 'Standard CMYK (220sqm/hr)',
    ratePerSqm: 3.8,
  },
  {
    label: 'Heavy CMYK + White (120sqm/hr)',
    ratePerSqm: 5.9,
  },
];

export const jobOperationOptions: OperationOption[] = [
  { name: 'Preflight', enabledByDefault: true },
  { name: '* PROOF PDF', enabledByDefault: true },
  { name: '*FILE SETUP ADS', enabledByDefault: true },
  { name: 'Auto to Press', enabledByDefault: true },
  { name: '* Standard Pack and Wrap', enabledByDefault: true },
];

export const sectionOperationOptions: OperationOption[] = [
  { name: 'CUT - Kongsberg Table Cutter', enabledByDefault: true },
  { name: 'Trim to Size' },
  { name: 'Drill Holes' },
  { name: 'Round Corners' },
];

export const defaultFormValues: OrderFormValues = {
  customerCode: 'C00014',
  customerReference: 'Q14259:1.0',
  jobTitle: '1024V01-Price Board Header L DS 80x420',
  jobDescription:
    'BK 01 - Finished Size: 80 x 420\nSubstrate: 3mm Corflute\nMode: Standard/Heavy CMYK (160sqm/hr)\nIncludes: Bulk packed and Wrapped',
  quantity: '5000',
  finishWidth: '80',
  finishHeight: '420',
  sectionWidth: '80',
  sectionHeight: '420',
  pages: '2',
  productCategory: '',
  sectionType: 'Single-Section',
  foldCatalog: 'Flat Product',
  stockCode: 'ARTBOARD005',
  processFront: 'Standard/Heavy CMYK (160sqm/hr)',
  processReverse: 'Standard/Heavy CMYK (160sqm/hr)',
  kindName: '125000273C01',
  notes: '',
  contact: {
    title: 'Accounts Payable',
    firstName: 'Accounts',
    surname: 'Payable',
    email: 'accounts@lithocraft.com.au',
  },
  selectedJobOperations: jobOperationOptions
    .filter((operation) => operation.enabledByDefault)
    .map((operation) => operation.name),
  selectedSectionOperations: sectionOperationOptions
    .filter((operation) => operation.enabledByDefault)
    .map((operation) => operation.name),
  wastePercent: '5',
  setupCost: '65',
  cutCostPerUnit: '0.02',
  targetFreightPrice: '',
};
