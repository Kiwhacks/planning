import type { PersistedData } from './useStore'
import type { TemplateConfig, Week } from '@/domain/types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

const KEY_STORAGE = 'planning-creche-key'

export function getAccessKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE)
  } catch {
    return null
  }
}

export function setAccessKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* ignore */
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getAccessKey()
  let res: Response
  try {
    res = await fetch(`/api/${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(key ? { 'x-app-key': key } : {}), ...(init?.headers ?? {}) },
    })
  } catch (e) {
    throw new ApiError(`Réseau : ${(e as Error).message}`, 0)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) throw new ApiError('API indisponible', res.status === 200 ? 0 : res.status)
  const body = (await res.json()) as T & { error?: string; message?: string }
  if (!res.ok) throw new ApiError(body?.message ?? body?.error ?? `HTTP ${res.status}`, res.status)
  return body
}

export interface RemoteData {
  version: 1
  template: TemplateConfig | null
  weeks: Record<string, Week>
}

export const api = {
  load: () => request<RemoteData>('data'),
  replaceAll: (data: PersistedData) => request<{ ok: true }>('data', { method: 'PUT', body: JSON.stringify(data) }),
  saveTemplate: (t: TemplateConfig) => request<{ ok: true }>('template', { method: 'PUT', body: JSON.stringify(t) }),
  saveWeek: (w: Week) => request<{ ok: true }>(`weeks/${w.id}`, { method: 'PUT', body: JSON.stringify(w) }),
  deleteWeek: (id: string) => request<{ ok: true }>(`weeks/${id}`, { method: 'DELETE' }),
}
