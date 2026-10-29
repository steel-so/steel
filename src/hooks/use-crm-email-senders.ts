import { useQuery } from '@tanstack/react-query'
import type { CrmEmailSenderOptionsDTO } from '@/types/crm-email-sender'
import { apiFetch } from './_fetch'

export const crmEmailSenderKeys = {
  options: (workspaceId: string) => ['crm-email-senders', workspaceId] as const,
}

/** Senders a campaign may use (ADR 0055): verified domains + platform. */
export function useCrmEmailSenders(workspaceId: string) {
  return useQuery({
    queryKey: crmEmailSenderKeys.options(workspaceId),
    queryFn: () =>
      apiFetch<CrmEmailSenderOptionsDTO>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/crm/email-senders`,
        undefined,
        'Erro ao carregar os remetentes',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
}
