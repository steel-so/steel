import {
  KillSteelAgentsSchema,
  SteelGovernanceQuerySchema,
  UpdateSteelAgentPolicySchema,
} from '@/src/schemas/steel-agent-governance.schema'
import {
  CreateSteelMcpServerSchema,
  UpdateSteelMcpServerSchema,
} from '@/src/schemas/steel-mcp-server.schema'
import { WORKSPACE_MEMBER_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  SteelAgentPolicyDTO,
  SteelGovernanceDTO,
  SteelKillResultDTO,
  SteelKillSwitchDTO,
  SteelMcpServerDTO,
} from '../schemas/steel-agents'

/**
 * Steel Agents — governança (A6), política de criação e modo automático (A8)
 * e servidores MCP externos (A8): `/workspaces/{id}/agents/governance/**` e
 * `/workspaces/{id}/agents/mcp-servers/**`.
 */

const TAG = 'Steel Agents' as const
const SERVER_PARAM = { description: 'ID do servidor MCP.' }

const MANAGE: ErrorEntry = {
  code: 'FORBIDDEN',
  when: 'Sem a permissão `steel-agents` de gerenciamento (admin)',
}
const ADMIN_ONLY: ErrorEntry = {
  code: 'FORBIDDEN',
  when: 'Só OWNER/ADMIN do workspace',
}
const SERVER_NOT_FOUND: ErrorEntry = {
  code: 'STEEL_MCP_SERVER_NOT_FOUND',
  when: 'Servidor inexistente ou de outro workspace',
}
const SERVER_INVALID: ErrorEntry = {
  code: 'STEEL_MCP_SERVER_INVALID',
  when: 'URL recusada (HTTP, endereço privado/local, credenciais na URL), limite de 10 servidores ou ferramenta que o servidor não tem',
}

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/agents/governance',
    tags: [TAG],
    summary: 'Painel de governança dos agentes',
    description:
      'Inventário de todos os agentes do workspace com o responsável humano (e o perfil dele), as ferramentas e o modo de cada uma, as taxas de aprovação e rejeição das ações propostas, o custo e o custo por escrita aplicada no período (`days`, 1 a 365, padrão 30), o interruptor de emergência e a política de criação/modo automático. Execuções de teste não entram nas contas. Exige a permissão de gerenciar agentes.',
    query: SteelGovernanceQuerySchema,
    responses: {
      200: { description: 'Painel.', schema: SteelGovernanceDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, MANAGE],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/governance/export',
    tags: [TAG],
    summary: 'Exportar o inventário (CSV, LGPD)',
    description:
      'O mesmo inventário em CSV (UTF-8 com BOM), com os campos que o registro das atividades de tratamento pede: responsável, módulos acessados, se trata dados pessoais, se contata terceiros ou sistemas externos, ferramentas e escritas automáticas. Células que começam com `=`, `+`, `-` ou `@` saem neutralizadas. A exportação fica na auditoria.',
    query: SteelGovernanceQuerySchema,
    responses: {
      200: {
        description: 'Arquivo CSV (`Content-Disposition: attachment`).',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string' },
      },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, MANAGE],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/governance/kill',
    tags: [TAG],
    summary: 'Desligamento de emergência',
    description:
      'Pausa **todos** os agentes do workspace: nenhuma execução nova roda (as da fila e as aguardando aprovação viram `SKIPPED`, as ações pendentes são canceladas), as que estão rodando param entre uma rodada e outra e nenhuma aprovação executa. Os agentes continuam como estão configurados; só `resume` os libera. Idempotente (o primeiro motivo é mantido). Auditado.',
    consent: true,
    body: {
      schema: KillSteelAgentsSchema,
      example: { reason: 'Agente de cobrança enviando mensagens erradas' },
    },
    responses: {
      200: { description: 'Agentes pausados.', schema: SteelKillResultDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, ADMIN_ONLY],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/governance/resume',
    tags: [TAG],
    summary: 'Retomar os agentes',
    description:
      'Desliga o interruptor de emergência. Os agentes voltam a rodar nos próximos gatilhos; o que foi cancelado pelo desligamento não volta. Auditado.',
    consent: true,
    responses: {
      200: {
        description: 'Interruptor desligado.',
        schema: SteelKillSwitchDTO,
      },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, ADMIN_ONLY],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/agents/governance/policy',
    tags: [TAG],
    summary: 'Definir quem cria agentes e o modo automático por perfil',
    description:
      'Com `restrictCreators`, só OWNER/ADMIN e os perfis de `creatorRoles` criam agentes (quem cria edita e exclui só os próprios); desligado, vale a matriz de permissões. Com `restrictAuto`, cada perfil (`ADMIN`, `MEMBER`, `VIEWER`) tem uma regra para o modo `AUTO`: `ALL`, `NONE` ou `LIST` (as ferramentas em `tools`). A regra vale ao salvar o agente (uma ferramenta que passa a ser automática precisa ser liberada para o perfil de quem salva) e na execução (se o perfil do responsável não libera, a escrita vai para aprovação e o passo aparece na linha do tempo). O OWNER nunca é limitado e exclusões sempre pedem aprovação. Auditado.',
    consent: true,
    body: UpdateSteelAgentPolicySchema,
    responses: {
      200: { description: 'Política salva.', schema: SteelAgentPolicyDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, ADMIN_ONLY],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/mcp-servers',
    tags: [TAG],
    summary: 'Listar servidores MCP',
    description:
      'Servidores MCP externos cadastrados, com as ferramentas descobertas e quais estão liberadas. O valor da credencial nunca é devolvido. Só OWNER/ADMIN.',
    responses: {
      200: {
        description: 'Servidores.',
        schema: SteelMcpServerDTO.array(),
      },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, ADMIN_ONLY],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/mcp-servers',
    tags: [TAG],
    summary: 'Adicionar servidor MCP',
    description:
      'Cadastra um servidor MCP (transporte HTTP) para os agentes chamarem. A URL passa pela mesma proteção contra SSRF dos webhooks: só HTTPS, sem usuário/senha na URL e com endereço público (conferido ao salvar e a cada requisição; redirecionamentos não são seguidos). `authValue` (por exemplo `Bearer …`) é cifrado com `CONNECTION_SECRETS` e enviado no cabeçalho `authHeaderName`. As ferramentas são descobertas na hora; **nenhuma fica liberada** até entrar em `allowedTools`. Ferramentas que não são só de leitura seguem a regra de aprovação dos agentes. Auditado.',
    consent: true,
    body: {
      schema: CreateSteelMcpServerSchema,
      example: {
        name: 'GitHub',
        url: 'https://mcp.example.com/mcp',
        authValue: 'Bearer ghp_exemplo',
      },
    },
    responses: {
      201: { description: 'Servidor criado.', schema: SteelMcpServerDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, ADMIN_ONLY, SERVER_INVALID],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/agents/mcp-servers/{serverId}',
    tags: [TAG],
    summary: 'Atualizar servidor MCP',
    description:
      'Atualização parcial. `allowedTools` substitui a lista de ferramentas liberadas (só nomes que o servidor tem); `authValue: null` apaga a credencial. Trocar a URL zera a lista e o cache de ferramentas. Auditado (o valor da credencial não vai para a auditoria).',
    consent: true,
    params: { serverId: SERVER_PARAM },
    body: UpdateSteelMcpServerSchema,
    responses: {
      200: { description: 'Servidor atualizado.', schema: SteelMcpServerDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      ADMIN_ONLY,
      SERVER_NOT_FOUND,
      SERVER_INVALID,
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/agents/mcp-servers/{serverId}',
    tags: [TAG],
    summary: 'Remover servidor MCP',
    description:
      'Remove o servidor. Agentes que usavam as ferramentas dele passam a não vê-las. Auditado.',
    consent: true,
    params: { serverId: SERVER_PARAM },
    responses: {
      200: { description: 'Servidor removido.', schema: SteelMcpServerDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, ADMIN_ONLY, SERVER_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/mcp-servers/{serverId}/refresh',
    tags: [TAG],
    summary: 'Atualizar as ferramentas do servidor MCP',
    description:
      'Roda `tools/list` de novo e atualiza o cache; ferramentas que sumiram saem da lista liberada. Se o servidor não responder, a resposta traz `lastError` (o servidor continua cadastrado).',
    consent: true,
    params: { serverId: SERVER_PARAM },
    responses: {
      200: { description: 'Servidor atualizado.', schema: SteelMcpServerDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      ADMIN_ONLY,
      SERVER_NOT_FOUND,
      SERVER_INVALID,
    ],
  },
]

export function registerSteelAgentsGovernancePaths(
  registry: OpenApiRegistry,
): void {
  for (const route of routes) registry.registerRoute(route)
}
