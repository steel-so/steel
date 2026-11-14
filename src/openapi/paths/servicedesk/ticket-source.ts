import { z } from 'zod'
import {
  CreateSdTicketFromSourceSchema,
  SdTicketSourceQuerySchema,
} from '@/src/schemas/sd-ticket-source.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SdTicketSourceCreatedDTO,
  SdTicketSourceLinkDTO,
  SdTicketSourcePrefillDTO,
} from '../../schemas/servicedesk/ticket-source'

/**
 * ServiceDesk · chamado a partir de uma conversa ou de um registro do CRM —
 * `app/api/workspaces/[id]/servicedesk/tickets/{from-source,by-source}`.
 */

const TAG = ['ServiceDesk · Chamados'] as const
const BASE = '/workspaces/{id}/servicedesk/tickets'

const ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Não é membro do workspace ou o perfil não concede a permissão',
  },
  'WORKSPACE_SUSPENDED',
  {
    code: 'MODULE_DISABLED',
    when: 'Módulo ServiceDesk (ou CRM / Comunicação, conforme a origem) desabilitado',
  },
  { code: 'SD_NOT_AGENT', when: 'Solicitante (membro sem departamento)' },
  { code: 'VALIDATION_ERROR', when: 'Parâmetros inválidos' },
]

const SOURCE_NOT_FOUND: ErrorEntry = {
  code: 'SD_TICKET_SOURCE_NOT_FOUND',
  when: 'Conversa inexistente, de outro workspace ou fora da visão do usuário',
}

const ACCESS =
  'Acesso: **agente** do ServiceDesk com `sd-tickets` e acesso de leitura à origem (CRM: `leads`/`people`/`opportunities`; conversa da Comunicação: `conversations` e a visão por equipe).'

function d(...parts: string[]): string {
  return parts.join('\n\n')
}

export const sdTicketSourceRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/from-source`,
    tags: [...TAG],
    summary: 'Pré-visualizar o chamado de uma conversa ou registro',
    description: d(
      'Devolve o que o diálogo "Criar chamado" mostra: título sugerido, prévia da descrição (com as últimas mensagens da conversa), o contato e o cliente do ServiceDesk encontrados e os chamados em aberto da mesma origem.',
      ACCESS,
    ),
    query: SdTicketSourceQuerySchema,
    responses: {
      200: {
        description: 'Pré-preenchimento.',
        schema: SdTicketSourcePrefillDTO,
      },
    },
    errors: [...ERRORS, SOURCE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/from-source`,
    tags: [...TAG],
    summary: 'Criar chamado a partir de uma conversa ou registro',
    description: d(
      'Abre o chamado pelo mesmo caminho de qualquer outro (catálogo, SLA, roteamento, automações e a confirmação "chamado criado" ao cliente) e liga os dois lados: `whatsappConversationId` / `crmLeadId` / `crmPersonId` / `crmOpportunityId` no chamado e uma atividade na linha do tempo da pessoa, oportunidade e empresa.',
      'Conversa da Comunicação (`COMMUNICATION`) e do ServiceDesk (`SERVICE_DESK`) são aceitas; a da Comunicação continua no zap e o chamado a lê e responde pela mesma conexão.',
      'Com um chamado em aberto na origem, responde `SD_TICKET_SOURCE_HAS_OPEN_TICKET` a menos que `allowDuplicate` seja `true`.',
      ACCESS,
    ),
    consent: true,
    body: CreateSdTicketFromSourceSchema,
    responses: {
      201: {
        description: 'Chamado criado.',
        schema: SdTicketSourceCreatedDTO,
      },
    },
    errors: [
      ...ERRORS,
      SOURCE_NOT_FOUND,
      {
        code: 'SD_TICKET_SOURCE_HAS_OPEN_TICKET',
        when: 'A origem já tem um chamado em aberto e `allowDuplicate` não foi enviado',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/by-source`,
    tags: [...TAG],
    summary: 'Chamados ligados a uma conversa ou registro',
    description: d(
      'Chamados (não excluídos) abertos a partir da conversa ou do lead, pessoa ou oportunidade, do mais novo ao mais antigo. Alimenta a faixa da conversa do zap e a linha do tempo dos registros do CRM.',
      'Acesso: **agente** do ServiceDesk com `sd-tickets`.',
    ),
    query: SdTicketSourceQuerySchema,
    responses: {
      200: {
        description: 'Chamados ligados à origem.',
        schema: z.array(SdTicketSourceLinkDTO),
      },
    },
    errors: ERRORS,
  },
]
