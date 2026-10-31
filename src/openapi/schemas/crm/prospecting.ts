import { z } from 'zod'
import { dto } from '../../common'

/** DTOs do agente de prospecção (`types/crm-prospecting.d.ts`). */

const channel = () =>
  z.enum(['EMAIL', 'WHATSAPP']).meta({ description: 'Canal do primeiro contato.' })

export const CrmProspectingSettingsDTO = dto(
  'CrmProspectingSettings',
  z.object({
    enabled: z.boolean().meta({
      description:
        'Liga a prospecção com IA no workspace. Desligada por padrão: sem isso as ferramentas de pesquisa e de rascunho recusam a chamada.',
    }),
    monthlyWebLimit: z.number().int().meta({
      description: 'Pesquisas e leituras de página por mês (UTC).',
    }),
    monthlyDraftLimit: z.number().int().meta({
      description: 'Rascunhos que o agente pode salvar por mês (UTC).',
    }),
    allowedChannels: z.array(channel()),
    valueProposition: z.string().nullable().meta({
      description: 'O que o workspace vende, nas palavras do time. Contexto do texto.',
    }),
    signalKeywords: z.array(z.string()).meta({
      description: 'Termos extras que o detector de sinais procura nas páginas.',
    }),
    searchAvailable: z.boolean().meta({
      description:
        'O ambiente tem chave de busca na web. Sem ela o agente só lê páginas por endereço.',
    }),
    updatedAt: z.iso.datetime().nullable(),
  }),
)

export const CrmProspectingUsageDTO = dto(
  'CrmProspectingUsage',
  z.object({
    period: z.iso.datetime().meta({ description: 'Primeiro dia do mês (UTC).' }),
    searches: z.number().int(),
    fetches: z.number().int(),
    drafts: z.number().int(),
    webLimit: z.number().int(),
    draftLimit: z.number().int(),
  }),
)

export const CrmProspectSignalDTO = dto(
  'CrmProspectSignal',
  z.object({
    type: z.enum([
      'HIRING',
      'FUNDING',
      'EXPANSION',
      'TECH_CHANGE',
      'LEADERSHIP_CHANGE',
      'TENDER',
      'LAUNCH',
      'PAIN',
      'CUSTOM',
    ]),
    label: z.string().meta({ description: 'Nome do sinal, em pt-BR.' }),
    evidence: z.string().meta({
      description: 'Frase da página que comprova o sinal.',
    }),
    sourceUrl: z.string().nullable(),
  }),
)

export const CrmProspectDraftDTO = dto(
  'CrmProspectDraft',
  z.object({
    id: z.string(),
    leadId: z.string().nullable(),
    companyId: z.string().nullable(),
    personId: z.string().nullable(),
    targetName: z.string(),
    channel: channel(),
    subject: z.string().nullable(),
    body: z.string(),
    toEmail: z.string().nullable(),
    toPhone: z.string().nullable(),
    summary: z.string().nullable(),
    signals: z.array(CrmProspectSignalDTO),
    sources: z.array(
      z.object({ url: z.string(), title: z.string().nullable() }),
    ),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SENT']).meta({
      description:
        '`PENDING` espera revisão; `APPROVED` foi liberado por uma pessoa; `SENT` ela confirmou o envio; `REJECTED` foi recusado.',
    }),
    agentId: z.string().nullable(),
    createdById: z.string(),
    decidedById: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    rejectReason: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)
