/**
 * Client MCP Apps minimal (JSON-RPC 2.0 via postMessage avec l'hôte), compatible avec le protocole
 * ext-apps 2026-01-26. Évite d'embarquer le SDK complet (~750 ko) dans la vue.
 */

export interface ToolResultLike {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}

export interface HostContextLike {
  theme?: 'light' | 'dark'
  locale?: string
  displayMode?: string
  [key: string]: unknown
}

interface InitializeResult {
  protocolVersion: string
  hostInfo?: { name: string; version: string }
  hostCapabilities?: Record<string, unknown>
  hostContext?: HostContextLike
}

type JsonRpcId = number | string

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export const PROTOCOL_VERSION = '2026-01-26'

export class MiniApp {
  ontoolresult?: (result: ToolResultLike) => void
  ontoolinput?: (params: { arguments?: Record<string, unknown> }) => void
  onhostcontextchanged?: (ctx: HostContextLike) => void
  hostContext: HostContextLike | undefined

  private nextId = 1
  private pending = new Map<JsonRpcId, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private initialized = false
  private target: Window

  private appInfo: { name: string; version: string }

  constructor(appInfo: { name: string; version: string }) {
    this.appInfo = appInfo
    this.target = window.parent
    window.addEventListener('message', (ev: MessageEvent) => {
      const msg = ev.data as JsonRpcMessage
      if (!msg || msg.jsonrpc !== '2.0') return
      this.handle(msg)
    })
  }

  private post(msg: JsonRpcMessage) {
    this.target.postMessage(msg, '*')
  }

  private request<T>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.post({ jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(method: string, params?: unknown) {
    this.post({ jsonrpc: '2.0', method, params })
  }

  private handle(msg: JsonRpcMessage) {
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
      return
    }
    if (msg.method === undefined) return
    const params = (msg.params ?? {}) as Record<string, unknown>
    switch (msg.method) {
      case 'ping':
        if (msg.id !== undefined) this.post({ jsonrpc: '2.0', id: msg.id, result: {} })
        break
      case 'ui/notifications/tool-result':
        this.ontoolresult?.(params as ToolResultLike)
        break
      case 'ui/notifications/tool-input':
        this.ontoolinput?.(params as { arguments?: Record<string, unknown> })
        break
      case 'ui/notifications/host-context-changed':
        this.hostContext = { ...this.hostContext, ...(params as HostContextLike) }
        this.onhostcontextchanged?.(params as HostContextLike)
        break
      case 'ui/resource-teardown':
        if (msg.id !== undefined) this.post({ jsonrpc: '2.0', id: msg.id, result: {} })
        break
      default:
        if (msg.id !== undefined) this.post({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Méthode non prise en charge : ${msg.method}` } })
    }
  }

  async connect(): Promise<InitializeResult> {
    const result = await this.request<InitializeResult>('ui/initialize', {
      appInfo: this.appInfo,
      appCapabilities: {},
      protocolVersion: PROTOCOL_VERSION,
    })
    this.hostContext = result.hostContext
    this.notify('ui/notifications/initialized')
    this.initialized = true
    this.setupAutoResize()
    return result
  }

  openLink(params: { url: string }): Promise<unknown> {
    if (!this.initialized) return Promise.reject(new Error('non initialisé'))
    return this.request('ui/open-link', params)
  }

  private setupAutoResize() {
    let scheduled = false
    let lastW = 0
    let lastH = 0
    const measure = () => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        const el = document.documentElement
        const prev = el.style.height
        el.style.height = 'max-content'
        const h = Math.ceil(el.getBoundingClientRect().height)
        el.style.height = prev
        const w = Math.ceil(window.innerWidth)
        if (w !== lastW || h !== lastH) {
          lastW = w
          lastH = h
          this.notify('ui/notifications/size-changed', { width: w, height: h })
        }
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.documentElement)
    ro.observe(document.body)
  }
}
