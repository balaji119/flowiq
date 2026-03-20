import { stockOptions } from '../constants';
import { CalculationSummary, OrderFormValues, PrintIqQuotePayload } from '../types';

export function buildDefaultJobDescription(values: OrderFormValues) {
  const stock = stockOptions.find((option) => option.stockCode === values.stockCode);
  const lines = [
    `${values.kindName || 'Item'} - Finished Size: ${values.finishWidth} x ${values.finishHeight}`,
    `Substrate: ${stock?.substrateLabel ?? values.stockCode}`,
    `Mode: ${values.processFront}`,
  ];

  if (values.selectedJobOperations.includes('* Standard Pack and Wrap')) {
    lines.push('Includes: Bulk packed and Wrapped');
  }

  return lines.join('\n');
}

export function buildPrintIqPayload(
  values: OrderFormValues,
  _calculation: CalculationSummary,
): PrintIqQuotePayload {
  const quantity = Number(values.quantity) || 0;
  const pages = Number(values.pages) || 0;
  const finishWidth = Number(values.finishWidth) || 0;
  const finishHeight = Number(values.finishHeight) || 0;
  const sectionWidth = Number(values.sectionWidth) || finishWidth;
  const sectionHeight = Number(values.sectionHeight) || finishHeight;
  const resolvedDescription = values.jobDescription.trim() || buildDefaultJobDescription(values);

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
          ProcessReverse: values.processReverse || null,
          SectionSizeWidth: sectionWidth,
          SectionSizeHeight: sectionHeight,
          FoldCatalog: values.foldCatalog,
          Pages: pages,
          SectionOperations: values.selectedSectionOperations.map((name) => ({
            OperationName: name,
          })),
          SideOperations: [],
        },
      ],
      JobOperations: values.selectedJobOperations.map((name) => ({
        OperationName: name,
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
            Name: values.kindName || values.customerReference || values.jobTitle,
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
    JobTitle: values.jobTitle,
    Notes: values.notes.trim() || null,
    CustomerExpectedDate: null,
    JobDueDate: null,
    CustomerReference: values.customerReference,
  };
}
