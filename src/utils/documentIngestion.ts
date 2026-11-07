import type { KnowledgeDocument } from '../types/app';
import {
  getCsvNumber,
  getStructuredDatasets,
  predictWithLinearRegression,
} from './datasetAnalytics';
import {
  expandQueryWithSynonyms,
  fuzzyTextMatchesTerm,
  matchesRowWithSynonyms,
} from './nluRouter';
import {
  combineRetailDatasets,
  getPopularItems,
  getProductPriceHistory,
  getSpendProgression,
  getVisitDays,
  inferRetailColumns,
  predictProductPrices,
} from './retailAnalytics';

export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
export const MAX_RETRIEVED_CHUNKS = 30;
export const PDF_TEXT_EXTRACTION_VERSION = 3;
export const MAKRO_ITEM_HEADER =
  'QTY, BARCODE, UNIT/PK, DESCRIPTION, WEIGHT (Kg), DIS, SGL INC, VAT, PK INC CODE, TOTAL EXC, TOTAL INC';
const SUPPORTED_EXTENSIONS = new Set(['pdf', 'csv', 'txt']);

export const isSupportedDocument = (file: File): boolean => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension !== undefined && SUPPORTED_EXTENSIONS.has(extension);
};

interface PdfPositionedItem {
  x: number;
  width: number;
  text: string;
}

interface PdfTextLine {
  y: number;
  items: PdfPositionedItem[];
}

const formatMakroItemRow = (fields: {
  qty: string;
  barcode: string;
  unitPk: string;
  description: string;
  weight?: string;
  dis?: string;
  sglInc: string;
  vat: string;
  pkIncCode: string;
  totalExc: string;
  totalInc: string;
}): string => {
  const escapedDescription = fields.description.trim().replace(/"/g, '""');
  const weight = fields.weight?.trim() ?? '';
  const dis = fields.dis?.trim() ?? '';
  return `${fields.qty.trim()}, ${fields.barcode.trim()}, ${fields.unitPk.trim()}, "${escapedDescription}", ${weight},${dis || ' '},${fields.sglInc.trim()}, ${fields.vat.trim()}, ${fields.pkIncCode.trim()}, ${fields.totalExc.trim()}, ${fields.totalInc.trim()}`;
};

const formatPdfLine = (items: PdfPositionedItem[]): string =>
  items.reduce((text, item, index) => {
    if (index === 0) return item.text;
    const previous = items[index - 1];
    const gap = item.x - previous.x - previous.width;
    return `${text}${gap > 18 ? '\t' : ' '}${item.text}`;
  }, '');

const formatPdfPageLines = (lines: PdfTextLine[]): string => {
  const sortedLines = lines
    .sort((left, right) => right.y - left.y)
    .map((line) => ({
      y: line.y,
      items: [...line.items].sort((left, right) => left.x - right.x),
    }));

  const outputLines: string[] = [];
  let inMakroItemTable = false;

  for (let index = 0; index < sortedLines.length; index += 1) {
    const current = sortedLines[index];
    const next = sortedLines[index + 1];

    const isMakroTopHeader =
      current.items[0]?.text.trim() === 'QTY' &&
      current.items.some((item) => item.text.trim() === 'UNIT/PK');
    const isMakroBottomHeader =
      next?.items[0]?.text.trim() === 'BARCODE' &&
      next.items.some((item) => item.text.trim() === 'DESCRIPTION');

    if (isMakroTopHeader && isMakroBottomHeader) {
      outputLines.push(MAKRO_ITEM_HEADER);
      inMakroItemTable = true;
      index += 1;
      continue;
    }

    if (inMakroItemTable) {
      const firstToken = current.items[0]?.text.trim() ?? '';
      if (
        firstToken === 'TOTALS' ||
        firstToken === 'Please Note :' ||
        firstToken === 'VAT SUMMARY' ||
        firstToken === 'PAYMENT SUMMARY'
      ) {
        inMakroItemTable = false;
      } else if (
        next &&
        /^\d+(?:\.\d+)?$/.test(firstToken) &&
        current.items.some((item) => item.x >= 80 && item.x < 250 && /^\d+(?:\.\d+)?$/.test(item.text.trim())) &&
        /^\d{8,}$/.test(next.items[0]?.text.trim() ?? '')
      ) {
        const qty = current.items.find((item) => item.x < 80)?.text.trim() ?? '';
        const unitPk = current.items.find((item) => item.x >= 80 && item.x < 250)?.text.trim() ?? '';
        const weight = current.items.find((item) => item.x >= 250 && item.x < 390)?.text.trim() ?? '';
        const barcode = next.items.find((item) => item.x < 80)?.text.trim() ?? '';
        const description = next.items
          .filter((item) => item.x >= 80 && item.x < 290)
          .map((item) => item.text.trim())
          .join(' ');
        const dis = next.items.find((item) => item.x >= 290 && item.x < 315)?.text.trim() ?? '';
        const sglInc = next.items.find((item) => item.x >= 315 && item.x < 365)?.text.trim() ?? '';
        const vat = next.items.find((item) => item.x >= 365 && item.x < 408)?.text.trim() ?? '';
        const pkIncCode = next.items.find((item) => item.x >= 408 && item.x < 445)?.text.trim() ?? '';
        const totalExc = next.items.find((item) => item.x >= 445 && item.x < 515)?.text.trim() ?? '';
        const totalInc = next.items.find((item) => item.x >= 515)?.text.trim() ?? '';

        outputLines.push(
          formatMakroItemRow({
            qty,
            barcode,
            unitPk,
            description,
            weight,
            dis,
            sglInc,
            vat,
            pkIncCode,
            totalExc,
            totalInc,
          })
        );
        index += 1;
        continue;
      }
    }

    outputLines.push(formatPdfLine(current.items));
  }

  return outputLines.join('\n');
};

export const restructureMakroInvoiceText = (content: string): string => {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1];

    if (
      /^QTY[\t ]+UNIT\/PK[\t ]+WEIGHT \(Kg\)[\t ]+VAT$/i.test(line.trim()) &&
      nextLine &&
      /^BARCODE[\t ]+DESCRIPTION[\t ]+DIS SGL INC[\t ]+PK INC CODE[\t ]+TOTAL EXC[\t ]+TOTAL INC$/i.test(
        nextLine.trim()
      )
    ) {
      output.push(MAKRO_ITEM_HEADER);
      index += 1;
      continue;
    }

    const quantityMatch = line.trim().match(/^(\d+(?:\.\d+)?)[\t ]+(\d+(?:\.\d+)?)(?:[\t ]+(\S+))?$/);
    if (quantityMatch && nextLine) {
      const parts = nextLine.split('\t').map((part) => part.trim()).filter(Boolean);
      const barcodeAndDesc = parts[0]?.match(/^(\d{8,})\s+(.+)$/);
      if (barcodeAndDesc && parts.length >= 4) {
        const [, qty, unitPk, weight = ''] = quantityMatch;
        const [, barcode, rawDescription] = barcodeAndDesc;
        let description = rawDescription.trim();
        let dis = '';

        if (parts.length >= 5) {
          dis = parts[1];
        } else {
          const trailingDis = description.match(/^(.*?\S)\s+(02|80)$/);
          if (trailingDis) {
            description = trailingDis[1];
            dis = trailingDis[2];
          }
        }

        const sglInc = parts[parts.length - 4] ?? '';
        const vatAndCode = (parts[parts.length - 3] ?? '').match(/^(.+?)\s+(\d+)$/);
        const vat = vatAndCode ? vatAndCode[1].trim() : (parts[parts.length - 3] ?? '');
        const pkIncCode = vatAndCode ? vatAndCode[2].trim() : '';
        const totalExc = parts[parts.length - 2] ?? '';
        const totalInc = parts[parts.length - 1] ?? '';

        output.push(
          formatMakroItemRow({
            qty,
            barcode,
            unitPk,
            description,
            weight,
            dis,
            sglInc,
            vat,
            pkIncCode,
            totalExc,
            totalInc,
          })
        );
        index += 1;
        continue;
      }
    }

    output.push(line);
  }

  return output.join('\n');
};

export const extractDocumentText = async (file: File): Promise<string> => {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'pdf') {
    const [{ getDocument, GlobalWorkerOptions }, { default: pdfWorkerUrl }] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    try {
      const pages: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const lines: PdfTextLine[] = [];

        textContent.items.forEach((item) => {
          if (!('str' in item) || !item.str.trim()) return;
          const y = item.transform[5];
          let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2);
          if (!line) {
            line = { y, items: [] };
            lines.push(line);
          }
          line.items.push({ x: item.transform[4], width: item.width, text: item.str });
        });

        pages.push(formatPdfPageLines(lines));
      }

      const text = restructureMakroInvoiceText(pages.join('\n').trim());
      if (!text) {
        throw new Error('No selectable text was found. Scanned PDFs require OCR, which is not supported yet.');
      }
      return text;
    } finally {
      await pdf.destroy();
    }
  }

  return restructureMakroInvoiceText((await file.text()).trim());
};

const splitIntoChunks = (text: string, chunkSize = 1200, overlap = 200): string[] => {
  const chunks: string[] = [];
  const step = chunkSize - overlap;

  for (let start = 0; start < text.length; start += step) {
    const chunk = text.slice(start, start + chunkSize).trim();
    if (chunk) chunks.push(chunk);
  }

  return chunks;
};

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'been', 'before', 'being', 'between',
  'but', 'can', 'could', 'did', 'does', 'for', 'from', 'had', 'has', 'have', 'into',
  'its', 'more', 'most', 'not', 'our', 'same', 'should', 'some', 'such', 'than',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'under', 'was', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'with', 'would', 'you', 'your',
]);

const formatAnalysisNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

const isBroadAnalysisQuery = (query: string): boolean =>
  /\b(analy[sz]e|analysis|summari[sz]e|summary|overview|insights?|business|profit|costs?|spend|spending|expenditure|outlay|revenue|sales|turnover|financial|dataset|data|breakdown|report)\b/i.test(query);

const summarizeStructuredDatasets = (
  documents: KnowledgeDocument[],
  query: string
): string => {
  const { expandedTerms } = expandQueryWithSynonyms(query);
  const queryTerms = expandedTerms.filter(
    (term) => term.length >= 2 && !STOP_WORDS.has(term)
  );
  const datasets = getStructuredDatasets(documents).filter(
    (dataset) => !dataset.error && dataset.rows.length > 0
  );
  const matchedDatasets = datasets
    .map((dataset) => {
      const headersAndName = `${dataset.name} ${dataset.headers.join(' ')}`.toLowerCase();
      const score = queryTerms.reduce((total, term) => {
        const matchesHeader = fuzzyTextMatchesTerm(headersAndName, term);
        const matchesValue =
          !matchesHeader &&
          dataset.rows.some((row) =>
            Object.values(row).some((value) => fuzzyTextMatchesTerm(value.toLowerCase(), term))
          );
        return total + Number(matchesHeader || matchesValue);
      }, 0);
      return { dataset, score };
    })
    .sort((left, right) =>
      right.score - left.score ||
      right.dataset.rows.length - left.dataset.rows.length
    )
    .filter(({ score }) => score > 0 || isBroadAnalysisQuery(query))
    .slice(0, 10)
    .map(({ dataset }) => dataset);

  const combinedDataset = datasets.length > 1 ? combineRetailDatasets(datasets) : undefined;
  const rankedDatasets = combinedDataset
    ? [combinedDataset, ...matchedDatasets]
    : matchedDatasets;

  return rankedDatasets
    .map((dataset) => {
      const numericSummaries = dataset.numericColumns.map((column) => {
        const values = dataset.rows
          .map((row) => getCsvNumber(row[column]))
          .filter((value): value is number => value !== undefined);
        const sortedValues = [...values].sort((left, right) => left - right);
        const { total, minimum, maximum } = values.reduce(
          (summary, value) => ({
            total: summary.total + value,
            minimum: Math.min(summary.minimum, value),
            maximum: Math.max(summary.maximum, value),
          }),
          { total: 0, minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY }
        );
        const average = total / values.length;
        const middle = Math.floor(sortedValues.length / 2);
        const median = sortedValues.length % 2 === 0
          ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
          : sortedValues[middle];
        const populationStandardDeviation = Math.sqrt(
          values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length
        );
        return `${column}: valid=${values.length}, missing=${dataset.rows.length - values.length}, sum=${formatAnalysisNumber(total)}, average=${formatAnalysisNumber(average)}, median=${formatAnalysisNumber(median)}, population SD=${formatAnalysisNumber(populationStandardDeviation)}, min=${formatAnalysisNumber(minimum)}, max=${formatAnalysisNumber(maximum)}`;
      });

      const categoricalSummaries = dataset.headers
        .filter((column) => !dataset.numericColumns.includes(column))
        .map((column) => {
          const counts = new Map<string, number>();
          dataset.rows.forEach((row) => {
            const value = row[column]?.trim();
            if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
          });
          const topValues = Array.from(counts, ([value, count]) => ({ value, count }))
            .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
            .slice(0, 5)
            .map(({ value, count }) => `${JSON.stringify(value)} (${count})`);
          return topValues.length ? `${column} top values: ${topValues.join(', ')}` : '';
        })
        .filter(Boolean);

      return [
        `Structured data source: ${dataset.name}`,
        `Rows: ${dataset.rows.length}; columns: ${dataset.headers.join(', ')}`,
        numericSummaries.length ? `Numeric analysis:\n${numericSummaries.join('\n')}` : '',
        categoricalSummaries.length ? `Category analysis:\n${categoricalSummaries.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
};

const summarizePriceForecasts = (
  documents: KnowledgeDocument[],
  query: string
): string => {
  const datasets = getStructuredDatasets(documents);
  const history = getProductPriceHistory(datasets);
  if (!history.length) return '';

  const products = Array.from(new Map(history.map((observation) => [
    observation.product.toLowerCase(),
    observation.product,
  ])).values());
  const normalizedQuery = query.toLowerCase();
  const { expandedTerms: forecastTerms } = expandQueryWithSynonyms(query);
  const orderedProducts = products
    .map((product) => ({
      product,
      relevant:
        normalizedQuery.includes(product.toLowerCase()) ||
        matchesRowWithSynonyms([product], query) ||
        forecastTerms.some(
          (term) => term.length >= 3 && fuzzyTextMatchesTerm(product.toLowerCase(), term)
        ),
      observations: history.filter(
        (observation) => observation.product.toLowerCase() === product.toLowerCase()
      ).length,
    }))
    .sort((left, right) =>
      Number(right.relevant) - Number(left.relevant) ||
      right.observations - left.observations ||
      left.product.localeCompare(right.product)
    )
    .slice(0, 10);

  const forecasts = orderedProducts.map(({ product }) => {
    const forecast = predictProductPrices(history, product);
    if (forecast.error) {
      return `${product}: ${forecast.error} Observations: ${forecast.rowsAnalyzed}; source files: ${forecast.sourceCount}.`;
    }

    return `${product}: ${forecast.predictions
      .map(({ date, price }) => `${date}=${formatAnalysisNumber(price)}`)
      .join(', ')}; observations=${forecast.rowsAnalyzed}; source files=${forecast.sourceCount}; in-sample R²=${formatAnalysisNumber(forecast.rSquared)}.`;
  });

  return [
    'Calculated product-price forecasts in South African rand (R; ordinary least squares linear regression; predictions are estimates, not guarantees):',
    ...forecasts,
  ].join('\n');
};

const summarizeNumericForecasts = (
  documents: KnowledgeDocument[],
  query: string
): string => {
  const normalizedQuery = query.toLowerCase();
  const candidates = getStructuredDatasets(documents)
    .filter((dataset) => !dataset.error)
    .flatMap((dataset) => dataset.numericColumns.map((column) => {
      const forecast = predictWithLinearRegression(dataset, column, '__row_order__');
      return {
        dataset,
        column,
        forecast,
        relevant:
          normalizedQuery.includes(dataset.name.toLowerCase()) ||
          normalizedQuery.includes(column.toLowerCase()),
      };
    }))
    .filter(({ forecast }) => !forecast.error)
    .sort((left, right) =>
      Number(right.relevant) - Number(left.relevant) ||
      right.forecast.rowsAnalyzed - left.forecast.rowsAnalyzed ||
      left.dataset.name.localeCompare(right.dataset.name) ||
      left.column.localeCompare(right.column)
    )
    .slice(0, 10);

  if (!candidates.length) return '';

  return [
    'Calculated numeric trend projections (linear regression over source row order; steps are not calendar periods; monetary columns are South African rand (R), other columns retain their own units):',
    ...candidates.map(({ dataset, column, forecast }) =>
      `${dataset.name} · ${column}: ${forecast.predictions
        .map(({ y }, index) => `step ${index + 1}=${formatAnalysisNumber(y)}`)
        .join(', ')}; rows=${forecast.rowsAnalyzed}; in-sample R²=${formatAnalysisNumber(forecast.rSquared)}.`
    ),
  ].join('\n');
};

export const buildGlobalKnowledgeContext = (documents: KnowledgeDocument[]): string => {
  const readyDocuments = documents.filter((document) => document.status === 'ready');
  if (!readyDocuments.length) {
    return 'No ready documents are currently imported in the database.';
  }

  const datasets = getStructuredDatasets(readyDocuments).filter(
    (dataset) => !dataset.error && dataset.rows.length > 0
  );
  const combinedRetail = combineRetailDatasets(datasets);

  // 1. Per-file / invoice index across ALL imported files
  const invoiceSummaries = datasets.map((dataset) => {
    const totalCol =
      dataset.headers.find((h) => h.toUpperCase() === 'TOTAL INC') ??
      dataset.headers.find((h) => /total|amount|spend/i.test(h));
    const fileSpend = totalCol
      ? dataset.rows.reduce((sum, row) => sum + (getCsvNumber(row[totalCol]) ?? 0), 0)
      : 0;
    const dateLabel = dataset.invoiceDate ? `, date=${dataset.invoiceDate}` : '';
    const customerLabel = dataset.customerName ? `, customer=${dataset.customerName}` : '';
    return `- ${dataset.name}: rows=${dataset.rows.length}${dateLabel}${customerLabel}, total=R${formatAnalysisNumber(fileSpend)}`;
  });

  // 2. Master Item Catalogue across ALL imported files
  const itemLedger = new Map<
    string,
    {
      description: string;
      barcode: string;
      totalQty: number;
      totalSpend: number;
      minUnitPrice: number;
      maxUnitPrice: number;
      invoiceCount: number;
      dates: Set<string>;
    }
  >();

  for (const dataset of datasets) {
    const descCol =
      dataset.headers.find((h) => h.toUpperCase() === 'DESCRIPTION') ??
      dataset.headers.find((h) => /item|product|description/i.test(h));
    const barcodeCol = dataset.headers.find((h) => h.toUpperCase() === 'BARCODE');
    const qtyCol =
      dataset.headers.find((h) => h.toUpperCase() === 'QTY') ??
      dataset.headers.find((h) => /qty|quantity/i.test(h));
    const unitPriceCol =
      dataset.headers.find((h) => h.toUpperCase() === 'SGL INC') ??
      dataset.headers.find((h) => /unit.*price|sgl inc|price/i.test(h));
    const totalCol =
      dataset.headers.find((h) => h.toUpperCase() === 'TOTAL INC') ??
      dataset.headers.find((h) => /total inc|total|amount/i.test(h));

    if (!descCol) continue;

    for (const row of dataset.rows) {
      const rawDesc = (row[descCol] ?? '').trim();
      if (!rawDesc) continue;
      const key = rawDesc.toUpperCase();
      const qty = (qtyCol ? getCsvNumber(row[qtyCol]) : undefined) ?? 1;
      const totalInc = (totalCol ? getCsvNumber(row[totalCol]) : undefined) ?? 0;
      const unitPrice =
        (unitPriceCol ? getCsvNumber(row[unitPriceCol]) : undefined) ??
        (qty > 0 && totalInc > 0 ? totalInc / qty : 0);
      const barcode = barcodeCol ? (row[barcodeCol] ?? '').trim() : '';

      const existing = itemLedger.get(key) ?? {
        description: rawDesc,
        barcode,
        totalQty: 0,
        totalSpend: 0,
        minUnitPrice: Number.POSITIVE_INFINITY,
        maxUnitPrice: 0,
        invoiceCount: 0,
        dates: new Set<string>(),
      };

      existing.totalQty += qty;
      existing.totalSpend += totalInc;
      if (unitPrice > 0) {
        existing.minUnitPrice = Math.min(existing.minUnitPrice, unitPrice);
        existing.maxUnitPrice = Math.max(existing.maxUnitPrice, unitPrice);
      }
      if (!existing.barcode && barcode) existing.barcode = barcode;
      existing.invoiceCount += 1;
      if (dataset.invoiceDate) existing.dates.add(dataset.invoiceDate);
      itemLedger.set(key, existing);
    }
  }

  const sortedLedger = Array.from(itemLedger.values()).sort(
    (a, b) => b.totalSpend - a.totalSpend || b.totalQty - a.totalQty
  );

  const masterItemLines = sortedLedger.map((entry) => {
    const unitRange =
      entry.minUnitPrice !== Number.POSITIVE_INFINITY
        ? entry.minUnitPrice === entry.maxUnitPrice
          ? `R${formatAnalysisNumber(entry.minUnitPrice)}`
          : `R${formatAnalysisNumber(entry.minUnitPrice)}–R${formatAnalysisNumber(entry.maxUnitPrice)}`
        : 'N/A';
    const dateSpan = entry.dates.size > 0 ? ` [${Array.from(entry.dates).sort().join(', ')}]` : '';
    return `- "${entry.description}"${entry.barcode ? ` (barcode ${entry.barcode})` : ''}: totalQty=${formatAnalysisNumber(entry.totalQty)}, unitPrice=${unitRange}, totalSpend=R${formatAnalysisNumber(entry.totalSpend)}, appearances=${entry.invoiceCount}${dateSpan}`;
  });

  // 3. Global Retail Rollup (visits, monthly spend, grand totals)
  let retailRollup = '';
  if (combinedRetail && combinedRetail.rows.length > 0) {
    const cols = inferRetailColumns(combinedRetail.headers);
    const visits = cols.date
      ? getVisitDays(combinedRetail, cols.date, cols.customer).points
      : [];
    const monthlySpend =
      cols.date && cols.amount
        ? getSpendProgression(combinedRetail, cols.date, cols.amount, 'month').points
        : [];
    const popular = cols.item
      ? getPopularItems(combinedRetail, cols.item, cols.quantity).points
      : [];
    const grandTotalSpend = monthlySpend.reduce((sum, p) => sum + p.spent, 0);

    retailRollup = [
      `Global Combined Retail Rollup (${readyDocuments.length} files, ${combinedRetail.rows.length} line items, Grand Total Spend = R${formatAnalysisNumber(grandTotalSpend)}):`,
      visits.length
        ? `Visits by weekday: ${visits.map((v) => `${v.day}=${v.visits}`).join(', ')}`
        : '',
      monthlySpend.length
        ? `Spend by month: ${monthlySpend.map((m) => `${m.period}=R${formatAnalysisNumber(m.spent)} (cum R${formatAnalysisNumber(m.cumulative)})`).join('; ')}`
        : '',
      popular.length
        ? `Top items by volume: ${popular.map((p) => `"${p.item}" (${formatAnalysisNumber(p.purchases)})`).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `=== GLOBAL KNOWLEDGE BASE SNAPSHOT (${readyDocuments.length} IMPORTED FILES) ===`,
    retailRollup,
    masterItemLines.length
      ? `Complete Master Product & Item Ledger (${masterItemLines.length} unique products across all files):\n${masterItemLines.join('\n')}`
      : '',
    invoiceSummaries.length
      ? `All Imported Files / Invoices (${invoiceSummaries.length}):\n${invoiceSummaries.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const searchDocuments = (documents: KnowledgeDocument[], query: string): string => {
  const readyDocuments = documents.filter((document) => document.status === 'ready');
  if (!readyDocuments.length) return '';

  const documentChunks = readyDocuments.flatMap((document) =>
    splitIntoChunks(document.content).map((text) => ({ name: document.name, text }))
  );
  if (!documentChunks.length) return '';

  const directTerms = new Set(
    query
      .toLowerCase()
      .match(/[\p{L}\p{N}]{2,}/gu)
      ?.filter((term) => !STOP_WORDS.has(term)) ?? []
  );
  const { expandedTerms } = expandQueryWithSynonyms(query);
  const terms = expandedTerms.filter(
    (term) => term.length >= 2 && !STOP_WORDS.has(term)
  );

  const matches = documentChunks
    .map((chunk) => {
      const normalizedText = chunk.text.toLowerCase();
      const score = terms.reduce((total, term) => {
        const occurrences = normalizedText.split(term).length - 1;
        const isDirect = directTerms.has(term);
        if (occurrences > 0) {
          return total + Math.min(occurrences, 5) * (isDirect ? 2 : 1);
        }
        if (term.length >= 4 && fuzzyTextMatchesTerm(normalizedText, term)) {
          return total + (isDirect ? 2 : 1);
        }
        return total;
      }, 0);
      return { ...chunk, score };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_RETRIEVED_CHUNKS);

  const selectedChunks = matches.length > 0
    ? matches
    : isBroadAnalysisQuery(query)
      ? Array.from({ length: Math.min(documentChunks.length, MAX_RETRIEVED_CHUNKS) }, (_, index) => {
          const sampleIndex =
            documentChunks.length <= MAX_RETRIEVED_CHUNKS
              ? index
              : Math.round(
                  (index * (documentChunks.length - 1)) /
                    (MAX_RETRIEVED_CHUNKS - 1)
                );
          return documentChunks[sampleIndex];
        })
      : [];

  const globalSnapshot = buildGlobalKnowledgeContext(readyDocuments);
  const textExcerpts = selectedChunks
    .map((match) => `Source: ${match.name}\n${match.text}`)
    .join('\n\n')
    .slice(0, 6000);
  const structuredAnalysis = summarizeStructuredDatasets(readyDocuments, query);
  const wantsForecast = /\b(price|prices|forecast|forecasting|predict|prediction|future|projection|estimate|trend)\b/i.test(query);
  const priceForecasts = wantsForecast
    ? summarizePriceForecasts(readyDocuments, query)
    : '';
  const numericForecasts = wantsForecast
    ? summarizeNumericForecasts(readyDocuments, query)
    : '';

  return [
    'Currency convention: user confirms that monetary values in imported files are South African rand (ZAR); report monetary amounts as R and do not convert currencies.',
    globalSnapshot,
    textExcerpts,
    structuredAnalysis ? `Full-dataset analysis:\n${structuredAnalysis.slice(0, 5000)}` : '',
    priceForecasts,
    numericForecasts,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 32000);
};
