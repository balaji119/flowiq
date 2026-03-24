import { CampaignCalculationSummary, OrderFormValues, PrintIqQuotePayload } from '../types';

function resolveQuantity(values: OrderFormValues, summary: CampaignCalculationSummary | null) {
  const explicitQuantity = Number(values.quantity);
  if (Number.isFinite(explicitQuantity) && explicitQuantity > 0) {
    return explicitQuantity;
  }

  return summary?.grandTotal.totalUnits ?? 0;
}

export function buildDefaultJobDescription(values: OrderFormValues, summary: CampaignCalculationSummary | null) {
  const lines = [
    `Campaign start: ${values.campaignStartDate || 'TBC'}`,
    `Run length: ${values.numberOfWeeks || '0'} weeks`,
    `Substrate: ${values.stockCode}`,
    `Mode: ${values.processFront}`,
  ];

  if (summary) {
    lines.push(`Poster total: ${summary.grandTotal.posterTotal}`);
    lines.push(`Frame total: ${summary.grandTotal.frameTotal}`);
    lines.push(`Special formats: ${summary.grandTotal.specialFormatTotal}`);
  }

  return lines.join('\n');
}

export function buildPrintIqPayload(
  values: OrderFormValues,
  summary: CampaignCalculationSummary | null,
): PrintIqQuotePayload {
  const quantity = resolveQuantity(values, summary);
  const pages = Number(values.pages) || 0;
  const finishWidth = Number(values.finishWidth) || 0;
  const finishHeight = Number(values.finishHeight) || 0;
  const sectionWidth = Number(values.sectionWidth) || finishWidth;
  const sectionHeight = Number(values.sectionHeight) || finishHeight;
  const resolvedDescription = values.jobDescription.trim() || buildDefaultJobDescription(values, summary);

  return {
    CustomProduct: {
      ProductCategory: values.productCategory || null,
      FinishSizeWidth: finishWidth,
      FinishSizeHeight: finishHeight,
      Sections: [
        {
          SectionType: values.sectionType,
          StockCode: values.stockCode,
          ProcessFront: values.processFront,
          ProcessReverse: values.processReverse.trim() || 'None',
          SectionSizeWidth: sectionWidth,
          SectionSizeHeight: sectionHeight,
          FoldCatalog: values.foldCatalog,
          Pages: pages,
          SectionOperations: values.selectedSectionOperations.map((operationName) => ({
            OperationName: operationName,
          })),
          SideOperations: [],
        },
      ],
      JobOperations: values.selectedJobOperations.map((operationName) => ({
        OperationName: operationName,
      })),
    },
    SelectedQuantity: {
      Quantity: quantity,
      Kinds: 0,
      TargetRetailPrice: 0,
      TargetWholesalePrice: 0,
      AdvancedKinds: {
        KindsArePacks: false,
        Kinds: [
          {
            Name: values.kindName || values.customerReference || values.campaignName,
            Quantity: quantity,
            Sections: [{ SectionNumber: 1 }],
          },
        ],
      },
    },
    QuoteContact: {
      Title: values.contact.title,
      FirstName: values.contact.firstName,
      Surname: values.contact.surname,
      Email: values.contact.email,
    },
    Deliveries: [],
    TargetFreightPrice: values.targetFreightPrice,
    CustomerCode: values.customerCode,
    AcceptQuote: false,
    JobDescription: resolvedDescription,
    JobTitle: values.campaignName,
    Notes: values.notes.trim() || null,
    CustomerExpectedDate: values.dueDate || null,
    JobDueDate: values.printDueDate || null,
    CustomerReference: values.customerReference,
  };
}
