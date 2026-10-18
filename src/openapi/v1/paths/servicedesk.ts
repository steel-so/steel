import {
  CreateV1SdTicketCommentSchema,
  ListV1SdCatalogSchema,
  ListV1SdTicketsSchema,
} from '@/src/schemas/api-v1.schema'
import {
  CreateSdTicketSchema,
  MoveSdTicketPhaseSchema,
} from '@/src/schemas/sd-ticket.schema'
import type { ErrorEntry, OpenApiRegistry } from '../../registry'
import { SdTicketMessageDTO } from '../../schemas/servicedesk/ticket-tabs'
import { SdCategoryDTO } from '../../schemas/servicedesk-config'
import { SdTicketDTO } from '../../schemas/servicedesk-tickets'
import { v1Page } from '../schemas'
import {
  moduleErrors,
  PAGINATION_NOTE,
  V1_READ,
  V1_WRITE,
  WRITE_ERRORS,
} from './shared'

/** v1 · ServiceDesk — `app/api/v1/servicedesk/**`, over `SdTicketService`. */

const TAG = 'v1 · ServiceDesk' as const
const TICKET_PARAM = {
  ticketId: 'Id do chamado, número (`123`) ou código (`INC-000123`).',
}
const ACCESS = moduleErrors('ServiceDesk')
const TICKET_ERRORS: ErrorEntry[] = [
  'SD_TICKET_NOT_FOUND',
  {
    code: 'SD_TICKET_FORBIDDEN',
    when: 'Solicitante sem vínculo com o chamado',
  },
]

export function registerV1ServiceDeskPaths(registry: OpenApiRegistry): void {
  registry.registerRoute({
    method: 'get',
    path: '/servicedesk/tickets',
    tags: [TAG],
    summary: 'Listar chamados',
    operationId: 'listTickets',
    description: `Chamados do workspace, dos mais novos para os mais antigos. Agentes veem todos; solicitantes, só os seus. ${PAGINATION_NOTE} ${V1_READ}`,
    auth: 'apiToken',
    query: ListV1SdTicketsSchema,
    responses: {
      200: {
        description: 'Página de chamados.',
        schema: v1Page('SdTicket', SdTicketDTO),
      },
    },
    errors: [
      ...ACCESS,
      { code: 'VALIDATION_ERROR', message: 'Cursor inválido' },
    ],
  })

  registry.registerRoute({
    method: 'get',
    path: '/servicedesk/tickets/{ticketId}',
    tags: [TAG],
    summary: 'Ver chamado',
    operationId: 'getTicket',
    description: V1_READ,
    auth: 'apiToken',
    params: TICKET_PARAM,
    responses: { 200: { description: 'Chamado.', schema: SdTicketDTO } },
    errors: [...ACCESS, ...TICKET_ERRORS],
  })

  registry.registerRoute({
    method: 'post',
    path: '/servicedesk/tickets',
    tags: [TAG],
    summary: 'Abrir chamado',
    operationId: 'createTicket',
    description: `Mesmas regras da abertura no app (modelo, prioridade, roteamento, SLA, automações). Canal \`API\` se o corpo não informar outro. Solicitantes abrem como no portal. ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    body: CreateSdTicketSchema,
    responses: { 201: { description: 'Chamado aberto.', schema: SdTicketDTO } },
    errors: [
      ...WRITE_ERRORS,
      ...ACCESS,
      'SD_CATEGORY_NOT_FOUND',
      'SD_DEPARTMENT_NOT_FOUND',
      'SD_CONFIG_NOT_FOUND',
      'SD_CUSTOM_FIELD_INVALID',
      { code: 'SD_PHASE_NOT_FOUND', when: 'O tipo não tem fase inicial ativa' },
      'SD_PORTAL_DISABLED',
      { code: 'SD_TICKET_FORBIDDEN', when: 'Tipo não permitido no portal' },
    ],
  })

  registry.registerRoute({
    method: 'post',
    path: '/servicedesk/tickets/{ticketId}/comments',
    tags: [TAG],
    summary: 'Comentar chamado',
    operationId: 'commentTicket',
    description: `Mensagem no histórico do chamado, pública (o solicitante vê e é avisado) ou interna (só agentes). Sem anexos na v1. ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    params: TICKET_PARAM,
    body: CreateV1SdTicketCommentSchema,
    responses: {
      201: { description: 'Comentário criado.', schema: SdTicketMessageDTO },
    },
    errors: [
      ...WRITE_ERRORS,
      ...ACCESS,
      ...TICKET_ERRORS,
      { code: 'SD_TICKET_CLOSED', when: 'Chamado fechado ou cancelado' },
    ],
  })

  registry.registerRoute({
    method: 'post',
    path: '/servicedesk/tickets/{ticketId}/phase',
    tags: [TAG],
    summary: 'Mudar fase do chamado',
    operationId: 'moveTicketPhase',
    description: `Só agentes. Respeita as transições, os requisitos da fase, aprovações e assinatura, como no app. ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    params: TICKET_PARAM,
    body: MoveSdTicketPhaseSchema,
    responses: {
      200: { description: 'Chamado na nova fase.', schema: SdTicketDTO },
    },
    errors: [
      ...WRITE_ERRORS,
      ...ACCESS,
      'SD_NOT_AGENT',
      ...TICKET_ERRORS,
      'SD_PHASE_NOT_FOUND',
      'SD_PHASE_TRANSITION_NOT_ALLOWED',
      'SD_PHASE_REQUIREMENTS_UNMET',
      'SD_APPROVAL_REQUIRED',
      'SD_SIGNATURE_REQUIRED',
    ],
  })

  registry.registerRoute({
    method: 'get',
    path: '/servicedesk/catalog',
    tags: [TAG],
    summary: 'Catálogo de serviços',
    operationId: 'listCatalog',
    description: `Categorias, subcategorias e serviços ativos numa lista plana e ordenada (\`level\` + \`parentId\`), para escolher onde abrir o chamado. Solicitantes veem só o que está visível no portal. ${PAGINATION_NOTE} ${V1_READ}`,
    auth: 'apiToken',
    query: ListV1SdCatalogSchema,
    responses: {
      200: {
        description: 'Página do catálogo.',
        schema: v1Page('SdCatalog', SdCategoryDTO),
      },
    },
    errors: [
      ...ACCESS,
      { code: 'VALIDATION_ERROR', message: 'Cursor inválido' },
    ],
  })
}
