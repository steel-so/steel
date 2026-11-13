import { z } from 'zod'
import { ok } from '@/src/lib/result'
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_KINDS,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUSES,
} from '@/src/schemas/document.schema'
import { DocumentService } from '@/src/services/document.service'
import type { DocumentListItemDTO } from '@/types/document'
import {
  afterFields,
  crmBase,
  crmPath,
  pageParameters,
  pageSchema,
  zodParser,
} from './crm/shared'
import type { AnySteelAiTool, SteelAiTool } from './types'

/**
 * Steel AI tools for the Documents builder (CRM > Documentos): any kind —
 * contracts, quotes, terms — not only proposals (those have
 * `crm_list_proposal_documents` / `crm_create_proposal`). Services are
 * called with the caller's id, so module access and RBAC still apply.
 * Sending a document to a customer is deliberately not a tool here.
 */

function documentHref(base: string | null, id: string): string | undefined {
  return crmPath(base, `documents/${id}`)
}

function compactDocument(doc: DocumentListItemDTO, base: string | null) {
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    kindLabel: DOCUMENT_KIND_LABELS[doc.kind],
    status: doc.status,
    statusLabel: DOCUMENT_STATUS_LABELS[doc.status],
    isTemplate: doc.isTemplate,
    totalValue: doc.totalValue,
    validUntil: doc.validUntil,
    sentAt: doc.sentAt,
    acceptedAt: doc.acceptedAt,
    viewCount: doc.viewCount,
    company: doc.company?.name ?? null,
    person: doc.person?.name ?? null,
    href: documentHref(base, doc.id),
  }
}

/* ---------------------------------- list ---------------------------------- */

const ListArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  templates: z.boolean().optional(),
  companyId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  ...pageSchema,
})

export const documentsListTool: SteelAiTool<z.output<typeof ListArgs>> = {
  name: 'documents_list',
  label: 'Consultando documentos',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista os documentos de CRM > Documentos de qualquer tipo (PROPOSAL, CONTRACT, QUOTE, PRESENTATION, TERMS, REPORT, OTHER), dos mais recentes para os mais antigos: título, tipo, status (DRAFT, SENT, VIEWED, ACCEPTED, DECLINED, EXPIRED, ARCHIVED), total, validade, visualizações e vínculos, com link. `templates: true` lista os modelos em vez dos documentos.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Parte do título.' },
      kind: { type: 'string', enum: [...DOCUMENT_KINDS] },
      status: { type: 'string', enum: [...DOCUMENT_STATUSES] },
      templates: {
        type: 'boolean',
        description: 'Lista os modelos de documento em vez dos documentos.',
      },
      companyId: { type: 'string', description: 'Só os da empresa (id).' },
      personId: { type: 'string', description: 'Só os da pessoa (id).' },
      opportunityId: {
        type: 'string',
        description: 'Só os da oportunidade (id).',
      },
      leadId: { type: 'string', description: 'Só os do lead (id).' },
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'VIEW' },
  parse: zodParser(ListArgs),
  async execute(ctx, args) {
    const pageNumber = Math.floor(args.offset / args.limit) + 1
    const listed = await DocumentService.list(ctx.actorId, ctx.workspaceId, {
      isTemplate: args.templates === true,
      kind: args.kind,
      status: args.status,
      q: args.query,
      companyId: args.companyId,
      personId: args.personId,
      opportunityId: args.opportunityId,
      leadId: args.leadId,
      page: pageNumber,
      pageSize: args.limit,
    })
    if (!listed.ok) return listed
    const base = await crmBase(ctx)
    const items = listed.value.items.map((doc) => compactDocument(doc, base))
    return ok({
      data: {
        total: listed.value.total,
        offset: (pageNumber - 1) * args.limit,
        limit: args.limit,
        hasMore: pageNumber * args.limit < listed.value.total,
        items,
      },
      summary: `${listed.value.total} documento(s) encontrado(s)`,
    })
  },
}

/* ----------------------------------- get ---------------------------------- */

const GetArgs = z.object({ documentId: z.string().trim().min(1).max(64) })

export const documentGetTool: SteelAiTool<z.output<typeof GetArgs>> = {
  name: 'document_get',
  label: 'Lendo documento',
  module: 'CRM',
  kind: 'READ',
  description:
    'Detalha um documento: tipo, status, descrição, vínculos, destinatários (nome e papel, sem contato), aceite ou recusa, visualizações e se há alterações ainda não enviadas, com o link para abrir no Steel. Não devolve o conteúdo do canvas.',
  parameters: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string',
        description: 'Id do documento (de documents_list).',
      },
    },
    required: ['documentId'],
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'VIEW' },
  parse: zodParser(GetArgs),
  async execute(ctx, args) {
    const found = await DocumentService.get(
      ctx.actorId,
      ctx.workspaceId,
      args.documentId,
    )
    if (!found.ok) return found
    const doc = found.value
    const base = await crmBase(ctx)
    return ok({
      data: {
        ...compactDocument(doc, base),
        description: doc.description,
        hasUnsentChanges: doc.hasUnsentChanges,
        acceptedByName: doc.acceptedByName,
        declinedAt: doc.declinedAt,
        declineReason: doc.declineReason,
        expiredAt: doc.expiredAt,
        paidAt: doc.paidAt,
        recipients: doc.recipients.map((r) => ({
          name: r.name,
          role: r.role,
        })),
      },
      summary: `Documento “${doc.title}”`,
    })
  },
}

/* --------------------------------- create --------------------------------- */

const CreateArgs = z.object({
  title: z.string().trim().min(1).max(200),
  kind: z.enum(DOCUMENT_KINDS).default('OTHER'),
  description: z.string().trim().max(2000).optional(),
  templateId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  opportunityId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
})

export const documentCreateTool: SteelAiTool<z.output<typeof CreateArgs>> = {
  name: 'document_create',
  label: 'Criando documento',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria um documento em CRM > Documentos, em RASCUNHO (nada é enviado a ninguém). Informe `title` e o `kind` (PROPOSAL, CONTRACT, QUOTE, PRESENTATION, TERMS, REPORT, OTHER); com `templateId` parte de um modelo; os vínculos (`companyId`, `personId`, `opportunityId`, `leadId`) são opcionais. O conteúdo é editado e o envio é feito depois no app do Steel (o `href` devolvido).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título do documento.' },
      kind: { type: 'string', enum: [...DOCUMENT_KINDS] },
      description: { type: 'string', description: 'Descrição interna.' },
      templateId: {
        type: 'string',
        description: 'Modelo de documento (id) para começar.',
      },
      companyId: { type: 'string', description: 'Empresa (id).' },
      personId: { type: 'string', description: 'Pessoa (id).' },
      opportunityId: { type: 'string', description: 'Oportunidade (id).' },
      leadId: { type: 'string', description: 'Lead (id).' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  permission: { resource: 'documents', action: 'CREATE' },
  parse: zodParser(CreateArgs),
  async preview(_ctx, args) {
    return ok({
      title: `Criar o documento “${args.title}”`,
      summary: 'Fica em rascunho; nada é enviado ao cliente.',
      fields: afterFields([
        ['Título', args.title],
        ['Tipo', DOCUMENT_KIND_LABELS[args.kind]],
        ['Modelo', args.templateId],
        ['Empresa', args.companyId],
        ['Pessoa', args.personId],
        ['Oportunidade', args.opportunityId],
        ['Lead', args.leadId],
      ]),
      target: { type: 'crm_document', label: args.title },
    })
  },
  async execute(ctx, args) {
    const created = await DocumentService.create(ctx.actorId, ctx.workspaceId, {
      title: args.title,
      kind: args.kind,
      description: args.description,
      isTemplate: false,
      templateId: args.templateId,
      companyId: args.companyId,
      personId: args.personId,
      opportunityId: args.opportunityId,
      leadId: args.leadId,
    })
    if (!created.ok) return created
    const base = await crmBase(ctx)
    const href = documentHref(base, created.value.id)
    return ok({
      data: { id: created.value.id, title: created.value.title, href },
      summary: `Documento “${created.value.title}” criado`,
      target: {
        type: 'crm_document',
        id: created.value.id,
        label: created.value.title,
        href,
      },
    })
  },
}

export const DOCUMENT_AI_TOOLS: AnySteelAiTool[] = [
  documentsListTool,
  documentGetTool,
  documentCreateTool,
]
