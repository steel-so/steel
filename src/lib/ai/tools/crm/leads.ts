import { z } from 'zod'
import {
  crmLeadAlreadyClosed,
  crmLeadReopenNotAllowed,
  crmLeadStageTransitionInvalid,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import {
  CreateCrmLeadSchema,
  CrmLeadStageEnum,
  UpdateCrmLeadSchema,
} from '@/src/schemas/crm-lead.schema'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import type { CrmLeadDTO } from '@/types/crm-lead'
import type { SteelAiTool } from '../types'
import {
  afterFields,
  changeFields,
  crmBase,
  formatMoney,
  LEAD_STAGE_LABELS,
  matchesQuery,
  memberNames,
  nothingToChange,
  ownerParameter,
  pageParameters,
  pageSchema,
  paginate,
  recordHref,
  resolveMember,
  zodParser,
} from './shared'

/** Compact lead for model payloads. */
export function compactLead(
  lead: CrmLeadDTO,
  base: string | null,
  owners: Map<string, string>,
) {
  return {
    id: lead.id,
    name: lead.name,
    company: lead.company,
    email: lead.emails[0] ?? null,
    phone: lead.phones[0] ?? null,
    source: lead.source,
    stage: lead.stage,
    stageLabel: LEAD_STAGE_LABELS[lead.stage],
    closeResult: lead.closeResult,
    lostReason: lead.lostReason,
    score: lead.score,
    ownerId: lead.ownerId,
    ownerName: lead.ownerId ? (owners.get(lead.ownerId) ?? null) : null,
    createdAt: lead.createdAt,
    href: recordHref(base, 'lead', lead.id),
  }
}

function leadTarget(lead: { id: string; name: string }, base: string | null) {
  return {
    type: 'crm_lead',
    id: lead.id,
    label: lead.name,
    href: recordHref(base, 'lead', lead.id),
  }
}

const LEAD_DESCRIPTION_FIELDS =
  'Etapas fixas do lead: RECEIVED (Lead recebido), IN_CONTACT (Em contato), QUALIFIED (Lead qualificado), OPPORTUNITY (Interesse/Oportunidade), PROPOSAL (Proposta), CLOSED (Fechado/Encerrado).'

/* ---------------------------------- list ---------------------------------- */

const ListLeadsArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  stage: CrmLeadStageEnum.optional(),
  status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
  owner: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  minScore: z.coerce.number().int().optional(),
  ...pageSchema,
})

export const crmListLeadsTool: SteelAiTool<z.output<typeof ListLeadsArgs>> = {
  name: 'crm_list_leads',
  label: 'Consultando leads',
  module: 'CRM',
  kind: 'READ',
  description: `Lista os leads do CRM com filtros e paginação — nome, empresa, contato, origem, etapa, pontuação e responsável, com link. ${LEAD_DESCRIPTION_FIELDS} \`status\`: OPEN (em aberto), WON (ganhos), LOST (perdidos).`,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Trecho do nome, empresa, e-mail ou telefone.',
      },
      stage: { type: 'string', enum: CrmLeadStageEnum.options },
      status: { type: 'string', enum: ['OPEN', 'WON', 'LOST'] },
      owner: ownerParameter,
      source: { type: 'string', description: 'Origem exata (ex.: "Site").' },
      minScore: { type: 'integer', description: 'Pontuação mínima.' },
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'leads', action: 'VIEW' },
  parse: zodParser(ListLeadsArgs),
  async execute(ctx, args) {
    const leads = await CrmLeadService.list(ctx.actorId, ctx.workspaceId, {
      stage: args.stage,
    })
    if (!leads.ok) return leads

    let ownerId: string | undefined
    if (args.owner) {
      const owner = await resolveMember(ctx, args.owner)
      if (!owner.ok) return owner
      ownerId = owner.value.id
    }

    const filtered = leads.value.filter(
      (l) =>
        matchesQuery(args.query, [
          l.name,
          l.company,
          ...l.emails,
          ...l.phones,
        ]) &&
        (!args.status ||
          (args.status === 'OPEN'
            ? l.closeResult === null
            : l.closeResult === args.status)) &&
        (!ownerId || l.ownerId === ownerId) &&
        (!args.source || matchesQuery(args.source, [l.source])) &&
        (args.minScore === undefined || l.score >= args.minScore),
    )

    const [base, owners] = await Promise.all([crmBase(ctx), memberNames(ctx)])
    const page = paginate(filtered, args, (l) => compactLead(l, base, owners))
    return ok({ data: page, summary: `${page.total} lead(s) encontrado(s)` })
  },
}

/* --------------------------------- create --------------------------------- */

export const crmCreateLeadTool: SteelAiTool<
  z.output<typeof CreateCrmLeadSchema>
> = {
  name: 'crm_create_lead',
  label: 'Criando lead',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria um lead no CRM (entra na etapa "Lead recebido"; pontuação e responsável vêm das regras do workspace). Requer nome, origem e ao menos um e-mail ou telefone. Se já existir um lead em aberto com o mesmo contato, a criação é recusada.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nome do lead.' },
      emails: { type: 'array', items: { type: 'string' } },
      phones: { type: 'array', items: { type: 'string' } },
      company: { type: 'string' },
      jobTitle: { type: 'string' },
      city: { type: 'string' },
      linkedin: { type: 'string' },
      source: { type: 'string', description: 'Origem do lead (obrigatório).' },
      channel: { type: 'string' },
    },
    required: ['name', 'source'],
    additionalProperties: false,
  },
  permission: { resource: 'leads', action: 'CREATE' },
  parse: zodParser(CreateCrmLeadSchema),
  async preview(_ctx, args) {
    return ok({
      title: `Criar o lead “${args.name}”`,
      summary: 'Um novo lead entra na etapa "Lead recebido".',
      fields: afterFields([
        ['Nome', args.name],
        ['E-mails', args.emails],
        ['Telefones', args.phones],
        ['Empresa', args.company],
        ['Cargo', args.jobTitle],
        ['Cidade', args.city],
        ['LinkedIn', args.linkedin],
        ['Origem', args.source],
        ['Canal', args.channel],
      ]),
      target: { type: 'crm_lead', label: args.name },
    })
  },
  async execute(ctx, args) {
    const lead = await CrmLeadService.create(ctx.actorId, ctx.workspaceId, args)
    if (!lead.ok) return lead
    const base = await crmBase(ctx)
    return ok({
      data: compactLead(lead.value, base, new Map()),
      summary: `Lead “${lead.value.name}” criado`,
      target: leadTarget(lead.value, base),
    })
  },
}

/* --------------------------------- update --------------------------------- */

const UpdateLeadArgs = UpdateCrmLeadSchema.omit({ ownerId: true })
  .extend({ leadId: z.string().min(1) })
  .refine((a) => Object.keys(a).some((k) => k !== 'leadId'), {
    message: 'Informe ao menos um campo para alterar',
  })

export const crmUpdateLeadTool: SteelAiTool<z.output<typeof UpdateLeadArgs>> = {
  name: 'crm_update_lead',
  label: 'Atualizando lead',
  module: 'CRM',
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera dados cadastrais de um lead (nome, contatos, empresa, cargo, cidade, LinkedIn, origem, canal). Envie só os campos que mudam; listas (emails/phones) substituem as atuais. Para responsável use crm_assign_owner; para fechar/reabrir, as ferramentas próprias.',
  parameters: {
    type: 'object',
    properties: {
      leadId: {
        type: 'string',
        description: 'Id do lead (de crm_list_leads ou ws_search).',
      },
      name: { type: 'string' },
      emails: { type: 'array', items: { type: 'string' } },
      phones: { type: 'array', items: { type: 'string' } },
      company: { type: 'string' },
      jobTitle: { type: 'string' },
      city: { type: 'string' },
      linkedin: { type: 'string' },
      source: { type: 'string' },
      channel: { type: 'string' },
    },
    required: ['leadId'],
    additionalProperties: false,
  },
  permission: { resource: 'leads', action: 'EDIT' },
  parse: zodParser(UpdateLeadArgs),
  async preview(ctx, args) {
    const lead = await CrmLeadService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
    )
    if (!lead.ok) return lead
    const before = lead.value
    const fields = changeFields([
      ['Nome', before.name, args.name],
      ['E-mails', before.emails, args.emails],
      ['Telefones', before.phones, args.phones],
      ['Empresa', before.company, args.company],
      ['Cargo', before.jobTitle, args.jobTitle],
      ['Cidade', before.city, args.city],
      ['LinkedIn', before.linkedin, args.linkedin],
      ['Origem', before.source, args.source],
      ['Canal', before.channel, args.channel],
    ])
    if (fields.length === 0) return err(nothingToChange())
    const base = await crmBase(ctx)
    return ok({
      title: `Atualizar o lead “${before.name}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: leadTarget(before, base),
    })
  },
  async execute(ctx, args) {
    const { leadId, ...dto } = args
    const lead = await CrmLeadService.update(
      ctx.actorId,
      ctx.workspaceId,
      leadId,
      dto,
    )
    if (!lead.ok) return lead
    const base = await crmBase(ctx)
    return ok({
      data: compactLead(lead.value, base, new Map()),
      summary: `Lead “${lead.value.name}” atualizado`,
      target: leadTarget(lead.value, base),
    })
  },
}

/* --------------------------------- delete --------------------------------- */

const LeadIdArgs = z.object({ leadId: z.string().min(1) })

export const crmDeleteLeadTool: SteelAiTool<z.output<typeof LeadIdArgs>> = {
  name: 'crm_delete_lead',
  label: 'Excluindo lead',
  module: 'CRM',
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui um lead do CRM: ele some das listas, buscas e relatórios. Não há ferramenta para desfazer; para encerrar uma negociação, prefira crm_close_lead_lost.',
  parameters: {
    type: 'object',
    properties: {
      leadId: {
        type: 'string',
        description: 'Id do lead (de crm_list_leads ou ws_search).',
      },
    },
    required: ['leadId'],
    additionalProperties: false,
  },
  permission: { resource: 'leads', action: 'DELETE' },
  parse: zodParser(LeadIdArgs),
  async preview(ctx, args) {
    const lead = await CrmLeadService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
    )
    if (!lead.ok) return lead
    const base = await crmBase(ctx)
    return ok({
      title: `Excluir o lead “${lead.value.name}”`,
      summary: 'O lead sai do painel e das listas do CRM.',
      fields: changeFields([
        ['Etapa', LEAD_STAGE_LABELS[lead.value.stage], 'Excluído'],
      ]),
      target: leadTarget(lead.value, base),
    })
  },
  async execute(ctx, args) {
    const lead = await CrmLeadService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
    )
    if (!lead.ok) return lead
    const removed = await CrmLeadService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
    )
    if (!removed.ok) return removed
    return ok({
      data: { id: args.leadId, deleted: true },
      summary: `Lead “${lead.value.name}” excluído`,
      target: { type: 'crm_lead', id: args.leadId, label: lead.value.name },
    })
  },
}

/* ------------------------------ close / reopen ----------------------------- */

const CloseWonArgs = z.object({
  leadId: z.string().min(1),
  closedAmount: z.coerce.number().nonnegative(),
  billingType: z.enum(['ONE_TIME', 'MONTHLY', 'YEARLY']),
  contractSignedAt: z.coerce.date(),
})

const BILLING_LABELS = {
  ONE_TIME: 'Pagamento único',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
} as const

export const crmCloseLeadWonTool: SteelAiTool<z.output<typeof CloseWonArgs>> = {
  name: 'crm_close_lead_won',
  label: 'Fechando lead como ganho',
  module: 'CRM',
  kind: 'ACTION',
  annotations: { destructiveHint: true },
  description:
    'Fecha um lead como GANHO (contrato assinado). Só vale para leads na etapa "Proposta" com a apresentação da proposta registrada. Converte o lead em pessoa. Pergunte valor fechado, tipo de cobrança e data da assinatura se o usuário não disse.',
  parameters: {
    type: 'object',
    properties: {
      leadId: {
        type: 'string',
        description: 'Id do lead (de crm_list_leads ou ws_search).',
      },
      closedAmount: { type: 'number', description: 'Valor fechado (R$).' },
      billingType: {
        type: 'string',
        enum: ['ONE_TIME', 'MONTHLY', 'YEARLY'],
        description: 'Cobrança: única, mensal ou anual.',
      },
      contractSignedAt: {
        type: 'string',
        description: 'Data da assinatura do contrato (AAAA-MM-DD).',
      },
    },
    required: ['leadId', 'closedAmount', 'billingType', 'contractSignedAt'],
    additionalProperties: false,
  },
  permission: { resource: 'leads', action: 'EDIT' },
  parse: zodParser(CloseWonArgs),
  async preview(ctx, args) {
    const lead = await CrmLeadService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
    )
    if (!lead.ok) return lead
    if (lead.value.stage === 'CLOSED') return err(crmLeadAlreadyClosed())
    if (lead.value.stage !== 'PROPOSAL') {
      return err(
        crmLeadStageTransitionInvalid(
          'Só é possível fechar como ganho a partir da etapa "Proposta"',
        ),
      )
    }
    const base = await crmBase(ctx)
    return ok({
      title: `Fechar o lead “${lead.value.name}” como ganho`,
      summary:
        'Ao confirmar, você declara que o contrato foi assinado. O lead vira uma pessoa no CRM.',
      fields: [
        ...changeFields([
          ['Etapa', LEAD_STAGE_LABELS[lead.value.stage], 'Fechado/Encerrado'],
          ['Resultado', null, 'Ganho'],
        ]),
        ...afterFields([
          ['Valor fechado', formatMoney(args.closedAmount)],
          ['Cobrança', BILLING_LABELS[args.billingType]],
          ['Contrato assinado em', args.contractSignedAt],
        ]),
      ],
      target: leadTarget(lead.value, base),
    })
  },
  async execute(ctx, args) {
    const { leadId, ...dto } = args
    // The human confirmation of the preview stands for the "contract signed"
    // checkbox of the UI.
    const person = await CrmLeadService.closeWon(
      ctx.actorId,
      ctx.workspaceId,
      leadId,
      { ...dto, contractSignedConfirmed: true },
    )
    if (!person.ok) return person
    const base = await crmBase(ctx)
    return ok({
      data: {
        leadId,
        closeResult: 'WON',
        person: {
          id: person.value.id,
          name: person.value.name,
          href: recordHref(base, 'person', person.value.id),
        },
      },
      summary: `Lead fechado como ganho; pessoa “${person.value.name}” vinculada`,
      target: {
        type: 'crm_lead',
        id: leadId,
        label: person.value.name,
        href: recordHref(base, 'lead', leadId),
      },
    })
  },
}

const CloseLostArgs = z.object({
  leadId: z.string().min(1),
  lostReason: z.string().trim().min(1, 'Informe o motivo da perda').max(200),
  lostNote: z.string().max(2000).optional(),
  retryAt: z.coerce.date().optional(),
})

export const crmCloseLeadLostTool: SteelAiTool<z.output<typeof CloseLostArgs>> =
  {
    name: 'crm_close_lead_lost',
    label: 'Fechando lead como perdido',
    module: 'CRM',
    kind: 'ACTION',
    annotations: { destructiveHint: false },
    description:
      'Fecha um lead como PERDIDO, com motivo obrigatório (e observação/data para tentar de novo, opcionais). Pergunte o motivo se o usuário não disse.',
    parameters: {
      type: 'object',
      properties: {
        leadId: {
          type: 'string',
          description: 'Id do lead (de crm_list_leads ou ws_search).',
        },
        lostReason: { type: 'string', description: 'Motivo da perda.' },
        lostNote: { type: 'string' },
        retryAt: {
          type: 'string',
          description: 'Quando tentar de novo (AAAA-MM-DD), opcional.',
        },
      },
      required: ['leadId', 'lostReason'],
      additionalProperties: false,
    },
    permission: { resource: 'leads', action: 'EDIT' },
    parse: zodParser(CloseLostArgs),
    async preview(ctx, args) {
      const lead = await CrmLeadService.getById(
        ctx.actorId,
        ctx.workspaceId,
        args.leadId,
      )
      if (!lead.ok) return lead
      if (lead.value.stage === 'CLOSED') return err(crmLeadAlreadyClosed())
      const base = await crmBase(ctx)
      return ok({
        title: `Fechar o lead “${lead.value.name}” como perdido`,
        summary: `Motivo: ${args.lostReason}`,
        fields: [
          ...changeFields([
            ['Etapa', LEAD_STAGE_LABELS[lead.value.stage], 'Fechado/Encerrado'],
            ['Resultado', null, 'Perdido'],
          ]),
          ...afterFields([
            ['Motivo', args.lostReason],
            ['Observação', args.lostNote],
            ['Tentar de novo em', args.retryAt],
          ]),
        ],
        target: leadTarget(lead.value, base),
      })
    },
    async execute(ctx, args) {
      const { leadId, ...dto } = args
      const lead = await CrmLeadService.closeLost(
        ctx.actorId,
        ctx.workspaceId,
        leadId,
        dto,
      )
      if (!lead.ok) return lead
      const base = await crmBase(ctx)
      return ok({
        data: compactLead(lead.value, base, new Map()),
        summary: `Lead “${lead.value.name}” fechado como perdido`,
        target: leadTarget(lead.value, base),
      })
    },
  }

const ReopenArgs = z.object({
  leadId: z.string().min(1),
  reason: z.string().trim().min(1, 'Informe o motivo da reabertura').max(1000),
})

export const crmReopenLeadTool: SteelAiTool<z.output<typeof ReopenArgs>> = {
  name: 'crm_reopen_lead',
  label: 'Reabrindo lead',
  module: 'CRM',
  kind: 'ACTION',
  annotations: { destructiveHint: false },
  description:
    'Reabre um lead PERDIDO (leads ganhos não reabrem). Ele volta para a etapa configurada no CRM, limitada ao que os registros do lead sustentam. Motivo obrigatório.',
  parameters: {
    type: 'object',
    properties: {
      leadId: {
        type: 'string',
        description: 'Id do lead (de crm_list_leads ou ws_search).',
      },
      reason: { type: 'string', description: 'Motivo da reabertura.' },
    },
    required: ['leadId', 'reason'],
    additionalProperties: false,
  },
  permission: { resource: 'leads', action: 'EDIT' },
  parse: zodParser(ReopenArgs),
  async preview(ctx, args) {
    const lead = await CrmLeadService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
    )
    if (!lead.ok) return lead
    if (lead.value.closeResult !== 'LOST') {
      return err(
        crmLeadReopenNotAllowed(
          lead.value.closeResult === 'WON'
            ? 'Leads ganhos não podem ser reabertos — o negócio já foi fechado'
            : undefined,
        ),
      )
    }
    const base = await crmBase(ctx)
    return ok({
      title: `Reabrir o lead “${lead.value.name}”`,
      summary: `Motivo: ${args.reason}`,
      fields: changeFields([
        ['Resultado', 'Perdido', 'Em aberto'],
        ['Motivo da perda', lead.value.lostReason, null],
      ]),
      target: leadTarget(lead.value, base),
    })
  },
  async execute(ctx, args) {
    const lead = await CrmLeadService.reopen(
      ctx.actorId,
      ctx.workspaceId,
      args.leadId,
      { reason: args.reason },
    )
    if (!lead.ok) return lead
    const base = await crmBase(ctx)
    return ok({
      data: compactLead(lead.value, base, new Map()),
      summary: `Lead “${lead.value.name}” reaberto em “${LEAD_STAGE_LABELS[lead.value.stage]}”`,
      target: leadTarget(lead.value, base),
    })
  },
}

export const CRM_LEAD_TOOLS = [
  crmListLeadsTool,
  crmCreateLeadTool,
  crmUpdateLeadTool,
  crmDeleteLeadTool,
  crmCloseLeadWonTool,
  crmCloseLeadLostTool,
  crmReopenLeadTool,
]
