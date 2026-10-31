import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TabularDataset } from '../utils/datasetAnalytics';
import {
  getPopularItems,
  getSpendProgression,
  getVisitDays,
  inferRetailColumns,
} from '../utils/retailAnalytics';
import type { TimeGrouping } from '../utils/retailAnalytics';

interface RetailChartsProps {
  dataset: TabularDataset;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '20px',
};

const selectStyle: React.CSSProperties = {
  padding: '7px 9px',
  border: '1px solid #cbd5e1',
  borderRadius: '6px',
  backgroundColor: '#ffffff',
  maxWidth: '100%',
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

const ColumnSelect: React.FC<{
  label: string;
  value: string;
  headers: string[];
  onChange: (value: string) => void;
  optional?: boolean;
}> = ({ label, value, headers, onChange, optional = false }) => (
  <label style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '0.8rem' }}>
    <span>{label}</span>
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={selectStyle}
    >
      <option value="">{optional ? 'None' : 'Select column'}</option>
      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
    </select>
  </label>
);

const RetailCharts: React.FC<RetailChartsProps> = ({ dataset }) => {
  const inferred = useMemo(() => inferRetailColumns(dataset.headers), [dataset.headers]);
  const [dateColumn, setDateColumn] = useState(inferred.date);
  const [amountColumn, setAmountColumn] = useState(inferred.amount);
  const [itemColumn, setItemColumn] = useState(inferred.item);
  const [quantityColumn, setQuantityColumn] = useState(inferred.quantity);
  const [customerColumn, setCustomerColumn] = useState(inferred.customer);
  const [grouping, setGrouping] = useState<TimeGrouping>('day');

  const visits = useMemo(
    () => dateColumn ? getVisitDays(dataset, dateColumn, customerColumn) : undefined,
    [dataset, dateColumn, customerColumn]
  );
  const spending = useMemo(
    () => dateColumn && amountColumn
      ? getSpendProgression(dataset, dateColumn, amountColumn, grouping)
      : undefined,
    [dataset, dateColumn, amountColumn, grouping]
  );
  const popularItems = useMemo(
    () => itemColumn ? getPopularItems(dataset, itemColumn, quantityColumn) : undefined,
    [dataset, itemColumn, quantityColumn]
  );
  const hasSuggestedColumns = inferred.date || inferred.amount || inferred.item;

  if (dataset.error) {
    return (
      <section role="status" style={cardStyle}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{dataset.name}</h2>
        <p style={{ color: '#b45309', fontSize: '0.875rem', marginTop: '8px' }}>{dataset.error}</p>
        <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '6px' }}>
          This uploaded file is included in the dashboard, but its extracted text does not contain a delimited table that can be used to calculate visit, spending, or item charts.
        </p>
      </section>
    );
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Store visits, spending & top items</h2>
        <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>
          Showing combined records from {dataset.sourceCount ?? 1} uploaded file(s).
          {hasSuggestedColumns
            ? ' Columns are detected from the extracted table headers. Adjust them below if needed.'
            : ' Choose the matching columns to build these charts.'}
        </p>
      </div>

      <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <ColumnSelect label="Visit / transaction date" value={dateColumn} headers={dataset.headers} onChange={setDateColumn} />
        <ColumnSelect label="Spend amount" value={amountColumn} headers={dataset.headers} onChange={setAmountColumn} />
        <ColumnSelect label="Item / product" value={itemColumn} headers={dataset.headers} onChange={setItemColumn} />
        <ColumnSelect label="Quantity" value={quantityColumn} headers={dataset.headers} onChange={setQuantityColumn} optional />
        <ColumnSelect label="Customer ID (optional)" value={customerColumn} headers={dataset.headers} onChange={setCustomerColumn} optional />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))', gap: '16px' }}>
        <article style={cardStyle}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 'bold' }}>Store visits by day of week</h3>
          <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '4px 0 12px' }}>
            {customerColumn
              ? 'Counts distinct customer-and-date visits to avoid counting the same basket items repeatedly.'
              : 'Each valid CSV row is counted as one visit.'}
          </p>
          {visits?.points.some((point) => point.visits > 0) ? (
            <>
              <div style={{ width: '100%', height: '280px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={visits.points} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={55} />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? formatNumber(value) : value} />
                    <Bar dataKey="visits" name="Visits" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {visits.skippedRows > 0 && <small style={{ color: '#64748b' }}>{visits.skippedRows} row(s) had an unreadable date and were excluded.</small>}
            </>
          ) : (
            <p role="status" style={{ color: '#b45309', fontSize: '0.85rem' }}>
              {dateColumn ? 'No valid dates were found in the selected column.' : 'Select a date column to show visits.'}
            </p>
          )}
        </article>

        <article style={cardStyle}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 'bold' }}>Spending progression over time</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}>
              Group by
              <select aria-label="Spending time grouping" value={grouping} onChange={(event) => setGrouping(event.target.value as TimeGrouping)} style={selectStyle}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>
          </div>
          <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '4px 0 12px' }}>
            Period spending and running cumulative total; values use the units in your file.
          </p>
          {spending?.points.length ? (
            <>
              <div style={{ width: '100%', height: '280px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={spending.points} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis tickFormatter={formatNumber} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? formatNumber(value) : value} />
                    <Legend />
                    <Bar dataKey="spent" name="Spend this period" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="cumulative" name="Cumulative spend" stroke="#ea580c" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {spending.skippedRows > 0 && <small style={{ color: '#64748b' }}>{spending.skippedRows} row(s) had an invalid date or spend amount and were excluded.</small>}
            </>
          ) : (
            <p role="status" style={{ color: '#b45309', fontSize: '0.85rem' }}>
              {dateColumn && amountColumn ? 'No rows had both a valid date and numeric spend amount.' : 'Select date and spend columns to show progression.'}
            </p>
          )}
        </article>

        <article style={{ ...cardStyle, gridColumn: '1 / -1' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 'bold' }}>Most purchased items</h3>
          <p style={{ color: '#64748b', fontSize: '0.75rem', margin: '4px 0 12px' }}>
            Ranked by {quantityColumn ? `total quantity (${quantityColumn})` : 'number of transaction rows'}.
          </p>
          {popularItems?.points.length ? (
            <>
              <div style={{ width: '100%', height: Math.max(260, popularItems.points.length * 38) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={popularItems.points} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" allowDecimals={!quantityColumn} tickFormatter={formatNumber} />
                    <YAxis type="category" dataKey="item" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => typeof value === 'number' ? formatNumber(value) : value} />
                    <Bar dataKey="purchases" name={quantityColumn ? 'Units purchased' : 'Transactions'} fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {popularItems.skippedRows > 0 && <small style={{ color: '#64748b' }}>{popularItems.skippedRows} row(s) had no item or a non-positive quantity and were excluded.</small>}
            </>
          ) : (
            <p role="status" style={{ color: '#b45309', fontSize: '0.85rem' }}>
              {itemColumn ? 'No item values were found in the selected column.' : 'Select an item/product column to show popular items.'}
            </p>
          )}
        </article>
      </div>
    </section>
  );
};

export default RetailCharts;
