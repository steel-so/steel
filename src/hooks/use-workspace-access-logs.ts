import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type {
  WorkspaceAccessLogListDTO,
  WorkspaceAccessOutcomeDTO,
  WorkspaceAccessSurfaceDTO,
} from '@/types/workspace-access-log'
import { ApiError, apiFetch } from './_fetch'

/**
 * Entry log of IP-restricted workspaces (ADR 0053). The same contract is
 * served to the workspace OWNER/ADMIN and to the global admin; only the base
 * path changes (`accessLogBasePath`).
 */

export interface AccessLogFilter {
  from?: string
  to?: string
  outcome?: WorkspaceAccessOutcomeDTO
  surface?: WorkspaceAccessSurfaceDTO
  user?: string
  page?: number
}

export function accessLogBasePath(
  workspaceId: string,
  scope: 'workspace' | 'admin',
): string {
  return scope === 'admin'
    ? `/api/admin/workspaces/${workspaceId}/access-logs`
    : `/api/workspaces/${workspaceId}/access-logs`
}

/** Query string with only the filled fields. */
export function accessLogSearch(filter: AccessLogFilter): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function accessLogExportUrl(
  basePath: string,
  filter: AccessLogFilter,
): string {
  const { page: _page, ...rest } = filter
  return `${basePath}/export${accessLogSearch(rest)}`
}

export function useWorkspaceAccessLogs(
  basePath: string,
  filter: AccessLogFilter,
) {
  return useQuery({
    queryKey: ['workspace-access-logs', basePath, filter],
    queryFn: () =>
      apiFetch<WorkspaceAccessLogListDTO>(
        `${basePath}${accessLogSearch(filter)}`,
        undefined,
        'Erro ao carregar o registro de acessos',
      ),
    placeholderData: keepPreviousData,
  })
}

const FILENAME = /filename="([^"]+)"/

/**
 * Downloads the CSV through `fetch`, so a refusal (range over the cap, IP
 * blocked) shows the server message instead of saving a JSON file.
 */
export async function downloadAccessLogCsv(url: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(
      body?.message ?? 'Erro ao exportar o registro de acessos',
      body?.error?.code ?? null,
      res.status,
      body?.error?.details,
    )
  }
  const blob = await res.blob()
  const name =
    FILENAME.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    'acessos.csv'
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}
