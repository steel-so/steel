'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CrmFormDTO,
  CrmFormFieldDefinition,
  CrmFormPhase,
  CrmFormSubmissionDTO,
} from '@/types/crm-form'
import { apiFetch } from './_fetch'

export type MutationResult<T> = { ok: boolean; data?: T; message?: string }

function readError(json: unknown): string {
  const data = json as { message?: string }
  return data?.message ?? 'Não foi possível salvar.'
}

/** Um formulário, com refetch manual — usado pelo builder. */
export function useCrmForm(workspaceId: string, formId: string) {
  const [form, setForm] = useState<CrmFormDTO | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await apiFetch<CrmFormDTO>(
        `/api/workspaces/${workspaceId}/crm/forms/${formId}`,
        undefined,
        'Erro ao buscar formulário',
      )
      setForm(data)
    } catch {
      setForm(null)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, formId])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { form, isLoading, refetch }
}

export async function saveCrmForm(
  workspaceId: string,
  formId: string,
  patch: {
    name?: string
    description?: string
    action?: string
    fields?: CrmFormFieldDefinition[]
    phases?: CrmFormPhase[]
    status?: 'DRAFT' | 'PUBLISHED'
    successMessage?: string
    redirectUrl?: string
    newsletterId?: string | null
  },
): Promise<MutationResult<CrmFormDTO>> {
  try {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/crm/forms/${formId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    )
    const json = await res.json()
    if (!res.ok || !json.success) return { ok: false, message: readError(json) }
    return { ok: true, data: json.data as CrmFormDTO }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}

export async function deleteCrmForm(
  workspaceId: string,
  formId: string,
): Promise<MutationResult<unknown>> {
  try {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/crm/forms/${formId}`,
      { method: 'DELETE' },
    )
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      return { ok: false, message: readError(json) }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Erro de rede. Tente novamente.' }
  }
}

/** Submissões de um formulário, com refetch manual — usado pelo painel de
 * estatísticas. */
export function useCrmFormSubmissions(workspaceId: string, formId: string) {
  const [items, setItems] = useState<CrmFormSubmissionDTO[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const refetch = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await apiFetch<CrmFormSubmissionDTO[]>(
        `/api/workspaces/${workspaceId}/crm/forms/${formId}/submissions`,
        undefined,
        'Erro ao buscar submissões',
      )
      setItems(data ?? [])
    } catch {
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, formId])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { items, isLoading, refetch }
}
