import { z } from 'zod'
import {
  Customer360QuerySchema,
  OpenCustomerWhatsappSchema,
} from '@/src/schemas/customer-360.schema'
import { dto } from '../../common'
import type { RouteConfig } from '../../registry'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * Visão 360 do cliente: o que o workspace sabe de uma pessoa ou empresa em
 * CRM, ServiceDesk e WhatsApp, numa só leitura. Cada bloco respeita a
 * permissão do usuário no módulo de origem.
 */

const TAG = 'CRM · Pessoas e empresas'

const iso = () => z.iso.datetime()

const Customer360DTO = dto(
  'Customer360',
  z.object({
    match: z
      .enum(['person', 'company', 'phone', 'email', 'cnpj', 'name', 'none'])
      .meta({
        description: 'Como o cliente foi encontrado.',
      }),
    available: z.object({
      crm: z.boolean(),
      servicedesk: z.boolean(),
      whatsapp: z.boolean(),
    }),
    person: z
      .object({
        id: z.string(),
        name: z.string(),
        jobTitle: z.string().nullable(),
        emails: z.array(z.string()),
        phones: z.array(z.string()),
        companyId: z.string().nullable(),
      })
      .nullable(),
    company: z
      .object({
        id: z.string(),
        name: z.string(),
        cnpj: z.string().nullable(),
        arr: z.number().nullable(),
        accountOwnerId: z.string().nullable(),
        accountOwnerName: z.string().nullable(),
      })
      .nullable(),
    health: z
      .object({
        level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        levelLabel: z.string(),
        riskScore: z.number().int(),
        healthScore: z.number().int(),
        nextActionLabel: z.string(),
        computedAt: iso(),
      })
      .nullable(),
    opportunities: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        amount: z.number().nullable(),
        stageName: z.string(),
        stageCategory: z.string(),
        pipelineName: z.string(),
        ownerName: z.string().nullable(),
        closeDate: iso().nullable(),
        updatedAt: iso(),
      }),
    ),
    leads: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        stage: z.string(),
        ownerName: z.string().nullable(),
        createdAt: iso(),
      }),
    ),
    tickets: z.array(
      z.object({
        id: z.string(),
        number: z.number().int(),
        title: z.string(),
        type: z.string(),
        phaseName: z.string(),
        phaseCategory: z.string(),
        priorityName: z.string().nullable(),
        open: z.boolean(),
        slaBreached: z.boolean(),
        resolutionDueAt: iso().nullable(),
        csatScore: z.number().int().nullable(),
        createdAt: iso(),
      }),
    ),
    openTickets: z.number().int(),
    conversations: z.array(
      z.object({
        id: z.string(),
        contactName: z.string().nullable(),
        contactPhone: z.string(),
        status: z.string(),
        connectionLabel: z.string(),
        lastMessageAt: iso().nullable(),
      }),
    ),
    calls: z.array(
      z.object({
        id: z.string(),
        direction: z.string(),
        status: z.string(),
        durationSeconds: z.number().int().nullable(),
        summary: z.string().nullable(),
        conversationId: z.string().nullable(),
        createdAt: iso(),
      }),
    ),
    documents: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.string(),
        status: z.string(),
        totalValue: z.number().nullable(),
        updatedAt: iso(),
      }),
    ),
  }),
)

export const crmCustomer360Routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/customer-360',
    tags: [TAG],
    summary: 'Visão 360 do cliente',
    description: describe(
      'Junta, para uma pessoa ou empresa, as oportunidades, a saúde, os leads abertos, os chamados do ServiceDesk (com SLA e satisfação), as conversas e ligações do WhatsApp e os documentos. Parte de `personId`, `companyId`, `phone`, `ticketId` ou `conversationId`. CRM, ServiceDesk e WhatsApp não têm vínculo entre si: o cliente é encontrado por telefone, CNPJ, e-mail ou nome exato (`match`). Um bloco sem permissão ou de módulo desligado vem vazio e `available` diz qual. Chamados exigem agente do ServiceDesk e conversas respeitam o escopo de equipes.',
      crmAccess('people', 'VIEW'),
    ),
    query: Customer360QuerySchema,
    responses: {
      200: { description: 'Visão 360.', schema: Customer360DTO },
    },
    errors: [
      ...CRM_ERRORS,
      'VALIDATION_ERROR',
      {
        code: 'WHATSAPP_CONVERSATION_NOT_FOUND',
        when: 'A conversa não existe ou o usuário não a enxerga (escopo de equipes)',
      },
      {
        code: 'SD_NOT_AGENT',
        when: 'Veio `ticketId` e o usuário não é agente do ServiceDesk',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/customer-360/whatsapp',
    tags: [TAG],
    summary: 'Abrir o WhatsApp de uma pessoa, empresa ou oportunidade',
    description: describe(
      'Devolve a conversa aberta do telefone do cadastro no módulo Comunicação ou abre uma nova. Para empresa usa o primeiro contato com telefone; para oportunidade, o contato principal. Exige também o módulo Comunicação e a permissão de criar conversas.',
      crmAccess('people', 'VIEW'),
    ),
    body: OpenCustomerWhatsappSchema,
    responses: {
      200: {
        description: 'Conversa a abrir.',
        schema: dto(
          'Customer360WhatsappConversation',
          z.object({
            conversationId: z.string(),
            contactId: z.string(),
            phone: z.string(),
          }),
        ),
      },
    },
    errors: [
      ...CRM_ERRORS,
      'MODULE_DISABLED',
      'VALIDATION_ERROR',
      { code: 'CRM_PERSON_NOT_FOUND', when: 'Pessoa ou empresa inexistente' },
      {
        code: 'CRM_OPPORTUNITY_NOT_FOUND',
        when: 'Oportunidade inexistente',
      },
      {
        code: 'WHATSAPP_CONNECTION_NOT_FOUND',
        when: 'O workspace não tem conexão de WhatsApp',
      },
    ],
  },
]
