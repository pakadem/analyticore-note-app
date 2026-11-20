export interface ApiRequestHeader {
  id: string;
  key: string;
  value: string;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  url: string;
  headers: ApiRequestHeader[];
}

export const ENDPOINT_STORAGE_KEY = 'analyticore-api-endpoints';

export const loadApiEndpoints = (): ApiEndpoint[] => {
  try {
    const saved = window.localStorage.getItem(ENDPOINT_STORAGE_KEY);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ApiEndpoint =>
          typeof item === 'object'
          && item !== null
          && typeof item.id === 'string'
          && typeof item.name === 'string'
          && typeof item.url === 'string'
          && Array.isArray(item.headers)
      )
      .map((endpoint) => ({
        ...endpoint,
        headers: endpoint.headers.filter(
          (header): header is ApiRequestHeader =>
            typeof header === 'object'
            && header !== null
            && typeof header.id === 'string'
            && typeof header.key === 'string'
            && typeof header.value === 'string'
        ),
      }));
  } catch {
    return [];
  }
};

const findArrayRecords = (payload: unknown): unknown[] | null => {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== 'object' || payload === null) return null;
  const values = Object.values(payload as Record<string, unknown>);
  const arrayValue = values.find(Array.isArray);
  return Array.isArray(arrayValue) ? arrayValue : null;
};

export const buildExternalApiContext = async (
  endpoints: ApiEndpoint[] = loadApiEndpoints()
): Promise<string> => {
  const configuredEndpoints = endpoints.filter((endpoint) => /^https?:\/\//i.test(endpoint.url.trim()));
  if (configuredEndpoints.length === 0) return '';

  const sections = await Promise.all(
    configuredEndpoints.map(async (endpoint): Promise<string> => {
      try {
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

        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof payload === 'object'
            && payload !== null
            && 'error' in payload
            && typeof payload.error === 'string'
              ? payload.error
              : `HTTP ${response.status}`;
          return `API [${endpoint.name || endpoint.url}] error: ${message}`;
        }

        const records = findArrayRecords(payload);
        if (!records) {
          return `API [${endpoint.name || endpoint.url}] returned a non-list JSON response:\n${JSON.stringify(payload).slice(0, 20_000)}`;
        }

        const limitedRecords = records.slice(0, 100);
        return [
          `API [${endpoint.name || endpoint.url}]`,
          `Source: ${endpoint.url}`,
          `Records: ${records.length}`,
          JSON.stringify(limitedRecords).slice(0, 30_000),
        ].join('\n');
      } catch (error) {
        return `API [${endpoint.name || endpoint.url}] error: ${
          error instanceof Error ? error.message : 'Unable to load API data.'
        }`;
      }
    })
  );

  return [
    'LIVE EXTERNAL API CONTEXT:',
    'The following API data is freshly fetched and may be used as evidence for answers.',
    ...sections,
  ].join('\n\n');
};
