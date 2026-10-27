import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { WhatsAppContactDTO } from '@/types/whatsapp-contact'
import type { WhatsAppContactImportResultDTO } from '@/types/whatsapp-contact-import'
import { apiFetch, apiSend } from './_fetch'

const CONTACTS_KEY = (
  workspaceId: string,
  search?: string,
  whatsapp?: WhatsAppCheckFilter,
  created?: WhatsAppCreatedFilter,
) =>
  [
    'whatsapp-contacts',
    workspaceId,
    search ?? '',
    whatsapp ?? '',
    created ?? '',
  ] as const

/** Filtro "tem zap?" da lista: com, sem ou ainda não verificado. */
export type WhatsAppCheckFilter = 'yes' | 'no' | 'unknown'

/** Filtro "Inseridos hoje" (dia civil de São Paulo). */
export type WhatsAppCreatedFilter = 'today'

interface CreateWhatsAppContactInput {
  waId: string
  name?: string
  avatarUrl?: string
  description?: string
}

/** `null` limpa o campo; omitido = sem alteração. */
interface UpdateWhatsAppContactInput {
  name?: string | null
  avatarUrl?: string | null
  description?: string | null
}

export function useWhatsAppContacts(
  workspaceId: string,
  search?: string,
  whatsapp?: WhatsAppCheckFilter,
  created?: WhatsAppCreatedFilter,
) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (whatsapp) params.set('whatsapp', whatsapp)
  if (created) params.set('created', created)
  const query = params.toString()

  return useQuery({
    queryKey: CONTACTS_KEY(workspaceId, search, whatsapp, created),
    queryFn: () =>
      apiFetch<WhatsAppContactDTO[]>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts${query ? `?${query}` : ''}`,
        undefined,
        'Erro ao buscar contatos',
      ),
    staleTime: 30 * 1000,
  })
}

export function useCreateWhatsAppContact(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateWhatsAppContactInput) =>
      apiFetch<WhatsAppContactDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao criar contato',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}

export function useFindOrCreateWhatsAppContact(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { waId: string; name?: string }) =>
      apiFetch<WhatsAppContactDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts/find-or-create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao localizar contato',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}

export function useSyncWhatsAppContactAvatar(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (contactId: string) =>
      apiFetch<WhatsAppContactDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts/${contactId}/sync-avatar`,
        { method: 'POST' },
        'Erro ao buscar foto de perfil',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}

export function useUpdateWhatsAppContact(
  workspaceId: string,
  contactId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateWhatsAppContactInput) =>
      apiFetch<WhatsAppContactDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts/${contactId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao atualizar contato',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}

export function useDeleteWhatsAppContact(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (contactId: string) =>
      apiSend(
        `/api/workspaces/${workspaceId}/whatsapp/contacts/${contactId}`,
        { method: 'DELETE' },
        'Erro ao remover contato',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}

/**
 * Opt-out LGPD de transmissões (somente OWNER/ADMIN — o servidor valida).
 * Reinscrever exige `contactRequested: true`: só a pedido explícito do
 * próprio contato.
 */
export function useSetWhatsAppContactBroadcastOptOut(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      contactId,
      ...data
    }: {
      contactId: string
      optedOut: boolean
      contactRequested?: boolean
    }) =>
      apiFetch<WhatsAppContactDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts/${contactId}/broadcast-opt-out`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        'Erro ao atualizar descadastro',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}

export function useImportWhatsAppContacts(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: string | { csv: string; validateWhatsapp?: boolean }) =>
      apiFetch<WhatsAppContactImportResultDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/contacts/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            typeof input === 'string' ? { csv: input } : input,
          ),
        },
        'Erro ao importar contatos',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-contacts', workspaceId],
      })
    },
  })
}
