import React from 'react';
import { ApiConfig } from '../types/app';

interface ApiPageProps {
  config: ApiConfig;
  canEdit: boolean;
  onUpdateConfig: (config: ApiConfig) => void;
}

interface ApiEndpoint {
  id: string;
  name: string;
  url: string;
  headers: ApiRequestHeader[];
}

interface ApiRequestHeader {
  id: string;
  key: string;
  value: string;
}

interface ApiPreview {
  endpointId: string;
  name: string;
  url: string;
  rows: Record<string, unknown>[];
  total: number;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

const ENDPOINT_STORAGE_KEY = 'analyticore-api-endpoints';

const DEFAULT_ENDPOINTS: ApiEndpoint[] = [
  { id: 'dummy-products', name: 'Products', url: 'https://dummyjson.com/Products', headers: [] },
  { id: 'dummy-carts', name: 'Carts', url: 'https://dummyjson.com/Carts', headers: [] },
  { id: 'dummy-users', name: 'Users', url: 'https://dummyjson.com/Users', headers: [] },
];

const loadEndpoints = (): ApiEndpoint[] => {
  try {
    const saved = window.localStorage.getItem(ENDPOINT_STORAGE_KEY);
    if (!saved) return DEFAULT_ENDPOINTS;
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_ENDPOINTS;
    const valid = parsed.filter(
      (item): item is ApiEndpoint =>
        typeof item === 'object'
        && item !== null
        && typeof item.id === 'string'
        && typeof item.name === 'string'
        && typeof item.url === 'string'
        && (item.headers === undefined || Array.isArray(item.headers))
    );
    return valid.length > 0
      ? valid.map((endpoint) => ({
          ...endpoint,
          headers: Array.isArray(endpoint.headers)
            ? endpoint.headers.filter(
                (header): header is ApiRequestHeader =>
                  typeof header === 'object'
                  && header !== null
                  && typeof header.id === 'string'
                  && typeof header.key === 'string'
                  && typeof header.value === 'string'
              )
            : [],
        }))
      : DEFAULT_ENDPOINTS;
  } catch {
    return DEFAULT_ENDPOINTS;
  }
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return `${value.length} items`;
    return JSON.stringify(value);
  }
  return String(value);
};

export const ApiConnectionPage: React.FC<ApiPageProps> = ({ config, canEdit, onUpdateConfig }) => {
  const [endpoints, setEndpoints] = React.useState<ApiEndpoint[]>(loadEndpoints);
  const [preview, setPreview] = React.useState<ApiPreview | null>(null);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    window.localStorage.setItem(ENDPOINT_STORAGE_KEY, JSON.stringify(endpoints));
  }, [endpoints]);

  const closePreview = React.useCallback(() => {
    setPreview(null);
    setSearch('');
    setPage(1);
  }, []);

  React.useEffect(() => {
    if (!preview) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preview, closePreview]);

  const updateEndpoint = (id: string, field: 'name' | 'url', value: string) => {
    if (!canEdit) return;
    setEndpoints((current) =>
      current.map((endpoint) => endpoint.id === id ? { ...endpoint, [field]: value } : endpoint)
    );
  };

  const addEndpoint = () => {
    if (!canEdit) return;
    setEndpoints((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `API ${current.length + 1}`,
        url: 'https://',
        headers: [],
      },
    ]);
  };

  const addHeader = (endpointId: string) => {
    if (!canEdit) return;
    setEndpoints((current) =>
      current.map((endpoint) =>
        endpoint.id === endpointId
          ? {
              ...endpoint,
              headers: [
                ...endpoint.headers,
                { id: crypto.randomUUID(), key: 'Authorization', value: '' },
              ],
            }
          : endpoint
      )
    );
  };

  const updateHeader = (
    endpointId: string,
    headerId: string,
    field: 'key' | 'value',
    value: string
  ) => {
    if (!canEdit) return;
    setEndpoints((current) =>
      current.map((endpoint) =>
        endpoint.id === endpointId
          ? {
              ...endpoint,
              headers: endpoint.headers.map((header) =>
                header.id === headerId ? { ...header, [field]: value } : header
              ),
            }
          : endpoint
      )
    );
  };

  const removeHeader = (endpointId: string, headerId: string) => {
    if (!canEdit) return;
    setEndpoints((current) =>
      current.map((endpoint) =>
        endpoint.id === endpointId
          ? {
              ...endpoint,
              headers: endpoint.headers.filter((header) => header.id !== headerId),
            }
          : endpoint
      )
    );
  };

  const removeEndpoint = (id: string) => {
    if (!canEdit) return;
    setEndpoints((current) => current.filter((endpoint) => endpoint.id !== id));
    if (preview?.endpointId === id) closePreview();
  };

  const openEndpoint = async (endpoint: ApiEndpoint) => {
    setSearch('');
    setPage(1);
    setPreview({
      endpointId: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      rows: [],
      total: 0,
      loaded: false,
      loading: true,
      error: null,
    });

    try {
      if (!/^https?:\/\//i.test(endpoint.url.trim())) {
        throw new Error('Enter a valid HTTP or HTTPS API URL.');
      }
      const headers = endpoint.headers.reduce<Record<string, string>>((result, header) => {
        if (header.key.trim()) result[header.key.trim()] = header.value;
        return result;
      }, {});
      const response = await fetch('/api/external-api', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: endpoint.url.trim(), headers }),
      });
      if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}.`);

      const payload: unknown = await response.json();
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('The API returned an unexpected response.');
      }

      const data = payload as Record<string, unknown>;
      const arrayValue = Object.values(data).find(Array.isArray);
      if (!Array.isArray(arrayValue)) {
        throw new Error('The API response does not contain a list of records.');
      }

      const rows = arrayValue.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null && !Array.isArray(row)
      );
      const total = typeof data.total === 'number' ? data.total : rows.length;
      setPreview({
        endpointId: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        rows,
        total,
        loaded: true,
        loading: false,
        error: null,
      });
    } catch (error) {
      setPreview({
        endpointId: endpoint.id,
        name: endpoint.name,
        url: endpoint.url,
        rows: [],
        total: 0,
        loaded: true,
        loading: false,
        error: error instanceof Error ? error.message : 'Unable to load API data.',
      });
    }
  };

  const filteredRows = preview
    ? preview.rows.filter((row) =>
        Object.values(row).some((value) =>
          displayValue(value).toLowerCase().includes(search.toLowerCase())
        )
      )
    : [];
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const columns = preview
    ? Array.from(
        visibleRows.reduce((set, row) => {
          Object.keys(row).slice(0, 8).forEach((key) => set.add(key));
          return set;
        }, new Set<string>())
      )
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '980px' }}>
      <div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold' }}>External API Setup</h1>
        <p style={{ color: '#64748b', fontSize: '0.875rem', marginTop: '4px' }}>
          Configure external API connections.
        </p>
      </div>

      {!canEdit && (
        <div
          role="status"
          style={{
            padding: '14px 16px',
            borderRadius: '10px',
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#334155',
            fontSize: '0.85rem',
          }}
        >
          <strong>View-only mode:</strong> Modifying settings requires a <strong>Writer</strong> or <strong>Admin</strong> role.
        </div>
      )}

      <section
        aria-labelledby="external-api-heading"
        style={{ backgroundColor: '#ffffff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
          <div>
            <h2 id="external-api-heading" style={{ margin: 0, fontSize: '1.1rem' }}>External API Connections</h2>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.875rem' }}>Edit endpoints or add a new API connection.</p>
          </div>
          {canEdit && (
            <button type="button" onClick={addEndpoint} style={{ border: 'none', borderRadius: '7px', backgroundColor: '#2563eb', color: '#ffffff', padding: '9px 13px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Add API
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {endpoints.map((endpoint) => (
            <div key={endpoint.id} style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '9px', backgroundColor: '#f8fafc' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 180px) minmax(220px, 1fr) auto auto', gap: '10px', alignItems: 'end' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', marginBottom: '5px' }}>API Name</label>
                  <input type="text" disabled={!canEdit} value={endpoint.name} onChange={(e) => updateEndpoint(endpoint.id, 'name', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: canEdit ? '#ffffff' : '#f1f5f9' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', marginBottom: '5px' }}>Endpoint URL</label>
                  <input type="url" disabled={!canEdit} value={endpoint.url} onChange={(e) => updateEndpoint(endpoint.id, 'url', e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '9px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: canEdit ? '#ffffff' : '#f1f5f9' }} />
                </div>
                <button type="button" onClick={() => void openEndpoint(endpoint)} style={{ height: '38px', border: '1px solid #2563eb', borderRadius: '6px', backgroundColor: '#ffffff', color: '#1d4ed8', padding: '0 12px', fontWeight: '600', cursor: 'pointer' }}>
                  View data
                </button>
                {canEdit && (
                  <button type="button" onClick={() => removeEndpoint(endpoint.id)} aria-label={`Remove ${endpoint.name}`} style={{ height: '38px', border: '1px solid #fca5a5', borderRadius: '6px', backgroundColor: '#fff1f2', color: '#991b1b', padding: '0 10px', cursor: 'pointer' }}>
                    Remove
                  </button>
                )}
              </div>

              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: '600' }}>Request Headers</span>
                    <span style={{ marginLeft: '8px', color: '#64748b', fontSize: '0.7rem' }}>For example: Authorization / Bearer token</span>
                  </div>
                  {canEdit && (
                    <button type="button" onClick={() => addHeader(endpoint.id)} style={{ border: '1px solid #cbd5e1', borderRadius: '6px', backgroundColor: '#ffffff', color: '#334155', padding: '6px 9px', cursor: 'pointer', fontSize: '0.75rem' }}>
                      + Add Header
                    </button>
                  )}
                </div>

                {endpoint.headers.length === 0 ? (
                  <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.75rem' }}>No custom headers configured.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {endpoint.headers.map((header) => (
                      <div key={header.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) minmax(220px, 1fr) auto', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="text"
                          disabled={!canEdit}
                          value={header.key}
                          onChange={(event) => updateHeader(endpoint.id, header.id, 'key', event.target.value)}
                          placeholder="Header name"
                          style={{ width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: canEdit ? '#ffffff' : '#f1f5f9' }}
                        />
                        <input
                          type={header.key.toLowerCase() === 'authorization' ? 'password' : 'text'}
                          disabled={!canEdit}
                          value={header.value}
                          onChange={(event) => updateHeader(endpoint.id, header.id, 'value', event.target.value)}
                          placeholder={header.key.toLowerCase() === 'authorization' ? 'Bearer token' : 'Header value'}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: canEdit ? '#ffffff' : '#f1f5f9' }}
                        />
                        {canEdit && (
                          <button type="button" onClick={() => removeHeader(endpoint.id, header.id)} aria-label={`Remove ${header.key || 'header'}`} style={{ border: 'none', backgroundColor: 'transparent', color: '#991b1b', cursor: 'pointer', padding: '8px' }}>
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {preview && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="api-modal-title" style={{ width: 'min(1100px, 96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', borderRadius: '14px', boxShadow: '0 24px 60px rgba(15,23,42,0.35)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', padding: '18px 20px', borderBottom: '1px solid #e2e8f0' }}>
              <div>
                <h2 id="api-modal-title" style={{ margin: 0, fontSize: '1.25rem' }}>{preview.name || 'API'} data</h2>
                <a href={preview.url} target="_blank" rel="noreferrer" style={{ color: '#64748b', fontSize: '0.75rem' }}>{preview.url}</a>
              </div>
              <button type="button" onClick={closePreview} aria-label="Close" style={{ border: 'none', background: '#f1f5f9', borderRadius: '7px', width: '36px', height: '36px', cursor: 'pointer', fontSize: '1.25rem' }}>×</button>
            </div>

            {preview.loaded && !preview.error && (
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0' }}>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                  placeholder={`Search ${preview.name.toLowerCase()}...`}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: '7px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
                />
              </div>
            )}

            <div style={{ overflow: 'auto', flex: 1, minHeight: '260px' }}>
              {preview.loading ? (
                <div style={{ padding: '32px', color: '#64748b', textAlign: 'center' }}>Loading API data...</div>
              ) : preview.error ? (
                <div style={{ padding: '32px', color: '#991b1b', textAlign: 'center' }}>
                  <div style={{ marginBottom: '12px' }}>{preview.error}</div>
                  <button type="button" onClick={() => {
                    const endpoint = endpoints.find((item) => item.id === preview.endpointId);
                    if (endpoint) void openEndpoint(endpoint);
                  }}>Retry</button>
                </div>
              ) : (
                <>
                  {visibleRows.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr>
                          {columns.map((column) => (
                            <th key={column} style={{ position: 'sticky', top: 0, zIndex: 1, textAlign: 'left', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '10px 12px', whiteSpace: 'nowrap' }}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row, index) => (
                          <tr key={String(row.id ?? index)}>
                            {columns.map((column) => (
                              <td key={column} title={displayValue(row[column])} style={{ borderBottom: '1px solid #f1f5f9', padding: '10px 12px', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {displayValue(row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '32px', color: '#64748b', textAlign: 'center' }}>No matching records found.</div>
                  )}
                </>
              )}
            </div>

            {preview.loaded && !preview.error && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid #e2e8f0', color: '#64748b', fontSize: '0.8rem' }}>
                <span>{filteredRows.length} of {preview.total} records</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
                  <span>Page {safePage} of {pageCount}</span>
                  <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiConnectionPage;
