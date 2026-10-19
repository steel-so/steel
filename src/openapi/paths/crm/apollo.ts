import { z } from 'zod'
import {
  ApolloListContactsSchema,
  ApolloPhoneWebhookSchema,
  ApolloSearchSchema,
  ConnectApolloSchema,
  CreateApolloImportSchema,
  ListApolloImportsSchema,
  UpdateApolloSettingsSchema,
} from '@/src/schemas/crm-apollo.schema'
import { dto, WORKSPACE_PRIVILEGED_ERRORS } from '../../common'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { CRM_ERRORS, crmAccess, describe, notFoundError } from './shared'

/**
 * CRM · Importação da Apollo.io — a chave de API é do próprio workspace
 * (cifrada, nunca devolvida), a busca e as listas são prévias sem custo e a
 * importação (que gasta créditos da Apollo) roda no worker.
 */

const TAG = 'CRM · Leads' as const
const BASE = '/workspaces/{id}/crm/apollo'
const WORKSPACE = { id: 'Id do workspace.' }
const dateTime = () => z.iso.datetime()

const SECRECY =
  'A chave **só entra**: nenhuma resposta a devolve, só os últimos 4 caracteres (`keyHint`).'

const RateLimit = dto(
  'CrmApolloRateLimit',
  z.object({
    minuteLeft: z.number().int().nullable(),
    hourLeft: z.number().int().nullable(),
    dayLeft: z.number().int().nullable(),
  }),
)

const Connection = dto(
  'CrmApolloConnection',
  z.object({
    connected: z.boolean(),
    status: z.enum(['ACTIVE', 'ERROR', 'DISCONNECTED']).nullable(),
    statusError: z.string().nullable(),
    keyHint: z.string().nullable().meta({ example: '••••ab12' }),
    lastCheckedAt: dateTime().nullable(),
    defaultMailingListId: z.string().nullable(),
    phoneRevealAvailable: z.boolean().meta({
      description:
        'false quando a URL pública não é HTTPS (a Apollo recusa o webhook).',
    }),
  }),
)

const Person = z.object({
  id: z.string(),
  name: z.string().meta({
    description: 'A Apollo oculta o sobrenome até o enriquecimento.',
    example: 'Maria Si***a',
  }),
  title: z.string().nullable(),
  organizationName: z.string().nullable(),
  hasEmail: z.boolean(),
})

const SearchResult = dto(
  'CrmApolloSearchResult',
  z.object({
    totalEntries: z.number().int(),
    page: z.number().int(),
    perPage: z.number().int(),
    totalPages: z.number().int(),
    people: z.array(Person),
    rateLimit: RateLimit,
  }),
)

const Label = dto(
  'CrmApolloLabel',
  z.object({ id: z.string(), name: z.string(), count: z.number().int() }),
)

const Contact = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  emailStatus: z.string().nullable(),
  title: z.string().nullable(),
  organizationName: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  city: z.string().nullable(),
})

const ContactsResult = dto(
  'CrmApolloContactsResult',
  z.object({
    totalEntries: z.number().int(),
    page: z.number().int(),
    perPage: z.number().int(),
    totalPages: z.number().int(),
    contacts: z.array(Contact),
    rateLimit: RateLimit,
  }),
)

const ImportRun = dto(
  'CrmApolloImport',
  z.object({
    id: z.string(),
    status: z.enum([
      'QUEUED',
      'RUNNING',
      'DONE',
      'FAILED',
      'PAUSED_RATE_LIMIT',
    ]),
    source: z.enum(['SEARCH', 'LIST']),
    filters: z.unknown(),
    mailingListId: z.string().nullable(),
    requestedCount: z.number().int(),
    createdCount: z.number().int(),
    skippedCount: z.number().int(),
    failedCount: z.number().int(),
    creditsConsumed: z.number().int(),
    revealPhones: z.boolean(),
    phonesRequested: z.number().int(),
    phonesReceived: z.number().int(),
    error: z.string().nullable(),
    createdById: z.string(),
    startedAt: dateTime().nullable(),
    finishedAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

const IntegrationRecord = dto(
  'CrmApolloIntegration',
  z.object({
    id: z.string(),
    kind: z.literal('APOLLO'),
    status: z.enum(['ACTIVE', 'ERROR', 'DISCONNECTED']),
    statusError: z.string().nullable(),
    externalName: z.string().nullable().meta({ example: '••••ab12' }),
    lastCheckedAt: dateTime().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const TestResult = dto(
  'CrmApolloTest',
  z.object({
    ok: z.boolean(),
    message: z.string(),
    integration: IntegrationRecord,
  }),
)

const NOT_CONNECTED: ErrorEntry = {
  code: 'CRM_APOLLO_NOT_CONNECTED',
  when: 'O workspace não tem chave da Apollo cadastrada',
}
const INVALID_KEY: ErrorEntry = {
  code: 'CRM_APOLLO_INVALID_KEY',
  when: 'A Apollo recusou a chave (inválida ou revogada)',
}
const FORBIDDEN_KEY: ErrorEntry = {
  code: 'CRM_APOLLO_FORBIDDEN',
  when: 'A chave não tem permissão para a operação (ex.: listas exigem chave master)',
}
const RATE_LIMITED: ErrorEntry = {
  code: 'CRM_APOLLO_RATE_LIMITED',
  when: 'A Apollo limitou as chamadas do plano; `error.details.retryAfterSeconds` quando informado',
}
const REQUEST_FAILED: ErrorEntry = {
  code: 'CRM_APOLLO_REQUEST_FAILED',
  when: 'A Apollo não respondeu ou falhou (5xx, rede, tempo esgotado)',
}
const APOLLO_CALL_ERRORS: ErrorEntry[] = [
  NOT_CONNECTED,
  INVALID_KEY,
  FORBIDDEN_KEY,
  RATE_LIMITED,
  REQUEST_FAILED,
]

const ADMIN = 'Acesso: sessão + **OWNER/ADMIN** do workspace.'

const connectionRoutes = (
  base: string,
  tag: 'CRM · Leads' | 'Integrações',
): RouteConfig[] => [
  {
    method: 'delete',
    path: base,
    tags: [tag],
    summary: 'Desconectar a Apollo',
    description: `A chave é apagada; as importações já feitas continuam no histórico e os leads criados permanecem. ${ADMIN}`,
    consent: true,
    params: WORKSPACE,
    responses: { 200: { description: 'Desconectada.', schema: null } },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, 'SD_INTEGRATION_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${base}/test`,
    tags: [tag],
    summary: 'Testar a conexão com a Apollo',
    description: `Chama \`/auth/health\` com a chave guardada (0 créditos). Falha é resposta normal (\`ok: false\`) e carimba \`status: ERROR\`. ${ADMIN}`,
    consent: true,
    params: WORKSPACE,
    responses: {
      200: { description: 'Resultado do teste.', schema: TestResult },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, 'SD_INTEGRATION_NOT_FOUND'],
  },
]

export const crmApolloRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/integration`,
    tags: [TAG],
    summary: 'Estado da conexão com a Apollo',
    description: describe(
      'Diz se o workspace tem chave cadastrada, o estado dela e a lista de destino padrão. Qualquer membro do CRM lê (a página de importação decide o que mostrar).',
      SECRECY,
      crmAccess('leads', 'VIEW'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Conexão.', schema: Connection } },
    errors: CRM_ERRORS,
  },
  {
    method: 'put',
    path: `${BASE}/integration`,
    tags: [TAG],
    summary: 'Conectar a Apollo (chave de API)',
    description: describe(
      'Guarda a chave de API do próprio workspace, cifrada com `CONNECTION_SECRETS`. A chave é validada na Apollo (`/auth/health`) **antes** de guardar; trocar a chave preserva a lista de destino padrão.',
      SECRECY,
      ADMIN,
    ),
    consent: true,
    params: WORKSPACE,
    body: ConnectApolloSchema,
    responses: {
      200: { description: 'Conectada.', schema: IntegrationRecord },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      INVALID_KEY,
      RATE_LIMITED,
      REQUEST_FAILED,
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/integration`,
    tags: [TAG],
    summary: 'Definir a lista de destino padrão',
    description: describe(
      'Lista de e-mail marketing que as importações sugerem por padrão (`null` limpa).',
      ADMIN,
    ),
    consent: true,
    params: WORKSPACE,
    body: UpdateApolloSettingsSchema,
    responses: { 200: { description: 'Salvo.', schema: Connection } },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      NOT_CONNECTED,
      notFoundError('CrmMailingList', 'Lista inexistente no workspace'),
    ],
  },
  ...connectionRoutes(`${BASE}/integration`, TAG),
  {
    method: 'post',
    path: '/workspaces/{id}/integrations/apollo',
    tags: ['Integrações'],
    summary: 'Conectar a Apollo (Ajustes › Integrações)',
    description: describe(
      'Mesmo efeito de `PUT /workspaces/{id}/crm/apollo/integration`, na base das integrações do workspace.',
      SECRECY,
      ADMIN,
    ),
    consent: true,
    params: WORKSPACE,
    body: ConnectApolloSchema,
    responses: {
      201: { description: 'Conectada.', schema: IntegrationRecord },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      INVALID_KEY,
      RATE_LIMITED,
      REQUEST_FAILED,
    ],
  },
  ...connectionRoutes('/workspaces/{id}/integrations/apollo', 'Integrações'),
  {
    method: 'post',
    path: `${BASE}/search`,
    tags: [TAG],
    summary: 'Buscar pessoas na Apollo (prévia)',
    description: describe(
      'Prévia da busca da Apollo (`mixed_people/api_search`): **0 créditos**, sem e-mail nem telefone na resposta. Exige ao menos um filtro. O `rateLimit` reflete os cabeçalhos do plano da conta.',
      crmAccess('leads', 'CREATE'),
    ),
    params: WORKSPACE,
    body: ApolloSearchSchema,
    responses: {
      200: { description: 'Página de pessoas.', schema: SearchResult },
    },
    errors: [
      ...CRM_ERRORS,
      ...APOLLO_CALL_ERRORS,
      { code: 'VALIDATION_ERROR', when: 'Nenhum filtro preenchido' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/lists`,
    tags: [TAG],
    summary: 'Listas salvas na Apollo',
    description: describe(
      'Listas (`labels`) da conta da Apollo. Exige chave **master**; com outra chave a Apollo devolve 403.',
      crmAccess('leads', 'CREATE'),
    ),
    params: WORKSPACE,
    responses: { 200: { description: 'Listas.', schema: z.array(Label) } },
    errors: [...CRM_ERRORS, ...APOLLO_CALL_ERRORS],
  },
  {
    method: 'post',
    path: `${BASE}/lists/{labelId}/contacts`,
    tags: [TAG],
    summary: 'Contatos de uma lista da Apollo (prévia)',
    description: describe(
      'Contatos já salvos na lista (`contacts/search`): **0 créditos**, e-mail incluído — a importação não chama o enriquecimento.',
      crmAccess('leads', 'CREATE'),
    ),
    params: { ...WORKSPACE, labelId: 'Id da lista na Apollo.' },
    body: ApolloListContactsSchema,
    responses: {
      200: { description: 'Página de contatos.', schema: ContactsResult },
    },
    errors: [...CRM_ERRORS, ...APOLLO_CALL_ERRORS],
  },
  {
    method: 'get',
    path: `${BASE}/imports`,
    tags: [TAG],
    summary: 'Histórico de importações da Apollo',
    description: describe(
      'Importações mais recentes primeiro, com contagens e créditos.',
      crmAccess('leads', 'VIEW'),
    ),
    params: WORKSPACE,
    query: ListApolloImportsSchema,
    responses: {
      200: { description: 'Importações.', schema: z.array(ImportRun) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/imports`,
    tags: [TAG],
    summary: 'Importar pessoas da Apollo como leads',
    description: describe(
      'Cria a importação e a enfileira (`202`): o worker enriquece as pessoas em lotes de 10 (~1 crédito por pessoa; contatos de lista salva custam 0), ignora quem não tem e-mail verificado, quem se descadastrou e quem já foi importado, e cria os leads (origem `Apollo`, sem aviso por lead). Ao final, uma notificação com o resumo. Nunca revela e-mail pessoal. Com `revealPhones`, pede também os telefones (até +8 créditos por pessoa), que chegam depois pelo webhook `/crm/apollo/webhook/{token}`.',
      crmAccess('leads', 'CREATE'),
    ),
    consent: true,
    params: WORKSPACE,
    body: CreateApolloImportSchema,
    responses: {
      202: { description: 'Importação na fila.', schema: ImportRun },
    },
    errors: [
      ...CRM_ERRORS,
      NOT_CONNECTED,
      notFoundError('CrmMailingList', 'Lista de destino inexistente'),
    ],
  },
  {
    method: 'get',
    path: `${BASE}/imports/{importId}`,
    tags: [TAG],
    summary: 'Detalhe de uma importação da Apollo',
    description: describe(
      'Estado e contagens (a página consulta enquanto `QUEUED`/`RUNNING`).',
      crmAccess('leads', 'VIEW'),
    ),
    params: { ...WORKSPACE, importId: 'Id da importação.' },
    responses: { 200: { description: 'Importação.', schema: ImportRun } },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_APOLLO_IMPORT_NOT_FOUND',
        when: 'Importação inexistente no workspace',
      },
    ],
  },
  {
    method: 'post',
    path: '/crm/apollo/webhook/{token}',
    tags: [TAG],
    summary: 'Webhook de telefones revelados (Apollo)',
    description:
      'Chamado pela Apollo minutos depois de uma importação com `revealPhones`: traz os telefones das pessoas enriquecidas. Público — o `token` secreto da URL (derivado da importação; só o hash é guardado) autentica a chamada. Os números são normalizados e acrescentados aos leads da Apollo (ou criam o lead de quem não tinha e-mail). Reentregas não têm efeito.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token secreto da importação.' },
    body: ApolloPhoneWebhookSchema,
    responses: {
      200: {
        description: 'Recebido.',
        schema: dto(
          'ApolloPhoneWebhookAck',
          z.object({ received: z.boolean() }),
        ),
      },
    },
    errors: [
      {
        code: 'CRM_APOLLO_IMPORT_NOT_FOUND',
        when: 'Token desconhecido ou expirado',
      },
    ],
  },
]
