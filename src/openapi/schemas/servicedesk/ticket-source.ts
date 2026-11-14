import { z } from 'zod'
import { dto } from '../../common'

/** DTOs de "criar chamado a partir de conversa ou registro do CRM" (`types/sd-ticket-source.d.ts`). */

export const SdTicketSourceLinkDTO = dto(
  'SdTicketSourceLink',
  z.object({
    id: z.string().meta({ example: 'ckw1ticket0000ab7d3k1e5xyz' }),
    number: z.number().meta({ example: 42 }),
    code: z.string().meta({ example: 'REQ-000042' }),
    title: z.string(),
    type: z.enum(['INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM']),
    phaseName: z.string().meta({ example: 'Em atendimento' }),
    phaseCategory: z
      .string()
      .meta({ example: 'IN_PROGRESS', description: 'Categoria da fase.' }),
    open: z.boolean().meta({
      description:
        '`false` quando o chamado já foi resolvido, fechado ou cancelado.',
    }),
    createdAt: z.string().meta({ example: '2026-11-13T17:05:00.000Z' }),
    href: z.string().meta({
      example: '/acme/servicedesk/tickets/42',
      description: 'Caminho interno do chamado.',
    }),
  }),
)

const NamedRef = z.object({ id: z.string(), name: z.string() }).nullable()

export const SdTicketSourcePrefillDTO = dto(
  'SdTicketSourcePrefill',
  z.object({
    source: z.enum(['conversation', 'lead', 'person', 'opportunity']),
    sourceId: z.string(),
    sourceLabel: z.string().meta({ example: 'Ana Souza' }),
    title: z.string().meta({ description: 'Título sugerido (editável).' }),
    descriptionPreview: z.string().meta({
      description: 'Texto da descrição que será gravada no chamado.',
    }),
    messageCount: z.number().meta({
      description: 'Quantas mensagens da conversa entram na descrição.',
    }),
    requester: z.object({
      name: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
    }),
    contact: NamedRef.meta({
      description: 'Contato do ServiceDesk encontrado por telefone ou e-mail.',
    }),
    customer: NamedRef.meta({
      description:
        'Cliente do ServiceDesk (vínculo do contato, CNPJ ou nome exato da empresa).',
    }),
    openTickets: z.array(SdTicketSourceLinkDTO).meta({
      description: 'Chamados em aberto da mesma origem (aviso de duplicidade).',
    }),
    connectionNote: z.string().nullable().meta({
      description:
        'Aviso sobre a conexão do WhatsApp (conversa da Comunicação).',
    }),
  }),
)

export const SdTicketSourceCreatedDTO = dto(
  'SdTicketSourceCreated',
  z.object({
    ticket: SdTicketSourceLinkDTO,
    conversationLinked: z.boolean().meta({
      description:
        '`true` quando a conversa do WhatsApp ficou vinculada ao chamado (aba WhatsApp).',
    }),
  }),
)
