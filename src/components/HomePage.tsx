import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { KnowledgeDocument } from '../types/app';
import {
  classifyRows,
  getStructuredDatasets,
  predictWithLinearRegression,
} from '../utils/datasetAnalytics';
import type { TabularDataset } from '../utils/datasetAnalytics';
import RetailCharts from './RetailCharts';
import { combineRetailDatasets } from '../utils/retailAnalytics';

interface HomePageProps {
  documents: KnowledgeDocument[];
  onOpenIngestion: () => void;
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  padding: '20px',
};

const clusterColors = ['#2563eb', '#7c3aed', '#059669'];

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

const RegressionForecast: React.FC<{ dataset: TabularDataset }> = ({ dataset }) => {
  const [targetColumn, setTargetColumn] = useState(dataset.numericColumns[0] ?? '');
  const [featureColumn, setFeatureColumn] = useState('__row_order__');
  const analysis = useMemo(
    () => predictWithLinearRegression(dataset, targetColumn, featureColumn),
    [dataset, targetColumn, featureColumn]
  );
  const featureOptions = dataset.numericColumns.filter((column) => column !== targetColumn);

  return (
    <section style={cardStyle}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Regression forecast</h2>
        <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>
          Ordinary least squares linear regression; predictions extrapolate three steps beyond the observed data.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <label style={{ display: 'grid', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
          Predict numeric target
          <select
            aria-label="Regression target column"
            value={targetColumn}
            onChange={(event) => {
              const nextTarget = event.target.value;
              setTargetColumn(nextTarget);
              if (featureColumn === nextTarget) setFeatureColumn('__row_order__');
            }}
            style={{ minWidth: '180px', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            {dataset.numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
          Forecast using
          <select
            aria-label="Regression input feature"
            value={featureColumn}
            onChange={(event) => setFeatureColumn(event.target.value)}
            style={{ minWidth: '180px', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            <option value="__row_order__">Row order</option>
            {featureOptions.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </label>
      </div>

      {analysis.error ? (
        <p role="status" style={{ color: '#b45309', fontSize: '0.875rem' }}>{analysis.error}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '12px', fontSize: '0.8rem', color: '#475569' }}>
            <span>Training rows: <strong>{analysis.rowsAnalyzed}</strong></span>
            <span>R²: <strong>{formatNumber(analysis.rSquared)}</strong></span>
            {analysis.rowsExcluded > 0 && <span>Rows skipped: <strong>{analysis.rowsExcluded}</strong></span>}
          </div>
          <div style={{ width: '100%', height: '280px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analysis.points} margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={{ fontSize: 12 }} />
                <YAxis dataKey="actual" type="number" domain={['auto', 'auto']} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => typeof value === 'number' ? formatNumber(value) : value} />
                <Legend />
                <Line type="linear" dataKey="actual" name="Observed" stroke="#2563eb" dot={{ r: 3 }} connectNulls={false} />
                <Line type="linear" dataKey="fitted" name="Regression fit" stroke="#7c3aed" dot={false} connectNulls={false} />
                <Line type="linear" dataKey="forecast" name="Forecast" stroke="#ea580c" strokeDasharray="5 4" dot={{ r: 4 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 'bold', margin: '12px 0 8px' }}>Next three predictions</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {analysis.predictions.map((prediction, index) => (
              <div key={index} style={{ backgroundColor: '#fff7ed', borderRadius: '8px', padding: '10px 12px', fontSize: '0.8rem' }}>
                <div style={{ color: '#9a3412' }}>Step {index + 1} · {formatNumber(prediction.x)}</div>
                <strong>{formatNumber(prediction.y)} {targetColumn}</strong>
              </div>
            ))}
          </div>
          <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '12px' }}>
            Forecasts extend a straight-line trend and are not confidence intervals. Use domain knowledge before acting on them.
          </p>
        </>
      )}
    </section>
  );
};

const DatasetAnalysis: React.FC<{ dataset: TabularDataset }> = ({ dataset }) => {
  const clusters = useMemo(() => classifyRows(dataset), [dataset]);

  if (dataset.error) {
    return <p role="status" style={{ ...cardStyle, color: '#b45309' }}>{dataset.name}: {dataset.error}</p>;
  }

  if (!dataset.numericColumns.length) {
    return (
      <p role="status" style={{ ...cardStyle, color: '#64748b' }}>
        {dataset.name} has no numeric fields suitable for clustering or regression.
      </p>
    );
  }

  return (
    <>
      <section style={cardStyle}>
        <div style={{ marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Automatic row classification</h2>
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>
            K-means clustering (k = up to 3) on normalized numeric columns: {clusters.columns.join(', ') || '—'}.
          </p>
        </div>
        {clusters.error ? (
          <p role="status" style={{ color: '#b45309', fontSize: '0.875rem' }}>{clusters.error}</p>
        ) : (
          <>
            <p style={{ color: '#475569', fontSize: '0.8rem', marginBottom: '12px' }}>
              Classified {clusters.rowsAnalyzed} rows
              {clusters.rowsExcluded > 0 ? `; skipped ${clusters.rowsExcluded} rows with missing or non-numeric values.` : '.'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              {clusters.clusters.map((cluster) => (
                <article key={cluster.id} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ color: clusterColors[(cluster.id - 1) % clusterColors.length] }}>Cluster {cluster.id}</strong>
                    <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                      {cluster.size} rows ({formatNumber((cluster.size / clusters.rowsAnalyzed) * 100)}%)
                    </span>
                  </div>
                  <div style={{ height: '6px', backgroundColor: '#e2e8f0', borderRadius: '99px', margin: '10px 0' }}>
                    <div style={{ height: '100%', width: `${(cluster.size / clusters.rowsAnalyzed) * 100}%`, backgroundColor: clusterColors[(cluster.id - 1) % clusterColors.length], borderRadius: '99px' }} />
                  </div>
                  <p style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: '6px' }}>Example records</p>
                  {cluster.examples.map((row, rowIndex) => (
                    <p key={rowIndex} style={{ color: '#334155', fontSize: '0.75rem', overflowWrap: 'anywhere', marginTop: '4px' }}>
                      {clusters.columns.slice(0, 3).map((column) => `${column}: ${row[column]}`).join(' · ')}
                    </p>
                  ))}
                </article>
              ))}
            </div>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 'bold', margin: '18px 0 8px' }}>
              Row assignments
            </h3>
            <div style={{ overflow: 'auto', maxHeight: '360px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, backgroundColor: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '9px' }}>CSV row</th>
                    <th style={{ padding: '9px' }}>Cluster</th>
                    {clusters.columns.slice(0, 5).map((column) => (
                      <th key={column} style={{ padding: '9px' }}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clusters.classifiedRows.map((row) => (
                    <tr key={row.rowNumber} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '9px' }}>{row.rowNumber}</td>
                      <td style={{ padding: '9px', fontWeight: 600, color: clusterColors[(row.clusterId - 1) % clusterColors.length] }}>
                        Cluster {row.clusterId}
                      </td>
                      {clusters.columns.slice(0, 5).map((column) => (
                        <td key={column} style={{ padding: '9px' }}>{row.values[column]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {clusters.columns.length > 5 && (
              <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '6px' }}>
                Clustering uses all {clusters.columns.length} numeric fields; the table shows the first five.
              </p>
            )}
          </>
        )}
      </section>

      {dataset.numericColumns.length >= 1 && <RegressionForecast key={dataset.id} dataset={dataset} />}
    </>
  );
};

export const HomePage: React.FC<HomePageProps> = ({ documents, onOpenIngestion }) => {
  const datasets = useMemo(() => getStructuredDatasets(documents), [documents]);
  const combinedRetailDataset = useMemo(() => combineRetailDatasets(datasets), [datasets]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) ?? datasets[0];
  const readyDocuments = documents.filter((document) => document.status === 'ready');
  const tabularDatasets = datasets.filter((dataset) => !dataset.error);
  const totalRows = tabularDatasets.reduce((total, dataset) => total + dataset.rows.length, 0);
  const totalNumericColumns = tabularDatasets.reduce((total, dataset) => total + dataset.numericColumns.length, 0);
  const metrics = [
    { title: 'Uploaded files', value: documents.length, description: `${readyDocuments.length} ready across supported file types`, color: '#2563eb' },
    { title: 'Structured tables', value: tabularDatasets.length, description: 'Ready files with detected table data', color: '#7c3aed' },
    { title: 'Data rows', value: totalRows.toLocaleString(), description: 'Rows available for charting and models', color: '#059669' },
    { title: 'Numeric fields', value: totalNumericColumns, description: 'Fields available for models', color: '#d97706' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>Dashboard & Data Analytics</h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Live analysis of uploaded documents, including structured tables extracted from CSV, TXT, and PDF files.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px' }}>
        {metrics.map((metric) => (
          <article key={metric.title} style={{ ...cardStyle, padding: '18px' }}>
            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>{metric.title}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'bold', margin: '8px 0', color: metric.color }}>{metric.value}</div>
            <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{metric.description}</div>
          </article>
        ))}
      </div>

      {combinedRetailDataset && <RetailCharts dataset={combinedRetailDataset} />}

      {datasets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <label htmlFor="analytics-dataset" style={{ fontSize: '0.875rem', fontWeight: 600 }}>Analyze dataset for ML</label>
          <select
            id="analytics-dataset"
            value={selectedDataset?.id ?? ''}
            onChange={(event) => setSelectedDatasetId(event.target.value)}
            style={{ minWidth: '220px', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
          >
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>{dataset.name}{dataset.error ? ' (no table detected)' : ''}</option>
            ))}
          </select>
        </div>
      )}

      {selectedDataset ? (
        <DatasetAnalysis key={selectedDataset.id} dataset={selectedDataset} />
      ) : (
        <section style={{ ...cardStyle, textAlign: 'center', padding: '32px' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>Upload a structured dataset to begin</h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '8px 0 16px' }}>
            Upload a CSV, TXT, or PDF that contains a delimited table. Narrative-only documents remain available to the assistant but cannot provide transaction chart data.
          </p>
          <button
            onClick={onOpenIngestion}
            style={{ padding: '10px 16px', backgroundColor: '#0284c7', color: '#ffffff', border: 0, borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
          >
            Go to Data Ingestion
          </button>
        </section>
      )}
    </div>
  );
};

export default HomePage;
