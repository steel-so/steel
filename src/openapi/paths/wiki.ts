import { z } from 'zod'
import {
  CreateWikiCommentSchema,
  ResolveWikiCommentSchema,
  UpdateWikiCommentSchema,
} from '@/src/schemas/wiki-comment.schema'
import {
  CreateWikiLabelSchema,
  SetWikiPageLabelsSchema,
  UpdateWikiLabelSchema,
  UpdateWikiSettingsSchema,
  WIKI_LABEL_COLORS,
} from '@/src/schemas/wiki-label.schema'
import {
  CreateWikiPageSchema,
  ListWikiMentionableMembersSchema,
  MoveWikiPageSchema,
  UpdateWikiPageSchema,
  WikiAiSchema,
} from '@/src/schemas/wiki-page.schema'
import {
  dto,
  fileUpload,
  WORKSPACE_MEMBER_ERRORS,
  WORKSPACE_PRIVILEGED_ERRORS,
} from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'

/**
 * Wiki do workspace (port do Nexo). Páginas, comentários e mídia passam por
 * `assertWikiMember`: membro do workspace **e** Wiki ativada.
 */

const dateTime = () => z.iso.datetime()
const WikiPerson = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .nullable()
const PlateValue = z
  .array(z.record(z.string(), z.unknown()))
  .meta({ description: 'Documento Plate (array de blocos).' })

const WikiPageDTO = dto(
  'WikiPage',
  z.object({
    id: z.string().meta({ example: 'ckv9x2p0h0000wk7d3k1e5abc' }),
    workspaceId: z.string(),
    parentId: z.string().nullable(),
    title: z.string().meta({ example: 'Manual de onboarding' }),
    icon: z.string().nullable(),
    coverImage: z.string().nullable(),
    content: PlateValue,
    position: z.number().int(),
    labelIds: z
      .array(z.string())
      .meta({ description: 'Etiquetas aplicadas (`WikiLabel.id`).' }),
    createdById: z.string().nullable(),
    updatedById: z.string().nullable(),
    archivedAt: dateTime().nullable(),
    publishedAt: dateTime()
      .nullable()
      .meta({ description: 'Publicada na web (link `/w/<publicToken>`).' }),
    publicToken: z
      .string()
      .nullable()
      .meta({ description: 'Segredo do link público; null sem publicação.' }),
    lockedAt: dateTime()
      .nullable()
      .meta({ description: 'Edição bloqueada desde.' }),
    lockedById: z.string().nullable(),
    canManageLock: z.boolean().meta({
      description:
        'Relativo a quem lê: autor da página ou OWNER/ADMIN. Com `lockedAt` e sem isto, a página é só leitura.',
    }),
    isFavorite: z
      .boolean()
      .meta({ description: 'Relativo a quem lê: está nos favoritos.' }),
    createdBy: WikiPerson,
    updatedBy: WikiPerson,
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const WikiCommentDTO = dto(
  'WikiComment',
  z.object({
    id: z.string(),
    wikiPageId: z.string(),
    markId: z.string().meta({
      description: 'Discussão (marca `comment_<markId>` no texto).',
    }),
    parentId: z.string().nullable(),
    content: PlateValue,
    author: z
      .object({
        id: z.string(),
        name: z.string(),
        username: z.string(),
        image: z.string().nullable(),
      })
      .nullable(),
    resolved: z.boolean(),
    resolvedAt: dateTime().nullable(),
    resolvedById: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const WikiLabelDTO = dto(
  'WikiLabel',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string().meta({ example: 'RH' }),
    color: z.enum(WIKI_LABEL_COLORS),
    pageCount: z
      .number()
      .int()
      .meta({ description: 'Páginas não arquivadas com a etiqueta.' }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const WikiSettingsDTO = dto('WikiSettings', z.object({ enabled: z.boolean() }))

const WikiMediaDTO = z.object({
  key: z.string().meta({ example: 'ckv9x2p0h0000ws7d3k1e5abc/abc123.png' }),
  url: z.string().meta({ description: 'URL pré-assinada (1h).' }),
})

const WikiMemberDTO = z.object({
  userId: z.string(),
  name: z.string(),
  image: z.string().nullable(),
})

const WS = { id: 'ID do workspace.' }
const PAGE = { ...WS, wikiPageId: 'ID da página.' }
const COMMENT = { ...PAGE, commentId: 'ID do comentário.' }
const LABEL = { ...WS, labelId: 'ID da etiqueta.' }

const WIKI_ERRORS: ErrorEntry[] = [
  ...WORKSPACE_MEMBER_ERRORS,
  { code: 'WIKI_DISABLED', when: 'A Wiki está desligada no workspace' },
]
const PAGE_ERRORS: ErrorEntry[] = [
  ...WIKI_ERRORS,
  'WIKI_PAGE_NOT_FOUND',
  { code: 'WIKI_PAGE_FORBIDDEN', when: 'Página de outro workspace' },
]
const COMMENT_ERRORS: ErrorEntry[] = [...PAGE_ERRORS, 'WIKI_COMMENT_NOT_FOUND']
const LOCKED: ErrorEntry = {
  code: 'WIKI_PAGE_LOCKED',
  when: 'Edição bloqueada e quem chama não é o autor nem OWNER/ADMIN',
}
const EDIT_ERRORS: ErrorEntry[] = [...PAGE_ERRORS, LOCKED]

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/wiki',
    tags: ['Wiki'],
    summary: 'Listar páginas',
    description:
      'Páginas não arquivadas, ordenadas por pai e posição (a árvore é montada no cliente).',
    params: WS,
    responses: {
      200: { description: 'Páginas.', schema: z.array(WikiPageDTO) },
    },
    errors: WIKI_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki',
    tags: ['Wiki'],
    summary: 'Criar página',
    description:
      'Cria uma página vazia, no fim dos irmãos. Com `parentId`, vira sub-página.',
    params: WS,
    body: CreateWikiPageSchema,
    responses: { 201: { description: 'Página criada.', schema: WikiPageDTO } },
    errors: PAGE_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/wiki/{wikiPageId}',
    tags: ['Wiki'],
    summary: 'Obter página',
    params: PAGE,
    responses: { 200: { description: 'Página.', schema: WikiPageDTO } },
    errors: PAGE_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/{wikiPageId}',
    tags: ['Wiki'],
    summary: 'Atualizar página',
    description:
      'Título, ícone, capa e o snapshot JSON do conteúdo (autosave). O estado colaborativo (Yjs) é gravado pelo servidor realtime.',
    params: PAGE,
    consent: true,
    body: UpdateWikiPageSchema,
    responses: { 200: { description: 'Página salva.', schema: WikiPageDTO } },
    errors: EDIT_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/{wikiPageId}/move',
    tags: ['Wiki'],
    summary: 'Mover página',
    params: PAGE,
    consent: true,
    body: MoveWikiPageSchema,
    responses: { 200: { description: 'Página movida.', schema: WikiPageDTO } },
    errors: EDIT_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/{wikiPageId}/archive',
    tags: ['Wiki'],
    summary: 'Arquivar página',
    description: 'Arquiva a página e toda a sub-árvore com o mesmo carimbo.',
    params: PAGE,
    consent: true,
    responses: {
      200: { description: 'Página arquivada.', schema: WikiPageDTO },
    },
    errors: EDIT_ERRORS,
  },
  {
    method: 'put',
    path: '/workspaces/{id}/wiki/{wikiPageId}/labels',
    tags: ['Wiki'],
    summary: 'Definir etiquetas da página',
    description:
      'Substitui o conjunto de etiquetas da página. Qualquer membro aplica; as etiquetas são criadas em Ajustes › Wiki.',
    params: PAGE,
    consent: true,
    body: SetWikiPageLabelsSchema,
    responses: {
      200: { description: 'Página com as etiquetas.', schema: WikiPageDTO },
    },
    errors: [
      ...EDIT_ERRORS,
      { code: 'WIKI_LABEL_NOT_FOUND', when: 'Etiqueta de outro workspace' },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/{wikiPageId}/publish',
    tags: ['Wiki'],
    summary: 'Publicar na web',
    description:
      'Cria o link público somente leitura `/w/<publicToken>` (token aleatório de 192 bits) e marca `publishedAt`. Idempotente: uma página já publicada mantém o link.',
    params: PAGE,
    consent: true,
    responses: {
      200: { description: 'Página publicada.', schema: WikiPageDTO },
    },
    errors: EDIT_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/wiki/{wikiPageId}/publish',
    tags: ['Wiki'],
    summary: 'Cancelar publicação',
    description: 'Revoga o link público: o endereço antigo passa a dar 404.',
    params: PAGE,
    consent: true,
    responses: {
      200: { description: 'Publicação cancelada.', schema: WikiPageDTO },
    },
    errors: EDIT_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/{wikiPageId}/lock',
    tags: ['Wiki'],
    summary: 'Bloquear edição',
    description:
      'Só o autor da página ou OWNER/ADMIN. Enquanto bloqueada, os demais recebem `WIKI_PAGE_LOCKED` ao editar e entram no editor colaborativo como somente leitura; editores já abertos reconectam em segundos com a nova permissão.',
    params: PAGE,
    consent: true,
    responses: {
      200: { description: 'Edição bloqueada.', schema: WikiPageDTO },
    },
    errors: [
      ...PAGE_ERRORS,
      { code: 'WIKI_LOCK_FORBIDDEN', when: 'Não é o autor nem OWNER/ADMIN' },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/wiki/{wikiPageId}/lock',
    tags: ['Wiki'],
    summary: 'Desbloquear edição',
    description: 'Só o autor da página ou OWNER/ADMIN.',
    params: PAGE,
    consent: true,
    responses: {
      200: { description: 'Edição desbloqueada.', schema: WikiPageDTO },
    },
    errors: [
      ...PAGE_ERRORS,
      { code: 'WIKI_LOCK_FORBIDDEN', when: 'Não é o autor nem OWNER/ADMIN' },
    ],
  },
  {
    method: 'put',
    path: '/workspaces/{id}/wiki/{wikiPageId}/favorite',
    tags: ['Wiki'],
    summary: 'Favoritar página',
    description: 'Favorito por usuário. Idempotente.',
    params: PAGE,
    consent: true,
    responses: { 200: { description: 'Página.', schema: WikiPageDTO } },
    errors: PAGE_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/wiki/{wikiPageId}/favorite',
    tags: ['Wiki'],
    summary: 'Remover dos favoritos',
    params: PAGE,
    consent: true,
    responses: { 200: { description: 'Página.', schema: WikiPageDTO } },
    errors: PAGE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/{wikiPageId}/duplicate',
    tags: ['Wiki'],
    summary: 'Duplicar página',
    description:
      'Cópia logo depois da original (mesmo pai): título com " (cópia)", ícone, capa, conteúdo, estado colaborativo (Yjs) e etiquetas. Sub-páginas não são copiadas; a cópia nasce sem publicação nem bloqueio.',
    params: PAGE,
    consent: true,
    responses: { 201: { description: 'Cópia criada.', schema: WikiPageDTO } },
    errors: PAGE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/{wikiPageId}/ai',
    tags: ['Wiki'],
    summary: 'IA no editor',
    description:
      'Reescreve `text` (parafrasear, simplificar, desenvolver, resumir ou sugerir título) com o provedor e o modelo de Ajustes › Steel IA, dentro da cota mensal (ADR 0007). Uso registrado como `WIKI_ASSISTANT`.',
    params: PAGE,
    rateLimit: 'user',
    body: WikiAiSchema,
    responses: {
      200: {
        description: 'Texto gerado.',
        schema: z.object({ text: z.string() }),
      },
    },
    errors: [
      ...PAGE_ERRORS,
      { code: 'AI_DISABLED', when: 'Steel IA desligada no workspace' },
      'AI_PROVIDER_UNAVAILABLE',
      'AI_QUOTA_EXCEEDED',
      { code: 'WIKI_AI_FAILED', when: 'O provedor falhou ou não respondeu' },
    ],
  },
  {
    method: 'get',
    path: '/wiki/public/{token}/media',
    tags: ['Wiki'],
    summary: 'Mídia de página publicada',
    description:
      'Serve, sem login, uma imagem/arquivo referenciado pela página publicada em `/w/<token>`. Só chaves que a página usa; revogar a publicação corta o acesso.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token do link público.' },
    query: z.object({
      key: z.string().meta({ description: 'Chave do objeto no bucket.' }),
    }),
    queryValidationError: false,
    responses: {
      200: {
        description: 'Conteúdo do arquivo.',
        envelope: false,
        contentType: 'application/octet-stream',
        schema: { type: 'string', format: 'binary' },
      },
    },
    errors: [
      'VALIDATION_ERROR',
      {
        code: 'WIKI_PAGE_NOT_FOUND',
        when: 'Token inválido/revogado ou chave que a página não usa',
      },
      'STORAGE_ERROR',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/wiki/{wikiPageId}/comments',
    tags: ['Wiki'],
    summary: 'Listar comentários',
    params: PAGE,
    responses: {
      200: { description: 'Comentários.', schema: z.array(WikiCommentDTO) },
    },
    errors: PAGE_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/{wikiPageId}/comments',
    tags: ['Wiki'],
    summary: 'Comentar',
    description:
      'Abre uma discussão (`markId`) ou responde a ela (`parentId`).',
    params: PAGE,
    consent: true,
    body: CreateWikiCommentSchema,
    responses: {
      201: { description: 'Comentário criado.', schema: WikiCommentDTO },
    },
    errors: [...COMMENT_ERRORS, 'WIKI_COMMENT_NESTING_TOO_DEEP'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/{wikiPageId}/comments/{commentId}',
    tags: ['Wiki'],
    summary: 'Editar comentário',
    description: 'Só o autor.',
    params: COMMENT,
    consent: true,
    body: UpdateWikiCommentSchema,
    responses: {
      200: { description: 'Comentário editado.', schema: WikiCommentDTO },
    },
    errors: [...COMMENT_ERRORS, 'WIKI_COMMENT_FORBIDDEN'],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/wiki/{wikiPageId}/comments/{commentId}',
    tags: ['Wiki'],
    summary: 'Excluir comentário',
    description: 'Só o autor.',
    params: COMMENT,
    consent: true,
    responses: { 200: { description: 'Comentário excluído.', schema: null } },
    errors: [...COMMENT_ERRORS, 'WIKI_COMMENT_FORBIDDEN'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/{wikiPageId}/comments/{commentId}/resolve',
    tags: ['Wiki'],
    summary: 'Resolver/reabrir discussão',
    params: COMMENT,
    consent: true,
    body: ResolveWikiCommentSchema,
    responses: {
      200: { description: 'Discussão atualizada.', schema: WikiCommentDTO },
    },
    errors: COMMENT_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/media',
    tags: ['Wiki'],
    summary: 'Enviar mídia',
    description:
      'Imagem (10 MB), vídeo (200 MB), áudio (50 MB) ou arquivo (25 MB), gravado no bucket `wiki-media`.',
    params: WS,
    consent: true,
    body: fileUpload('file', 'Arquivo a enviar.'),
    responses: { 201: { description: 'Mídia gravada.', schema: WikiMediaDTO } },
    errors: [...WIKI_ERRORS, 'STORAGE_ERROR'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/wiki/media',
    tags: ['Wiki'],
    summary: 'Renovar URL de mídia',
    params: WS,
    query: z.object({
      key: z.string().meta({ description: 'Chave devolvida pelo upload.' }),
    }),
    responses: {
      200: {
        description: 'URL pré-assinada (1h).',
        schema: WikiMediaDTO.pick({ url: true }),
      },
    },
    errors: WIKI_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/wiki/members',
    tags: ['Wiki'],
    summary: 'Membros para @menção',
    description: 'Até 8 membros do workspace, por nome.',
    params: WS,
    query: ListWikiMentionableMembersSchema,
    responses: {
      200: { description: 'Membros.', schema: z.array(WikiMemberDTO) },
    },
    errors: WIKI_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/wiki/settings',
    tags: ['Wiki'],
    summary: 'Ajustes da Wiki',
    description: 'Se a Wiki está ativada no workspace. Qualquer membro lê.',
    params: WS,
    responses: {
      200: { description: 'Ajustes.', schema: WikiSettingsDTO },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/settings',
    tags: ['Wiki'],
    summary: 'Ativar/desativar a Wiki',
    description: 'Só OWNER/ADMIN. Desligar esconde a Wiki, sem apagar páginas.',
    params: WS,
    consent: true,
    body: UpdateWikiSettingsSchema,
    responses: {
      200: { description: 'Ajustes salvos.', schema: WikiSettingsDTO },
    },
    errors: WORKSPACE_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: '/workspaces/{id}/wiki/labels',
    tags: ['Wiki'],
    summary: 'Listar etiquetas',
    description: 'Qualquer membro lê (o cabeçalho da página aplica).',
    params: WS,
    responses: {
      200: { description: 'Etiquetas.', schema: z.array(WikiLabelDTO) },
    },
    errors: WORKSPACE_MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/wiki/labels',
    tags: ['Wiki'],
    summary: 'Criar etiqueta',
    description: 'Só OWNER/ADMIN.',
    params: WS,
    consent: true,
    body: CreateWikiLabelSchema,
    responses: {
      201: { description: 'Etiqueta criada.', schema: WikiLabelDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, 'WIKI_LABEL_CONFLICT'],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/wiki/labels/{labelId}',
    tags: ['Wiki'],
    summary: 'Editar etiqueta',
    description: 'Só OWNER/ADMIN.',
    params: LABEL,
    consent: true,
    body: UpdateWikiLabelSchema,
    responses: {
      200: { description: 'Etiqueta salva.', schema: WikiLabelDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      'WIKI_LABEL_NOT_FOUND',
      'WIKI_LABEL_CONFLICT',
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/wiki/labels/{labelId}',
    tags: ['Wiki'],
    summary: 'Excluir etiqueta',
    description: 'Só OWNER/ADMIN. Sai de todas as páginas.',
    params: LABEL,
    consent: true,
    responses: { 200: { description: 'Etiqueta excluída.', schema: null } },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, 'WIKI_LABEL_NOT_FOUND'],
  },
]

export function registerWikiPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
