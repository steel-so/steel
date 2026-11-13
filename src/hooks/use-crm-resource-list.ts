'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatFieldErrors, readFieldErrors } from '@/src/lib/api-field-errors'

type ApiResponse<T> = {
  success: boolean
  data?: T
  message?: string
}

/**
 * Busca a lista de um recurso (`/api/workspaces/<workspaceId>/<path>`), com
 * refetch manual. `path` é o caminho completo após `/api/workspaces/<id>/`
 * (ex.: `crm/companies`, `whatsapp/conversations`).
 */
export function useResourceList<T>(workspaceId: string, path: string) {
  const [items, setItems] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!workspaceId || !path) return
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/${path}`)
      const json = (await response.json()) as ApiResponse<T[]>
      if (!response.ok || !json.success || !json.data) {
        setError(json?.message ?? 'Não foi possível carregar os dados.')
        return
      }
      setItems(json.data)
    } catch {
      setError('Erro de rede. Tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, path])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { items, isLoading, error, refetch }
}

/**
 * Busca a lista de um recurso do CRM
 * (`/api/workspaces/<workspaceId>/crm/<resource>`), com refetch manual.
 */
export function useCrmResourceList<T>(workspaceId: string, resource: string) {
  return useResourceList<T>(workspaceId, `crm/${resource}`)
}

export type MutationResult<T> = {
  ok: boolean
  data?: T
  /** Mensagem legível (com erros por campo concatenados, quando houver). */
  message?: string
}

function readError(json: unknown): string {
  const data = json as { message?: string; error?: unknown }
  const fieldErrors = readFieldErrors(data?.error)
  if (fieldErrors) return formatFieldErrors(fieldErrors)
  return data?.message ?? 'Não foi possível salvar.'
}

/** Cria um registro (POST). Usado pela linha vazia de criação inline. */
export async function createCrmResource<T>(
  workspaceId: string,
  resource: string,
  payload: Record<string, unknown>,
): Promise<MutationResult<T>> {
  try {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/crm/${resource}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const json = await response.json()
    if (!response.ok || !json.success) {
      return { ok: false, message: readError(json) }
    }
    return { ok: true, data: json.data as T }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}

/** Atualiza um campo (PATCH parcial). Usado pela edição inline (auto-save). */
export async function updateCrmResource<T>(
  workspaceId: string,
  resource: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<MutationResult<T>> {
  try {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/crm/${resource}/${id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    )
    const json = await response.json()
    if (!response.ok || !json.success) {
      return { ok: false, message: readError(json) }
    }
    return { ok: true, data: json.data as T }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}

/** Remove (soft-delete) um registro. */
export async function deleteCrmResource(
  workspaceId: string,
  resource: string,
  id: string,
): Promise<MutationResult<unknown>> {
  try {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/crm/${resource}/${id}`,
      { method: 'DELETE' },
    )
    const json = await response.json()
    if (!response.ok || !json.success) {
      return { ok: false, message: readError(json) }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}

/** Persiste a nova ordem (drag-drop) de um recurso. Best-effort. */
export async function reorderCrmResource(
  workspaceId: string,
  resource: string,
  orderedIds: string[],
): Promise<void> {
  try {
    await fetch(`/api/workspaces/${workspaceId}/crm/${resource}/reorder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    })
  } catch {
    // A ordem local já está aplicada; falha de rede não bloqueia a UI.
  }
}
