import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ConnectApolloDTO } from '@/src/schemas/crm-apollo.schema'
import type {
  ConnectGithubDTO,
  ConnectGitlabDTO,
  UpdateRepoCredentialsDTO,
  UpdateWorkspaceSlackDTO,
} from '@/src/schemas/workspace-integration.schema'
import type {
  SlackChannelOptionDTO,
  WorkspaceIntegrationDTO,
  WorkspaceIntegrationKindDTO,
  WorkspaceIntegrationsOverviewDTO,
  WorkspaceIntegrationTestDTO,
} from '@/types/workspace-integration'
import { apiFetch, apiSend } from './_fetch'

/**
 * Ajustes > Integrações (Slack, GitHub, GitLab — ADR 0024). Everything under
 * `['workspace-integrations', workspaceId]`; the ServiceDesk tab reads the
 * same connections, so mutations also refresh `['sd-integrations', …]`.
 *
 * Tokens and secrets **only go in**. Connecting Slack is not a mutation: it
 * is a browser redirect to `…/integrations/slack/connect`.
 */

export const workspaceIntegrationKeys = {
  all: (workspaceId: string) =>
    ['workspace-integrations', workspaceId] as const,
  overview: (workspaceId: string) =>
    ['workspace-integrations', workspaceId, 'overview'] as const,
  channels: (workspaceId: string) =>
    ['workspace-integrations', workspaceId, 'slack-channels'] as const,
}

function base(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/integrations`
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/** Where the "Conectar o Slack" button sends the browser. */
export function workspaceSlackConnectUrl(workspaceId: string): string {
  return `${base(workspaceId)}/slack/connect`
}

export function useWorkspaceIntegrations(workspaceId: string) {
  return useQuery({
    queryKey: workspaceIntegrationKeys.overview(workspaceId),
    queryFn: () =>
      apiFetch<WorkspaceIntegrationsOverviewDTO>(
        base(workspaceId),
        undefined,
        'Erro ao carregar as integrações',
      ),
    enabled: !!workspaceId,
  })
}

/** Slack channels — only fetched once Slack is connected. */
export function useWorkspaceSlackChannels(
  workspaceId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: workspaceIntegrationKeys.channels(workspaceId),
    queryFn: () =>
      apiFetch<SlackChannelOptionDTO[]>(
        `${base(workspaceId)}/slack/channels`,
        undefined,
        'Erro ao carregar os canais do Slack',
      ),
    enabled: !!workspaceId && (options.enabled ?? false),
    staleTime: 5 * 60 * 1000,
  })
}

type RepoKind = Exclude<WorkspaceIntegrationKindDTO, 'SLACK'>

export function useWorkspaceIntegrationMutations(workspaceId: string) {
  const queryClient = useQueryClient()
  const url = base(workspaceId)
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: workspaceIntegrationKeys.all(workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: ['sd-integrations', workspaceId],
      }),
    ])
  }

  const updateSlack = useMutation({
    mutationFn: (data: UpdateWorkspaceSlackDTO) =>
      apiFetch<WorkspaceIntegrationDTO>(
        `${url}/slack`,
        json('PATCH', data),
        'Erro ao salvar as regras do Slack',
      ),
    onSuccess: invalidate,
  })
  const connectGithub = useMutation({
    mutationFn: (data: ConnectGithubDTO) =>
      apiFetch<WorkspaceIntegrationDTO>(
        `${url}/github`,
        json('POST', data),
        'Erro ao conectar o GitHub',
      ),
    onSuccess: invalidate,
  })
  const connectGitlab = useMutation({
    mutationFn: (data: ConnectGitlabDTO) =>
      apiFetch<WorkspaceIntegrationDTO>(
        `${url}/gitlab`,
        json('POST', data),
        'Erro ao conectar o GitLab',
      ),
    onSuccess: invalidate,
  })
  const connectApollo = useMutation({
    mutationFn: (data: ConnectApolloDTO) =>
      apiFetch<WorkspaceIntegrationDTO>(
        `${url}/apollo`,
        json('POST', data),
        'Erro ao conectar a Apollo',
      ),
    onSuccess: async () => {
      await invalidate()
      await queryClient.invalidateQueries({ queryKey: ['crm-apollo'] })
    },
  })
  const updateCredentials = useMutation({
    mutationFn: ({
      kind,
      ...data
    }: UpdateRepoCredentialsDTO & { kind: RepoKind }) =>
      apiFetch<WorkspaceIntegrationDTO>(
        `${url}/${kind.toLowerCase()}`,
        json('PATCH', data),
        'Erro ao salvar as credenciais',
      ),
    onSuccess: invalidate,
  })
  const test = useMutation({
    mutationFn: (kind: WorkspaceIntegrationKindDTO) =>
      apiFetch<WorkspaceIntegrationTestDTO>(
        `${url}/${kind.toLowerCase()}/test`,
        { method: 'POST' },
        'Erro ao testar a conexão',
      ),
    onSuccess: invalidate,
  })
  const disconnect = useMutation({
    mutationFn: (kind: WorkspaceIntegrationKindDTO) =>
      apiSend(
        `${url}/${kind.toLowerCase()}`,
        { method: 'DELETE' },
        'Erro ao desconectar',
      ),
    onSuccess: invalidate,
  })

  return {
    updateSlack,
    connectGithub,
    connectGitlab,
    connectApollo,
    updateCredentials,
    test,
    disconnect,
  }
}
