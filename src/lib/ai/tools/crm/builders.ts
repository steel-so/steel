import { z } from 'zod'
import { ok } from '@/src/lib/result'
import { CreateCrmDashboardSchema } from '@/src/schemas/crm-dashboard.schema'
import {
  CreateCrmFormSchema,
  FIELD_TARGETS,
  FORM_ACTIONS,
  FORM_FIELD_TYPES,
  TARGET_ATTRIBUTES,
} from '@/src/schemas/crm-form.schema'
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
} from '@/src/schemas/document.schema'
import { CrmDashboardService } from '@/src/services/crm-dashboard.service'
import { CrmFormService } from '@/src/services/crm-form.service'
import { DocumentCrmService } from '@/src/services/document-crm.service'
import type { CrmDocumentSummaryDTO } from '@/types/crm-document-summary'
import type { SteelAiTool } from '../types'
import {
  afterFields,
  crmBase,
  crmPath,
  matchesQuery,
  pageParameters,
  pageSchema,
  paginate,
  zodParser,
} from './shared'

/*
 * Ports of the old CRM assistant's "create" tools (dashboard, form) and the
 * proposal tools of CRM > Documentos (ADR 0063): a proposal is a document of
 * kind PROPOSAL.
 */

export const crmCreateDashboardTool: SteelAiTool<
  z.output<typeof CreateCrmDashboardSchema>
> = {
  name: 'crm_create_dashboard',
  label: 'Criando dashboard',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria um dashboard vazio (sem widgets) no CRM; os widgets são montados depois no app do Steel, na tela do dashboard (o `href` devolvido).',
  parameters: {
    type: 'object',
    properties: { title: { type: 'string', description: 'Título.' } },
    required: ['title'],
    additionalProperties: false,
  },
  permission: { resource: 'dashboards', action: 'CREATE' },
  parse: zodParser(CreateCrmDashboardSchema),
  async preview(_ctx, args) {
    return ok({
      title: `Criar o dashboard “${args.title}”`,
      summary: 'Um dashboard vazio, para montar os widgets depois.',
      fields: afterFields([['Título', args.title]]),
      target: { type: 'crm_dashboard', label: args.title },
    })
  },
  async execute(ctx, args) {
    const dashboard = await CrmDashboardService.create(
      ctx.actorId,
      ctx.workspaceId,
      args,
    )
    if (!dashboard.ok) return dashboard
    const base = await crmBase(ctx)
    const href = crmPath(base, `dashboards/${dashboard.value.id}`)
    return ok({
      data: { id: dashboard.value.id, title: dashboard.value.title, href },
      summary: `Dashboard “${dashboard.value.title}” criado`,
      target: {
        type: 'crm_dashboard',
        id: dashboard.value.id,
        label: dashboard.value.title,
        href,
      },
    })
  },
}

const FORM_ACTION_LABELS = {
  COMPANY: 'Cria uma empresa',
  PERSON: 'Cria uma pessoa',
  LEAD: 'Cria um lead',
} as const

export const crmCreateFormTool: SteelAiTool<
  z.output<typeof CreateCrmFormSchema>
> = {
  name: 'crm_create_form',
  label: 'Criando formulário',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description: `Cria um formulário público no CRM, com campos. \`action\` define o que cada envio gera (COMPANY empresa, PERSON pessoa, LEAD lead) e cada campo mapeia para um atributo dessa entidade via \`mapping\` — atributos válidos: lead ${TARGET_ATTRIBUTES.lead.join(', ')}; person ${TARGET_ATTRIBUTES.person.join(', ')}; company ${TARGET_ATTRIBUTES.company.join(', ')}. O formulário nasce como rascunho.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      action: { type: 'string', enum: [...FORM_ACTIONS] },
      successMessage: { type: 'string' },
      fields: {
        type: 'array',
        description: 'Campos na ordem de exibição.',
        items: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'Identificador único: minúsculas, números e _.',
            },
            label: { type: 'string' },
            type: { type: 'string', enum: [...FORM_FIELD_TYPES] },
            required: { type: 'boolean' },
            placeholder: { type: 'string' },
            options: {
              type: 'array',
              description: 'Obrigatório para type "select".',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['label', 'value'],
              },
            },
            mapping: {
              type: 'object',
              properties: {
                target: { type: 'string', enum: [...FIELD_TARGETS] },
                attribute: { type: 'string' },
              },
              required: ['target', 'attribute'],
            },
          },
          required: ['key', 'label', 'type', 'mapping'],
        },
      },
    },
    required: ['name', 'action', 'fields'],
    additionalProperties: false,
  },
  permission: { resource: 'forms', action: 'CREATE' },
  parse: zodParser(CreateCrmFormSchema),
  async preview(_ctx, args) {
    return ok({
      title: `Criar o formulário “${args.name}”`,
      summary: `${FORM_ACTION_LABELS[args.action]} a cada envio. ${args.fields.length} campo(s).`,
      fields: afterFields([
        ['Nome', args.name],
        ['Descrição', args.description],
        ['Ação', FORM_ACTION_LABELS[args.action]],
        [
          'Campos',
          args.fields.map(
            (f) => `${f.label}${f.required ? ' *' : ''} (${f.type})`,
          ),
        ],
        ['Mensagem de sucesso', args.successMessage],
      ]),
      target: { type: 'crm_form', label: args.name },
    })
  },
  async execute(ctx, args) {
    const form = await CrmFormService.create(ctx.actorId, ctx.workspaceId, args)
    if (!form.ok) return form
    const base = await crmBase(ctx)
    const href = crmPath(base, `forms/${form.value.id}`)
    return ok({
      data: {
        id: form.value.id,
        name: form.value.name,
        status: form.value.status,
        href,
      },
      summary: `Formulário “${form.value.name}” criado`,
      target: {
        type: 'crm_form',
        id: form.value.id,
        label: form.value.name,
        href,
      },
    })
  },
}

const CreateProposalArgs = z.object({
  title: z.string().trim().min(1).max(200),
  opportunityId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  templateId: z.string().min(1).optional(),
})

function documentHref(base: string | null, id: string): string | undefined {
  return crmPath(base, `documents/${id}`)
}

export const crmCreateProposalTool: SteelAiTool<
  z.output<typeof CreateProposalArgs>
> = {
  name: 'crm_create_proposal',
  label: 'Criando proposta',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma proposta comercial em CRM > Documentos (documento do tipo PROPOSAL, em rascunho). Com `opportunityId`, vincula a oportunidade, a empresa e o contato dela e já traz os itens da oportunidade na tabela de preços; com `templateId`, parte de um modelo de documento. O conteúdo é editado depois no app do Steel (o `href` devolvido).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título da proposta.' },
      opportunityId: {
        type: 'string',
        description: 'Oportunidade (id) da proposta.',
      },
      companyId: { type: 'string', description: 'Empresa (id).' },
      personId: { type: 'string', description: 'Pessoa de contato (id).' },
      leadId: { type: 'string', description: 'Lead (id).' },
      templateId: {
        type: 'string',
        description: 'Modelo de documento (id) para começar.',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'CREATE' },
  parse: zodParser(CreateProposalArgs),
  async preview(_ctx, args) {
    return ok({
      title: `Criar a proposta “${args.title}”`,
      summary: args.opportunityId
        ? 'Com os itens da oportunidade na tabela de preços.'
        : 'Em rascunho, para editar no app.',
      fields: afterFields([
        ['Título', args.title],
        ['Oportunidade', args.opportunityId],
        ['Empresa', args.companyId],
        ['Pessoa', args.personId],
        ['Lead', args.leadId],
        ['Modelo', args.templateId],
      ]),
      target: { type: 'crm_document', label: args.title },
    })
  },
  async execute(ctx, args) {
    const created = args.opportunityId
      ? await DocumentCrmService.createForOpportunity(
          ctx.actorId,
          ctx.workspaceId,
          args.opportunityId,
          { title: args.title, templateId: args.templateId },
        )
      : await DocumentCrmService.createProposal(ctx.actorId, ctx.workspaceId, {
          title: args.title,
          companyId: args.companyId,
          personId: args.personId,
          leadId: args.leadId,
          templateId: args.templateId,
        })
    if (!created.ok) return created
    const base = await crmBase(ctx)
    const href = documentHref(base, created.value.id)
    return ok({
      data: { id: created.value.id, title: created.value.title, href },
      summary: `Proposta “${created.value.title}” criada`,
      target: {
        type: 'crm_document',
        id: created.value.id,
        label: created.value.title,
        href,
      },
    })
  },
}

const ListProposalDocumentsArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  opportunityId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  templates: z.boolean().optional(),
  ...pageSchema,
})

function compactDocument(doc: CrmDocumentSummaryDTO, base: string | null) {
  return {
    id: doc.id,
    title: doc.title,
    status: doc.status,
    statusLabel: DOCUMENT_STATUS_LABELS[doc.status],
    isTemplate: doc.isTemplate,
    totalValue: doc.totalValue,
    validUntil: doc.validUntil,
    sentAt: doc.sentAt,
    acceptedAt: doc.acceptedAt,
    acceptedByName: doc.acceptedByName,
    opportunityId: doc.opportunityId,
    leadId: doc.leadId,
    companyId: doc.companyId,
    personId: doc.personId,
    ownerId: doc.ownerId,
    href: documentHref(base, doc.id),
  }
}

export const crmListProposalDocumentsTool: SteelAiTool<
  z.output<typeof ListProposalDocumentsArgs>
> = {
  name: 'crm_list_proposal_documents',
  label: 'Consultando propostas em Documentos',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista as propostas de CRM > Documentos (documentos do tipo PROPOSAL), das mais recentes para as mais antigas — título, status (DRAFT, SENT, VIEWED, ACCEPTED, DECLINED, EXPIRED, ARCHIVED), total, validade, aceite e vínculos, com link. `templates: true` lista os modelos de proposta.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Parte do título.' },
      status: { type: 'string', enum: [...DOCUMENT_STATUSES] },
      opportunityId: {
        type: 'string',
        description: 'Só as da oportunidade (id).',
      },
      leadId: { type: 'string', description: 'Só as do lead (id).' },
      companyId: { type: 'string', description: 'Só as da empresa (id).' },
      templates: {
        type: 'boolean',
        description: 'Lista os modelos de proposta em vez das propostas.',
      },
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'VIEW' },
  parse: zodParser(ListProposalDocumentsArgs),
  async execute(ctx, args) {
    const docs = await DocumentCrmService.listProposals(
      ctx.actorId,
      ctx.workspaceId,
      {
        status: args.status,
        opportunityId: args.opportunityId,
        leadId: args.leadId,
        isTemplate: args.templates === true,
      },
    )
    if (!docs.ok) return docs
    const filtered = docs.value.filter(
      (doc) =>
        matchesQuery(args.query, [doc.title]) &&
        (!args.companyId || doc.companyId === args.companyId),
    )
    const base = await crmBase(ctx)
    const page = paginate(filtered, args, (doc) => compactDocument(doc, base))
    return ok({
      data: page,
      summary: `${page.total} proposta(s) encontrada(s)`,
    })
  },
}

export const CRM_BUILDER_TOOLS = [
  crmCreateDashboardTool,
  crmCreateFormTool,
  crmCreateProposalTool,
  crmListProposalDocumentsTool,
]
