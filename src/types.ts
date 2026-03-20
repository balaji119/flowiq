export type StockOption = {
  label: string;
  stockCode: string;
  substrateLabel: string;
  materialRatePerSqm: number;
};

export type ProcessOption = {
  label: string;
  ratePerSqm: number;
};

export type OperationOption = {
  name: string;
  enabledByDefault?: boolean;
};

export type ContactDetails = {
  title: string;
  firstName: string;
  surname: string;
  email: string;
};

export type OrderFormValues = {
  customerCode: string;
  customerReference: string;
  jobTitle: string;
  jobDescription: string;
  quantity: string;
  finishWidth: string;
  finishHeight: string;
  sectionWidth: string;
  sectionHeight: string;
  pages: string;
  productCategory: string;
  sectionType: string;
  foldCatalog: string;
  stockCode: string;
  processFront: string;
  processReverse: string;
  kindName: string;
  notes: string;
  contact: ContactDetails;
  selectedJobOperations: string[];
  selectedSectionOperations: string[];
  wastePercent: string;
  setupCost: string;
  cutCostPerUnit: string;
  targetFreightPrice: string;
};

export type CalculationSummary = {
  quantity: number;
  finishAreaSqm: number;
  totalAreaSqm: number;
  chargeableAreaSqm: number;
  printSides: number;
  estimatedRunHours: number;
  materialCost: number;
  printCost: number;
  finishingCost: number;
  setupCost: number;
  estimatedTotal: number;
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
