import type { Tool } from 'ollama/browser';
import type { KnowledgeDocument, NavTab } from '../types/app';
import {
  classifyRows,
  getCsvNumber,
  getStructuredDatasets,
  predictWithLinearRegression,
  type TabularDataset,
} from './datasetAnalytics';
import { searchDocuments } from './documentIngestion';
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
];

const formatNumber = (value: number): number =>
  Number.isInteger(value) ? value : Number(value.toFixed(2));

const findDataset = (
  datasets: TabularDataset[],
  datasetName?: string
): TabularDataset | undefined => {
  const valid = datasets.filter((dataset) => !dataset.error && dataset.rows.length > 0);
  if (!valid.length) return undefined;
  if (!datasetName?.trim()) return valid[0];

  const normalized = datasetName.trim().toLowerCase();
  return (
    valid.find((dataset) => dataset.name.toLowerCase() === normalized) ??
    valid.find((dataset) => dataset.name.toLowerCase().includes(normalized)) ??
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

      return JSON.stringify(
        {
          dataset: targetDataset.name,
          rowCount: targetDataset.rows.length,
          inferredColumns: columns,
          currency: 'ZAR (R)',
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

      const matchingProducts = requestedProduct
        ? products.filter((p) => p.toLowerCase().includes(requestedProduct.toLowerCase()))
        : products.slice(0, 8);

      const targetProducts = matchingProducts.length ? matchingProducts : products.slice(0, 5);
      const forecasts = targetProducts.map((product) => {
        const forecast = predictProductPrices(history, product);
        return {
          product,
          currency: 'ZAR (R)',
          observations: forecast.rowsAnalyzed,
          sourceFiles: forecast.sourceCount,
          inSampleRSquared: formatNumber(forecast.rSquared),
          predictions: forecast.predictions.map((p) => ({
            date: p.date,
            predictedPriceZAR: formatNumber(p.price),
          })),
          error: forecast.error,
        };
      });

      return JSON.stringify({ availableProducts: products, forecasts }, null, 2);
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

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
};
