import type { TabularDataset } from './datasetAnalytics';
import { fitLinearRegression, getCsvNumber } from './datasetAnalytics';

export type TimeGrouping = 'day' | 'week' | 'month';

export interface RetailChartColumns {
  date: string;
  amount: string;
  item: string;
  quantity: string;
  customer: string;
}

export interface VisitDay {
  day: string;
  visits: number;
}

export interface SpendPeriod {
  period: string;
  spent: number;
  cumulative: number;
}

export interface PopularItem {
  item: string;
  purchases: number;
}

export interface ProductPriceObservation {
  date: string;
  timestamp: number;
  product: string;
  price: number;
  sourceIds: string[];
}

export interface ProductPriceForecastPoint {
  date: string;
  actual: number | null;
  fitted: number | null;
  forecast: number | null;
}

export interface ProductPriceForecast {
  points: ProductPriceForecastPoint[];
  predictions: Array<{ date: string; price: number }>;
  rSquared: number;
  rowsAnalyzed: number;
  sourceCount: number;
  error?: string;
}

const columnHints = {
  date: ['visit date', 'transaction date', 'purchase date', 'order date', 'sale date', 'date', 'timestamp', 'time'],
  amount: ['total spend', 'total amount', 'amount spent', 'spend', 'total', 'amount', 'revenue', 'sales', 'price', 'cost'],
  item: ['product name', 'item name', 'product', 'item', 'sku', 'description'],
  quantity: ['quantity', 'qty', 'units', 'item count'],
  customer: ['customer id', 'client id', 'customer', 'client', 'member id', 'user id'],
} satisfies Record<keyof RetailChartColumns, string[]>;

const normalizeHeader = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const inferPriceColumn = (headers: string[]): string => {
  const candidates = headers.map((header) => ({
    header,
    normalized: normalizeHeader(header),
  }));
  const hints = [
    'unit price',
    'price per unit',
    'product price',
    'selling price',
    'retail price',
    'price',
  ];

  for (const hint of hints) {
    const exact = candidates.find(({ normalized }) => normalized === hint);
    if (exact) return exact.header;
  }

  for (const hint of hints.slice(0, -1)) {
    const partial = candidates.find(({ normalized }) => normalized.includes(hint));
    if (partial) return partial.header;
  }

  return candidates.find(
    ({ normalized }) =>
      normalized.includes('price') && !/\b(total|extended|amount|spend|revenue|sales)\b/.test(normalized)
  )?.header ?? '';
};

export const inferRetailColumns = (headers: string[]): RetailChartColumns => {
  const infer = (key: keyof RetailChartColumns): string => {
    const candidates = headers.map((header) => ({
      header,
      normalized: normalizeHeader(header),
    }));

    for (const hint of columnHints[key]) {
      const exact = candidates.find(({ normalized }) => normalized === hint);
      if (exact) return exact.header;
    }

    const partial = candidates.find(({ normalized }) =>
      columnHints[key].some((hint) => normalized.includes(hint))
    );
    return partial?.header ?? '';
  };

  return {
    date: infer('date'),
    amount: infer('amount'),
    item: infer('item'),
    quantity: infer('quantity'),
    customer: infer('customer'),
  };
};

export const getProductPriceHistory = (
  datasets: TabularDataset[]
): ProductPriceObservation[] => {
  const observations = new Map<
    string,
    { date: string; timestamp: number; product: string; total: number; count: number; sources: Set<string> }
  >();

  datasets.forEach((dataset) => {
    if (dataset.error) return;
    const columns = inferRetailColumns(dataset.headers);
    const priceColumn = inferPriceColumn(dataset.headers);
    if (!columns.date || !columns.item) return;

    dataset.rows.forEach((row) => {
      const date = parseDate(row[columns.date]);
      const product = row[columns.item]?.trim();
      let price = priceColumn ? getCsvNumber(row[priceColumn]) : undefined;
      if (price === undefined && columns.amount && columns.amount !== priceColumn && columns.quantity) {
        const lineTotal = getCsvNumber(row[columns.amount]);
        const quantity = getCsvNumber(row[columns.quantity]);
        if (lineTotal !== undefined && quantity !== undefined && quantity > 0) {
          price = lineTotal / quantity;
        }
      }
      if (!date || !product || price === undefined) return;

      const dateKey = getDateKey(date);
      const key = `${product.toLowerCase()}\u0000${dateKey}`;
      const observation = observations.get(key) ?? {
        date: dateKey,
        timestamp: new Date(dateKey).getTime(),
        product,
        total: 0,
        count: 0,
        sources: new Set<string>(),
      };
      observation.total += price;
      observation.count += 1;
      observation.sources.add(dataset.id);
      observations.set(key, observation);
    });
  });

  return Array.from(observations.values())
    .map(({ date, timestamp, product, total, count, sources }) => ({
      date,
      timestamp,
      product,
      price: total / count,
      sourceIds: Array.from(sources),
    }))
    .sort((left, right) => left.timestamp - right.timestamp || left.product.localeCompare(right.product));
};

export const predictProductPrices = (
  history: ProductPriceObservation[],
  selectedProduct: string
): ProductPriceForecast => {
  const observations = history
    .filter((observation) => observation.product.toLowerCase() === selectedProduct.toLowerCase())
    .sort((left, right) => left.timestamp - right.timestamp);
  const points = observations.map((observation) => ({
    x: (observation.timestamp - observations[0].timestamp) / 86_400_000,
    y: observation.price,
  }));
  const fit = fitLinearRegression(points);

  if (observations.length < 3) {
    return {
      points: [],
      predictions: [],
      rSquared: 0,
      rowsAnalyzed: observations.length,
      sourceCount: new Set(observations.flatMap((observation) => observation.sourceIds)).size,
      error: 'At least three dated price observations for this product are required.',
    };
  }

  if (!fit) {
    return {
      points: [],
      predictions: [],
      rSquared: 0,
      rowsAnalyzed: observations.length,
      sourceCount: new Set(observations.flatMap((observation) => observation.sourceIds)).size,
      error: 'Price history does not vary over time, so a regression forecast cannot be fitted.',
    };
  }

  const intervals = observations.slice(1).map(
    (observation, index) => (observation.timestamp - observations[index].timestamp) / 86_400_000
  );
  const sortedIntervals = [...intervals].sort((left, right) => left - right);
  const middle = Math.floor(sortedIntervals.length / 2);
  const medianInterval =
    sortedIntervals.length % 2 === 0
      ? (sortedIntervals[middle - 1] + sortedIntervals[middle]) / 2
      : sortedIntervals[middle];
  const typicalInterval = Math.max(1, Math.round(medianInterval));
  const lastTimestamp = observations[observations.length - 1].timestamp;
  const predict = (x: number) => fit.intercept + fit.slope * x;
  const predictions = [1, 2, 3].map((horizon) => {
    const timestamp = lastTimestamp + typicalInterval * horizon * 86_400_000;
    return {
      date: new Date(timestamp).toISOString().slice(0, 10),
      price: predict(points[points.length - 1].x + typicalInterval * horizon),
    };
  });
  const fittedPoints = observations.map((observation, index) => ({
    date: observation.date,
    actual: observation.price,
    fitted: predict(points[index].x),
    forecast: null,
  }));
  const forecastPoints = predictions.map((prediction) => ({
    date: prediction.date,
    actual: null,
    fitted: null,
    forecast: prediction.price,
  }));

  return {
    points: [...fittedPoints, ...forecastPoints],
    predictions,
    rSquared: fit.rSquared,
    rowsAnalyzed: observations.length,
    sourceCount: new Set(observations.flatMap((observation) => observation.sourceIds)).size,
  };
};

export const combineRetailDatasets = (datasets: TabularDataset[]): TabularDataset | undefined => {
  const rows: Array<Record<string, string>> = [];
  let sourceCount = 0;
  const headers = ['visit_date', 'customer_id', 'product', 'quantity', 'total_spend'];

  datasets.forEach((dataset) => {
    if (dataset.error) return;
    const columns = inferRetailColumns(dataset.headers);
    if (!columns.date && !columns.amount && !columns.item) return;

    sourceCount += 1;
    dataset.rows.forEach((sourceRow) => {
      rows.push({
        visit_date: columns.date ? sourceRow[columns.date] ?? '' : '',
        customer_id: columns.customer ? sourceRow[columns.customer] ?? '' : '',
        product: columns.item ? sourceRow[columns.item] ?? '' : '',
        quantity: columns.quantity ? sourceRow[columns.quantity] ?? '' : '',
        total_spend: columns.amount ? sourceRow[columns.amount] ?? '' : '',
      });
    });
  });

  if (!rows.length) return undefined;

  const numericColumns = ['quantity', 'total_spend'].filter(
    (column) => rows.filter((row) => getCsvNumber(row[column]) !== undefined).length >= 3
  );

  return {
    id: 'all-uploaded-retail-data',
    name: `All uploaded files (${sourceCount})`,
    headers,
    numericColumns,
    rows,
    sourceCount,
  };
};

const parseDate = (value: string | undefined): Date | undefined => {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  const dateOnly = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day)) {
      return date;
    }
    return undefined;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getStartOfWeek = (date: Date): Date => {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
};

export const getVisitDays = (
  dataset: TabularDataset,
  dateColumn: string,
  customerColumn = ''
): { points: VisitDay[]; skippedRows: number } => {
  const counts = new Map<string, number>();
  const seenVisits = new Set<string>();
  let skippedRows = 0;

  dataset.rows.forEach((row) => {
    const date = parseDate(row[dateColumn]);
    if (!date) {
      skippedRows += 1;
      return;
    }

    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getDay()];
    const customer = customerColumn ? row[customerColumn]?.trim() : '';
    const visitKey = customer ? `${getDateKey(date)}\u0000${customer}` : undefined;
    if (visitKey && seenVisits.has(visitKey)) return;
    if (visitKey) seenVisits.add(visitKey);
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  });

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return {
    points: weekdays.map((day) => ({ day, visits: counts.get(day) ?? 0 })),
    skippedRows,
  };
};

const getPeriodKey = (date: Date, grouping: TimeGrouping): { key: string; label: string } => {
  if (grouping === 'month') {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: date.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) };
  }

  if (grouping === 'week') {
    const start = getStartOfWeek(date);
    const key = getDateKey(start);
    return {
      key,
      label: `Week of ${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`,
    };
  }

  const key = getDateKey(date);
  return {
    key,
    label: date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
  };
};

export const getSpendProgression = (
  dataset: TabularDataset,
  dateColumn: string,
  amountColumn: string,
  grouping: TimeGrouping
): { points: SpendPeriod[]; skippedRows: number } => {
  const totals = new Map<string, { label: string; spent: number }>();
  let skippedRows = 0;

  dataset.rows.forEach((row) => {
    const date = parseDate(row[dateColumn]);
    const amount = getCsvNumber(row[amountColumn]);
    if (!date || amount === undefined) {
      skippedRows += 1;
      return;
    }

    const { key, label } = getPeriodKey(date, grouping);
    const period = totals.get(key) ?? { label, spent: 0 };
    period.spent += amount;
    totals.set(key, period);
  });

  let cumulative = 0;
  const points = Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, period]) => {
      cumulative += period.spent;
      return { period: period.label, spent: period.spent, cumulative };
    });

  return { points, skippedRows };
};

export const getPopularItems = (
  dataset: TabularDataset,
  itemColumn: string,
  quantityColumn = ''
): { points: PopularItem[]; skippedRows: number; measure: string } => {
  const counts = new Map<string, number>();
  let skippedRows = 0;

  dataset.rows.forEach((row) => {
    const item = row[itemColumn]?.trim();
    if (!item) {
      skippedRows += 1;
      return;
    }

    const quantity = quantityColumn ? getCsvNumber(row[quantityColumn]) : undefined;
    const count = quantityColumn ? quantity ?? 0 : 1;
    if (count <= 0) {
      skippedRows += 1;
      return;
    }
    counts.set(item, (counts.get(item) ?? 0) + count);
  });

  return {
    points: Array.from(counts, ([item, purchases]) => ({ item, purchases }))
      .sort((left, right) => right.purchases - left.purchases || left.item.localeCompare(right.item))
      .slice(0, 10),
    skippedRows,
    measure: quantityColumn ? `units from ${quantityColumn}` : 'transaction rows',
  };
};
