/**
 * Shared JSON helper for plugin-owned catalog endpoints.
 *
 * @module @dsh-external/dsh-proxy-monitor/client/models/catalog-request
 */

class CatalogRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogRequestError'
  }
}

/** GET/POST a `{ ok, value }` catalog envelope. */
export async function catalogRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value: unknown = await response.json().catch(() => undefined)
  const envelope = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  if (!response.ok || envelope?.['ok'] === false) {
    const error = envelope?.['error']
    throw new CatalogRequestError(typeof error === 'string' ? error : `HTTP ${String(response.status)}`)
  }
  return (envelope?.['value'] ?? value) as T
}
