import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { UpdateWhatsAppAiCampaignDTO } from '@/src/schemas/whatsapp-ai-campaign.schema'
import type {
  WhatsAppAiCampaignActionRunDTO,
  WhatsAppAiCampaignDTO,
  WhatsAppAiCampaignRecipientPageDTO,
  WhatsAppAiCampaignRecipientStatusDTO,
} from '@/types/whatsapp-ai-campaign'
import { apiFetch } from './_fetch'

const CAMPAIGNS_KEY = (workspaceId: string) =>
  ['whatsapp-ai-campaigns', workspaceId] as const
const CAMPAIGN_KEY = (workspaceId: string, id: string) =>
  ['whatsapp-ai-campaigns', workspaceId, id] as const

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/ai-campaigns`

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

/** Polls while any campaign is sending, so the cards move. */
export function useWhatsAppAiCampaigns(workspaceId: string) {
  return useQuery({
    queryKey: CAMPAIGNS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppAiCampaignDTO[]>(
        base(workspaceId),
        undefined,
        'Erro ao buscar as campanhas de IA',
      ),
    refetchInterval: (query) =>
      query.state.data?.some((campaign) => campaign.status === 'RUNNING')
        ? 5000
        : false,
  })
}

export function useWhatsAppAiCampaign(workspaceId: string, id: string) {
  return useQuery({
    queryKey: CAMPAIGN_KEY(workspaceId, id),
    queryFn: () =>
      apiFetch<WhatsAppAiCampaignDTO>(
        `${base(workspaceId)}/${id}`,
        undefined,
        'Erro ao buscar a campanha',
      ),
    refetchInterval: (query) =>
      query.state.data?.status === 'RUNNING' ? 5000 : false,
  })
}

/** Writes the fresh campaign into both caches. */
function useCampaignCache(workspaceId: string) {
  const queryClient = useQueryClient()
  return (campaign: WhatsAppAiCampaignDTO) => {
    queryClient.setQueryData(CAMPAIGN_KEY(workspaceId, campaign.id), campaign)
    queryClient.invalidateQueries({
      queryKey: CAMPAIGNS_KEY(workspaceId),
      exact: true,
    })
  }
}

export function useCreateWhatsAppAiCampaign(workspaceId: string) {
  const store = useCampaignCache(workspaceId)
  return useMutation({
    mutationFn: (data: { name: string; objective?: string }) =>
      apiFetch<WhatsAppAiCampaignDTO>(
        base(workspaceId),
        json('POST', data),
        'Erro ao criar a campanha',
      ),
    onSuccess: store,
  })
}

export function useUpdateWhatsAppAiCampaign(workspaceId: string, id: string) {
  const store = useCampaignCache(workspaceId)
  return useMutation({
    mutationFn: (data: UpdateWhatsAppAiCampaignDTO) =>
      apiFetch<WhatsAppAiCampaignDTO>(
        `${base(workspaceId)}/${id}`,
        json('PATCH', data),
        'Erro ao salvar a campanha',
      ),
    onSuccess: store,
  })
}

export function useArchiveWhatsAppAiCampaign(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(
        `${base(workspaceId)}/${id}`,
        { method: 'DELETE' },
        'Erro ao remover a campanha',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: CAMPAIGNS_KEY(workspaceId) }),
  })
}

export type QueueWhatsAppAiCampaignInput =
  | { all: true }
  | { contactIds: string[] }
  | {
      rows: { phone: string; name?: string; values: Record<string, string> }[]
    }

export function useQueueWhatsAppAiCampaign(workspaceId: string, id: string) {
  const store = useCampaignCache(workspaceId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: QueueWhatsAppAiCampaignInput) =>
      apiFetch<
        WhatsAppAiCampaignDTO & {
          added: number
          rejected: number
          optedOut: number
        }
      >(
        `${base(workspaceId)}/${id}/recipients`,
        json('POST', data),
        'Erro ao adicionar contatos',
      ),
    onSuccess: (campaign) => {
      store(campaign)
      queryClient.invalidateQueries({
        queryKey: [...CAMPAIGN_KEY(workspaceId, id), 'recipients'],
      })
    },
  })
}

export function useClearWhatsAppAiCampaign(workspaceId: string, id: string) {
  const store = useCampaignCache(workspaceId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (all: boolean) =>
      apiFetch<WhatsAppAiCampaignDTO>(
        `${base(workspaceId)}/${id}/recipients${all ? '?all=true' : ''}`,
        { method: 'DELETE' },
        'Erro ao limpar os contatos',
      ),
    onSuccess: (campaign) => {
      store(campaign)
      queryClient.invalidateQueries({
        queryKey: [...CAMPAIGN_KEY(workspaceId, id), 'recipients'],
      })
    },
  })
}

function useRunMutation(
  workspaceId: string,
  action: 'play' | 'pause',
  fallback: string,
) {
  const store = useCampaignCache(workspaceId)
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<WhatsAppAiCampaignDTO>(
        `${base(workspaceId)}/${id}/${action}`,
        { method: 'POST' },
        fallback,
      ),
    onSuccess: store,
  })
}

export function usePlayWhatsAppAiCampaign(workspaceId: string) {
  return useRunMutation(workspaceId, 'play', 'Erro ao iniciar a campanha')
}

export function usePauseWhatsAppAiCampaign(workspaceId: string) {
  return useRunMutation(workspaceId, 'pause', 'Erro ao pausar a campanha')
}

export function useWhatsAppAiCampaignRecipients(
  workspaceId: string,
  id: string,
  filters: { status?: WhatsAppAiCampaignRecipientStatusDTO; search?: string },
) {
  return useInfiniteQuery({
    queryKey: [...CAMPAIGN_KEY(workspaceId, id), 'recipients', filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.search) params.set('search', filters.search)
      if (pageParam) params.set('cursor', pageParam)
      const query = params.toString()
      return apiFetch<WhatsAppAiCampaignRecipientPageDTO>(
        `${base(workspaceId)}/${id}/recipients${query ? `?${query}` : ''}`,
        undefined,
        'Erro ao buscar os contatos da campanha',
      )
    },
    getNextPageParam: (page) => page.nextCursor,
  })
}

export function useWhatsAppAiCampaignActionRuns(
  workspaceId: string,
  id: string,
) {
  return useQuery({
    queryKey: [...CAMPAIGN_KEY(workspaceId, id), 'action-runs'],
    queryFn: () =>
      apiFetch<WhatsAppAiCampaignActionRunDTO[]>(
        `${base(workspaceId)}/${id}/action-runs`,
        undefined,
        'Erro ao buscar as ações da IA',
      ),
    refetchInterval: 15_000,
  })
}
