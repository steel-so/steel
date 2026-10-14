import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateWhatsAppTemplateButtonsInput } from '@/src/schemas/whatsapp-button.schema'
import type { CreateWhatsAppTemplateInput } from '@/src/schemas/whatsapp-template.schema'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { apiFetch } from './_fetch'

const TEMPLATES_KEY = (workspaceId: string) =>
  ['whatsapp-templates', workspaceId] as const

export function useWhatsAppTemplates(workspaceId: string) {
  return useQuery({
    queryKey: TEMPLATES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppTemplateDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/templates`,
        undefined,
        'Erro ao buscar templates',
      ),
    staleTime: 5 * 60 * 1000,
  })
}

export function useSyncWhatsAppTemplates(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (connectionId: string) =>
      apiFetch<WhatsAppTemplateDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/templates/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId }),
        },
        'Erro ao sincronizar templates',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY(workspaceId) })
    },
  })
}

export function useCreateWhatsAppTemplate(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateWhatsAppTemplateInput) =>
      apiFetch<WhatsAppTemplateDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/templates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao criar template',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY(workspaceId) })
    },
  })
}

/** Configure what each reply button does on click (also for templates synced
 * from Meta). Labels/types must match the approved template. */
export function useUpdateWhatsAppTemplateButtons(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      templateId,
      ...input
    }: UpdateWhatsAppTemplateButtonsInput & { templateId: string }) =>
      apiFetch<WhatsAppTemplateDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/templates/${templateId}/buttons`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
        'Erro ao salvar as ações dos botões',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY(workspaceId) })
    },
  })
}
