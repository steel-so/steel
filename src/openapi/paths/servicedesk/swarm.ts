import {
  CloseSdSwarmSchema,
  InviteSdSwarmSchema,
  RespondSdSwarmSchema,
  StartSdSwarmSchema,
} from '@/src/schemas/sd-swarm.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { SdSwarmDTO, SdSwarmListDTO } from '../../schemas/servicedesk/swarm'

/**
 * ServiceDesk · Swarming de especialistas —
 * `app/api/workspaces/[id]/servicedesk/tickets/[ticketId]/swarms/**`.
 * Especialistas são chamados direto para o chamado, sem os níveis N1/N2/N3.
 */

const SWARM = 'ServiceDesk · Execução do atendimento' as const

const ticket = '/workspaces/{id}/servicedesk/tickets/{ticketId}'
const collection = `${ticket}/swarms`
const item = `${collection}/{swarmId}`

const PARAMS = {
  ticketId: 'Id do chamado, número (`123`) ou código (`INC-000123`).',
}
const ITEM_PARAMS = { ...PARAMS, swarmId: 'Id do swarming.' }

const ACCESS =
  'Acesso: sessão + membro com o módulo **ServiceDesk** habilitado e a permissão `sd-tickets` do tipo da ação.'

const BASE_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Não é membro do workspace ou o perfil não concede a permissão',
  },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
  'SD_TICKET_NOT_FOUND',
  { code: 'SD_TICKET_FORBIDDEN', when: 'Sem vínculo com o chamado' },
]
const AGENT_ERRORS: ErrorEntry[] = [
  ...BASE_ERRORS,
  { code: 'SD_NOT_AGENT', when: 'Não é agente nem foi convidado' },
]
const NOT_FOUND: ErrorEntry = {
  code: 'SD_SWARM_NOT_FOUND',
  when: 'Swarming inexistente ou de outro chamado',
}
const CLOSED: ErrorEntry = {
  code: 'SD_SWARM_CLOSED',
  when: 'O swarming já foi encerrado',
}
const MEMBERS: ErrorEntry = {
  code: 'VALIDATION_ERROR',
  when: 'Usuário que não é membro do workspace, ou lista vazia',
}

export const sdSwarmRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: collection,
    tags: [SWARM],
    summary: 'Listar swarmings do chamado',
    description: `Do mais recente ao mais antigo, com a situação de cada convidado e do canal do Slack. \`slackAvailable\` diz se o workspace pode abrir o canal. Agentes e convidados. ${ACCESS}`,
    params: PARAMS,
    responses: { 200: { description: 'Swarmings.', schema: SdSwarmListDTO } },
    errors: AGENT_ERRORS,
  },
  {
    method: 'post',
    path: collection,
    tags: [SWARM],
    summary: 'Chamar especialistas (abrir swarming)',
    description: `Cada convidado vira participante do chamado e é avisado (\`swarm.invited\`). Um chamado tem no máximo um swarming aberto. Com \`openSlackChannel\`, abre um canal privado temporário no Slack; se o Slack falhar o swarming abre mesmo assim e o motivo vem em \`slack.error\`. Só agentes. Auditado. ${ACCESS}`,
    consent: true,
    params: PARAMS,
    body: StartSdSwarmSchema,
    responses: { 201: { description: 'Swarming aberto.', schema: SdSwarmDTO } },
    errors: [
      ...AGENT_ERRORS,
      MEMBERS,
      { code: 'SD_TICKET_CLOSED', when: 'Chamado fechado ou cancelado' },
      {
        code: 'SD_SWARM_ALREADY_OPEN',
        when: 'O chamado já tem um swarming aberto',
      },
    ],
  },
  {
    method: 'post',
    path: `${item}/invite`,
    tags: [SWARM],
    summary: 'Convidar mais especialistas',
    description: `Quem recusou é convidado de novo; quem já está no swarming é ignorado. Limite de especialistas por swarming em \`maxMembers\`. Só agentes. Auditado. ${ACCESS}`,
    consent: true,
    params: ITEM_PARAMS,
    body: InviteSdSwarmSchema,
    responses: { 200: { description: 'Swarming.', schema: SdSwarmDTO } },
    errors: [
      ...AGENT_ERRORS,
      NOT_FOUND,
      CLOSED,
      MEMBERS,
      {
        code: 'SD_SWARM_LIMIT_REACHED',
        when: 'Passaria do máximo de especialistas',
      },
    ],
  },
  {
    method: 'post',
    path: `${item}/respond`,
    tags: [SWARM],
    summary: 'Entrar ou recusar o convite',
    description: `Só o próprio convidado responde. O agente que abriu o swarming é avisado (\`swarm.responded\`). ${ACCESS}`,
    consent: true,
    params: ITEM_PARAMS,
    body: RespondSdSwarmSchema,
    responses: { 200: { description: 'Swarming.', schema: SdSwarmDTO } },
    errors: [
      ...BASE_ERRORS,
      NOT_FOUND,
      CLOSED,
      { code: 'SD_SWARM_NOT_INVITED', when: 'Você não foi convidado' },
    ],
  },
  {
    method: 'post',
    path: `${item}/close`,
    tags: [SWARM],
    summary: 'Encerrar o swarming',
    description: `Registra o resultado no histórico do chamado e, se houver canal no Slack, posta o resumo e arquiva o canal. O corpo é opcional. Só agentes. Auditado. ${ACCESS}`,
    consent: true,
    params: ITEM_PARAMS,
    body: CloseSdSwarmSchema,
    responses: { 200: { description: 'Swarming.', schema: SdSwarmDTO } },
    errors: [...AGENT_ERRORS, NOT_FOUND, CLOSED],
  },
]
