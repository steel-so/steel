import { z } from 'zod'
import {
  ConnectGithubSchema,
  ConnectGitlabSchema,
  UpdateRepoCredentialsSchema,
  UpdateWorkspaceSlackSchema,
} from '@/src/schemas/workspace-integration.schema'
import { dto, WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  SdGithubWebhookDTO,
  SdGithubWebhookPayload,
  SdGitlabWebhookDTO,
  SdGitlabWebhookPayload,
} from '../schemas/servicedesk/integrations'

/**
 * Workspace-level integrations (Ajustes › Integrações, ADR 0024): Slack,
 * GitHub and GitLab connected once per workspace (OWNER/ADMIN) and used by
 * every module, plus the public repository webhooks.
 */

const TAG = 'Integrações' as const
const BASE = '/workspaces/{id}/integrations'

const SECRECY =
  'Token e segredo do webhook **só entram**: nenhuma resposta os devolve, nem mascarados (o DTO diz só `hasWebhookSecret`).'
const PRIVILEGED = 'Acesso: sessão + **OWNER/ADMIN** do workspace.'

const dateTime = () => z.iso.datetime()
const Kind = z.enum(['SLACK', 'GITHUB', 'GITLAB', 'APOLLO'])

const SlackRoute = z.object({
  event: z.string().meta({
    description:
      'Chave do catálogo (`servicedesk.sla.breached`, `crm.deal.won`, `crm.lead.created`, `communication.conversation.waiting`, `agents.approval.pending`…).',
    example: 'crm.deal.won',
  }),
  channelId: z.string().nullable().meta({
    description:
      '`null` = canal do time do chamado (só eventos do ServiceDesk).',
    example: 'C024BE91L',
  }),
  channelName: z.string().nullable().meta({ example: 'vendas' }),
})

const WorkspaceIntegrationDTO = dto(
  'WorkspaceIntegration',
  z.object({
    id: z.string(),
    kind: Kind,
    status: z.enum(['ACTIVE', 'ERROR', 'DISCONNECTED']),
    statusError: z.string().nullable(),
    externalId: z.string().meta({
      description:
        'Workspace do Slack (`T…`), `owner/repo` no GitHub ou `grupo/projeto` no GitLab.',
    }),
    externalName: z.string().nullable(),
    baseUrl: z.string().nullable().meta({
      description: 'Instância do GitLab (`https://gitlab.com` ou própria).',
    }),
    hasWebhookSecret: z.boolean(),
    lastEventAt: dateTime().nullable(),
    lastEventType: z
      .string()
      .nullable()
      .meta({ example: 'github:issues.closed' }),
    lastCheckedAt: dateTime().nullable(),
    slack: z
      .object({
        routes: z.array(SlackRoute),
        waitingMinutes: z.number().int(),
      })
      .nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const WorkspaceIntegrationsOverviewDTO = dto(
  'WorkspaceIntegrationsOverview',
  z.object({
    providers: z.array(
      z.object({
        kind: Kind,
        available: z.boolean().meta({
          description:
            '`false` quando falta configuração no servidor (ex.: app do Slack sem `SLACK_CLIENT_ID`).',
        }),
        unavailableReason: z.string().nullable(),
        webhookUrl: z.string().nullable().meta({
          description:
            'URL a cadastrar no provedor (Request URL do app do Slack, webhook do repositório/projeto).',
        }),
        connection: WorkspaceIntegrationDTO.nullable(),
      }),
    ),
    enabledModules: z.array(z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])),
  }),
)

const SlackChannelOptionDTO = dto(
  'SlackChannelOption',
  z.object({
    id: z.string().meta({ example: 'C024BE91L' }),
    name: z.string().meta({ example: 'vendas' }),
    isPrivate: z.boolean(),
  }),
)

const WorkspaceIntegrationTestDTO = dto(
  'WorkspaceIntegrationTest',
  z.object({
    ok: z.boolean(),
    message: z.string().meta({
      example: 'Acesso confirmado a steel-so/steel',
    }),
    integration: WorkspaceIntegrationDTO,
  }),
)

const NOT_CONNECTED: ErrorEntry = {
  code: 'SD_INTEGRATION_NOT_FOUND',
  when: 'Provedor não conectado neste workspace',
}
const NOT_CONFIGURED: ErrorEntry = {
  code: 'SD_INTEGRATION_NOT_CONFIGURED',
  when: 'App do Slack sem credenciais no servidor, ou conexão sem token/segredo legível',
}
const REQUEST_FAILED: ErrorEntry = {
  code: 'SD_INTEGRATION_REQUEST_FAILED',
  when: 'O provedor recusou a chamada (token sem acesso, repositório/projeto inexistente, fora do ar)',
}
const SIGNATURE_INVALID: ErrorEntry = {
  code: 'SD_INTEGRATION_SIGNATURE_INVALID',
  when: 'Assinatura/token do webhook ausente ou inválido',
}

const repoRoutes = (kind: 'github' | 'gitlab'): RouteConfig[] => {
  const label = kind === 'github' ? 'GitHub' : 'GitLab'
  return [
    {
      method: 'post',
      path: `${BASE}/${kind}`,
      tags: [TAG],
      summary: `Conectar o ${label}`,
      description:
        kind === 'github'
          ? `Guarda o repositório (\`owner/repo\` ou a URL), o token (PAT fine-grained) e o segredo do webhook, cifrados com \`CONNECTION_SECRETS\`. O acesso é validado na API **antes** de guardar; o \`externalId\` fica com o nome canônico devolvido pelo GitHub. Reconectar outro repositório aposenta o anterior. ${SECRECY} ${PRIVILEGED}`
          : `Guarda a instância (\`baseUrl\`, vazio = gitlab.com; só HTTPS e domínio público), o projeto (\`grupo/projeto\` ou a URL), o token (pessoal, de projeto ou de grupo) e o *secret token* do webhook, cifrados com \`CONNECTION_SECRETS\`. O acesso é validado na API v4 **antes** de guardar. ${SECRECY} ${PRIVILEGED}`,
      consent: true,
      params: { id: 'Id do workspace.' },
      body: kind === 'github' ? ConnectGithubSchema : ConnectGitlabSchema,
      responses: {
        201: { description: 'Conectado.', schema: WorkspaceIntegrationDTO },
      },
      errors: [
        ...WORKSPACE_PRIVILEGED_ERRORS,
        REQUEST_FAILED,
        {
          code: 'VALIDATION_ERROR',
          when: 'Repositório/projeto ou instância inválidos',
        },
      ],
    },
    {
      method: 'patch',
      path: `${BASE}/${kind}`,
      tags: [TAG],
      summary: `Trocar token/segredo do ${label}`,
      description: `Troca o token (revalidado no ${label}) e/ou o segredo do webhook; o anterior é descartado. ${SECRECY} ${PRIVILEGED}`,
      consent: true,
      params: { id: 'Id do workspace.' },
      body: UpdateRepoCredentialsSchema,
      responses: {
        200: {
          description: 'Credenciais salvas.',
          schema: WorkspaceIntegrationDTO,
        },
      },
      errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_CONNECTED, REQUEST_FAILED],
    },
    {
      method: 'delete',
      path: `${BASE}/${kind}`,
      tags: [TAG],
      summary: `Desconectar o ${label}`,
      description: `O token é apagado e o webhook deixa de ser aceito, em todos os módulos. Os vínculos já registrados continuam no histórico dos chamados. ${PRIVILEGED}`,
      consent: true,
      params: { id: 'Id do workspace.' },
      responses: { 200: { description: 'Desconectado.', schema: null } },
      errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_CONNECTED],
    },
    {
      method: 'post',
      path: `${BASE}/${kind}/test`,
      tags: [TAG],
      summary: `Testar a conexão com o ${label}`,
      description: `Chama a API com o token guardado. Falha do provedor é resposta normal (\`ok: false\` + motivo) e carimba \`status: ERROR\`; conexão sem segredo de webhook também falha (o webhook seria recusado). ${PRIVILEGED}`,
      consent: true,
      params: { id: 'Id do workspace.' },
      responses: {
        200: {
          description: 'Resultado do teste.',
          schema: WorkspaceIntegrationTestDTO,
        },
      },
      errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_CONNECTED],
    },
  ]
}

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Integrações do workspace',
    description: `Slack, GitHub e GitLab: disponibilidade no servidor (com o motivo quando indisponível), a conexão e as URLs a cadastrar em cada provedor, e os módulos habilitados (filtram os eventos do Slack). ${SECRECY} ${PRIVILEGED}`,
    params: { id: 'Id do workspace.' },
    responses: {
      200: {
        description: 'Integrações do workspace.',
        schema: WorkspaceIntegrationsOverviewDTO,
      },
    },
    errors: WORKSPACE_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/slack/connect`,
    tags: [TAG],
    summary: 'Conectar o Slack (iniciar OAuth)',
    description: `Redireciona (\`302\`) para a autorização do app do Slack. Abra no navegador — não é uma chamada JSON. O workspace viaja num \`state\` assinado (10 min); o callback é \`GET /servicedesk/integrations/oauth/slack\`, que volta para Ajustes › Integrações. ${PRIVILEGED}`,
    params: { id: 'Id do workspace.' },
    responses: {
      302: {
        description: 'Redirect para a autorização do Slack.',
        envelope: false,
        headers: { Location: { description: 'URL de autorização do Slack.' } },
      },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_CONFIGURED],
  },
  {
    method: 'get',
    path: `${BASE}/slack/channels`,
    tags: [TAG],
    summary: 'Listar canais do Slack',
    description: `Canais (públicos e privados) que o bot enxerga, em ordem alfabética. Falha do Slack carimba \`status: ERROR\` na conexão. ${PRIVILEGED}`,
    params: { id: 'Id do workspace.' },
    responses: {
      200: {
        description: 'Canais disponíveis.',
        schema: z.array(SlackChannelOptionDTO),
      },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      NOT_CONNECTED,
      NOT_CONFIGURED,
      REQUEST_FAILED,
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/slack`,
    tags: [TAG],
    summary: 'Regras de notificação do Slack',
    description: `Substitui as regras "evento → canal" (até 120; um evento pode ir a vários canais) e/ou o tempo, em minutos, para uma conversa da Comunicação contar como "aguardando há muito tempo". As configurações do ServiceDesk (canal por time…) ficam em \`PATCH /workspaces/{id}/servicedesk/integrations/slack\`. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'Id do workspace.' },
    body: UpdateWorkspaceSlackSchema,
    responses: {
      200: { description: 'Regras salvas.', schema: WorkspaceIntegrationDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      NOT_CONNECTED,
      {
        code: 'VALIDATION_ERROR',
        when: 'Evento desconhecido, regra repetida ou sem canal',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/slack`,
    tags: [TAG],
    summary: 'Desconectar o Slack',
    description: `O token é apagado, os avisos param e o webhook deixa de ser aceito, em todos os módulos. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'Id do workspace.' },
    responses: { 200: { description: 'Desconectado.', schema: null } },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_CONNECTED],
  },
  {
    method: 'post',
    path: `${BASE}/slack/test`,
    tags: [TAG],
    summary: 'Testar a conexão com o Slack',
    description: `\`auth.test\` com o token do bot guardado. Falha é resposta normal (\`ok: false\` + motivo) e carimba \`status: ERROR\`. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'Id do workspace.' },
    responses: {
      200: {
        description: 'Resultado do teste.',
        schema: WorkspaceIntegrationTestDTO,
      },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, NOT_CONNECTED, NOT_CONFIGURED],
  },
  ...repoRoutes('github'),
  ...repoRoutes('gitlab'),
  {
    method: 'post',
    path: '/integrations/github/webhook',
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Receber webhook do GitHub (público)',
    description: `Espelha nos chamados o estado das issues/PRs vinculadas: \`closed\`, \`reopened\` e \`merged\` atualizam o vínculo, registram o evento e publicam uma mensagem no chamado (fechar/mesclar **sugere** avançar a fase). Sem sessão: \`repository.full_name\` só acha as conexões candidatas; vale a primeira cujo segredo fecha o HMAC \`X-Hub-Signature-256\` sobre o corpo bruto (tempo constante). Idempotente por \`X-GitHub-Delivery\`; \`ping\` é ignorado. Também carimba o "último evento" da conexão.`,
    headers: {
      'X-Hub-Signature-256': {
        description: '`sha256=<hex>` do HMAC com o segredo do webhook.',
        required: true,
      },
      'X-GitHub-Event': {
        description: '`issues`, `pull_request` ou `ping`.',
        required: true,
      },
      'X-GitHub-Delivery': { description: 'Chave de idempotência.' },
    },
    body: {
      schema: SdGithubWebhookPayload,
      description: 'Payload de `issues` ou `pull_request`.',
    },
    responses: {
      200: { description: 'Webhook processado.', schema: SdGithubWebhookDTO },
    },
    errors: [
      SIGNATURE_INVALID,
      NOT_CONFIGURED,
      { code: 'VALIDATION_ERROR', when: 'Corpo inválido ou sem repositório' },
      { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
    ],
  },
  {
    method: 'post',
    path: '/integrations/gitlab/webhook',
    tags: [TAG],
    auth: 'public',
    rateLimit: 'ip',
    summary: 'Receber webhook do GitLab (público)',
    description:
      'Mesmo comportamento do webhook do GitHub, para issues e merge requests (gitlab.com ou self-managed). O GitLab não assina o corpo: o *secret token* do webhook chega em `X-Gitlab-Token` e é comparado em tempo constante com o segredo de cada conexão do projeto (`project.path_with_namespace` só acha as candidatas). Qualquer ação é aceita — estado igual ao anterior não faz nada. Idempotente por `X-Gitlab-Event-UUID` (ou `Idempotency-Key`).',
    headers: {
      'X-Gitlab-Token': {
        description: 'Secret token cadastrado no webhook do projeto.',
        required: true,
      },
      'X-Gitlab-Event': {
        description: '`Issue Hook` ou `Merge Request Hook`.',
      },
      'X-Gitlab-Event-UUID': { description: 'Chave de idempotência.' },
    },
    body: {
      schema: SdGitlabWebhookPayload,
      description: 'Payload de issue ou merge request.',
    },
    responses: {
      200: { description: 'Webhook processado.', schema: SdGitlabWebhookDTO },
    },
    errors: [
      SIGNATURE_INVALID,
      NOT_CONFIGURED,
      { code: 'VALIDATION_ERROR', when: 'Corpo inválido ou sem projeto' },
      { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
    ],
  },
]

export function registerIntegrationPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
