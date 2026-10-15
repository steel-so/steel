import {
  CreateCrmEmailSavedBlockSchema,
  CreateCrmEmailTemplateVersionSchema,
  CrmEmailAiRewriteSchema,
  CrmEmailAiSectionSchema,
  CrmEmailContactListsQuerySchema,
  ListCrmEmailSavedBlocksQuerySchema,
  UpdateCrmEmailSavedBlockSchema,
} from '@/src/schemas/crm-email-editor.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmEmailAiRewriteResultDTO,
  CrmEmailAiSectionResultDTO,
  CrmEmailContactListsDTO,
  CrmEmailSavedBlockDTO,
  CrmEmailTemplateRestoreDTO,
  CrmEmailTemplateVersionDetailDTO,
  CrmEmailTemplateVersionDTO,
} from '../../schemas/crm/email-editor'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · editor de e-mail (Steel Canvas), fases E2/E3: blocos salvos,
 * histórico de versões dos templates v2, IA nos blocos e as listas de um
 * contato para a prévia do conteúdo condicional.
 */

const TAGS: RouteConfig['tags'] = ['CRM · E-mail marketing']
const AI_TAGS: RouteConfig['tags'] = ['CRM · IA']

const TEMPLATE_ID = 'ID do template de e-mail.'
const VERSION_ID = 'ID da versão do template.'
const BLOCK_ID = 'ID do bloco salvo.'

const TEMPLATE_NOT_FOUND = notFoundError(
  'CrmEmailTemplate',
  'Template inexistente no workspace',
)
const BLOCK_NOT_FOUND: ErrorEntry = {
  code: 'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
  when: 'Bloco inexistente no workspace',
}
const VERSION_NOT_FOUND: ErrorEntry = {
  code: 'CRM_EMAIL_TEMPLATE_VERSION_NOT_FOUND',
  when: 'Versão inexistente para este template',
}
const AI_ERRORS: ErrorEntry[] = [
  {
    code: 'FEATURE_NOT_ENABLED',
    when: 'Feature `crm.aiAssistant` desligada para o workspace',
  },
  {
    code: 'AI_QUOTA_EXCEEDED',
    when: 'Cota mensal de IA do workspace esgotada',
  },
  {
    code: 'AI_PROVIDER_UNAVAILABLE',
    when: 'Nenhum modelo habilitado com provedor configurado',
  },
  {
    code: 'CRM_EMAIL_AI_FAILED',
    when: 'O provedor falhou ou não devolveu nada que o catálogo de e-mail aceite',
  },
]
const FRAGMENT_EXAMPLE = {
  rootId: 'h1',
  nodes: {
    h1: {
      id: 'h1',
      type: 'email.heading',
      props: {
        text: 'Novidades do mês',
        level: 'h2',
        align: 'left',
        padding: { top: 8, right: 0, bottom: 8, left: 0 },
        visibility: { base: true, tablet: true, mobile: true },
      },
    },
  },
}

export const crmEmailEditorRoutes: RouteConfig[] = [
  /* ------------------------------ saved blocks ----------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-saved-blocks',
    tags: TAGS,
    summary: 'Listar blocos salvos do editor de e-mail',
    description: describe(
      'Seções e blocos salvos para reutilizar em qualquer template do workspace (aba "Salvos"), mais recentes primeiro (até 200). `q` busca no nome e na categoria.',
      crmAccess('email', 'VIEW'),
    ),
    query: ListCrmEmailSavedBlocksQuerySchema,
    responses: {
      200: {
        description: 'Blocos salvos.',
        schema: CrmEmailSavedBlockDTO.array(),
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-saved-blocks',
    tags: TAGS,
    summary: 'Salvar bloco do editor de e-mail',
    description: describe(
      'Salva uma seção (`email.section`) ou um bloco de conteúdo como fragmento reutilizável. O fragmento passa pela mesma validação do documento (regras do catálogo e props de cada nó; texto rico e HTML sanitizados). Limite de 200 blocos por workspace.',
      crmAccess('email', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmEmailSavedBlockSchema,
      example: {
        name: 'Título do mês',
        category: 'Cabeçalhos',
        fragment: FRAGMENT_EXAMPLE,
      },
    },
    responses: {
      201: { description: 'Bloco salvo.', schema: CrmEmailSavedBlockDTO },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_EMAIL_SAVED_BLOCK_INVALID',
        when: 'Raiz que não é seção nem bloco, ou fragmento fora das regras do catálogo; `details.issues` lista os problemas',
      },
      {
        code: 'CRM_EMAIL_SAVED_BLOCK_LIMIT_REACHED',
        when: 'O workspace já tem 200 blocos salvos',
      },
      {
        code: 'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
        when: 'Quem não é OWNER/ADMIN tentou salvar um bloco de HTML',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/crm/email-saved-blocks/{blockId}',
    tags: TAGS,
    summary: 'Renomear bloco salvo',
    description: crmAccess('email', 'EDIT'),
    params: { blockId: BLOCK_ID },
    consent: true,
    body: {
      schema: UpdateCrmEmailSavedBlockSchema,
      example: { name: 'Cabeçalho de outubro' },
    },
    responses: {
      200: { description: 'Bloco atualizado.', schema: CrmEmailSavedBlockDTO },
    },
    errors: [...CRM_ERRORS, BLOCK_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/crm/email-saved-blocks/{blockId}',
    tags: TAGS,
    summary: 'Excluir bloco salvo',
    description: describe(
      'Templates que já usam o bloco não mudam (o conteúdo foi copiado ao inserir).',
      crmAccess('email', 'DELETE'),
    ),
    params: { blockId: BLOCK_ID },
    consent: true,
    responses: { 200: { description: 'Bloco excluído.', schema: null } },
    errors: [...CRM_ERRORS, BLOCK_NOT_FOUND],
  },
  /* ---------------------------- template versions --------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-templates/{templateId}/versions',
    tags: TAGS,
    summary: 'Histórico de versões do template',
    description: describe(
      'Versões de um template do novo editor (documento versão 2), mais recentes primeiro. Uma versão é gravada em "Salvar versão", no envio de teste, no uso numa campanha e na restauração; ficam as 50 mais recentes.',
      crmAccess('email', 'VIEW'),
    ),
    params: { templateId: TEMPLATE_ID },
    responses: {
      200: {
        description: 'Versões.',
        schema: CrmEmailTemplateVersionDTO.array(),
      },
    },
    errors: [...CRM_ERRORS, TEMPLATE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-templates/{templateId}/versions',
    tags: TAGS,
    summary: 'Salvar versão do template',
    description: describe(
      'Grava o template como está salvo agora, com um nome opcional. Sem mudança desde a última versão, devolve `data: null` (200) e não grava nada.',
      crmAccess('email', 'EDIT'),
    ),
    params: { templateId: TEMPLATE_ID },
    consent: true,
    body: {
      schema: CreateCrmEmailTemplateVersionSchema,
      example: { label: 'Antes da revisão' },
    },
    responses: {
      201: {
        description: 'Versão gravada.',
        schema: CrmEmailTemplateVersionDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      TEMPLATE_NOT_FOUND,
      {
        code: 'CRM_EMAIL_TEMPLATE_NOT_BUILDER',
        when: 'O template não usa o novo editor (documento versão 2)',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-templates/{templateId}/versions/{versionId}',
    tags: TAGS,
    summary: 'Detalhe de uma versão do template',
    description: describe(
      'A versão com o documento completo (prévia no histórico).',
      crmAccess('email', 'VIEW'),
    ),
    params: { templateId: TEMPLATE_ID, versionId: VERSION_ID },
    responses: {
      200: {
        description: 'Versão.',
        schema: CrmEmailTemplateVersionDetailDTO,
      },
    },
    errors: [...CRM_ERRORS, VERSION_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-templates/{templateId}/versions/{versionId}/restore',
    tags: TAGS,
    summary: 'Restaurar versão do template',
    description: describe(
      'Salva o template com o documento e o assunto da versão (mesma validação do salvamento) e grava uma versão `RESTORE`. Nada é apagado.',
      crmAccess('email', 'EDIT'),
    ),
    params: { templateId: TEMPLATE_ID, versionId: VERSION_ID },
    consent: true,
    responses: {
      200: {
        description: 'Template restaurado.',
        schema: CrmEmailTemplateRestoreDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      VERSION_NOT_FOUND,
      TEMPLATE_NOT_FOUND,
      {
        code: 'CRM_EMAIL_CANVAS_INVALID',
        when: 'A versão não passa mais nas regras atuais do catálogo',
      },
      {
        code: 'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
        when: 'A versão muda um bloco de HTML e quem pede não é OWNER/ADMIN',
      },
    ],
  },
  /* ---------------------------------- AI ----------------------------------- */
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-ai/rewrite',
    tags: AI_TAGS,
    summary: 'Escrever ou reescrever o texto de um bloco de e-mail com IA',
    description: describe(
      '`mode`: `write` (escreve a partir de `prompt`), `shorter`, `persuasive` ou `formal` (reescreve `text`). Vale para título, texto rico, botão, depoimento, cupom, evento, NPS e descrição de produto. O texto rico volta como HTML sanitizado. Usa a IA do workspace e consome a cota mensal.',
      crmAccess('email', 'EDIT'),
    ),
    body: {
      schema: CrmEmailAiRewriteSchema,
      example: {
        blockType: 'email.heading',
        mode: 'persuasive',
        text: 'Conheça o novo plano',
      },
    },
    responses: {
      200: {
        description: 'Texto sugerido.',
        schema: CrmEmailAiRewriteResultDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'VALIDATION_ERROR',
        when: 'Bloco sem texto para a IA, `write` sem pedido ou reescrita de um campo vazio',
      },
      ...AI_ERRORS,
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/crm/email-ai/section',
    tags: AI_TAGS,
    summary: 'Gerar seção de e-mail com IA',
    description: describe(
      'Monta uma seção (1 a 3 colunas com título, texto, botão, lista, depoimento, cupom, divisor e o produto escolhido) a partir de `prompt` e/ou de um produto do CRM. Cada bloco é criado com os padrões do catálogo e validado; blocos inválidos são descartados e a seção passa pela validação completa antes de voltar. Usa a IA do workspace e consome a cota mensal.',
      crmAccess('email', 'EDIT'),
    ),
    body: {
      schema: CrmEmailAiSectionSchema,
      example: { prompt: 'Três benefícios da fibra para empresas' },
    },
    responses: {
      200: {
        description: 'Seção gerada.',
        schema: CrmEmailAiSectionResultDTO,
      },
    },
    errors: [
      ...CRM_ERRORS,
      notFoundError('CrmProduct', 'Produto inexistente no workspace'),
      ...AI_ERRORS,
    ],
  },
  /* -------------------------- conditional content -------------------------- */
  {
    method: 'get',
    path: '/workspaces/{id}/crm/email-builder/contact-lists',
    tags: TAGS,
    summary: 'Listas de e-mail de um contato',
    description: describe(
      'Listas de e-mail de uma pessoa do CRM (pela pessoa ou por um dos seus e-mails), para a prévia do conteúdo condicional ("Mostrar se: está na lista").',
      crmAccess('email', 'VIEW'),
    ),
    query: CrmEmailContactListsQuerySchema,
    responses: {
      200: { description: 'Listas.', schema: CrmEmailContactListsDTO },
    },
    errors: [
      ...CRM_ERRORS,
      notFoundError('CrmPerson', 'Pessoa inexistente no workspace'),
    ],
  },
]
