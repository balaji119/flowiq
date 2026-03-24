import { CampaignAsset, CampaignMarket, OrderFormValues } from './types';

export function createCampaignAsset(id: string): CampaignAsset {
  return {
    id,
    assetId: '',
    assetSearch: '',
    selectedWeeks: [1],
  };
}

export function createCampaignMarket(id: string): CampaignMarket {
  return {
    id,
    market: 'Sydney',
    assets: [createCampaignAsset(`asset-${id}-1`)],
  };
}

export function createDefaultFormValues(): OrderFormValues {
  return {
    customerCode: 'C00014',
    customerReference: 'Q14259:1.0',
    campaignName: '',
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
    campaignStartDate: '',
    dueDate: '',
    numberOfWeeks: '3',
    campaignMarkets: [createCampaignMarket('market-1')],
    contact: {
      title: 'Accounts Payable',
      firstName: 'Accounts',
      surname: 'Team',
      email: 'accounts@example.com',
    },
    selectedJobOperations: [],
    selectedSectionOperations: [],
  };
}

export const defaultFormValues: OrderFormValues = createDefaultFormValues();
