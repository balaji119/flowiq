import { CampaignAsset, CampaignMarket, OrderFormValues } from './types';

function getTodayDateInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function createAllWeeks(weekCount: number) {
  const safeWeekCount = Math.max(1, Math.floor(weekCount || 1));
  return Array.from({ length: safeWeekCount }, (_, index) => index + 1);
}

export function createCampaignAsset(id: string, weekCount = 1): CampaignAsset {
  return {
    id,
    assetId: '',
    assetSearch: '',
    selectedWeeks: createAllWeeks(weekCount),
    creativeImageId: '',
    creativeImageIds: {},
    deliveryAddress: '',
  };
}

export function createCampaignMarket(id: string, weekCount = 1): CampaignMarket {
  return {
    id,
    market: 'Sydney',
    assets: [createCampaignAsset(`asset-${id}-1`, weekCount)],
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
    campaignStartDate: getTodayDateInputValue(),
    dueDate: '',
    numberOfWeeks: '3',
    printImages: [],
    campaignMarkets: [createCampaignMarket('market-1', 3)],
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
