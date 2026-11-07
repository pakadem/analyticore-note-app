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
    'drink',
    'drinks',
    'beverage',
    'beverages',
  ],
  [
    'juice',
    'liquifruit',
    'fruit juice',
    'breakfast punch',
    'brkfast',
    'pnch',
    'soft drink',
    'cold drink',
    'refreshment',
    'beverage',
  ],
  [
    'washing machine',
    'w/machine',
    'washer',
    'laundry',
    'front loader',
    'hisense',
    'appliance',
    'appliances',
    'white goods',
    'silver',
    'silv',
  ],
  [
    'bag',
    'bags',
    'checkout bag',
    'carrier bag',
    'shopping bag',
    'multi use',
    'plastic bag',
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
 * 1. Exact substring
 * 2. Word stem equality
 * 3. Fuzzy edit distance <= 1 (for words >= 5 chars) or <= 2 (for words >= 8 chars)
 */
export const fuzzyTextMatchesTerm = (normalizedTarget: string, term: string): boolean => {
  const cleanTerm = term.toLowerCase().trim();
  if (!cleanTerm) return false;
  if (normalizedTarget.includes(cleanTerm)) return true;

  const termStem = stemWord(cleanTerm);
  if (termStem.length >= 4 && normalizedTarget.includes(termStem)) return true;

  if (cleanTerm.length < 5) return false;
  const maxDist = cleanTerm.length >= 8 ? 2 : 1;
  const targetWords = normalizedTarget.match(/[\p{L}\p{N}]{4,}/gu) ?? [];
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
    const groupMatched = group.some((phrase) => {
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

    if (groupMatched) {
      for (const synonym of group) {
        expandedSet.add(synonym);
        synonym.split(/\s+/).forEach((token) => {
          if (token.length >= 2) expandedSet.add(token);
        });
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
  const filterTokens = cleanFilter.split(/\s+/).filter((t) => t.length >= 2);

  // Check if any expanded synonym group term appears in the row
  const anySynonymMatches = expandedTerms.some(
    (term) => term.length >= 3 && fuzzyTextMatchesTerm(joinedRow, term)
  );
  if (anySynonymMatches) return true;

  return filterTokens.every((token) => fuzzyTextMatchesTerm(joinedRow, token));
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

  // Navigation intent (e.g., "take me to upload", "show the dashboard", "open model settings")
  let targetTab: NavTab | undefined;
  if (
    /\b(open|go to|switch|navigate|take me|show me|view|bring up)\b.*\b(dashboard|home|main|overview|charts|upload|ingest|import|files|documents|api|setup|settings|model|connection|ollama)\b/i.test(
      lower
    )
  ) {
    targetTab = /\b(upload|ingest|import|files|documents)\b/i.test(lower)
      ? 'upload'
      : /\b(api|setup|settings|model|connection|ollama)\b/i.test(lower)
        ? 'api'
        : 'home';
  }

  // Table or file creation intent (recognizes direct requests and natural phrasing)
  const wantsTableOrFile =
    /\b(table|tabular|grid|sheet|spreadsheet|csv|xlsx|xls|workbook|json|txt|markdown|excel|export|download|downloadable|save as|extract|dump|item list|line items)\b/i.test(
      lower
    ) ||
    /\b(give me|show me|create|generate|build|make|prepare|compile|list all|breakdown of)\b.*\b(list|items|invoices|purchases|transactions|products|schedule|report|file|rows|records)\b/i.test(
      lower
    );

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

  const matchedDoc = documents.find(
    (doc) =>
      lower.includes(doc.name.toLowerCase()) ||
      lower.includes(doc.name.replace(/\.pdf$/i, '').toLowerCase())
  );

  const wantsForecast =
    /\b(forecast|forecasts|forecasting|predict|prediction|predictions|project|projection|future|upcoming|next month|next quarter|next year|outlook|trajectory|going to cost|will cost|price trend|expected price)\b/i.test(
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
    /\b(spend progression|monthly spend|weekly spend|daily spend|spend over time|expenditure over time|outflow|cash flow|how much did we spend|total spent|spending trend)\b/i.test(
      lower
    );

  const wantsRetailMetrics =
    wantsPopular ||
    wantsSpendProgression ||
    /\b(visit|visits|trips|weekday|busiest day|spend|spending|expenditure|outlay|revenue|sales|turnover|cost|paid|bill|retail|summary|overview)\b/i.test(
      lower
    );

  const retailGrouping: 'day' | 'week' | 'month' = /\b(week|weekly)\b/i.test(lower)
    ? 'week'
    : /\b(day|daily)\b/i.test(lower)
      ? 'day'
      : 'month';

  let tableSource: SemanticIntentPlan['tableSource'] = 'makro_items';
  if (wantsForecast) {
    tableSource = 'price_forecasts';
  } else if (wantsPopular && !/\b(all items|makro|invoice)\b/i.test(lower)) {
    tableSource = 'popular_items';
  } else if (wantsSpendProgression) {
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
    wantsForecast,
    wantsRetailMetrics,
    retailGrouping,
    wantsClustering,
    targetTab,
    expandedQuery,
    expandedTerms,
  };
};

/**
 * Optional LLM-powered semantic query expansion and intent refinement for models
 * without native tool support, merging LLM semantic understanding with the
 * deterministic synonym router.
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

    return {
      ...basePlan,
      wantsTableOrFile: basePlan.wantsTableOrFile || Boolean(parsed.wantsTableOrFile),
      tableSource: parsed.tableSource ?? basePlan.tableSource,
      fileFormat: parsed.fileFormat ?? basePlan.fileFormat,
      searchFilter:
        typeof parsed.searchFilter === 'string' && parsed.searchFilter.trim()
          ? parsed.searchFilter.trim()
          : basePlan.searchFilter,
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
