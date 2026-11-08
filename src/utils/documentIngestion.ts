import type { KnowledgeDocument } from '../types/app';
import {
  formatMakroItemRow,
  getCsvNumber,
  getStructuredDatasets,
  MAKRO_ITEM_HEADER,
  predictWithLinearRegression,
  restructureMakroInvoiceText,
  type TabularDataset,
} from './datasetAnalytics';
import {
  expandQueryWithSynonyms,
  extractProductSearchFilter,
  fuzzyTextMatchesTerm,
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

export { MAKRO_ITEM_HEADER, restructureMakroInvoiceText };

export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
export const MAX_RETRIEVED_CHUNKS = 30;
export const PDF_TEXT_EXTRACTION_VERSION = 3;
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
  const nonGenericForecastTerms = forecastTerms.filter(
    (term) =>
      term.length >= 3 &&
      !/^(price|prices|pricing|forecast|forecasts|forecasting|predict|prediction|predictions|project|projection|projections|future|upcoming|next|month|quarter|year|outlook|estimate|trajectory|trend|inflation|change|going|cost|will|unit|single|sgl|inc|each|per|item|pack|rate|what|the|and|for|all|product|products|json|csv|xlsx|table|export|download)$/.test(
        term
      )
  );

  const evaluatedProducts = products.map((product) => {
    const forecast = predictProductPrices(history, product);
    const hasSpecificMatch =
      nonGenericForecastTerms.length > 0 &&
      (normalizedQuery.includes(product.toLowerCase()) ||
        nonGenericForecastTerms.some((term) =>
          fuzzyTextMatchesTerm(product.toLowerCase(), term)
        ));
    return {
      product,
      forecast,
      relevant: hasSpecificMatch,
      hasValidForecast: !forecast.error && forecast.predictions.length > 0,
      observations: forecast.rowsAnalyzed,
    };
  });

  const orderedProducts = evaluatedProducts
    .sort(
      (left, right) =>
        Number(right.relevant) - Number(left.relevant) ||
        Number(right.hasValidForecast) - Number(left.hasValidForecast) ||
        right.observations - left.observations ||
        left.product.localeCompare(right.product)
    )
    .slice(0, 12);

  const forecasts = orderedProducts.map(({ product, forecast }) => {
    const observedPrices = forecast.points
      .filter((p) => p.actual !== null)
      .map((p) => `${p.date}=R${formatAnalysisNumber(p.actual!)}`);
    const latestObserved =
      observedPrices.length > 0 ? observedPrices[observedPrices.length - 1] : 'N/A';

    if (forecast.error) {
      return `${product}: ${forecast.error} Observed price history (${forecast.rowsAnalyzed} dated observation(s) across ${forecast.sourceCount} file(s)): ${observedPrices.join(', ') || latestObserved}.`;
    }

    return `${product}: forecasted next dates ${forecast.predictions
      .map(({ date, price }) => `${date}=R${formatAnalysisNumber(price)}`)
      .join(', ')}; latest observed=${latestObserved}; observations=${forecast.rowsAnalyzed}; source files=${forecast.sourceCount}; in-sample R²=${formatAnalysisNumber(forecast.rSquared)}.`;
  });

  return [
    'Calculated product-price forecasts in South African rand (R; ordinary least squares linear regression on SGL INC unit price; requires 3+ distinct invoice dates):',
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

interface MasterLedgerEntry {
  description: string;
  barcode: string;
  totalQty: number;
  totalSpend: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  invoiceCount: number;
  dates: Set<string>;
}

const buildMasterItemLedger = (datasets: TabularDataset[]): MasterLedgerEntry[] => {
  const itemLedger = new Map<string, MasterLedgerEntry>();

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

  return Array.from(itemLedger.values()).sort(
    (a, b) => b.totalSpend - a.totalSpend || b.totalQty - a.totalQty
  );
};

const formatLedgerEntryLine = (entry: MasterLedgerEntry): string => {
  const unitRange =
    entry.minUnitPrice !== Number.POSITIVE_INFINITY
      ? entry.minUnitPrice === entry.maxUnitPrice
        ? `R${formatAnalysisNumber(entry.minUnitPrice)}`
        : `R${formatAnalysisNumber(entry.minUnitPrice)}–R${formatAnalysisNumber(entry.maxUnitPrice)}`
      : 'N/A';
  const sortedDates = Array.from(entry.dates).sort();
  const dateSpan =
    sortedDates.length > 0
      ? sortedDates.length <= 3
        ? ` [dates: ${sortedDates.join(', ')}]`
        : ` [${sortedDates.length} dates: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}]`
      : '';
  return `- "${entry.description}"${entry.barcode ? ` (barcode ${entry.barcode})` : ''}: totalQty=${formatAnalysisNumber(entry.totalQty)}, unitPrice=${unitRange}, totalSpend=R${formatAnalysisNumber(entry.totalSpend)}, appearances=${entry.invoiceCount}${dateSpan}`;
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

  // Deduplicated unique invoices check
  const uniqueDatasetMap = new Map<string, { dataset: TabularDataset; count: number; spend: number }>();
  let totalAllFilesSpend = 0;

  for (const dataset of datasets) {
    const totalCol =
      dataset.headers.find((h) => h.toUpperCase() === 'TOTAL INC') ??
      dataset.headers.find((h) => /total|amount|spend/i.test(h));
    const fileSpend = totalCol
      ? dataset.rows.reduce((sum, row) => sum + (getCsvNumber(row[totalCol]) ?? 0), 0)
      : 0;
    totalAllFilesSpend += fileSpend;
    const key = dataset.name.toLowerCase();
    const existing = uniqueDatasetMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      uniqueDatasetMap.set(key, { dataset, count: 1, spend: fileSpend });
    }
  }

  const uniqueInvoices = Array.from(uniqueDatasetMap.values());
  const uniqueTotalSpend = uniqueInvoices.reduce((sum, item) => sum + item.spend, 0);

  // Master Item Catalogue across ALL imported files
  const sortedLedger = buildMasterItemLedger(datasets);
  const topBySpend = sortedLedger.slice(0, 35);
  const topByQty = [...sortedLedger]
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 15)
    .filter((entry) => !topBySpend.some((s) => s.description === entry.description));
  const combinedTopLedgerLines = [...topBySpend, ...topByQty].map(formatLedgerEntryLine);

  // Top Forecastable Products (3+ distinct purchase dates)
  const history = getProductPriceHistory(datasets);
  const distinctProducts = Array.from(
    new Map(history.map((h) => [h.product.toLowerCase(), h.product])).values()
  );
  const validForecastLines = distinctProducts
    .map((product) => ({ product, forecast: predictProductPrices(history, product) }))
    .filter(({ forecast }) => !forecast.error && forecast.predictions.length > 0)
    .sort((a, b) => b.forecast.rowsAnalyzed - a.forecast.rowsAnalyzed)
    .slice(0, 12)
    .map(({ product, forecast }) => {
      const nextPreds = forecast.predictions
        .slice(0, 2)
        .map((p) => `${p.date}=R${formatAnalysisNumber(p.price)}`)
        .join(', ');
      return `- "${product}": ${forecast.rowsAnalyzed} dated observations, R²=${formatAnalysisNumber(forecast.rSquared)}, OLS forecast: ${nextPreds}`;
    });

  // Global Retail Rollup (visits, monthly spend, grand totals)
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
    const grandTotalSpend = monthlySpend.reduce((sum, p) => sum + p.spent, 0) || totalAllFilesSpend;

    retailRollup = [
      `Global Combined Retail Rollup: ${readyDocuments.length} uploaded files (${uniqueInvoices.length} unique invoice filenames), ${combinedRetail.rows.length} total line items across all uploaded files.`,
      `Grand Total Spend (all ${readyDocuments.length} uploaded files) = R${formatAnalysisNumber(grandTotalSpend)} (Unique deduplicated invoices spend across ${uniqueInvoices.length} unique invoices = R${formatAnalysisNumber(uniqueTotalSpend)}).`,
      visits.length
        ? `Shopping Trips / Visits by Weekday: ${visits.map((v) => `${v.day}=${v.visits}`).join(', ')}`
        : '',
      monthlySpend.length
        ? `Monthly Spend Progression: ${monthlySpend.map((m) => `${m.period}=R${formatAnalysisNumber(m.spent)} (cum R${formatAnalysisNumber(m.cumulative)})`).join('; ')}`
        : '',
      popular.length
        ? `Top Popular Items by Quantity Purchased: ${popular.map((p) => `"${p.item}" (${formatAnalysisNumber(p.purchases)} units)`).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    `=== GLOBAL KNOWLEDGE BASE SNAPSHOT (${readyDocuments.length} IMPORTED FILES, ${ sortedLedger.length } UNIQUE PRODUCTS) ===`,
    retailRollup,
    validForecastLines.length
      ? `Products Eligible for OLS Price Forecasting (3+ distinct invoice dates, ${validForecastLines.length} shown):\n${validForecastLines.join('\n')}`
      : '',
    combinedTopLedgerLines.length
      ? `Key Products in Master Ledger (showing top ${combinedTopLedgerLines.length} of ${sortedLedger.length} unique products by spend & volume; use search_knowledge_base or create_table_or_file for any other specific item):\n${combinedTopLedgerLines.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const searchDocuments = (documents: KnowledgeDocument[], query: string): string => {
  const readyDocuments = documents.filter((document) => document.status === 'ready');
  if (!readyDocuments.length) return '';

  const datasets = getStructuredDatasets(readyDocuments).filter(
    (dataset) => !dataset.error && dataset.rows.length > 0
  );
  const fullLedger = buildMasterItemLedger(datasets);

  const directTerms = new Set(
    query
      .toLowerCase()
      .match(/[\p{L}\p{N}/]{2,}/gu)
      ?.filter((term) => !STOP_WORDS.has(term)) ?? []
  );
  const { expandedTerms } = expandQueryWithSynonyms(query);
  const terms = expandedTerms.filter(
    (term) => term.length >= 2 && !STOP_WORDS.has(term)
  );

  // Find exact and synonym-matched products from the full 334-product ledger
  const productFilter = extractProductSearchFilter(query, readyDocuments);
  const directFilterTokens = productFilter
    ? productFilter.split(/\s+/).filter((t) => t.length >= 3)
    : [];
  const { expandedTerms: productSynonymTerms } = productFilter
    ? expandQueryWithSynonyms(productFilter)
    : { expandedTerms: [] as string[] };

  const matchedLedgerEntries =
    directFilterTokens.length > 0
      ? fullLedger
          .map((entry) => {
            const target = `${entry.description} ${entry.barcode}`.toLowerCase();
            const directHits = directFilterTokens.filter(
              (tok) => target.includes(tok) || fuzzyTextMatchesTerm(target, tok)
            ).length;
            const synonymHits = productSynonymTerms.filter(
              (tok) => tok.length >= 3 && (target.includes(tok) || fuzzyTextMatchesTerm(target, tok))
            ).length;
            return { entry, directHits, synonymHits };
          })
          .filter((item) => item.directHits > 0 || item.synonymHits > 0)
          .sort(
            (a, b) =>
              b.directHits - a.directHits ||
              b.synonymHits - a.synonymHits ||
              b.entry.totalSpend - a.entry.totalSpend
          )
          .map((item) => item.entry)
      : [];

  const matchedLedgerSection =
    matchedLedgerEntries.length > 0
      ? [
          `Exact Cross-File Product Ledger Matches (${matchedLedgerEntries.length} matching products across all ${readyDocuments.length} uploaded files):`,
          ...matchedLedgerEntries.slice(0, 25).map(formatLedgerEntryLine),
        ].join('\n')
      : '';

  const documentChunks = readyDocuments.flatMap((document) =>
    splitIntoChunks(document.content).map((text) => ({ name: document.name, text }))
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
    .slice(0, 12);

  const selectedChunks = matches.length > 0
    ? matches
    : isBroadAnalysisQuery(query)
      ? Array.from({ length: Math.min(documentChunks.length, 8) }, (_, index) => {
          const sampleIndex =
            documentChunks.length <= 8
              ? index
              : Math.round((index * (documentChunks.length - 1)) / 7);
          return documentChunks[sampleIndex];
        })
      : [];

  const textExcerpts = selectedChunks
    .map((match) => `Source: ${match.name}\n${match.text}`)
    .join('\n\n')
    .slice(0, 3500);
  const structuredAnalysis = summarizeStructuredDatasets(readyDocuments, query);
  const wantsForecast = /\b(price|prices|forecast|forecasting|predict|prediction|future|projection|estimate|trend|cost)\b/i.test(query);
  const priceForecasts = wantsForecast
    ? summarizePriceForecasts(readyDocuments, query)
    : '';
  const numericForecasts = wantsForecast
    ? summarizeNumericForecasts(readyDocuments, query)
    : '';

  return [
    'Currency convention: monetary values in imported files are South African rand (ZAR); report monetary amounts as R and do not convert currencies.',
    matchedLedgerSection,
    priceForecasts,
    numericForecasts,
    structuredAnalysis ? `Dataset summary:\n${structuredAnalysis.slice(0, 3000)}` : '',
    textExcerpts,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 10000);
};
