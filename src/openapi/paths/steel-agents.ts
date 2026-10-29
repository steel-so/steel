import { z } from 'zod'
import {
  ApproveSteelAgentActionSchema,
  AssignSteelAgentSchema,
  CreateSteelAgentSchema,
  ListSteelAgentRunsQuerySchema,
  RestoreSteelAgentVersionSchema,
  UpdateSteelAgentSchema,
} from '@/src/schemas/steel-agent.schema'
import { WORKSPACE_MEMBER_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import {
  SteelAgentAssignmentDTO,
  SteelAgentCatalogDTO,
  SteelAgentDTO,
  SteelAgentRunDetailDTO,
  SteelAgentRunDTO,
  SteelAgentUpdateResultDTO,
  SteelAgentVersionListDTO,
  SteelAgentVersionRefDTO,
} from '../schemas/steel-agents'
import { AiPendingActionDTO } from '../schemas/steel-ai'

/** Steel Agents — agentes autônomos (`/workspaces/{id}/agents/**`). */

const TAG = 'Steel Agents' as const
const AGENT_PARAM = { description: 'ID do agente.' }
const RUN_PARAM = { description: 'ID da execução.' }
const ACTION_PARAM = {
  description: 'ID da ação pendente proposta pela execução.',
}

const MANAGE: ErrorEntry = {
  code: 'FORBIDDEN',
  when: 'Sem a permissão `steel-agents` (criar/editar/excluir é de admin)',
}
const AGENT_NOT_FOUND: ErrorEntry = {
  code: 'STEEL_AGENT_NOT_FOUND',
  when: 'Agente inexistente ou de outro workspace',
}
const RUN_NOT_FOUND: ErrorEntry = {
  code: 'STEEL_AGENT_RUN_NOT_FOUND',
  when: 'Execução inexistente ou de outro agente/workspace',
}
const VALIDATION: ErrorEntry[] = [
  'STEEL_AGENT_INVALID_TOOL',
  'STEEL_AGENT_INVALID_TRIGGER',
  'STEEL_AGENT_INVALID_OWNER',
  'STEEL_AGENT_EVAL_SET_INVALID',
]
const VERSION_PARAM = { description: 'ID da versão do agente.' }
const VERSION_NOT_FOUND: ErrorEntry = {
  code: 'STEEL_AGENT_VERSION_NOT_FOUND',
  when: 'Versão inexistente ou de outro agente/workspace',
}
const VERSION_STATE: ErrorEntry = {
  code: 'STEEL_AGENT_VERSION_INVALID_STATE',
  when: 'A versão não está num estado em que a ação vale',
}
const DECISION_ERRORS: ErrorEntry[] = [
  ...WORKSPACE_MEMBER_ERRORS,
  {
    code: 'FORBIDDEN',
    when: 'Quem decide é o responsável pelo agente ou um admin (`steel-agents` EDIT)',
  },
  RUN_NOT_FOUND,
  {
    code: 'AI_PENDING_ACTION_NOT_FOUND',
    when: 'Ação inexistente ou de outra execução',
  },
  'AI_PENDING_ACTION_NOT_PENDING',
]

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/agents',
    tags: [TAG],
    summary: 'Listar agentes',
    description:
      'Agentes do workspace com ferramentas permitidas e a última execução. Membros e visualizadores leem; só admins gerenciam.',
    responses: {
      200: { description: 'Agentes.', schema: z.array(SteelAgentDTO) },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents',
    tags: [TAG],
    summary: 'Criar agente',
    description:
      'Gatilho `SCHEDULE` exige `cron` de 5 campos (+ `timezone`); `EVENT` exige `eventKey` do catálogo; `MANUAL` só roda pelo botão. Cada ferramenta é `AUTO` (executa sozinha) ou `APPROVAL` (padrão — vira ação pendente aprovada na caixa de entrada); ferramentas de exclusão são sempre gravadas como `APPROVAL`. O responsável (`ownerId`) precisa ser membro: o agente roda com as permissões dele.',
    consent: true,
    body: {
      schema: CreateSteelAgentSchema,
      example: {
        name: 'Triagem de chamados',
        instructions:
          'Classifique cada chamado novo e sugira a prioridade com base no impacto descrito.',
        triggerType: 'EVENT',
        eventKey: 'sd.ticket.created',
        ownerId: 'ckw1user0000ab7d3k1e5xyz',
        tools: [
          { toolName: 'sd_get_ticket', mode: 'AUTO' },
          { toolName: 'sd_update_ticket', mode: 'APPROVAL' },
        ],
      },
    },
    responses: {
      201: { description: 'Agente criado.', schema: SteelAgentDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, MANAGE, ...VALIDATION],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/catalog',
    tags: [TAG],
    summary: 'Catálogo do editor',
    description:
      'Ferramentas do registro (`STEEL_AI_TOOLS`) e eventos disponíveis para os módulos habilitados, o interruptor do modo agente e se o usuário pode gerenciar agentes.',
    responses: {
      200: { description: 'Catálogo.', schema: SteelAgentCatalogDTO },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/{agentId}',
    tags: [TAG],
    summary: 'Detalhar agente',
    params: { agentId: AGENT_PARAM },
    responses: { 200: { description: 'Agente.', schema: SteelAgentDTO } },
    errors: [...WORKSPACE_MEMBER_ERRORS, AGENT_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/agents/{agentId}',
    tags: [TAG],
    summary: 'Atualizar agente',
    description:
      'Atualização parcial; `tools`, quando enviado, substitui a lista inteira. `enabled: false` pausa o agente. O gatilho é revalidado sobre o resultado. Mudar `instructions`, `tools` ou `maxToolRounds` cria uma **versão** (campo `version` da resposta): com `evalSetId` configurado ela fica `PENDING_EVAL` até a avaliação terminar (os campos do agente seguem na versão publicada) e só é publicada se a taxa de aprovação atingir `evalMinPassRate`; sem conjunto, é publicada na hora. `rolloutPercent` (1 a 99) manda a versão nova para essa parcela das execuções (teste A/B) em vez de substituir a publicada. `changeNote` descreve a alteração no histórico.',
    consent: true,
    params: { agentId: AGENT_PARAM },
    body: UpdateSteelAgentSchema,
    responses: {
      200: {
        description: 'Agente atualizado e a versão criada, se houve.',
        schema: SteelAgentUpdateResultDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      MANAGE,
      AGENT_NOT_FOUND,
      ...VALIDATION,
      {
        code: 'STEEL_AGENT_VERSION_PENDING',
        when: 'Já existe uma versão do agente em avaliação',
      },
      {
        code: 'AI_DISABLED',
        when: 'Há trava de avaliação e o Steel AI está desligado',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/agents/{agentId}',
    tags: [TAG],
    summary: 'Excluir agente',
    description:
      'Exclui o agente, as execuções e as ações pendentes delas. O histórico de escritas da IA (`ai_action_logs`) permanece.',
    consent: true,
    params: { agentId: AGENT_PARAM },
    responses: {
      200: { description: 'Agente excluído.', schema: SteelAgentDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, MANAGE, AGENT_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/{agentId}/run',
    tags: [TAG],
    summary: 'Executar agora',
    description:
      'Enfileira uma execução `MANUAL` (o worker a roda). Responsável ou admin. Agente pausado responde `STEEL_AGENT_DISABLED`.',
    consent: true,
    params: { agentId: AGENT_PARAM },
    responses: {
      202: { description: 'Execução enfileirada.', schema: SteelAgentRunDTO },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      { code: 'FORBIDDEN', when: 'Nem responsável nem admin' },
      AGENT_NOT_FOUND,
      'STEEL_AGENT_DISABLED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/{agentId}/test',
    tags: [TAG],
    summary: 'Testar agente',
    description:
      'Enfileira uma execução de teste (`isTest: true`): as leituras rodam de verdade e toda escrita é simulada no servidor a partir da prévia — nada é gravado nem enviado, nenhuma aprovação vai para a inbox. Não conta no limite mensal, não mexe no agendamento e não aparece como última execução. Responsável ou admin; funciona com o agente pausado e com o modo agente desligado.',
    consent: true,
    params: { agentId: AGENT_PARAM },
    responses: {
      202: {
        description: 'Execução de teste enfileirada.',
        schema: SteelAgentRunDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      { code: 'FORBIDDEN', when: 'Nem responsável nem admin' },
      AGENT_NOT_FOUND,
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/{agentId}/versions',
    tags: [TAG],
    summary: 'Versões do agente',
    description:
      'Histórico de versões (mais nova primeiro) com o resultado da avaliação que travou cada uma e as métricas das execuções reais (sucesso, custo médio, taxa de aprovação das ações) usadas na comparação A/B. Execuções de teste não contam.',
    params: { agentId: AGENT_PARAM },
    responses: {
      200: { description: 'Versões.', schema: SteelAgentVersionListDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, AGENT_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/{agentId}/versions/{versionId}/promote',
    tags: [TAG],
    summary: 'Promover versão do teste A/B',
    description:
      'Publica a versão `CHALLENGER` para 100% das execuções; a publicada vira `SUPERSEDED` e os campos do agente passam a espelhar a nova.',
    consent: true,
    params: { agentId: AGENT_PARAM, versionId: VERSION_PARAM },
    responses: {
      200: {
        description: 'Versão publicada.',
        schema: SteelAgentVersionRefDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      MANAGE,
      AGENT_NOT_FOUND,
      VERSION_NOT_FOUND,
      VERSION_STATE,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/{agentId}/versions/{versionId}/discard',
    tags: [TAG],
    summary: 'Descartar versão',
    description:
      'Encerra uma versão `PENDING_EVAL` ou `CHALLENGER` sem publicá-la (no A/B, o tráfego volta todo para a publicada).',
    consent: true,
    params: { agentId: AGENT_PARAM, versionId: VERSION_PARAM },
    responses: {
      200: {
        description: 'Versão descartada.',
        schema: SteelAgentVersionRefDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      MANAGE,
      AGENT_NOT_FOUND,
      VERSION_NOT_FOUND,
      VERSION_STATE,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/{agentId}/versions/{versionId}/restore',
    tags: [TAG],
    summary: 'Restaurar versão antiga',
    description:
      'Cria uma **nova** versão com o conteúdo de uma `SUPERSEDED`, `REJECTED` ou `DISCARDED`. Ela passa pela mesma trava de avaliação (e A/B opcional) de qualquer edição — reverter também não é cego.',
    consent: true,
    params: { agentId: AGENT_PARAM, versionId: VERSION_PARAM },
    body: { schema: RestoreSteelAgentVersionSchema, required: false },
    responses: {
      201: {
        description: 'Nova versão criada.',
        schema: SteelAgentVersionRefDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      MANAGE,
      AGENT_NOT_FOUND,
      VERSION_NOT_FOUND,
      VERSION_STATE,
      {
        code: 'STEEL_AGENT_VERSION_PENDING',
        when: 'Já existe uma versão do agente em avaliação',
      },
      'STEEL_AGENT_EVAL_SET_INVALID',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/{agentId}/runs',
    tags: [TAG],
    summary: 'Histórico de execuções',
    description: 'Execuções mais recentes primeiro (padrão 20, máx. 100).',
    params: { agentId: AGENT_PARAM },
    query: ListSteelAgentRunsQuerySchema,
    responses: {
      200: { description: 'Execuções.', schema: z.array(SteelAgentRunDTO) },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, AGENT_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/{agentId}/runs/{runId}/rerun',
    tags: [TAG],
    summary: 'Reexecutar como teste',
    description:
      'Cria uma execução de teste (`isTest: true`, `rerunOfId` apontando para a original) com o **mesmo gatilho e os mesmos dados de entrada** da execução indicada. Leituras reais, escritas simuladas; não conta no limite mensal. Responsável ou admin; funciona com o agente pausado.',
    consent: true,
    params: { agentId: AGENT_PARAM, runId: RUN_PARAM },
    responses: {
      202: {
        description: 'Execução de teste enfileirada.',
        schema: SteelAgentRunDTO,
      },
    },
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      { code: 'FORBIDDEN', when: 'Nem responsável nem admin' },
      AGENT_NOT_FOUND,
      RUN_NOT_FOUND,
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/agents/{agentId}/runs/{runId}',
    tags: [TAG],
    summary: 'Detalhar execução',
    description:
      'Linha do tempo com o porquê de cada passo (raciocínio do modelo, ferramentas com o contexto recuperado, regras de guardrail acionadas e aprovações), ações propostas com prévia e se o usuário pode aprová-las.',
    params: { agentId: AGENT_PARAM, runId: RUN_PARAM },
    responses: {
      200: { description: 'Execução.', schema: SteelAgentRunDetailDTO },
    },
    errors: [...WORKSPACE_MEMBER_ERRORS, RUN_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/runs/{runId}/actions/{actionId}/approve',
    tags: [TAG],
    summary: 'Aprovar ação do agente',
    description:
      'Executa a escrita proposta **com as permissões do responsável** pelo agente (o servidor revalida acesso dele, modo agente, módulo, permissão e se a ferramenta continua permitida). Exclusões exigem `doubleConfirmed: true`. Se a prévia montada de novo a partir dos registros atuais difere da que foi aprovada, responde `409 AI_PENDING_ACTION_CHANGED` sem executar (prévia nova em `error.details.action`; a ação segue pendente). Idempotente: outra aprovação devolve o resultado da primeira. Depois da decisão a execução retoma sozinha.',
    consent: true,
    params: { runId: RUN_PARAM, actionId: ACTION_PARAM },
    body: { schema: ApproveSteelAgentActionSchema, required: false },
    responses: {
      200: { description: 'Ação decidida.', schema: AiPendingActionDTO },
    },
    errors: [
      ...DECISION_ERRORS,
      'AI_PENDING_ACTION_EXPIRED',
      'AI_PENDING_ACTION_CHANGED',
      'AI_DOUBLE_CONFIRMATION_REQUIRED',
      'AI_AGENT_MODE_DISABLED',
      'AI_TOOL_NOT_ALLOWED',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/agents/runs/{runId}/actions/{actionId}/reject',
    tags: [TAG],
    summary: 'Rejeitar ação do agente',
    description:
      'Descarta a escrita proposta; nada é alterado e a execução retoma sabendo da rejeição.',
    consent: true,
    params: { runId: RUN_PARAM, actionId: ACTION_PARAM },
    responses: {
      200: { description: 'Ação rejeitada.', schema: AiPendingActionDTO },
    },
    errors: DECISION_ERRORS,
  },
]

function assignmentRoutes(input: {
  path: string
  param: string
  paramDescription: string
  what: string
  access: string
  errors: ErrorEntry[]
}): RouteConfig[] {
  const params = { [input.param]: input.paramDescription }
  return [
    {
      method: 'get',
      path: input.path,
      tags: [TAG],
      summary: `Agente atribuído ao ${input.what}`,
      description: `Qual Steel Agent recebeu o ${input.what} (\`agent: null\` quando ninguém). ${input.access}`,
      params,
      responses: {
        200: {
          description: 'Atribuição atual.',
          schema: SteelAgentAssignmentDTO,
        },
      },
      errors: input.errors,
    },
    {
      method: 'put',
      path: input.path,
      tags: [TAG],
      summary: `Atribuir o ${input.what} a um agente`,
      description: `Entrega o ${input.what} a um Steel Agent do workspace (um por registro; trocar substitui o anterior) e enfileira uma execução do agente com o registro como contexto — o agente roda mesmo que o gatilho dele seja manual ou agendado. \`agentId: null\` remove a atribuição sem executar nada. Agente pausado responde \`STEEL_AGENT_DISABLED\`. ${input.access}`,
      consent: true,
      params,
      body: AssignSteelAgentSchema,
      responses: {
        200: {
          description: 'Atribuição atualizada.',
          schema: SteelAgentAssignmentDTO,
        },
      },
      errors: [...input.errors, AGENT_NOT_FOUND, 'STEEL_AGENT_DISABLED'],
    },
  ]
}

routes.push(
  ...assignmentRoutes({
    path: '/workspaces/{id}/servicedesk/tickets/{ticketId}/agent',
    param: 'ticketId',
    paramDescription: 'Id do chamado, número (`123`) ou código (`INC-000123`).',
    what: 'chamado',
    access:
      'Acesso: agente do ServiceDesk com a permissão `sd-tickets` (EDIT para atribuir, VIEW para ler).',
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      { code: 'SD_NOT_AGENT', when: 'Quem chama não é agente do ServiceDesk' },
      { code: 'SD_TICKET_NOT_FOUND', when: 'Chamado inexistente' },
      {
        code: 'SD_TICKET_CLOSED',
        when: 'Chamado fechado ou cancelado (só ao atribuir)',
      },
    ],
  }),
  ...assignmentRoutes({
    path: '/workspaces/{id}/crm/leads/{leadId}/agent',
    param: 'leadId',
    paramDescription: 'Id do lead.',
    what: 'lead',
    access:
      'Acesso: módulo **CRM** habilitado e a permissão `leads` (EDIT para atribuir, VIEW para ler).',
    errors: [
      ...WORKSPACE_MEMBER_ERRORS,
      { code: 'FORBIDDEN', when: 'Sem a permissão `leads`' },
      { code: 'RESOURCE_NOT_FOUND', when: 'Lead inexistente' },
    ],
  }),
)

export function registerSteelAgentsPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
