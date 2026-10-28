import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSendingDomainDTO,
  SendingDomainDTO,
} from '@/src/schemas/sending-domain.schema'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Ajustes › Domínios de e-mail (OWNER/ADMIN, ADR 0054). Everything under
 * `['sending-domains', workspaceId]`. The list has no DMARC; the detail
 * (and create/verify responses) do.
 */

export const sendingDomainKeys = {
  all: (workspaceId: string) => ['sending-domains', workspaceId] as const,
  list: (workspaceId: string) =>
    ['sending-domains', workspaceId, 'list'] as const,
  detail: (workspaceId: string, domainId: string) =>
    ['sending-domains', workspaceId, 'detail', domainId] as const,
}

const base = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/sending-domains`

const domainPath = (workspaceId: string, domainId: string) =>
  `${base(workspaceId)}/${encodeURIComponent(domainId)}`

export function useSendingDomains(workspaceId: string) {
  return useQuery({
    queryKey: sendingDomainKeys.list(workspaceId),
    queryFn: () =>
      apiFetch<SendingDomainDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao carregar os domínios',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useSendingDomain(workspaceId: string, domainId: string | null) {
  return useQuery({
    queryKey: sendingDomainKeys.detail(workspaceId, domainId ?? ''),
    queryFn: () =>
      apiFetch<SendingDomainDTO>(
        domainPath(workspaceId, domainId ?? ''),
        undefined,
        'Erro ao carregar o domínio',
      ),
    enabled: Boolean(workspaceId && domainId),
  })
}

export function useSendingDomainMutations(workspaceId: string) {
  const queryClient = useQueryClient()
  const refreshList = () =>
    queryClient.invalidateQueries({
      queryKey: sendingDomainKeys.list(workspaceId),
    })
  const storeDetail = (domain: SendingDomainDTO) => {
    queryClient.setQueryData(
      sendingDomainKeys.detail(workspaceId, domain.id),
      domain,
    )
    return refreshList()
  }

  const create = useMutation({
    mutationFn: (dto: CreateSendingDomainDTO) =>
      apiFetchJson<SendingDomainDTO>(
        base(workspaceId),
        'POST',
        dto,
        'Erro ao cadastrar o domínio',
      ),
    onSuccess: storeDetail,
  })

  const verify = useMutation({
    mutationFn: (domainId: string) =>
      apiFetchJson<SendingDomainDTO>(
        `${domainPath(workspaceId, domainId)}/verify`,
        'POST',
        undefined,
        'Erro ao verificar o domínio',
      ),
    onSuccess: storeDetail,
  })

  const remove = useMutation({
    mutationFn: (domainId: string) =>
      apiSend(
        domainPath(workspaceId, domainId),
        { method: 'DELETE' },
        'Erro ao remover o domínio',
      ),
    onSuccess: (_data, domainId) => {
      queryClient.removeQueries({
        queryKey: sendingDomainKeys.detail(workspaceId, domainId),
      })
      return refreshList()
    },
  })

  return { create, verify, remove }
}
