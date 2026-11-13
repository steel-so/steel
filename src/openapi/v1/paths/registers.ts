import { z } from 'zod'
import {
  ListV1CrmCompaniesSchema,
  ListV1CrmDocumentsSchema,
  ListV1CrmPeopleSchema,
  ListV1SdContactsSchema,
  ListV1SdCustomersSchema,
  ListV1SdKbArticlesSchema,
} from '@/src/schemas/api-v1.schema'
import {
  CreateCrmCompanySchema,
  UpdateCrmCompanySchema,
} from '@/src/schemas/crm-company.schema'
import {
  CreateCrmPersonSchema,
  UpdateCrmPersonSchema,
} from '@/src/schemas/crm-person.schema'
import {
  CreateDocumentSchema,
  UpdateDocumentSchema,
} from '@/src/schemas/document.schema'
import {
  CreateSdContactSchema,
  UpdateSdContactSchema,
} from '@/src/schemas/sd-contact.schema'
import {
  CreateSdCustomerSchema,
  UpdateSdCustomerSchema,
} from '@/src/schemas/sd-customer.schema'
import {
  CreateSdKbArticleSchema,
  SetSdKbArticleStatusSchema,
  UpdateSdKbArticleSchema,
} from '@/src/schemas/sd-kb-article.schema'
import { notFoundError } from '../../paths/crm/shared'
import type { ErrorEntry, OpenApiRegistry } from '../../registry'
import { DocumentDTO, DocumentListItemDTO } from '../../schemas/crm/documents'
import { CrmCompanyDTO, CrmPersonDTO } from '../../schemas/crm/people'
import {
  SdContactDetailDTO,
  SdContactDTO,
  SdCustomerDetailDTO,
  SdCustomerDTO,
} from '../../schemas/servicedesk/directory'
import {
  SdKbArticleDTO,
  SdKbArticleSummaryDTO,
} from '../../schemas/servicedesk/knowledge'
import { v1Page } from '../schemas'
import {
  moduleErrors,
  PAGINATION_NOTE,
  V1_READ,
  V1_WRITE,
  WRITE_ERRORS,
} from './shared'

/**
 * v1 · registers, knowledge base and documents: CRM people, companies and
 * documents (`app/api/v1/crm/**`) and ServiceDesk customers, contacts and KB
 * articles (`app/api/v1/servicedesk/**`). Every write emits the matching
 * outbound webhook (`src/services/webhook-entity-events.ts`).
 */

const CRM_TAG = 'v1 · CRM' as const
const SD_TAG = 'v1 · ServiceDesk' as const

const DELETED = z.object({ id: z.string() })

const PAGE_CURSOR_NOTE =
  'Paginação por cursor: `limit` (padrão 25, máximo 100) e `cursor` (o `nextCursor` da página anterior; mantenha o mesmo `limit` ao seguir).'
const CURSOR_ERROR = {
  code: 'VALIDATION_ERROR',
  message: 'Cursor inválido',
} as const

interface CrudConfig {
  tag: typeof CRM_TAG | typeof SD_TAG
  /** Path relative to `/api/v1`, e.g. `/crm/people`. */
  base: string
  idParam: string
  idDescription: string
  /** `[singular, plural]` in pt-BR, lower case. */
  noun: [string, string]
  /** `operationId` suffix: `Person`/`People`. */
  ids: [string, string]
  /** `true` for feminine nouns ("Excluída"). */
  feminine?: boolean
  listQuery: z.ZodType
  listSchema: z.ZodType
  listDescription: string
  detailSchema: z.ZodType
  itemSchema: z.ZodType
  createBody: z.ZodType
  updateBody: z.ZodType
  access: ErrorEntry[]
  notFound: ErrorEntry
  writeErrors: ErrorEntry[]
  event: string
  /** The list pages by `page`/`pageSize` instead of in memory. */
  pageBased?: boolean
  extra?: { create?: string; update?: string; delete?: string }
}

function desc(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function registerCrud(registry: OpenApiRegistry, c: CrudConfig): void {
  const [one, many] = c.noun
  const [idOne, idMany] = c.ids
  const suffix = c.feminine ? 'a' : 'o'
  const idPath = `${c.base}/{${c.idParam}}`
  const params = { [c.idParam]: c.idDescription }

  registry.registerRoute({
    method: 'get',
    path: c.base,
    tags: [c.tag],
    summary: `Listar ${many}`,
    operationId: `list${idMany}`,
    description: desc(
      c.listDescription,
      c.pageBased ? PAGE_CURSOR_NOTE : PAGINATION_NOTE,
      V1_READ,
    ),
    auth: 'apiToken',
    query: c.listQuery,
    responses: {
      200: { description: `Página de ${many}.`, schema: c.listSchema },
    },
    errors: [...c.access, CURSOR_ERROR],
  })

  registry.registerRoute({
    method: 'get',
    path: idPath,
    tags: [c.tag],
    summary: `Ver ${one}`,
    operationId: `get${idOne}`,
    description: V1_READ,
    auth: 'apiToken',
    params,
    responses: { 200: { description: `${cap(one)}.`, schema: c.detailSchema } },
    errors: [...c.access, c.notFound],
  })

  registry.registerRoute({
    method: 'post',
    path: c.base,
    tags: [c.tag],
    summary: `Criar ${one}`,
    operationId: `create${idOne}`,
    description: desc(
      'Mesma entrada do app.',
      `Dispara o webhook \`${c.event}.created\`.`,
      c.extra?.create,
      V1_WRITE,
    ),
    auth: 'apiToken',
    consent: true,
    body: c.createBody,
    responses: {
      201: { description: `${cap(one)} criad${suffix}.`, schema: c.itemSchema },
    },
    errors: [...WRITE_ERRORS, ...c.access, ...c.writeErrors],
  })

  registry.registerRoute({
    method: 'patch',
    path: idPath,
    tags: [c.tag],
    summary: `Alterar ${one}`,
    operationId: `update${idOne}`,
    description: desc(
      'Atualização parcial: campos omitidos não mudam.',
      `Dispara o webhook \`${c.event}.updated\`.`,
      c.extra?.update,
      V1_WRITE,
    ),
    auth: 'apiToken',
    consent: true,
    params,
    body: c.updateBody,
    responses: {
      200: {
        description: `${cap(one)} alterad${suffix}.`,
        schema: c.itemSchema,
      },
    },
    errors: [...WRITE_ERRORS, ...c.access, c.notFound, ...c.writeErrors],
  })

  registry.registerRoute({
    method: 'delete',
    path: idPath,
    tags: [c.tag],
    summary: `Excluir ${one}`,
    operationId: `delete${idOne}`,
    description: desc(
      c.extra?.delete ?? 'Exclusão lógica: some das listagens.',
      `Dispara o webhook \`${c.event}.deleted\`.`,
      V1_WRITE,
    ),
    auth: 'apiToken',
    consent: true,
    params,
    responses: {
      200: { description: `${cap(one)} excluíd${suffix}.`, schema: DELETED },
    },
    errors: [...WRITE_ERRORS, ...c.access, c.notFound],
  })
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

const CRM_ACCESS = moduleErrors('CRM')
const SD_ACCESS: ErrorEntry[] = [
  ...moduleErrors('ServiceDesk'),
  { code: 'SD_NOT_AGENT', when: 'Solicitante: estas rotas são dos agentes' },
]

const CUSTOM_FIELD_INVALID: ErrorEntry = {
  code: 'CRM_CUSTOM_FIELD_INVALID',
  when: 'Valor de `customFields` incompatível com o tipo da definição',
}

const DOCUMENT_LINK_ERRORS: ErrorEntry[] = [
  notFoundError('CrmCompany', '`companyId` não existe no workspace'),
  notFoundError('CrmPerson', '`personId` não existe no workspace'),
  notFoundError('CrmOpportunity', '`opportunityId` não existe no workspace'),
  notFoundError('CrmLead', '`leadId` não existe no workspace'),
]

export function registerV1RegistersPaths(registry: OpenApiRegistry): void {
  registerCrud(registry, {
    tag: CRM_TAG,
    base: '/crm/people',
    idParam: 'personId',
    idDescription: 'Id da pessoa do CRM.',
    noun: ['pessoa', 'pessoas'],
    ids: ['CrmPerson', 'CrmPeople'],
    feminine: true,
    listQuery: ListV1CrmPeopleSchema,
    listSchema: v1Page('CrmPerson', CrmPersonDTO),
    listDescription:
      'Pessoas do CRM (as excluídas ficam de fora), na ordem manual do app. `companyId` filtra por empresa.',
    detailSchema: CrmPersonDTO,
    itemSchema: CrmPersonDTO,
    createBody: CreateCrmPersonSchema,
    updateBody: UpdateCrmPersonSchema,
    access: CRM_ACCESS,
    notFound: notFoundError(
      'CrmPerson',
      'Pessoa inexistente ou de outro workspace',
    ),
    writeErrors: [CUSTOM_FIELD_INVALID],
    event: 'crm.person',
  })

  registerCrud(registry, {
    tag: CRM_TAG,
    base: '/crm/companies',
    idParam: 'companyId',
    idDescription: 'Id da empresa do CRM.',
    noun: ['empresa', 'empresas'],
    ids: ['CrmCompany', 'CrmCompanies'],
    feminine: true,
    listQuery: ListV1CrmCompaniesSchema,
    listSchema: v1Page('CrmCompany', CrmCompanyDTO),
    listDescription:
      'Empresas do CRM (as excluídas ficam de fora), na ordem manual do app. `icp=true` limita ao perfil de cliente ideal.',
    detailSchema: CrmCompanyDTO,
    itemSchema: CrmCompanyDTO,
    createBody: CreateCrmCompanySchema,
    updateBody: UpdateCrmCompanySchema,
    access: CRM_ACCESS,
    notFound: notFoundError(
      'CrmCompany',
      'Empresa inexistente ou de outro workspace',
    ),
    writeErrors: [
      {
        code: 'CRM_COMPANY_CONFLICT',
        when: 'Domínio ou CNPJ já usado por outra empresa do workspace',
      },
      CUSTOM_FIELD_INVALID,
    ],
    event: 'crm.company',
  })

  registerCrud(registry, {
    tag: CRM_TAG,
    base: '/crm/documents',
    idParam: 'documentId',
    idDescription: 'Id do documento.',
    noun: ['documento', 'documentos'],
    ids: ['CrmDocument', 'CrmDocuments'],
    listQuery: ListV1CrmDocumentsSchema,
    listSchema: v1Page('CrmDocumentListItem', DocumentListItemDTO),
    listDescription:
      'Documentos do CRM (propostas, contratos, orçamentos...), do mais recente para o mais antigo. `isTemplate=true` lista os modelos. Os filtros de vínculo mostram os documentos de uma empresa, pessoa, oportunidade ou lead.',
    detailSchema: DocumentDTO,
    itemSchema: DocumentDTO,
    createBody: CreateDocumentSchema,
    updateBody: UpdateDocumentSchema,
    access: CRM_ACCESS,
    notFound: 'DOCUMENT_NOT_FOUND',
    writeErrors: [
      ...DOCUMENT_LINK_ERRORS,
      { code: 'DOCUMENT_TEMPLATE_NOT_FOUND', when: '`templateId` inexistente' },
    ],
    event: 'crm.document',
    pageBased: true,
    extra: {
      create:
        'Cria um rascunho (em branco, de um modelo ou de um modelo da galeria); o envio ao destinatário continua pelo app e dispara `crm.document.sent`.',
      update:
        '`status` aceita `ARCHIVED` e `DRAFT` (desarquivar); o texto do documento é editado pelo app.',
    },
  })

  registerCrud(registry, {
    tag: SD_TAG,
    base: '/servicedesk/customers',
    idParam: 'customerId',
    idDescription: 'Id do cliente/empresa do ServiceDesk.',
    noun: ['cliente', 'clientes'],
    ids: ['SdCustomer', 'SdCustomers'],
    listQuery: ListV1SdCustomersSchema,
    listSchema: v1Page('SdCustomer', SdCustomerDTO),
    listDescription:
      'Clientes e empresas do ServiceDesk, por nome. Só agentes.',
    detailSchema: SdCustomerDetailDTO,
    itemSchema: SdCustomerDTO,
    createBody: CreateSdCustomerSchema,
    updateBody: UpdateSdCustomerSchema,
    access: SD_ACCESS,
    notFound: 'SD_CUSTOMER_NOT_FOUND',
    writeErrors: [
      {
        code: 'SD_CUSTOMER_DOCUMENT_CONFLICT',
        when: 'CPF/CNPJ já usado por outro cliente do workspace',
      },
      { code: 'SD_DOCUMENT_INVALID', when: 'CPF/CNPJ inválido' },
    ],
    event: 'servicedesk.customer',
    pageBased: true,
  })

  registerCrud(registry, {
    tag: SD_TAG,
    base: '/servicedesk/contacts',
    idParam: 'contactId',
    idDescription: 'Id do contato do ServiceDesk.',
    noun: ['contato', 'contatos'],
    ids: ['SdContact', 'SdContacts'],
    listQuery: ListV1SdContactsSchema,
    listSchema: v1Page('SdContact', SdContactDTO),
    listDescription:
      'Contatos do ServiceDesk, por nome. `customerId` filtra pelos vinculados a um cliente/empresa. Só agentes.',
    detailSchema: SdContactDetailDTO,
    itemSchema: SdContactDTO,
    createBody: CreateSdContactSchema,
    updateBody: UpdateSdContactSchema,
    access: SD_ACCESS,
    notFound: 'SD_CONTACT_NOT_FOUND',
    writeErrors: [
      {
        code: 'SD_CUSTOMER_NOT_FOUND',
        when: 'Um `customers[].customerId` não existe no workspace',
      },
    ],
    event: 'servicedesk.contact',
    pageBased: true,
    extra: { update: '`customers`, quando enviado, substitui os vínculos.' },
  })

  registerCrud(registry, {
    tag: SD_TAG,
    base: '/servicedesk/kb/articles',
    idParam: 'articleId',
    idDescription: 'Id do artigo da base de conhecimento.',
    noun: ['artigo', 'artigos'],
    ids: ['SdKbArticle', 'SdKbArticles'],
    listQuery: ListV1SdKbArticlesSchema,
    listSchema: v1Page('SdKbArticleSummary', SdKbArticleSummaryDTO),
    listDescription:
      'Artigos da base de conhecimento, sem o conteúdo (use "Ver artigo"). Sem `q` lista a árvore inteira; com `q`, é a busca com relevância (até 50 resultados) e aceita `status`, `visibility`, `categoryId` e `tag`. Solicitantes só veem o que está publicado no portal.',
    detailSchema: SdKbArticleDTO,
    itemSchema: SdKbArticleDTO,
    createBody: CreateSdKbArticleSchema,
    updateBody: UpdateSdKbArticleSchema,
    access: [
      ...moduleErrors('ServiceDesk'),
      { code: 'SD_NOT_AGENT', when: 'Escrever exige ser agente' },
    ],
    notFound: 'SD_KB_ARTICLE_NOT_FOUND',
    writeErrors: [],
    event: 'servicedesk.kb_article',
    extra: {
      create: 'Nasce como rascunho; publique em `POST .../{articleId}/status`.',
      update:
        'O autosave só de `content` não dispara o webhook; qualquer outro campo, sim.',
      delete:
        'Exclusão definitiva: o artigo, os sub-artigos, os comentários e a mídia.',
    },
  })

  registry.registerRoute({
    method: 'post',
    path: '/servicedesk/kb/articles/{articleId}/status',
    tags: [SD_TAG],
    summary: 'Publicar ou despublicar artigo',
    operationId: 'setSdKbArticleStatus',
    description: `\`PUBLISHED\` publica (carimba \`publishedAt\`); \`DRAFT\` volta para rascunho. Dispara \`servicedesk.kb_article.published\` ou \`servicedesk.kb_article.unpublished\`. ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    params: { articleId: 'Id do artigo da base de conhecimento.' },
    body: SetSdKbArticleStatusSchema,
    responses: { 200: { description: 'Artigo.', schema: SdKbArticleDTO } },
    errors: [
      ...WRITE_ERRORS,
      ...moduleErrors('ServiceDesk'),
      'SD_KB_ARTICLE_NOT_FOUND',
      { code: 'VALIDATION_ERROR', when: 'Artigo arquivado ou sem título' },
    ],
  })
}
