import type { z } from 'zod'
import { ok } from '@/src/lib/result'
import { CreateCrmDashboardSchema } from '@/src/schemas/crm-dashboard.schema'
import {
  CreateCrmFormSchema,
  FIELD_TARGETS,
  FORM_ACTIONS,
  FORM_FIELD_TYPES,
  TARGET_ATTRIBUTES,
} from '@/src/schemas/crm-form.schema'
import { CrmProposalSectionTypeEnum } from '@/src/schemas/crm-proposal.schema'
import { CreateCrmProposalTemplateSchema } from '@/src/schemas/crm-proposal-template.schema'
import { CrmDashboardService } from '@/src/services/crm-dashboard.service'
import { CrmFormService } from '@/src/services/crm-form.service'
import { CrmProposalTemplateService } from '@/src/services/crm-proposal-template.service'
import type { SteelAiTool } from '../types'
import { afterFields, crmBase, crmPath, zodParser } from './shared'

/* Ports of the old CRM assistant's "create" tools (dashboard, form, template). */

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

const SECTION_LABELS: Record<
  z.infer<typeof CrmProposalSectionTypeEnum>,
  string
> = {
  COVER: 'Capa',
  COMPANY_PRESENTATION: 'Apresentação da empresa',
  CLIENT_NEEDS: 'Necessidade do cliente',
  SOLUTION: 'Solução da proposta',
  SCOPE: 'Escopo dos serviços',
  PRODUCTS_PRICING: 'Produtos e valores',
  COMMERCIAL_TERMS: 'Condições comerciais',
  TERMS_CONDITIONS: 'Termos e condições',
  SIGNATURE: 'Assinatura',
}

export const crmCreateProposalTemplateTool: SteelAiTool<
  z.output<typeof CreateCrmProposalTemplateSchema>
> = {
  name: 'crm_create_proposal_template',
  label: 'Criando modelo de proposta',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria um modelo (template) de proposta comercial com o esqueleto de seções, na ordem desejada; o conteúdo de cada seção é editado depois no app do Steel, na tela do modelo.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: CrmProposalSectionTypeEnum.options,
            },
            order: { type: 'integer', minimum: 0 },
            enabled: { type: 'boolean' },
          },
          required: ['type', 'order'],
        },
      },
    },
    required: ['name', 'sections'],
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'CREATE' },
  parse: zodParser(CreateCrmProposalTemplateSchema),
  async preview(_ctx, args) {
    const sections = [...args.sections]
      .sort((a, b) => a.order - b.order)
      .map((s) => `${SECTION_LABELS[s.type]}${s.enabled ? '' : ' (oculta)'}`)
    return ok({
      title: `Criar o modelo de proposta “${args.name}”`,
      summary: `${sections.length} seção(ões).`,
      fields: afterFields([
        ['Nome', args.name],
        ['Descrição', args.description],
        ['Seções', sections],
      ]),
      target: { type: 'crm_proposal_template', label: args.name },
    })
  },
  async execute(ctx, args) {
    const template = await CrmProposalTemplateService.create(
      ctx.actorId,
      ctx.workspaceId,
      args,
    )
    if (!template.ok) return template
    const base = await crmBase(ctx)
    const href = crmPath(base, `proposal-templates/${template.value.id}`)
    return ok({
      data: { id: template.value.id, name: template.value.name, href },
      summary: `Modelo de proposta “${template.value.name}” criado`,
      target: {
        type: 'crm_proposal_template',
        id: template.value.id,
        label: template.value.name,
        href,
      },
    })
  },
}

export const CRM_BUILDER_TOOLS = [
  crmCreateDashboardTool,
  crmCreateFormTool,
  crmCreateProposalTemplateTool,
]
