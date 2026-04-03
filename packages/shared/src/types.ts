export const formatKeys = ['8-sheet', '6-sheet', '4-sheet', '2-sheet', 'QA0', 'Mega', 'DOT M', 'MP'] as const;

export type FormatKey = (typeof formatKeys)[number];

export type QuantityBreakdown = Record<FormatKey, number>;

export type OperationOption = {
  id?: string;
  label: string;
  operationName: string;
  enabledByDefault?: boolean;
};

export type PrintIqStockOption = {
  value: string;
  label: string;
  description?: string;
};

export type PrintIqQuoteOptionsResponse = {
  jobOperations: OperationOption[];
  sectionOperations: OperationOption[];
};

export type AuthRole = 'super_admin' | 'admin' | 'user';
export type CampaignStatus = 'draft' | 'calculated' | 'submitted';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  tenantId: string | null;
  tenantName: string | null;
  active: boolean;
};

export type AuthSession = {
  token: string;
  user: AuthUser;
};

export type TenantRecord = {
  id: string;
  name: string;
  createdAt?: string;
};

export type PrintIqOptionsCacheBucket = {
  cached: boolean;
  count: number;
  updatedAt: string | null;
};

export type PrintIqOptionsCacheStatus = {
  stocks: PrintIqOptionsCacheBucket;
  processes: PrintIqOptionsCacheBucket;
};

export type ContactDetails = {
  title: string;
  firstName: string;
  surname: string;
  email: string;
};

export type CampaignAsset = {
  id: string;
  assetId: string;
  assetSearch: string;
  selectedWeeks: number[];
  creativeImageId: string;
  deliveryAddress: string;
};

export type CampaignMarket = {
  id: string;
  market: string;
  assets: CampaignAsset[];
};

export type CampaignPrintImage = {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  storedName?: string;
  imageUrl?: string;
};

export type CampaignLine = CampaignAsset & { market: string };

export type MarketAssetOption = {
  id: string;
  market: string;
  asset: string;
  label: string;
  state: string;
  quantities: QuantityBreakdown;
};

export type MarketMetadata = {
  name: string;
  assets: MarketAssetOption[];
};

export type CalculatorMappingInput = {
  market: string;
  asset: string;
  label: string;
  state: string;
  quantities: QuantityBreakdown;
};

export type CalculatorMappingRecord = CalculatorMappingInput & {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type MarketDeliveryAddressInput = {
  market: string;
  deliveryAddress: string;
};

export type MarketDeliveryAddressRecord = MarketDeliveryAddressInput & {
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type MarketShippingRateInput = {
  market: string;
  shippingRate: number;
};

export type MarketShippingRateRecord = MarketShippingRateInput & {
  tenantId: string;
  createdAt: string;
  updatedAt: string;
};

export type CampaignLineResult = {
  id: string;
  market: string;
  assetLabel: string;
  state: string;
  runCount: number;
  selectedWeeks: number[];
  breakdown: QuantityBreakdown;
};

export type CampaignTotals = {
  market: string;
  breakdown: QuantityBreakdown;
  posterTotal: number;
  frameTotal: number;
  specialFormatTotal: number;
  totalUnits: number;
  activeAssets: number;
  activeRuns: number;
};

export type CampaignCalculationSummary = {
  lines: CampaignLineResult[];
  perMarket: CampaignTotals[];
  grandTotal: CampaignTotals;
};

export type CalculatorMetadataResponse = {
  markets: MarketMetadata[];
  formatKeys: FormatKey[];
};

export type OrderFormValues = {
  customerCode: string;
  customerReference: string;
  campaignName: string;
  jobDescription: string;
  notes: string;
  productCategory: string;
  sectionType: string;
  foldCatalog: string;
  stockCode: string;
  processFront: string;
  processReverse: string;
  targetFreightPrice: string;
  quantity: string;
  finishWidth: string;
  finishHeight: string;
  sectionWidth: string;
  sectionHeight: string;
  pages: string;
  kindName: string;
  campaignStartDate: string;
  dueDate: string;
  numberOfWeeks: string;
  printImages: CampaignPrintImage[];
  campaignMarkets: CampaignMarket[];
  contact: ContactDetails;
  selectedJobOperations: string[];
  selectedSectionOperations: string[];
};

export type CampaignRecord = {
  id: string;
  tenantId: string;
  createdByUserId: string;
  updatedByUserId: string;
  status: CampaignStatus;
  values: OrderFormValues;
  summary: CampaignCalculationSummary | null;
  purchaseOrder: {
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
  } | null;
  latestQuoteAmount: number | string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignListItem = {
  id: string;
  tenantId: string;
  status: CampaignStatus;
  campaignName: string;
  campaignStartDate: string;
  dueDate: string;
  numberOfWeeks: string;
  marketCount: number;
  assetCount: number;
  latestQuoteAmount: number | string | null;
  updatedAt: string;
  createdAt: string;
};

export type CampaignUpsertPayload = {
  values: OrderFormValues;
};

export type CampaignCalculationResponse = {
  campaign: CampaignRecord;
  summary: CampaignCalculationSummary;
};

export type CampaignSubmitResponse = {
  campaign: CampaignRecord;
  amount: number | string | null;
};

export type PrintIqQuotePayload = {
  CustomProduct: {
    ProductCategory: string | null;
    FinishSizeWidth: number;
    FinishSizeHeight: number;
    Sections: Array<{
      SectionType: string;
      StockCode: string;
      ProcessFront: string;
      ProcessReverse: string | null;
      SectionSizeWidth: number;
      SectionSizeHeight: number;
      FoldCatalog: string;
      Pages: number;
      SectionOperations: Array<{ OperationName: string }>;
      SideOperations: Array<{ OperationName: string }>;
    }>;
    JobOperations: Array<{ OperationName: string }>;
  };
  SelectedQuantity: {
    Quantity: number;
    Kinds: number;
    TargetRetailPrice: number;
    TargetWholesalePrice: number;
    AdvancedKinds: {
      KindsArePacks: boolean;
      Kinds: Array<{
        Name: string;
        Quantity: number;
        Sections: Array<{ SectionNumber: number }>;
      }>;
    };
  };
  QuoteContact: {
    Title: string;
    FirstName: string;
    Surname: string;
    Email: string;
  };
  Deliveries: unknown[];
  TargetFreightPrice: string;
  CustomerCode: string;
  AcceptQuote: boolean;
  JobDescription: string;
  JobTitle: string;
  Notes: string | null;
  CustomerExpectedDate: string | null;
  JobDueDate: string | null;
  CustomerReference: string;
};

export type LoginResponse = AuthSession;
