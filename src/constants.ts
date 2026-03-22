import { CampaignLine, OrderFormValues } from './types';

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
  customerCode: 'TstCus',
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
  selectedJobOperations: [],
  selectedSectionOperations: [],
};
