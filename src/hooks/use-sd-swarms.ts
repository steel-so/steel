import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SdSwarmDTO, SdSwarmListDTO } from '@/types/sd-swarm'
import { apiFetch } from './_fetch'
import { sdJson, sdTicketTabKey, sdTicketTabUrl } from './_sd-ticket-tab'

export function useSdSwarms(workspaceId: string, ticketRef: string) {
  return useQuery({
    queryKey: sdTicketTabKey(workspaceId, ticketRef, 'swarms'),
    queryFn: () =>
      apiFetch<SdSwarmListDTO>(
        sdTicketTabUrl(workspaceId, ticketRef, 'swarms'),
        undefined,
        'Erro ao carregar os swarmings',
      ),
    enabled: Boolean(workspaceId && ticketRef),
  })
}

function useInvalidate(workspaceId: string, ticketRef: string) {
  const qc = useQueryClient()
  return () =>
    qc.invalidateQueries({
      queryKey: sdTicketTabKey(workspaceId, ticketRef, 'swarms'),
    })
}

export function useStartSdSwarm(workspaceId: string, ticketRef: string) {
  const invalidate = useInvalidate(workspaceId, ticketRef)
  return useMutation({
    mutationFn: (input: {
      reason: string
      userIds: string[]
      openSlackChannel: boolean
    }) =>
      apiFetch<SdSwarmDTO>(
        sdTicketTabUrl(workspaceId, ticketRef, 'swarms'),
        sdJson('POST', input),
        'Erro ao abrir o swarming',
      ),
    onSuccess: invalidate,
  })
}

type SwarmAction = 'invite' | 'respond' | 'close'

function useSwarmAction<TInput>(
  workspaceId: string,
  ticketRef: string,
  action: SwarmAction,
  errorMessage: string,
) {
  const invalidate = useInvalidate(workspaceId, ticketRef)
  return useMutation({
    mutationFn: ({ swarmId, ...body }: { swarmId: string } & TInput) =>
      apiFetch<SdSwarmDTO>(
        `${sdTicketTabUrl(workspaceId, ticketRef, 'swarms')}/${swarmId}/${action}`,
        sdJson('POST', body),
        errorMessage,
      ),
    onSuccess: invalidate,
  })
}

export function useInviteSdSwarm(workspaceId: string, ticketRef: string) {
  return useSwarmAction<{ userIds: string[] }>(
    workspaceId,
    ticketRef,
    'invite',
    'Erro ao convidar especialistas',
  )
}

export function useRespondSdSwarm(workspaceId: string, ticketRef: string) {
  return useSwarmAction<{ response: 'JOIN' | 'DECLINE' }>(
    workspaceId,
    ticketRef,
    'respond',
    'Erro ao responder o convite',
  )
}

export function useCloseSdSwarm(workspaceId: string, ticketRef: string) {
  return useSwarmAction<{ outcome?: string }>(
    workspaceId,
    ticketRef,
    'close',
    'Erro ao encerrar o swarming',
  )
}
