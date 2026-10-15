import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import type {
  CrmEmailAiRewriteInput,
  CrmEmailAiSectionInput,
} from '@/src/schemas/crm-email-editor.schema'
import type {
  CrmEmailAiRewriteResultDTO,
  CrmEmailAiSectionResultDTO,
  CrmEmailContactListsDTO,
  CrmEmailSavedBlockDTO,
  CrmEmailTemplateRestoreDTO,
  CrmEmailTemplateVersionDetailDTO,
  CrmEmailTemplateVersionDTO,
} from '@/types/crm-email-editor'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/** Hooks of the e-mail editor E2/E3: saved blocks, versions, AI. */

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/crm`

export const savedBlocksKey = (workspaceId: string) =>
  ['crm-email-saved-blocks', workspaceId] as const
export const templateVersionsKey = (workspaceId: string, templateId: string) =>
  ['crm-email-template-versions', workspaceId, templateId] as const

// ─── saved blocks ─────────────────────────────────────────────────────────

export function useCrmEmailSavedBlocks(workspaceId: string) {
  return useQuery({
    queryKey: savedBlocksKey(workspaceId),
    queryFn: () =>
      apiFetch<CrmEmailSavedBlockDTO[]>(
        `${base(workspaceId)}/email-saved-blocks`,
        undefined,
        'Erro ao carregar os blocos salvos',
      ),
    staleTime: 30 * 1000,
  })
}

export function useCreateCrmEmailSavedBlock(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      name: string
      category: string
      fragment: CanvasFragment
    }) =>
      apiFetchJson<CrmEmailSavedBlockDTO>(
        `${base(workspaceId)}/email-saved-blocks`,
        'POST',
        data,
        'Erro ao salvar o bloco',
      ),
    onSuccess: (block) => {
      queryClient.setQueryData<CrmEmailSavedBlockDTO[]>(
        savedBlocksKey(workspaceId),
        (current) => [block, ...(current ?? [])],
      )
    },
  })
}

export function useUpdateCrmEmailSavedBlock(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string
      name?: string
      category?: string
    }) =>
      apiFetchJson<CrmEmailSavedBlockDTO>(
        `${base(workspaceId)}/email-saved-blocks/${id}`,
        'PATCH',
        data,
        'Erro ao renomear o bloco',
      ),
    onSuccess: (block) => {
      queryClient.setQueryData<CrmEmailSavedBlockDTO[]>(
        savedBlocksKey(workspaceId),
        (current) =>
          current?.map((item) => (item.id === block.id ? block : item)),
      )
    },
  })
}

export function useDeleteCrmEmailSavedBlock(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiSend(
        `${base(workspaceId)}/email-saved-blocks/${id}`,
        { method: 'DELETE' },
        'Erro ao excluir o bloco',
      ).then(() => id),
    onSuccess: (id) => {
      queryClient.setQueryData<CrmEmailSavedBlockDTO[]>(
        savedBlocksKey(workspaceId),
        (current) => current?.filter((item) => item.id !== id),
      )
    },
  })
}

// ─── template versions ────────────────────────────────────────────────────

export function useCrmEmailTemplateVersions(
  workspaceId: string,
  templateId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: templateVersionsKey(workspaceId, templateId),
    queryFn: () =>
      apiFetch<CrmEmailTemplateVersionDTO[]>(
        `${base(workspaceId)}/email-templates/${templateId}/versions`,
        undefined,
        'Erro ao carregar o histórico',
      ),
    enabled,
  })
}

export function useCrmEmailTemplateVersion(
  workspaceId: string,
  templateId: string,
  versionId: string | null,
) {
  return useQuery({
    queryKey: [
      ...templateVersionsKey(workspaceId, templateId),
      versionId,
    ] as const,
    queryFn: () =>
      apiFetch<CrmEmailTemplateVersionDetailDTO>(
        `${base(workspaceId)}/email-templates/${templateId}/versions/${versionId}`,
        undefined,
        'Erro ao carregar a versão',
      ),
    enabled: versionId !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSaveCrmEmailTemplateVersion(
  workspaceId: string,
  templateId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { label?: string }) =>
      apiFetchJson<CrmEmailTemplateVersionDTO | null>(
        `${base(workspaceId)}/email-templates/${templateId}/versions`,
        'POST',
        data,
        'Erro ao salvar a versão',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: templateVersionsKey(workspaceId, templateId),
      }),
  })
}

export function useRestoreCrmEmailTemplateVersion(
  workspaceId: string,
  templateId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (versionId: string) =>
      apiFetchJson<CrmEmailTemplateRestoreDTO>(
        `${base(workspaceId)}/email-templates/${templateId}/versions/${versionId}/restore`,
        'POST',
        undefined,
        'Erro ao restaurar a versão',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: templateVersionsKey(workspaceId, templateId),
      }),
  })
}

// ─── AI ───────────────────────────────────────────────────────────────────

export function useCrmEmailAiRewrite(workspaceId: string) {
  return useMutation({
    mutationFn: (data: CrmEmailAiRewriteInput) =>
      apiFetchJson<CrmEmailAiRewriteResultDTO>(
        `${base(workspaceId)}/email-ai/rewrite`,
        'POST',
        data,
        'A IA não conseguiu escrever agora',
      ),
  })
}

export function useCrmEmailAiSection(workspaceId: string) {
  return useMutation({
    mutationFn: (data: CrmEmailAiSectionInput) =>
      apiFetchJson<CrmEmailAiSectionResultDTO>(
        `${base(workspaceId)}/email-ai/section`,
        'POST',
        data,
        'A IA não conseguiu gerar a seção agora',
      ),
  })
}

// ─── conditional content ──────────────────────────────────────────────────

/** Mailing lists of a CRM person (preview of "Mostrar se"). */
export function useCrmEmailContactLists(
  workspaceId: string,
  personId: string | null,
) {
  return useQuery({
    queryKey: ['crm-email-contact-lists', workspaceId, personId] as const,
    queryFn: () =>
      apiFetch<CrmEmailContactListsDTO>(
        `${base(workspaceId)}/email-builder/contact-lists?personId=${encodeURIComponent(personId ?? '')}`,
        undefined,
        'Erro ao carregar as listas do contato',
      ),
    enabled: personId !== null,
    staleTime: 30 * 1000,
  })
}
