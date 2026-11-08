import type { Ollama } from 'ollama/browser';
import type { KnowledgeDocument, NavTab } from '../types/app';

export interface SemanticIntentPlan {
  wantsTableOrFile: boolean;
  tableSource:
    | 'makro_items'
    | 'combined_retail'
    | 'dataset'
    | 'popular_items'
    | 'spend_progression'
    | 'price_forecasts';
  fileFormat: 'csv' | 'xlsx' | 'json' | 'txt' | 'md';
  datasetName?: string;
  searchFilter?: string;
  wantsForecast: boolean;
  wantsRegression: boolean;
  regressionTargetColumn?: string;
  wantsRetailMetrics: boolean;
  retailGrouping: 'day' | 'week' | 'month';
  wantsClustering: boolean;
  targetTab?: NavTab;
  expandedQuery: string;
  expandedTerms: string[];
}

/**
 * Bidirectional synonym groups covering retail, Makro invoice abbreviations,
 * financial/actuarial terminology, and conversational phrasing.
 */
const SYNONYM_GROUPS: string[][] = [
  // Table / Export / Download concepts
  [
    'table',
    'tables',
    'tabular',
    'grid',
    'sheet',
    'spreadsheet',
    'csv',
    'excel',
    'export',
    'download',
    'downloadable',
    'save',
    'extract',
    'dump',
    'breakdown',
    'schedule',
    'roster',
    'item list',
    'line items',
    'catalogue',
    'catalog',
    'inventory list',
    'report file',
  ],
  // Spend / Cost / Revenue / Financial concepts
  [
    'spend',
    'spending',
    'spent',
    'expenditure',
    'outlay',
    'outflow',
    'cost',
    'costs',
    'expense',
    'expenses',
    'paid',
    'payment',
    'bill',
    'bills',
    'amount',
    'total inc',
    'total exc',
    'sgl inc',
    'turnover',
    'revenue',
    'sales',
    'rand',
    'zar',
    'money',
    'budget',
  ],
  // Popular / Top / Volume concepts
  [
    'popular',
    'popularity',
    'top',
    'best selling',
    'bestselling',
    'best seller',
    'most bought',
    'most purchased',
    'frequent',
    'frequently',
    'fast moving',
    'highest volume',
    'demand',
    'favourite',
    'favorite',
    'leading',
    'biggest',
  ],
  // Forecast / Prediction / Trend concepts
  [
    'forecast',
    'forecasts',
    'forecasting',
    'predict',
    'prediction',
    'predictions',
    'project',
    'projection',
    'projections',
    'future',
    'upcoming',
    'next month',
    'next quarter',
    'next year',
    'outlook',
    'estimate',
    'trajectory',
    'trend',
    'inflation',
    'price change',
    'going to cost',
    'will cost',
  ],
  // Clustering / Segmentation concepts
  [
    'cluster',
    'clusters',
    'clustering',
    'kmeans',
    'k-means',
    'segment',
    'segments',
    'segmentation',
    'group',
    'grouping',
    'categorize',
    'classify',
    'classification',
    'pattern',
    'cohort',
    'similarity',
  ],
  // Store visits / Frequency concepts
  [
    'visit',
    'visits',
    'visiting',
    'trips',
    'shopping trips',
    'footfall',
    'attendance',
    'weekday',
    'day of week',
    'busiest day',
    'when do we shop',
    'frequency',
  ],
  // Unit price / Pack / Quantity concepts
  [
    'price',
    'prices',
    'pricing',
    'unit price',
    'single price',
    'sgl inc',
    'each',
    'per unit',
    'per item',
    'pack price',
    'rate',
  ],
  [
    'quantity',
    'qty',
    'units',
    'count',
    'volume',
    'how many',
    'number of items',
    'pack size',
    'unit/pk',
  ],
  // Makro & Retail Product Abbreviations / Synonyms
  [
    'whisky',
    'whiskey',
    'scotch',
    'bourbon',
    'chivas',
    'regal',
    'jack daniels',
    'gentleman jack',
    'liquor',
    'alcohol',
    'booze',
    'spirits',
  ],
  [
    'juice',
    'liquifruit',
    'fruit juice',
    'breakfast punch',
    'brkfast',
    'pnch',
  ],
  [
    'washing machine',
    'w/machine',
    'washer',
    'front loader',
  ],
  [
    'checkout bag',
    'carrier bag',
    'shopping bag',
    'plastic bag',
    'bag',
    'bags',
  ],
  [
    'discount',
    'discounts',
    'dis',
    'promo',
    'promotion',
    'markdown',
    'rebate',
    'saving',
    'savings',
    'special',
  ],
  [
    'tax',
    'vat',
    'value added tax',
    'pk inc code',
    'taxable',
  ],
  [
    'invoice',
    'invoices',
    'receipt',
    'receipts',
    'slip',
    'slips',
    'statement',
    'makro',
    'masstores',
    'document',
    'documents',
  ],
];

/**
 * Simple English suffix stemmer so "forecasts"/"forecasting" -> "forecast",
 * "invoices" -> "invoic", "machines" -> "machin", etc.
 */
export const stemWord = (word: string): string => {
  const clean = word.toLowerCase().trim();
  if (clean.length <= 3) return clean;
  return clean
    .replace(/ies$/, 'y')
    .replace(/ing$/, '')
    .replace(/ed$/, '')
    .replace(/es$/, '')
    .replace(/s$/, '');
};

/**
 * Bounded Levenshtein edit distance for typo & spelling tolerance
 * (e.g. "whiskey" vs "whisky", "liquifrut" vs "liquifruit").
 */
export const levenshteinDistance = (a: string, b: string): number => {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 3;

  const matrix: number[][] = Array.from({ length: left.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= right.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
};

/**
 * Checks whether a target text matches a query term either by:
 * 1. Exact substring (or word-boundary match for 3-char tokens)
 * 2. Word stem equality
 * 3. Fuzzy edit distance <= 1 (for words >= 5 chars) or <= 2 (for words >= 8 chars)
 */
export const fuzzyTextMatchesTerm = (normalizedTarget: string, term: string): boolean => {
  const cleanTerm = term.toLowerCase().trim();
  if (!cleanTerm) return false;
  if (cleanTerm.includes(' ')) {
    return normalizedTarget.includes(cleanTerm);
  }
  if (cleanTerm.length <= 3) {
    const escaped = cleanTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(normalizedTarget);
  }
  if (normalizedTarget.includes(cleanTerm)) return true;

  const termStem = stemWord(cleanTerm);
  if (termStem.length >= 4 && normalizedTarget.includes(termStem)) return true;

  if (cleanTerm.length < 5) return false;
  const maxDist = cleanTerm.length >= 8 ? 2 : 1;
  const targetWords = normalizedTarget.match(/[\p{L}\p{N}/]{4,}/gu) ?? [];
  return targetWords.some(
    (word) =>
      stemWord(word) === termStem || levenshteinDistance(word, cleanTerm) <= maxDist
  );
};

/**
 * Expands a natural-language query into canonical domain keywords and synonyms.
 */
export const expandQueryWithSynonyms = (query: string): {
  expandedQuery: string;
  expandedTerms: string[];
} => {
  const lowerQuery = query.toLowerCase();
  const baseTerms =
    lowerQuery.match(/[\p{L}\p{N}/]{2,}/gu)?.map((t) => t.trim()) ?? [];
  const expandedSet = new Set<string>(baseTerms);

  for (const group of SYNONYM_GROUPS) {
    const matchedPhrases = group.filter((phrase) => {
      if (phrase.includes(' ')) {
        return lowerQuery.includes(phrase);
      }
      return baseTerms.some(
        (term) =>
          term === phrase ||
          stemWord(term) === stemWord(phrase) ||
          (term.length >= 5 && phrase.length >= 5 && levenshteinDistance(term, phrase) <= 1)
      );
    });

    if (matchedPhrases.length > 0) {
      for (const phrase of matchedPhrases) {
        if (phrase.includes(' ')) {
          phrase.split(/\s+/).forEach((part) => expandedSet.delete(part));
        }
      }
      for (const synonym of group) {
        expandedSet.add(synonym);
      }
    }
  }

  const expandedTerms = Array.from(expandedSet);
  return {
    expandedQuery: `${query} ${expandedTerms.join(' ')}`.trim(),
    expandedTerms,
  };
};

/**
 * Expands a product or row search filter into matching synonym tokens so
 * searching for "whiskey" or "breakfast punch" matches "WHISKY" or "BRKFAST PNCH".
 */
export const matchesRowWithSynonyms = (
  rowValues: string[],
  rawFilter: string
): boolean => {
  const cleanFilter = rawFilter.toLowerCase().trim();
  if (!cleanFilter) return true;

  const joinedRow = rowValues.join(' ').toLowerCase();
  if (joinedRow.includes(cleanFilter)) return true;

  const { expandedTerms } = expandQueryWithSynonyms(cleanFilter);

  // Check if any expanded synonym term or filter token matches the row
  return expandedTerms.some(
    (term) => term.length >= 3 && fuzzyTextMatchesTerm(joinedRow, term)
  );
};

const NON_PRODUCT_FILTER_WORDS = new Set([
  'what',
  'which',
  'when',
  'where',
  'who',
  'how',
  'many',
  'much',
  'did',
  'does',
  'do',
  'we',
  'our',
  'us',
  'you',
  'the',
  'and',
  'or',
  'for',
  'from',
  'with',
  'into',
  'across',
  'over',
  'about',
  'all',
  'every',
  'each',
  'total',
  'grand',
  'sum',
  'spend',
  'spending',
  'spent',
  'expenditure',
  'outlay',
  'outflow',
  'cash',
  'cost',
  'costs',
  'paid',
  'price',
  'prices',
  'pricing',
  'unit',
  'sgl',
  'inc',
  'exc',
  'vat',
  'dis',
  'qty',
  'quantity',
  'barcode',
  'description',
  'weight',
  'code',
  'table',
  'tables',
  'tabular',
  'grid',
  'sheet',
  'spreadsheet',
  'workbook',
  'excel',
  'xlsx',
  'xls',
  'csv',
  'json',
  'txt',
  'text',
  'markdown',
  'md',
  'file',
  'files',
  'document',
  'documents',
  'invoice',
  'invoices',
  'receipt',
  'receipts',
  'slip',
  'slips',
  'makro',
  'masstores',
  'dataset',
  'datasets',
  'record',
  'records',
  'row',
  'rows',
  'line',
  'item',
  'items',
  'product',
  'products',
  'purchase',
  'purchases',
  'purchased',
  'buy',
  'bought',
  'transaction',
  'transactions',
  'report',
  'list',
  'breakdown',
  'schedule',
  'summary',
  'overview',
  'show',
  'give',
  'create',
  'generate',
  'build',
  'make',
  'export',
  'download',
  'downloadable',
  'save',
  'extract',
  'find',
  'search',
  'look',
  'get',
  'me',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'will',
  'going',
  'next',
  'future',
  'upcoming',
  'month',
  'months',
  'monthly',
  'week',
  'weeks',
  'weekly',
  'day',
  'days',
  'daily',
  'weekday',
  'year',
  'forecast',
  'forecasts',
  'forecasting',
  'predict',
  'prediction',
  'predictions',
  'project',
  'projection',
  'trend',
  'linear',
  'regression',
  'ols',
  'cluster',
  'clusters',
  'clustering',
  'kmeans',
  'segment',
  'segments',
  'segmentation',
  'popular',
  'top',
  'best',
  'most',
  'frequent',
  'visit',
  'visits',
  'trip',
  'trips',
  'shopping',
  'uploaded',
  'imported',
  'time',
  'times',
  'it',
  'them',
  'their',
  'different',
  'compare',
  'run',
  'using',
  'progression',
  'cumulative',
  'period',
  'periods',
  'amount',
  'amounts',
  'number',
  'numbers',
  'value',
  'values',
  'dashboard',
  'home',
  'main',
  'analytics',
  'screen',
  'tab',
  'page',
  'view',
  'settings',
  'setup',
  'switch',
  'open',
  'take',
  'back',
  'navigate',
  'connection',
  'ollama',
  'model',
  'api',
]);

/**
 * Extracts specific product/brand/category filter keywords from a natural-language
 * query when present (e.g., "whiskey", "washing machine", "chivas regal", "liquifruit").
 */
export const extractProductSearchFilter = (
  query: string,
  documents: KnowledgeDocument[]
): string | undefined => {
  let cleaned = query.toLowerCase();
  for (const doc of documents) {
    const docLower = doc.name.toLowerCase();
    cleaned = cleaned.replace(docLower, ' ');
    cleaned = cleaned.replace(docLower.replace(/\.pdf$/i, ''), ' ');
  }

  const tokens =
    cleaned
      .match(/[\p{L}\p{N}/]{3,}/gu)
      ?.map((t) => t.trim())
      .filter((t) => !NON_PRODUCT_FILTER_WORDS.has(t) && !/^\d+$/.test(t)) ?? [];

  if (tokens.length === 0) return undefined;
  return Array.from(new Set(tokens)).join(' ');
};

/**
 * Fast, deterministic NLU intent classifier that maps varied sentence structures
 * and synonyms into a structured tool execution plan.
 */
export const classifyNaturalLanguageIntent = (
  query: string,
  documents: KnowledgeDocument[]
): SemanticIntentPlan => {
  const lower = query.toLowerCase();
  const { expandedQuery, expandedTerms } = expandQueryWithSynonyms(query);

  // Navigation intent (strictly matches UI tab switching commands)
  let targetTab: NavTab | undefined;
  if (
    /\b(take me to|go to|go back to|switch to|navigate to|bring up the)\b.*\b(dashboard|home|main|analytics|overview|upload|ingest|import|file import|api|setup|settings|model|connection|ollama)\b/i.test(
      lower
    ) ||
    /\b(open|switch|view)\b.*\b(screen|tab|page|view|settings|dashboard|setup)\b/i.test(lower)
  ) {
    targetTab = /\b(upload|ingest|import)\b/i.test(lower)
      ? 'upload'
      : /\b(api|setup|settings|model|connection|ollama)\b/i.test(lower)
        ? 'api'
        : 'home';
  }

  const matchedDoc = documents.find(
    (doc) =>
      lower.includes(doc.name.toLowerCase()) ||
      lower.includes(doc.name.replace(/\.pdf$/i, '').toLowerCase())
  );

  const hasExplicitExportOrTable =
    /\b(table|tabular|grid|sheet|spreadsheet|csv|xlsx|xls|workbook|json|txt|markdown|excel|export|download|downloadable|save as|extract|dump|item list|line items|text report)\b/i.test(
      lower
    );

  const searchFilter =
    !targetTab || hasExplicitExportOrTable
      ? extractProductSearchFilter(query, documents)
      : undefined;

  // Table or file creation intent (recognizes direct requests and natural phrasing, including in multi-action prompts)
  const wantsTableOrFile =
    hasExplicitExportOrTable ||
    (!targetTab &&
      (/\b(give me|show me|create|generate|build|make|prepare|compile|list all|breakdown of|show)\b.*\b(list|items|line items|invoices|purchases|transactions|products|schedule|report|file|rows|records)\b/i.test(
        lower
      ) ||
        (/\b(show me all|list all|find all|give me all)\b/i.test(lower) && Boolean(searchFilter))));

  const fileFormat: 'csv' | 'xlsx' | 'json' | 'txt' | 'md' = /\b(xlsx|xls|excel|workbook|spreadsheet)\b/i.test(
    lower
  )
    ? 'xlsx'
    : /\bjson\b/i.test(lower)
      ? 'json'
      : /\b(txt|text)\b/i.test(lower)
        ? 'txt'
        : /\b(md|markdown)\b/i.test(lower)
          ? 'md'
          : 'csv';

  const wantsRegression =
    /\b(linear regression|regression|ols|ordinary least squares|r-squared|r²|r2)\b/i.test(lower);

  const regressionTargetColumn = /\btotal exc\b/i.test(lower)
    ? 'TOTAL EXC'
    : /\bsgl inc\b|\bunit price\b/i.test(lower)
      ? 'SGL INC'
      : /\bvat\b/i.test(lower)
        ? 'VAT'
        : /\bqty\b|\bquantity\b/i.test(lower)
          ? 'QTY'
          : 'TOTAL INC';

  const wantsForecast =
    /\b(forecast|forecasts|forecasting|predict|prediction|predictions|project|projection|future|upcoming|next month|next quarter|next year|outlook|trajectory|going to cost|will cost|price trend|expected price|will the price)\b/i.test(
      lower
    );

  const wantsClustering =
    /\b(cluster|clusters|clustering|k-means|kmeans|segment|segments|segmentation|group similar|categorize|classify rows|cohort)\b/i.test(
      lower
    );

  const wantsPopular =
    /\b(popular|top|best[- ]?selling|bestseller|most bought|most purchased|frequent|fast[- ]?moving|biggest seller|highest volume)\b/i.test(
      lower
    );

  const wantsSpendProgression =
    /\b(spend progression|monthly spend|monthly cash|weekly spend|daily spend|spend over time|expenditure over time|outflow|cash flow|cash outlay|how much did we spend|total spent|spending trend|spending across different months|compare.*spending)\b/i.test(
      lower
    );

  const wantsRetailMetrics =
    wantsPopular ||
    wantsSpendProgression ||
    /\b(visit|visits|trips|shopping trips|weekday|day of the week|busiest day|spend|spending|expenditure|outlay|revenue|sales|turnover|cost|paid|bill|retail|summary|overview|grand total)\b/i.test(
      lower
    );

  const retailGrouping: 'day' | 'week' | 'month' =
    /\b(week|weekly)\b/i.test(lower) && !/\bday of the week\b/i.test(lower)
      ? 'week'
      : /\b(day|daily)\b/i.test(lower) && !/\bday of the week\b/i.test(lower)
        ? 'day'
        : 'month';

  let tableSource: SemanticIntentPlan['tableSource'] = 'makro_items';
  if (wantsForecast && !matchedDoc) {
    tableSource = 'price_forecasts';
  } else if (wantsPopular && !/\b(all items|makro|invoice)\b/i.test(lower)) {
    tableSource = 'popular_items';
  } else if (wantsSpendProgression && !searchFilter) {
    tableSource = 'spend_progression';
  } else if (/\b(combined|all transactions)\b/i.test(lower) && !/\bmakro\b/i.test(lower)) {
    tableSource = 'combined_retail';
  } else if (matchedDoc) {
    tableSource = 'makro_items';
  }

  return {
    wantsTableOrFile,
    tableSource,
    fileFormat,
    datasetName: matchedDoc?.name,
    searchFilter:
      tableSource === 'popular_items' || tableSource === 'spend_progression'
        ? undefined
        : searchFilter,
    wantsForecast,
    wantsRegression,
    regressionTargetColumn,
    wantsRetailMetrics,
    retailGrouping,
    wantsClustering,
    targetTab,
    expandedQuery,
    expandedTerms,
  };
};

const VALID_TABLE_SOURCES = new Set<SemanticIntentPlan['tableSource']>([
  'makro_items',
  'combined_retail',
  'dataset',
  'popular_items',
  'spend_progression',
  'price_forecasts',
]);

const VALID_FILE_FORMATS = new Set<SemanticIntentPlan['fileFormat']>([
  'csv',
  'xlsx',
  'json',
  'txt',
  'md',
]);

/**
 * Optional LLM-powered semantic query expansion and intent refinement for models
 * without native tool support, merging LLM semantic understanding with the
 * deterministic synonym router without overwriting specific deterministic choices.
 */
export const refineIntentWithLLM = async (
  ollama: Ollama,
  modelName: string,
  query: string,
  basePlan: SemanticIntentPlan
): Promise<SemanticIntentPlan> => {
  try {
    const response = await ollama.chat({
      model: modelName,
      format: 'json',
      options: { temperature: 0 },
      messages: [
        {
          role: 'system',
          content: [
            'You are a semantic intent parser for a retail & financial analytics agent.',
            'Convert the user request into JSON with these fields:',
            '- "wantsTableOrFile": boolean (true if the user asks for a table, list, breakdown, sheet, export, or downloadable file)',
            '- "tableSource": one of "makro_items", "combined_retail", "popular_items", "spend_progression", "price_forecasts"',
            '- "fileFormat": one of "csv", "xlsx", "json", "txt", "md"',
            '- "searchFilter": optional product or category keyword filter (e.g. "whisky", "juice", "hisense") or ""',
            '- "wantsForecast": boolean (true if asking about future prices, predictions, or trends)',
            '- "wantsRetailMetrics": boolean (true if asking about spending, visits, popular items, costs, or totals)',
            '- "wantsClustering": boolean (true if asking to segment, cluster, or group rows)',
            '- "synonyms": array of 3 to 6 domain keywords/synonyms that mean the same thing as the user query',
          ].join('\n'),
        },
        {
          role: 'user',
          content: query,
        },
      ],
    });

    const parsed = JSON.parse(response.message.content) as Partial<{
      wantsTableOrFile: boolean;
      tableSource: SemanticIntentPlan['tableSource'];
      fileFormat: SemanticIntentPlan['fileFormat'];
      searchFilter: string;
      wantsForecast: boolean;
      wantsRetailMetrics: boolean;
      wantsClustering: boolean;
      synonyms: string[];
    }>;

    const extraSynonyms = Array.isArray(parsed.synonyms)
      ? parsed.synonyms.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];
    const mergedTerms = Array.from(new Set([...basePlan.expandedTerms, ...extraSynonyms]));

    const resolvedTableSource =
      basePlan.tableSource !== 'makro_items'
        ? basePlan.tableSource
        : parsed.tableSource && VALID_TABLE_SOURCES.has(parsed.tableSource)
          ? parsed.tableSource
          : basePlan.tableSource;

    const resolvedFileFormat =
      basePlan.fileFormat !== 'csv'
        ? basePlan.fileFormat
        : parsed.fileFormat && VALID_FILE_FORMATS.has(parsed.fileFormat)
          ? parsed.fileFormat
          : basePlan.fileFormat;

    return {
      ...basePlan,
      wantsTableOrFile:
        !basePlan.targetTab && (basePlan.wantsTableOrFile || Boolean(parsed.wantsTableOrFile)),
      tableSource: resolvedTableSource,
      fileFormat: resolvedFileFormat,
      searchFilter:
        basePlan.searchFilter ??
        (typeof parsed.searchFilter === 'string' && parsed.searchFilter.trim()
          ? parsed.searchFilter.trim()
          : undefined),
      wantsForecast: basePlan.wantsForecast || Boolean(parsed.wantsForecast),
      wantsRetailMetrics: basePlan.wantsRetailMetrics || Boolean(parsed.wantsRetailMetrics),
      wantsClustering: basePlan.wantsClustering || Boolean(parsed.wantsClustering),
      expandedTerms: mergedTerms,
      expandedQuery: `${basePlan.expandedQuery} ${extraSynonyms.join(' ')}`.trim(),
    };
  } catch {
    return basePlan;
  }
};
