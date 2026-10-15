'use client'

import * as React from 'react'
import type { Row } from './widget-data'

/** Workspace routes answer the rows; the TV link answers `{ rows }`. */
type ApiResponse = {
  success: boolean
  data?: Row[] | { rows?: Row[] }
  message?: string
}

type Entry = { at: number; promise: Promise<Row[]> }

/** Janela em que widgets da mesma fonte compartilham a mesma busca. */
const SHARE_MS = 5_000
const cache = new Map<string, Entry>()

async function load(url: string): Promise<Row[]> {
  const response = await fetch(url)
  const json = (await response.json()) as ApiResponse
  if (!response.ok || !json.success || !json.data) {
    throw new Error(json?.message ?? 'Não foi possível carregar os dados.')
  }
  return Array.isArray(json.data) ? json.data : (json.data.rows ?? [])
}

/** Busca compartilhada: N widgets da mesma fonte = 1 requisição. */
export function fetchDashboardRows(url: string, refreshKey = 0) {
  const key = `${url}#${refreshKey}`
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < SHARE_MS) return hit.promise
  const promise = load(url)
  cache.set(key, { at: now, promise })
  promise.catch(() => cache.delete(key))
  if (cache.size > 50) {
    for (const [k, entry] of cache) {
      if (now - entry.at >= SHARE_MS) cache.delete(k)
    }
  }
  return promise
}

/** Só para testes: esquece as buscas compartilhadas. */
export function clearDashboardRowsCache() {
  cache.clear()
}

/** Widget aberto pelo link público da TV: os dados vêm pelo token. */
export interface TvRowsSource {
  token: string
  widgetId: string
}

/**
 * Linhas de uma fonte (`/api/workspaces/<id>/<path>`) para os widgets. Ao
 * mudar `refreshKey` (auto-refresh do modo TV), rebusca mantendo as linhas
 * anteriores na tela até chegarem as novas. Com `tv`, busca as linhas do
 * widget pelo link da TV (sem dados de contato).
 */
export function useDashboardRows(
  workspaceId: string,
  path: string,
  refreshKey = 0,
  tv?: TvRowsSource,
): { items: Row[]; isLoading: boolean; error: string | null } {
  const [items, setItems] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(Boolean(path))
  const [error, setError] = React.useState<string | null>(null)
  const loadedPath = React.useRef<string | null>(null)

  const tvToken = tv?.token
  const tvWidgetId = tv?.widgetId

  React.useEffect(() => {
    if ((!workspaceId && !tvToken) || !path) {
      setIsLoading(false)
      return
    }
    let active = true
    const url = tvToken
      ? `/api/crm/tv/${tvToken}/widgets/${tvWidgetId}`
      : `/api/workspaces/${workspaceId}/${path}`
    // Troca de fonte limpa a tela; refresh da mesma fonte, não.
    if (loadedPath.current !== url) setIsLoading(true)
    fetchDashboardRows(url, refreshKey)
      .then((rows) => {
        if (!active) return
        loadedPath.current = url
        setItems(rows)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Erro de rede.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [workspaceId, path, refreshKey, tvToken, tvWidgetId])

  return { items, isLoading, error }
}
