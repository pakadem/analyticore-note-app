import type { KnowledgeDocument } from '../types/app';
import {
  getCsvNumber,
  getStructuredDatasets,
  predictWithLinearRegression,
} from './datasetAnalytics';
import { getProductPriceHistory, predictProductPrices } from './retailAnalytics';

export const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024;
export const MAX_RETRIEVED_CHUNKS = 5;
export const PDF_TEXT_EXTRACTION_VERSION = 2;
const SUPPORTED_EXTENSIONS = new Set(['pdf', 'csv', 'txt']);

export const isSupportedDocument = (file: File): boolean => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension !== undefined && SUPPORTED_EXTENSIONS.has(extension);
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
        const lines: Array<{ y: number; items: Array<{ x: number; width: number; text: string }> }> = [];

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

        pages.push(
          lines
            .sort((left, right) => right.y - left.y)
            .map((line) => {
              const items = line.items.sort((left, right) => left.x - right.x);
              return items.reduce((text, item, index) => {
                if (index === 0) return item.text;
                const previous = items[index - 1];
                const gap = item.x - previous.x - previous.width;
                return `${text}${gap > 18 ? '\t' : ' '}${item.text}`;
              }, '');
            })
            .join('\n')
        );
      }

      const text = pages.join('\n').trim();
      if (!text) {
        throw new Error('No selectable text was found. Scanned PDFs require OCR, which is not supported yet.');
      }
      return text;
    } finally {
      await pdf.destroy();
    }
  }

  return (await file.text()).trim();
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
  /\b(analy[sz]e|analysis|summari[sz]e|summary|overview|insights?|business|profit|costs?|revenue|financial|dataset|data)\b/i.test(query);

const summarizeStructuredDatasets = (
  documents: KnowledgeDocument[],
  query: string
): string => {
  const queryTerms = query
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.filter((term) => !STOP_WORDS.has(term)) ?? [];
  const datasets = getStructuredDatasets(documents).filter(
    (dataset) => !dataset.error && dataset.rows.length > 0
  );
  const rankedDatasets = datasets
    .map((dataset) => {
      const headersAndName = `${dataset.name} ${dataset.headers.join(' ')}`.toLowerCase();
      const score = queryTerms.reduce((total, term) => {
        const matchesHeader = headersAndName.includes(term);
        const matchesValue = !matchesHeader && dataset.rows.some((row) =>
          Object.values(row).some((value) => value.toLowerCase().includes(term))
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
    .slice(0, 3)
    .map(({ dataset }) => dataset);

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
  const orderedProducts = products
    .map((product) => ({
      product,
      relevant: normalizedQuery.includes(product.toLowerCase()),
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

export const searchDocuments = (documents: KnowledgeDocument[], query: string): string => {
  const readyDocuments = documents.filter((document) => document.status === 'ready');
  if (!readyDocuments.length) return '';

  const documentChunks = readyDocuments.flatMap((document) =>
    splitIntoChunks(document.content).map((text) => ({ name: document.name, text }))
  );
  if (!documentChunks.length) return '';

  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu)
        ?.filter((term) => !STOP_WORDS.has(term)) ?? []
    )
  );

  const matches = documentChunks
    .map((chunk) => {
      const normalizedText = chunk.text.toLowerCase();
      const score = terms.reduce((total, term) => {
        const occurrences = normalizedText.split(term).length - 1;
        return total + Math.min(occurrences, 5);
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
    textExcerpts,
    structuredAnalysis ? `Full-dataset analysis:\n${structuredAnalysis.slice(0, 5000)}` : '',
    priceForecasts,
    numericForecasts,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 16000);
};
