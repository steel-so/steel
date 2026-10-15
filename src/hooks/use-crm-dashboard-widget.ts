'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CreateCrmDashboardWidgetDTO,
  UpdateCrmDashboardWidgetDTO,
} from '@/src/schemas/crm-dashboard.schema'
import type { CrmDashboardWidgetDTO } from '@/types/crm-dashboard'

type ApiResponse<T> = { success: boolean; data?: T; message?: string }
export type MutationResult<T> = { ok: boolean; data?: T; message?: string }

function base(
  workspaceId: string,
  dashboardId: string,
  basePath: string,
): string {
  return `/api/workspaces/${workspaceId}/${basePath}/dashboards/${dashboardId}/widgets`
}

/** Lista os widgets de um dashboard, com refetch manual. */
export function useCrmDashboardWidgets(
  workspaceId: string,
  dashboardId: string,
  basePath = 'crm',
) {
  const [widgets, setWidgets] = useState<CrmDashboardWidgetDTO[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(base(workspaceId, dashboardId, basePath))
      const json = (await res.json()) as ApiResponse<CrmDashboardWidgetDTO[]>
      if (!res.ok || !json.success || !json.data) {
        setError(json?.message ?? 'Não foi possível carregar os widgets.')
        return
      }
      setWidgets(json.data)
    } catch {
      setError('Erro de rede. Tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, dashboardId, basePath])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { widgets, setWidgets, isLoading, error, refetch }
}

export async function createCrmDashboardWidget(
  workspaceId: string,
  dashboardId: string,
  payload: CreateCrmDashboardWidgetDTO,
  basePath = 'crm',
): Promise<MutationResult<CrmDashboardWidgetDTO>> {
  try {
    const res = await fetch(base(workspaceId, dashboardId, basePath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json()
    if (!res.ok || !json.success) {
      return { ok: false, message: json?.message ?? 'Não foi possível criar.' }
    }
    return { ok: true, data: json.data as CrmDashboardWidgetDTO }
  } catch {
    return { ok: false, message: 'Erro de rede.' }
  }
}

export async function updateCrmDashboardWidget(
  workspaceId: string,
  dashboardId: string,
  widgetId: string,
  patch: UpdateCrmDashboardWidgetDTO,
  basePath = 'crm',
): Promise<MutationResult<CrmDashboardWidgetDTO>> {
  try {
    const res = await fetch(
      `${base(workspaceId, dashboardId, basePath)}/${widgetId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    )
    const json = await res.json()
    if (!res.ok || !json.success) {
      return { ok: false, message: json?.message ?? 'Não foi possível salvar.' }
    }
    return { ok: true, data: json.data as CrmDashboardWidgetDTO }
  } catch {
    return { ok: false, message: 'Erro de rede.' }
  }
}

export async function deleteCrmDashboardWidget(
  workspaceId: string,
  dashboardId: string,
  widgetId: string,
  basePath = 'crm',
): Promise<MutationResult<unknown>> {
  try {
    const res = await fetch(
      `${base(workspaceId, dashboardId, basePath)}/${widgetId}`,
      { method: 'DELETE' },
    )
    const json = await res.json()
    if (!res.ok || !json.success) {
      return {
        ok: false,
        message: json?.message ?? 'Não foi possível remover.',
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Erro de rede.' }
  }
}

/** Persiste posições/tamanhos após drag/resize. Best-effort. */
export async function applyCrmDashboardWidgetLayout(
  workspaceId: string,
  dashboardId: string,
  items: {
    id: string
    x: number
    y: number
    w: number
    h: number
    page?: number
  }[],
  basePath = 'crm',
): Promise<void> {
  try {
    await fetch(`${base(workspaceId, dashboardId, basePath)}/layout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
  } catch {
    // Layout local já aplicado; falha de rede não bloqueia a UI.
  }
}
