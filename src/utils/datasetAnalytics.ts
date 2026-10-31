import type { KnowledgeDocument } from '../types/app';

export interface TabularDataset {
  id: string;
  name: string;
  headers: string[];
  numericColumns: string[];
  rows: Array<Record<string, string>>;
  sourceCount?: number;
  error?: string;
}

export interface Cluster {
  id: number;
  size: number;
  examples: Array<Record<string, string>>;
}

export interface ClassifiedRow {
  rowNumber: number;
  clusterId: number;
  values: Record<string, string>;
}

export interface ClusterAnalysis {
  clusters: Cluster[];
  classifiedRows: ClassifiedRow[];
  rowsAnalyzed: number;
  rowsExcluded: number;
  columns: string[];
  error?: string;
}

export interface RegressionPoint {
  x: number;
  actual: number | null;
  fitted: number | null;
  forecast: number | null;
}

export interface RegressionAnalysis {
  points: RegressionPoint[];
  predictions: Array<{ x: number; y: number }>;
  rSquared: number;
  rowsAnalyzed: number;
  rowsExcluded: number;
  error?: string;
}

export interface LinearRegressionFit {
  slope: number;
  intercept: number;
  rSquared: number;
}

export const fitLinearRegression = (
  points: Array<{ x: number; y: number }>
): LinearRegressionFit | undefined => {
  if (points.length < 3) return undefined;

  const meanX = points.reduce((total, point) => total + point.x, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.y, 0) / points.length;
  const denominator = points.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
  if (denominator === 0) return undefined;

  const slope =
    points.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const predict = (x: number) => intercept + slope * x;
  const sumSquaredErrors = points.reduce((total, point) => total + (point.y - predict(point.x)) ** 2, 0);
  const totalSumSquares = points.reduce((total, point) => total + (point.y - meanY) ** 2, 0);

  return {
    slope,
    intercept,
    rSquared:
      totalSumSquares === 0 ? (sumSquaredErrors === 0 ? 1 : 0) : 1 - sumSquaredErrors / totalSumSquares,
  };
};

const parseDelimitedRows = (content: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (character === '"') {
      if (inQuotes && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === delimiter && !inQuotes) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('CSV contains an unclosed quoted field.');
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
};

export const getCsvNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const numericPattern = /^\(?\s*-?\s*[$€£]?\s*[\d,]+(?:\.\d+)?%?\s*\)?$/;
  if (!numericPattern.test(trimmed)) return undefined;

  const parenthesized = trimmed.startsWith('(') && trimmed.endsWith(')');
  const parsed = Number(trimmed.replace(/[$€£,%()\s]/g, ''));
  if (!Number.isFinite(parsed)) return undefined;
  return parenthesized ? -Math.abs(parsed) : parsed;
};

const parseRetailInvoice = (content: string): Array<Record<string, string>> => {
  const salesDate = content.match(
    /Sales Date\s*:\s*(?:[A-Za-z]{3,9}\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i
  );
  if (!salesDate) return [];

  const [, day, month, year] = salesDate;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const customerName = content.match(/Customer Name\s*:\s*([^\t\r\n]+)/i)?.[1]?.trim() ?? '';
  const lines = content.split(/\r?\n/);
  const rows: Array<Record<string, string>> = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const quantityLine = lines[index].trim().match(/^(\d+)[\t ]+(\d+)$/);
    if (!quantityLine) continue;

    const fields = lines[index + 1].split('\t').map((field) => field.trim()).filter(Boolean);
    const barcodeAndItem = fields[0]?.match(/^(\d{8,})\s+(.+)$/);
    if (!barcodeAndItem || fields.length < 3) continue;

    const amount = getCsvNumber(fields[fields.length - 1]?.split(/\s+/).pop());
    if (amount === undefined) continue;
    const quantity = Number(quantityLine[1]);

    rows.push({
      visit_date: date,
      customer_id: customerName,
      product: barcodeAndItem[2].trim(),
      quantity: String(quantity),
      total_spend: String(amount),
      unit_price: quantity > 0 ? String(amount / quantity) : '',
    });
  }

  return rows;
};

const detectDelimitedTable = (content: string): { delimiter: string; startLine: number } | undefined => {
  const sourceLines = content.split(/\r?\n/);
  const nonEmptyLineIndexes = sourceLines
    .map((line, index) => line.trim() ? index : -1)
    .filter((index) => index >= 0)
    .slice(0, 30);
  const sampleLines = nonEmptyLineIndexes.map((index) => sourceLines[index]);
  const candidates = ['\t', ',', '|', ';'];

  const detections = candidates.flatMap((delimiter) => {
    const parsedLines = sampleLines.map((line) => parseDelimitedRows(line, delimiter)[0] ?? []);
    const fieldCounts = parsedLines.map((fields) => fields.length);
    const countFrequencies = new Map<number, number>();
    fieldCounts.forEach((count) => {
      if (count > 1) countFrequencies.set(count, (countFrequencies.get(count) ?? 0) + 1);
    });

    return Array.from(countFrequencies, ([columnCount, frequency]) => {
      const startLine = fieldCounts.findIndex((count) => count === columnCount);
      const header = parsedLines[startLine];
      const plausibleHeader = header.every(
        (field) => /[a-z]/i.test(field) && getCsvNumber(field) === undefined
      );
      return { delimiter, startLine, columnCount, frequency, plausibleHeader };
    }).filter(({ frequency, plausibleHeader }) => frequency >= 3 && plausibleHeader);
  });

  const best = detections.sort(
    (left, right) =>
      right.frequency - left.frequency ||
      right.columnCount - left.columnCount ||
      left.startLine - right.startLine
  )[0];

  return best
    ? { delimiter: best.delimiter, startLine: nonEmptyLineIndexes[best.startLine] }
    : undefined;
};

export const getStructuredDatasets = (documents: KnowledgeDocument[]): TabularDataset[] =>
  documents
    .filter((document) => document.status === 'ready')
    .map((document) => {
      try {
        if (document.analyticsError) throw new Error(document.analyticsError);
        const isCsv =
          document.name.toLowerCase().endsWith('.csv') ||
          document.type.toLowerCase().includes('csv');
        const isPdf = document.name.toLowerCase().endsWith('.pdf') ||
          document.type.toLowerCase().includes('pdf');
        const invoiceRows = isPdf ? parseRetailInvoice(document.content) : [];
        if (invoiceRows.length) {
          return {
            id: document.id,
            name: document.name,
            headers: ['visit_date', 'customer_id', 'product', 'quantity', 'total_spend', 'unit_price'],
            rows: invoiceRows,
            numericColumns: ['quantity', 'total_spend', 'unit_price'],
          };
        }

        const table = isCsv
          ? { delimiter: ',', startLine: 0 }
          : detectDelimitedTable(document.content);
        if (!table) {
          return {
            id: document.id,
            name: document.name,
            headers: [],
            rows: [],
            numericColumns: [],
            error: 'No structured table was detected. Retail charts need rows with separate date, spend, or item fields.',
          };
        }

        const tableContent = document.content.split(/\r?\n/).slice(table.startLine).join('\n');
        const [headerRow, ...parsedDataRows] = parseDelimitedRows(tableContent, table.delimiter);
        const dataRows = isCsv
          ? parsedDataRows
          : parsedDataRows.filter((values) => values.length === headerRow.length);
        if (!headerRow?.length) throw new Error('The CSV is empty or has no header row.');

        const usedHeaders = new Set<string>();
        const headers = headerRow.map((value, index) => {
          const base = value.trim() || `Column ${index + 1}`;
          let header = base;
          let suffix = 2;
          while (usedHeaders.has(header)) {
            header = `${base} (${suffix})`;
            suffix += 1;
          }
          usedHeaders.add(header);
          return header;
        });

        const rows = dataRows.map((values, rowIndex) => {
          if (values.length > headers.length) {
            throw new Error(`Row ${rowIndex + 2} has more fields than the header.`);
          }
          return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
        });

        if (!rows.length) throw new Error('The CSV has headers but no data rows.');

        const numericColumns = headers.filter(
          (header) => rows.filter((row) => getCsvNumber(row[header]) !== undefined).length >= 3
        );

        return { id: document.id, name: document.name, headers, rows, numericColumns };
      } catch (error) {
        return {
          id: document.id,
          name: document.name,
          headers: [],
          rows: [],
          numericColumns: [],
          error: error instanceof Error ? error.message : 'Unable to analyze this CSV.',
        };
      }
    });

const euclideanDistance = (left: number[], right: number[]): number =>
  Math.sqrt(left.reduce((total, value, index) => total + (value - right[index]) ** 2, 0));

export const classifyRows = (dataset: TabularDataset): ClusterAnalysis => {
  const numericColumns = dataset.numericColumns;
  if (!numericColumns.length) {
    return {
      clusters: [],
      classifiedRows: [],
      rowsAnalyzed: 0,
      rowsExcluded: dataset.rows.length,
      columns: [],
      error: 'At least one numeric column with three or more values is required for clustering.',
    };
  }

  const ranges = numericColumns.map((column) => {
    const values = dataset.rows.map((row) => getCsvNumber(row[column])).filter((value) => value !== undefined);
    return { column, min: Math.min(...values), max: Math.max(...values) };
  });
  const varyingColumns = ranges.filter((range) => range.max > range.min);
  if (!varyingColumns.length) {
    return {
      clusters: [],
      classifiedRows: [],
      rowsAnalyzed: 0,
      rowsExcluded: dataset.rows.length,
      columns: [],
      error: 'The numeric columns have no variation, so rows cannot be separated into clusters.',
    };
  }

  const validRows = dataset.rows.flatMap((row, index) => {
    const parsedValues = varyingColumns.map(({ column }) => getCsvNumber(row[column]));
    if (!parsedValues.every((value): value is number => value !== undefined)) return [];
    return [{
      sourceIndex: index,
      row,
      values: parsedValues.map((value, columnIndex) => {
        const range = varyingColumns[columnIndex];
        return (value - range.min) / (range.max - range.min);
      }),
    }];
  });

  if (validRows.length < 3) {
    return {
      clusters: [],
      classifiedRows: [],
      rowsAnalyzed: validRows.length,
      rowsExcluded: dataset.rows.length - validRows.length,
      columns: varyingColumns.map(({ column }) => column),
      error: 'At least three complete rows are required for clustering.',
    };
  }

  const uniquePoints = Array.from(
    new Map(validRows.map((point) => [point.values.join(','), point.values])).values()
  );
  const clusterCount = Math.min(3, uniquePoints.length);
  if (clusterCount < 2) {
    return {
      clusters: [],
      classifiedRows: [],
      rowsAnalyzed: validRows.length,
      rowsExcluded: dataset.rows.length - validRows.length,
      columns: varyingColumns.map(({ column }) => column),
      error: 'The numeric rows are identical, so there are no distinct clusters to classify.',
    };
  }

  const centroids: number[][] = [[...uniquePoints[0]]];
  while (centroids.length < clusterCount) {
    const next = uniquePoints
      .map((point) => ({
        values: point,
        distance: Math.min(...centroids.map((centroid) => euclideanDistance(point, centroid))),
      }))
      .filter((point) => !centroids.some((centroid) => euclideanDistance(centroid, point.values) === 0))
      .sort((left, right) => right.distance - left.distance)[0];
    centroids.push([...next.values]);
  }

  let assignments = validRows.map(() => -1);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const nextAssignments = validRows.map((point) =>
      centroids.reduce(
        (best, centroid, index) => {
          const distance = euclideanDistance(point.values, centroid);
          return distance < best.distance ? { index, distance } : best;
        },
        { index: 0, distance: Number.POSITIVE_INFINITY }
      ).index
    );

    const unchanged = nextAssignments.every((assignment, index) => assignment === assignments[index]);
    assignments = nextAssignments;
    if (unchanged) break;

    centroids.forEach((centroid, clusterIndex) => {
      const members = validRows.filter((_, index) => assignments[index] === clusterIndex);
      if (!members.length) return;
      centroid.forEach((_, featureIndex) => {
        centroid[featureIndex] =
          members.reduce((total, point) => total + point.values[featureIndex], 0) / members.length;
      });
    });
  }

  const clusters = Array.from({ length: clusterCount }, (_, index) => {
    const members = validRows.filter((_, rowIndex) => assignments[rowIndex] === index);
    return {
      id: index + 1,
      size: members.length,
      examples: members.slice(0, 3).map(({ row }) => row),
    };
  }).filter((cluster) => cluster.size > 0);

  return {
    clusters,
    classifiedRows: validRows.map((point, index) => ({
      rowNumber: point.sourceIndex + 2,
      clusterId: assignments[index] + 1,
      values: point.row,
    })),
    rowsAnalyzed: validRows.length,
    rowsExcluded: dataset.rows.length - validRows.length,
    columns: varyingColumns.map(({ column }) => column),
  };
};

export const predictWithLinearRegression = (
  dataset: TabularDataset,
  targetColumn: string,
  featureColumn: string
): RegressionAnalysis => {
  const points = dataset.rows.flatMap((row, index) => {
    const x = featureColumn === '__row_order__' ? index + 1 : getCsvNumber(row[featureColumn]);
    const y = getCsvNumber(row[targetColumn]);
    return x === undefined || y === undefined ? [] : [{ x, y }];
  });
  const rowsExcluded = dataset.rows.length - points.length;

  if (points.length < 3) {
    return {
      points: [],
      predictions: [],
      rSquared: 0,
      rowsAnalyzed: points.length,
      rowsExcluded,
      error: 'At least three rows with numeric values for both selected fields are required.',
    };
  }

  const fit = fitLinearRegression(points);
  if (!fit) {
    return {
      points: [],
      predictions: [],
      rSquared: 0,
      rowsAnalyzed: points.length,
      rowsExcluded,
      error: 'The selected input feature does not vary, so a regression model cannot be fitted.',
    };
  }

  const predict = (x: number) => fit.intercept + fit.slope * x;

  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const step = featureColumn === '__row_order__' ? 1 : (maxX - minX) / (points.length - 1);
  const predictions = [1, 2, 3].map((horizon) => {
    const x = maxX + step * horizon;
    return { x, y: predict(x) };
  });
  const fittedPoints = [...points].sort((left, right) => left.x - right.x).map((point) => ({
    x: point.x,
    actual: point.y,
    fitted: predict(point.x),
    forecast: null,
  }));
  const forecastPoints = predictions.map((point) => ({
    x: point.x,
    actual: null,
    fitted: null,
    forecast: point.y,
  }));

  return {
    points: [...fittedPoints, ...forecastPoints],
    predictions,
    rSquared: fit.rSquared,
    rowsAnalyzed: points.length,
    rowsExcluded,
  };
};
