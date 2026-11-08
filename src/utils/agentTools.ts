import type { Tool } from 'ollama/browser';
import type { GeneratedFileArtifact, KnowledgeDocument, NavTab } from '../types/app';
import {
  classifyRows,
  getCsvNumber,
  getStructuredDatasets,
  predictWithLinearRegression,
  type TabularDataset,
} from './datasetAnalytics';
import { MAKRO_ITEM_HEADER, searchDocuments } from './documentIngestion';
import { buildExcelWorkbookBytes } from './excelExport';
import { fuzzyTextMatchesTerm, matchesRowWithSynonyms } from './nluRouter';
import {
  combineRetailDatasets,
  getPopularItems,
  getProductPriceHistory,
  getSpendProgression,
  getVisitDays,
  inferRetailColumns,
  predictProductPrices,
  type TimeGrouping,
} from './retailAnalytics';

export interface AgentToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  resultPreview?: string;
}

export interface AgentToolContext {
  documents: KnowledgeDocument[];
  onSelectTab?: (tab: NavTab) => void;
  onArtifactCreated?: (artifact: GeneratedFileArtifact) => void;
}

export const AGENT_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'list_documents_and_datasets',
      description:
        'List all uploaded documents, their readiness status, and detected structured tables with column names, numeric columns, and row counts.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description:
        'Search uploaded PDF, CSV, and TXT documents for relevant text excerpts and full-dataset statistical summaries matching a query.',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description: 'Keywords, metric names, product names, or business question to search for.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_retail_metrics',
      description:
        'Compute retail performance metrics across uploaded structured datasets: store visits by weekday, spend progression over time, and top popular items.',
      parameters: {
        type: 'object',
        properties: {
          grouping: {
            type: 'string',
            enum: ['day', 'week', 'month'],
            description: 'Time grouping for spend progression (day, week, or month). Defaults to month.',
          },
          datasetName: {
            type: 'string',
            description: 'Optional dataset file name to analyze; omit to combine all compatible retail datasets.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forecast_product_prices',
      description:
        'Run ordinary least squares linear regression on dated product-price history across uploaded files to forecast future prices in South African rand (R).',
      parameters: {
        type: 'object',
        properties: {
          product: {
            type: 'string',
            description: 'Product name to forecast. Omit to list forecasts for top products with price history.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_linear_regression',
      description:
        'Run linear regression on a numeric target column in a dataset against either row order (__row_order__) or another numeric feature column.',
      parameters: {
        type: 'object',
        required: ['targetColumn'],
        properties: {
          datasetName: {
            type: 'string',
            description: 'Optional name of the dataset file. Defaults to the first structured dataset with numeric columns.',
          },
          targetColumn: {
            type: 'string',
            description: 'Numeric column to predict.',
          },
          featureColumn: {
            type: 'string',
            description: 'Predictor column name, or "__row_order__" for sequential trend projection.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_kmeans_clustering',
      description:
        'Segment rows of a structured dataset into clusters using K-means clustering across all varying numeric columns.',
      parameters: {
        type: 'object',
        properties: {
          datasetName: {
            type: 'string',
            description: 'Optional dataset file name. Defaults to the first structured dataset with numeric columns.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_app_view',
      description:
        'Navigate the AnalytiCore application UI to a specific view: "home" (Dashboard & Analytics), "upload" (Data Ingestion), or "api" (API & Model Setup).',
      parameters: {
        type: 'object',
        required: ['tab'],
        properties: {
          tab: {
            type: 'string',
            enum: ['home', 'upload', 'api'],
            description: 'Target navigation tab.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_table_or_file',
      description:
        'Create an interactive table in the chat and generate a downloadable file (CSV, JSON, TXT, or Markdown) from uploaded invoices/datasets, retail summaries, price forecasts, or custom rows.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            enum: [
              'makro_items',
              'combined_retail',
              'dataset',
              'popular_items',
              'spend_progression',
              'price_forecasts',
              'custom',
            ],
            description:
              'Data source to build the table/file from. Use "makro_items" for the 11-column Makro item list across invoices, "dataset" for a specific file, "combined_retail" for all retail rows with dates, "popular_items" for top items, "spend_progression" for spend by period, "price_forecasts" for product price predictions, or "custom" for custom columns/rows/content.',
          },
          datasetName: {
            type: 'string',
            description: 'Optional dataset or invoice file name when source is "dataset" or "makro_items".',
          },
          searchFilter: {
            type: 'string',
            description: 'Optional keyword filter to match product description, barcode, date, or customer.',
          },
          format: {
            type: 'string',
            enum: ['csv', 'xlsx', 'json', 'txt', 'md'],
            description: 'Downloadable file format (csv, xlsx for Microsoft Excel, json, txt, or md). Defaults to csv.',
          },
          title: {
            type: 'string',
            description: 'Human-readable title for the generated table or file.',
          },
          filename: {
            type: 'string',
            description: 'Optional file name for download (e.g. "makro-items.csv" or "price-forecast.json").',
          },
          columns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of column names to include or custom table headers.',
          },
          rows: {
            type: 'array',
            items: { type: 'object' },
            description: 'Optional array of row objects when source is "custom".',
          },
          content: {
            type: 'string',
            description: 'Optional raw text/markdown/CSV content when generating a custom text report.',
          },
        },
      },
    },
  },
];

const escapeCsvCell = (value: string, forceQuote = false): string => {
  const trimmed = value ?? '';
  if (forceQuote || /[",\r\n]/.test(trimmed)) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }
  return trimmed;
};

const MAKRO_HEADERS = MAKRO_ITEM_HEADER.split(',').map((header) => header.trim());

export const serializeTableContent = (
  headers: string[],
  rows: Record<string, string>[],
  format: 'csv' | 'xlsx' | 'json' | 'txt' | 'md',
  sheetTitle = 'AnalytiCore Data'
): { content: string; binaryContent?: Uint8Array; mimeType: string; extension: string } => {
  if (format === 'xlsx') {
    const binaryContent = buildExcelWorkbookBytes(headers, rows, sheetTitle);
    const csvFallback = serializeTableContent(headers, rows, 'csv', sheetTitle);
    return {
      content: csvFallback.content,
      binaryContent,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      extension: 'xlsx',
    };
  }

  if (format === 'json') {
    return {
      content: JSON.stringify(rows, null, 2),
      mimeType: 'application/json;charset=utf-8',
      extension: 'json',
    };
  }

  if (format === 'md' || format === 'txt') {
    const headerLine = `| ${headers.join(' | ')} |`;
    const dividerLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const bodyLines = rows.map(
      (row) => `| ${headers.map((header) => (row[header] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`
    );
    return {
      content: [headerLine, dividerLine, ...bodyLines].join('\n'),
      mimeType: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
      extension: format,
    };
  }

  const isMakroFormat =
    headers.length === MAKRO_HEADERS.length &&
    headers.every((header, index) => header.toUpperCase() === MAKRO_HEADERS[index].toUpperCase());

  if (isMakroFormat) {
    const lines = rows.map((row) => {
      const qty = (row['QTY'] ?? '').trim();
      const barcode = (row['BARCODE'] ?? '').trim();
      const unitPk = (row['UNIT/PK'] ?? '').trim();
      const description = (row['DESCRIPTION'] ?? '').trim().replace(/"/g, '""');
      const weight = (row['WEIGHT (Kg)'] ?? '').trim();
      const dis = (row['DIS'] ?? '').trim();
      const sglInc = (row['SGL INC'] ?? '').trim();
      const vat = (row['VAT'] ?? '').trim();
      const pkIncCode = (row['PK INC CODE'] ?? '').trim();
      const totalExc = (row['TOTAL EXC'] ?? '').trim();
      const totalInc = (row['TOTAL INC'] ?? '').trim();
      return `${qty}, ${barcode}, ${unitPk}, "${description}", ${weight},${dis || ' '},${sglInc}, ${vat}, ${pkIncCode}, ${totalExc}, ${totalInc}`;
    });
    return {
      content: [MAKRO_ITEM_HEADER, ...lines].join('\n'),
      mimeType: 'text/csv;charset=utf-8',
      extension: 'csv',
    };
  }

  const csvHeader = headers.map((header) => escapeCsvCell(header)).join(', ');
  const csvRows = rows.map((row) =>
    headers
      .map((header) =>
        escapeCsvCell(
          row[header] ?? '',
          header.toUpperCase() === 'DESCRIPTION' || header.toUpperCase() === 'ITEM'
        )
      )
      .join(', ')
  );

  return {
    content: [csvHeader, ...csvRows].join('\n'),
    mimeType: 'text/csv;charset=utf-8',
    extension: 'csv',
  };
};

const formatNumber = (value: number): number =>
  Number.isInteger(value) ? value : Number(value.toFixed(2));

const combineAllDatasets = (datasets: TabularDataset[]): TabularDataset | undefined => {
  const valid = datasets.filter((dataset) => !dataset.error && dataset.rows.length > 0);
  if (!valid.length) return undefined;
  if (valid.length === 1) return valid[0];

  const makroDatasets = valid.filter((d) =>
    MAKRO_HEADERS.every((h) => d.headers.some((dh) => dh.toUpperCase() === h.toUpperCase()))
  );

  if (makroDatasets.length > 0) {
    const rows = makroDatasets.flatMap((d) =>
      d.rows.map((r) =>
        Object.fromEntries(
          MAKRO_HEADERS.map((h) => {
            const actualKey = Object.keys(r).find((k) => k.toUpperCase() === h.toUpperCase()) ?? h;
            return [h, r[actualKey] ?? ''];
          })
        )
      )
    );
    const numericColumns = MAKRO_HEADERS.filter(
      (header) =>
        header !== 'BARCODE' &&
        header !== 'DIS' &&
        rows.some((row) => getCsvNumber(row[header]) !== undefined)
    );
    return {
      id: 'combined-all-makro-datasets',
      name: `All Uploaded Makro Invoices (${makroDatasets.length} files)`,
      headers: [...MAKRO_HEADERS],
      rows,
      numericColumns,
    };
  }

  return combineRetailDatasets(valid) ?? valid[0];
};

const isSpecificDatasetName = (datasetName?: string): boolean => {
  if (!datasetName?.trim()) return false;
  const clean = datasetName.trim().toLowerCase();
  if (
    /^(all|all[ _-]?files|all[ _-]?invoices|combined|makro|invoices|datasets|every|total)$/i.test(
      clean
    )
  ) {
    return false;
  }
  return true;
};

const findDataset = (
  datasets: TabularDataset[],
  datasetName?: string
): TabularDataset | undefined => {
  const valid = datasets.filter((dataset) => !dataset.error && dataset.rows.length > 0);
  if (!valid.length) return undefined;
  if (!isSpecificDatasetName(datasetName)) {
    return combineAllDatasets(valid) ?? combineRetailDatasets(valid) ?? valid[0];
  }

  const normalized = datasetName!.trim().toLowerCase();
  return (
    valid.find((dataset) => dataset.name.toLowerCase() === normalized) ??
    valid.find((dataset) => dataset.name.toLowerCase().includes(normalized)) ??
    combineAllDatasets(valid) ??
    combineRetailDatasets(valid) ??
    valid[0]
  );
};

export const executeAgentTool = async (
  name: string,
  rawArgs: Record<string, unknown> | undefined,
  context: AgentToolContext
): Promise<string> => {
  const args = rawArgs ?? {};
  const structuredDatasets = getStructuredDatasets(context.documents);

  switch (name) {
    case 'list_documents_and_datasets': {
      const docs = context.documents.map((doc) => ({
        name: doc.name,
        status: doc.status,
        sizeBytes: doc.size,
        tokenCount: doc.tokenCount ?? 0,
      }));
      const tables = structuredDatasets.map((dataset) => ({
        name: dataset.name,
        rowCount: dataset.rows.length,
        headers: dataset.headers,
        numericColumns: dataset.numericColumns,
        error: dataset.error,
      }));
      return JSON.stringify({ documents: docs, structuredTables: tables }, null, 2);
    }

    case 'search_knowledge_base': {
      const query = String(args.query ?? '').trim() || 'summary overview';
      const result = searchDocuments(context.documents, query);
      return result || 'No ready documents or matching excerpts found.';
    }

    case 'analyze_retail_metrics': {
      const groupingArg = String(args.grouping ?? 'month').toLowerCase();
      const grouping: TimeGrouping =
        groupingArg === 'day' || groupingArg === 'week' || groupingArg === 'month'
          ? groupingArg
          : 'month';
      const requestedName = typeof args.datasetName === 'string' ? args.datasetName : undefined;
      const targetDataset = requestedName
        ? findDataset(structuredDatasets, requestedName)
        : combineRetailDatasets(structuredDatasets) ?? findDataset(structuredDatasets);

      if (!targetDataset) {
        return JSON.stringify({ error: 'No structured retail dataset is currently available.' });
      }

      const columns = inferRetailColumns(targetDataset.headers);
      const visits = columns.date
        ? getVisitDays(targetDataset, columns.date, columns.customer).points
        : [];
      const spend =
        columns.date && columns.amount
          ? getSpendProgression(targetDataset, columns.date, columns.amount, grouping).points
          : [];
      const popularItems = columns.item
        ? getPopularItems(targetDataset, columns.item, columns.quantity)
        : undefined;

      const numericTotals = Object.fromEntries(
        targetDataset.numericColumns.map((col) => {
          const vals = targetDataset.rows
            .map((r) => getCsvNumber(r[col]))
            .filter((v): v is number => v !== undefined);
          const sum = vals.reduce((acc, v) => acc + v, 0);
          return [
            col,
            {
              count: vals.length,
              sum: formatNumber(sum),
              average: vals.length ? formatNumber(sum / vals.length) : 0,
            },
          ];
        })
      );

      const grandTotalSpend = formatNumber(
        spend.reduce((acc, point) => acc + point.spent, 0)
      );

      return JSON.stringify(
        {
          dataset: targetDataset.name,
          rowCount: targetDataset.rows.length,
          inferredColumns: columns,
          currency: 'ZAR (R)',
          grandTotalSpend,
          numericTotals,
          visitsByWeekday: visits,
          spendProgression: spend.slice(-12),
          topPopularItems: popularItems?.points ?? [],
        },
        null,
        2
      );
    }

    case 'forecast_product_prices': {
      const history = getProductPriceHistory(structuredDatasets);
      if (!history.length) {
        return JSON.stringify({
          error: 'No dated product-price history was found across uploaded files.',
        });
      }

      const products = Array.from(
        new Map(history.map((item) => [item.product.toLowerCase(), item.product])).values()
      );
      const requestedProduct = typeof args.product === 'string' ? args.product.trim() : '';

      const allEvaluated = products
        .map((product) => {
          const forecast = predictProductPrices(history, product);
          const actualPoints = forecast.points.filter((p) => p.actual !== null);
          const latestActual =
            actualPoints.length > 0 ? actualPoints[actualPoints.length - 1] : undefined;
          return {
            product,
            currency: 'ZAR (R)',
            observations: forecast.rowsAnalyzed,
            sourceFiles: forecast.sourceCount,
            latestObservedDate: latestActual?.date ?? null,
            latestObservedPriceZAR:
              latestActual?.actual != null ? formatNumber(latestActual.actual) : null,
            observedHistory: actualPoints.slice(-6).map((p) => ({
              date: p.date,
              priceZAR: formatNumber(p.actual!),
            })),
            inSampleRSquared: formatNumber(forecast.rSquared),
            predictions: forecast.predictions.map((p) => ({
              date: p.date,
              predictedPriceZAR: formatNumber(p.price),
            })),
            hasValidForecast: !forecast.error && forecast.predictions.length > 0,
            error: forecast.error,
          };
        })
        .sort(
          (a, b) =>
            Number(b.hasValidForecast) - Number(a.hasValidForecast) ||
            b.observations - a.observations ||
            a.product.localeCompare(b.product)
        );

      const directRequestTokens = requestedProduct
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 3);

      const matchingForecasts = requestedProduct
        ? allEvaluated
            .filter(
              (item) =>
                item.product.toLowerCase().includes(requestedProduct.toLowerCase()) ||
                matchesRowWithSynonyms([item.product], requestedProduct)
            )
            .sort((a, b) => {
              const aDirect = directRequestTokens.filter((t) =>
                fuzzyTextMatchesTerm(a.product.toLowerCase(), t)
              ).length;
              const bDirect = directRequestTokens.filter((t) =>
                fuzzyTextMatchesTerm(b.product.toLowerCase(), t)
              ).length;
              return (
                bDirect - aDirect ||
                Number(b.hasValidForecast) - Number(a.hasValidForecast) ||
                b.observations - a.observations
              );
            })
        : [];

      const topForecastable = allEvaluated
        .filter((item) => item.hasValidForecast)
        .slice(0, 15);

      const selectedForecasts =
        matchingForecasts.length > 0
          ? [
              ...matchingForecasts.slice(0, 15),
              ...topForecastable
                .filter(
                  (tf) => !matchingForecasts.some((mf) => mf.product === tf.product)
                )
                .slice(0, 5),
            ]
          : allEvaluated.slice(0, 20);

      return JSON.stringify(
        {
          totalProductsTracked: products.length,
          eligibleForOLSForecastCount: allEvaluated.filter((item) => item.hasValidForecast).length,
          note: 'OLS linear regression price forecasting requires at least 3 distinct invoice dates per product. Single-observation products report their latestObservedPriceZAR.',
          topForecastableProducts: topForecastable.map((item) => item.product),
          forecasts: selectedForecasts,
        },
        null,
        2
      );
    }

    case 'run_linear_regression': {
      const dataset = findDataset(
        structuredDatasets,
        typeof args.datasetName === 'string' ? args.datasetName : undefined
      );
      if (!dataset) {
        return JSON.stringify({ error: 'No structured dataset with rows is available.' });
      }

      const requestedTarget = String(args.targetColumn ?? '').trim();
      const targetColumn =
        dataset.numericColumns.find(
          (col) => col.toLowerCase() === requestedTarget.toLowerCase()
        ) ??
        dataset.numericColumns.find((col) =>
          col.toLowerCase().includes(requestedTarget.toLowerCase())
        ) ??
        dataset.numericColumns[0];

      if (!targetColumn) {
        return JSON.stringify({
          error: `No numeric target column found in ${dataset.name}. Available numeric columns: ${dataset.numericColumns.join(', ')}`,
        });
      }

      const requestedFeature = String(args.featureColumn ?? '__row_order__').trim();
      const featureColumn =
        requestedFeature === '__row_order__'
          ? '__row_order__'
          : dataset.numericColumns.find(
              (col) => col.toLowerCase() === requestedFeature.toLowerCase()
            ) ?? '__row_order__';

      const analysis = predictWithLinearRegression(dataset, targetColumn, featureColumn);
      return JSON.stringify(
        {
          dataset: dataset.name,
          targetColumn,
          featureColumn,
          rowsAnalyzed: analysis.rowsAnalyzed,
          rowsExcluded: analysis.rowsExcluded,
          inSampleRSquared: formatNumber(analysis.rSquared),
          predictions: analysis.predictions.map((p, index) => ({
            step: index + 1,
            x: formatNumber(p.x),
            predictedY: formatNumber(p.y),
          })),
          error: analysis.error,
        },
        null,
        2
      );
    }

    case 'run_kmeans_clustering': {
      const dataset = findDataset(
        structuredDatasets,
        typeof args.datasetName === 'string' ? args.datasetName : undefined
      );
      if (!dataset) {
        return JSON.stringify({ error: 'No structured dataset is available for clustering.' });
      }

      const clustering = classifyRows(dataset);
      return JSON.stringify(
        {
          dataset: dataset.name,
          columnsUsed: clustering.columns,
          rowsAnalyzed: clustering.rowsAnalyzed,
          rowsExcluded: clustering.rowsExcluded,
          clusters: clustering.clusters.map((cluster) => ({
            clusterId: cluster.id,
            size: cluster.size,
            examples: cluster.examples,
          })),
          error: clustering.error,
        },
        null,
        2
      );
    }

    case 'switch_app_view': {
      const tab = String(args.tab ?? '').toLowerCase();
      if (tab === 'home' || tab === 'upload' || tab === 'api') {
        context.onSelectTab?.(tab);
        return JSON.stringify({
          status: 'ok',
          switchedTo: tab,
        });
      }
      return JSON.stringify({
        error: 'Invalid tab. Must be one of: "home", "upload", "api".',
      });
    }

    case 'create_table_or_file': {
      const rawFormat = String(args.format ?? 'csv').toLowerCase();
      const format: 'csv' | 'xlsx' | 'json' | 'txt' | 'md' =
        rawFormat === 'xlsx' || rawFormat === 'xls' || rawFormat === 'excel'
          ? 'xlsx'
          : rawFormat === 'json' || rawFormat === 'txt' || rawFormat === 'md'
            ? rawFormat
            : 'csv';
      const requestedDatasetName =
        typeof args.datasetName === 'string' ? args.datasetName.trim() : undefined;
      const searchFilter =
        typeof args.searchFilter === 'string' ? args.searchFilter.trim().toLowerCase() : '';
      const rawSource = String(
        args.source ??
          (Array.isArray(args.rows) || typeof args.content === 'string'
            ? 'custom'
            : requestedDatasetName
              ? 'dataset'
              : 'makro_items')
      ).toLowerCase();

      let title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '';
      let headers: string[] = [];
      let rows: Record<string, string>[] = [];

      if (rawSource === 'custom' && typeof args.content === 'string' && args.content.trim() && !Array.isArray(args.rows)) {
        const customContent = args.content.trim();
        const ext = format === 'json' ? 'json' : format === 'md' ? 'md' : format === 'txt' ? 'txt' : 'csv';
        const mimeType =
          ext === 'json'
            ? 'application/json;charset=utf-8'
            : ext === 'md'
              ? 'text/markdown;charset=utf-8'
              : ext === 'txt'
                ? 'text/plain;charset=utf-8'
                : 'text/csv;charset=utf-8';
        const baseName =
          typeof args.filename === 'string' && args.filename.trim()
            ? args.filename.trim()
            : `analyticore-report-${Date.now()}.${ext}`;
        const artifact: GeneratedFileArtifact = {
          id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: title || 'Generated Report',
          filename: baseName.includes('.') ? baseName : `${baseName}.${ext}`,
          mimeType,
          content: customContent,
        };
        context.onArtifactCreated?.(artifact);
        return JSON.stringify({
          status: 'created',
          title: artifact.title,
          filename: artifact.filename,
          byteLength: artifact.content.length,
        });
      }

      if (rawSource === 'custom' && Array.isArray(args.rows) && args.rows.length > 0) {
        const rawRows = args.rows.filter(
          (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
        );
        const inferredHeaders =
          Array.isArray(args.columns) && args.columns.length > 0
            ? args.columns.map((col) => String(col))
            : Array.from(new Set(rawRows.flatMap((row) => Object.keys(row))));
        headers = inferredHeaders;
        rows = rawRows.map((row) =>
          Object.fromEntries(headers.map((header) => [header, String(row[header] ?? '')]))
        );
        title = title || 'Custom Analysis Table';
      } else if (rawSource === 'popular_items') {
        const combined = combineRetailDatasets(structuredDatasets) ?? findDataset(structuredDatasets);
        if (!combined) {
          return JSON.stringify({ error: 'No structured retail dataset is available.' });
        }
        const cols = inferRetailColumns(combined.headers);
        const popular = cols.item ? getPopularItems(combined, cols.item, cols.quantity) : undefined;
        headers = ['Rank', 'Item', 'Total Quantity'];
        rows = (popular?.points ?? []).map((point, index) => ({
          Rank: String(index + 1),
          Item: point.item,
          'Total Quantity': String(formatNumber(point.purchases)),
        }));
        title = title || 'Top Popular Items';
      } else if (rawSource === 'spend_progression') {
        const combined = combineRetailDatasets(structuredDatasets) ?? findDataset(structuredDatasets);
        if (!combined) {
          return JSON.stringify({ error: 'No structured retail dataset is available.' });
        }
        const cols = inferRetailColumns(combined.headers);
        const spend =
          cols.date && cols.amount
            ? getSpendProgression(combined, cols.date, cols.amount, 'month').points
            : [];
        headers = ['Period', 'Total Spend (ZAR)', 'Cumulative Spend (ZAR)'];
        rows = spend.map((point) => ({
          Period: point.period,
          'Total Spend (ZAR)': `R${formatNumber(point.spent).toFixed(2)}`,
          'Cumulative Spend (ZAR)': `R${formatNumber(point.cumulative).toFixed(2)}`,
        }));
        title = title || 'Spend Progression by Month';
      } else if (rawSource === 'price_forecasts') {
        const history = getProductPriceHistory(structuredDatasets);
        const products = Array.from(
          new Map(history.map((item) => [item.product.toLowerCase(), item.product])).values()
        );
        headers = [
          'Product',
          'Observations',
          'Latest Price (ZAR)',
          'In-Sample R²',
          'Forecast Date 1',
          'Forecast Price 1 (ZAR)',
          'Forecast Date 2',
          'Forecast Price 2 (ZAR)',
        ];
        const evaluatedRows = products
          .map((product) => {
            const forecast = predictProductPrices(history, product);
            const actualPoints = forecast.points.filter((p) => p.actual !== null);
            const latestActual =
              actualPoints.length > 0 ? actualPoints[actualPoints.length - 1] : undefined;
            const p1 = forecast.predictions[0];
            const p2 = forecast.predictions[1];
            const hasValidForecast = !forecast.error && forecast.predictions.length > 0;
            return {
              hasValidForecast,
              observations: forecast.rowsAnalyzed,
              row: {
                Product: product,
                Observations: String(forecast.rowsAnalyzed),
                'Latest Price (ZAR)':
                  latestActual?.actual != null
                    ? `R${formatNumber(latestActual.actual).toFixed(2)}`
                    : '-',
                'In-Sample R²': hasValidForecast ? String(formatNumber(forecast.rSquared)) : '-',
                'Forecast Date 1': p1?.date ?? '-',
                'Forecast Price 1 (ZAR)': p1 ? `R${formatNumber(p1.price).toFixed(2)}` : '-',
                'Forecast Date 2': p2?.date ?? '-',
                'Forecast Price 2 (ZAR)': p2 ? `R${formatNumber(p2.price).toFixed(2)}` : '-',
              } as Record<string, string>,
            };
          })
          .sort(
            (a, b) =>
              Number(b.hasValidForecast) - Number(a.hasValidForecast) ||
              b.observations - a.observations ||
              a.row.Product.localeCompare(b.row.Product)
          );

        const validForecastRows = evaluatedRows
          .filter((item) => item.hasValidForecast)
          .map((item) => item.row);
        rows =
          !searchFilter && validForecastRows.length > 0
            ? validForecastRows
            : evaluatedRows.map((item) => item.row);
        title = title || 'Product Price Forecasts (OLS)';
      } else if (rawSource === 'combined_retail') {
        const combined = combineRetailDatasets(structuredDatasets) ?? findDataset(structuredDatasets);
        if (!combined) {
          return JSON.stringify({ error: 'No structured retail dataset is available.' });
        }
        headers = [...combined.headers];
        rows = [...combined.rows];
        title = title || 'Combined Retail Transactions';
      } else if (rawSource === 'dataset' && isSpecificDatasetName(requestedDatasetName)) {
        const target = findDataset(structuredDatasets, requestedDatasetName);
        if (!target) {
          return JSON.stringify({ error: 'No matching structured dataset found.' });
        }
        headers = [...target.headers];
        rows = [...target.rows];
        title = title || `${target.name} Table`;
      } else {
        // Default: 'makro_items' — use the 11-column Makro item format across matching or all Makro datasets
        const validDatasets = structuredDatasets.filter((d) => !d.error && d.rows.length > 0);
        const matchingDatasets = isSpecificDatasetName(requestedDatasetName)
          ? Array.from(
              new Map(
                validDatasets
                  .filter((d) =>
                    d.name.toLowerCase().includes(requestedDatasetName!.toLowerCase())
                  )
                  .map((d) => [d.name.toLowerCase(), d])
              ).values()
            )
          : validDatasets;
        const targetDatasets = matchingDatasets.length ? matchingDatasets : validDatasets;
        const makroDatasets = targetDatasets.filter((d) =>
          MAKRO_HEADERS.every((h) => d.headers.some((dh) => dh.toUpperCase() === h.toUpperCase()))
        );

        if (makroDatasets.length > 0) {
          headers = [...MAKRO_HEADERS];
          rows = makroDatasets.flatMap((d) =>
            d.rows.map((r) =>
              Object.fromEntries(
                MAKRO_HEADERS.map((h) => {
                  const actualKey =
                    Object.keys(r).find((k) => k.toUpperCase() === h.toUpperCase()) ?? h;
                  return [h, r[actualKey] ?? ''];
                })
              )
            )
          );
          title =
            title ||
            (makroDatasets.length === 1
              ? `${makroDatasets[0].name} Items`
              : `Makro Invoice Items (${makroDatasets.length} invoices)`);
        } else if (targetDatasets[0]) {
          headers = [...targetDatasets[0].headers];
          rows = [...targetDatasets[0].rows];
          title = title || `${targetDatasets[0].name} Table`;
        } else {
          return JSON.stringify({ error: 'No structured datasets are currently available to export.' });
        }
      }

      if (searchFilter) {
        rows = rows.filter((row) =>
          matchesRowWithSynonyms(Object.values(row).map(String), searchFilter)
        );
      }

      if (Array.isArray(args.columns) && args.columns.length > 0 && rawSource !== 'custom') {
        const requestedCols = args.columns.map((col) => String(col).trim());
        const matchedHeaders = requestedCols
          .map((req) => headers.find((h) => h.toLowerCase() === req.toLowerCase()))
          .filter((h): h is string => Boolean(h));
        if (matchedHeaders.length > 0) {
          headers = matchedHeaders;
          rows = rows.map((row) =>
            Object.fromEntries(headers.map((header) => [header, row[header] ?? '']))
          );
        }
      }

      const serialized = serializeTableContent(headers, rows, format, title);
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'analyticore-table';
      const rawFilename =
        typeof args.filename === 'string' && args.filename.trim()
          ? args.filename.trim()
          : `${slug}.${serialized.extension}`;
      const filename = rawFilename.includes('.')
        ? rawFilename
        : `${rawFilename}.${serialized.extension}`;

      const artifact: GeneratedFileArtifact = {
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        filename,
        mimeType: serialized.mimeType,
        content: serialized.content,
        binaryContent: serialized.binaryContent,
        headers,
        rows,
      };
      context.onArtifactCreated?.(artifact);

      return JSON.stringify(
        {
          status: 'created',
          title: artifact.title,
          filename: artifact.filename,
          format,
          rowCount: rows.length,
          columns: headers,
          sampleRows: rows.slice(0, 5),
          note: 'The interactive table and downloadable file button have been attached directly to the chat message for the user.',
        },
        null,
        2
      );
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
};
