import { z } from 'zod'
import {
  BulkSitePostsSchema,
  CreateSiteAuthorSchema,
  CreateSiteBlogCategorySchema,
  CreateSiteBlogTagSchema,
  CreateSitePostSchema,
  ListSitePostsQuerySchema,
  SiteBlogAiSchema,
  UpdateSiteAuthorSchema,
  UpdateSiteBlogCategorySchema,
  UpdateSiteBlogTagSchema,
  UpdateSitePostSchema,
} from '@/src/schemas/site-blog.schema'
import {
  CreateSiteCollectionItemSchema,
  CreateSiteCollectionSchema,
  ReorderSiteCollectionItemsSchema,
  UpdateSiteCollectionItemSchema,
  UpdateSiteCollectionSchema,
} from '@/src/schemas/site-collection.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SiteAuthorDTOSchema,
  SiteBlogAiResultDTOSchema,
  SiteBlogCategoryDTOSchema,
  SiteBlogTagDTOSchema,
  SiteBulkPostsResultDTOSchema,
  SiteCmsPreviewDTOSchema,
  SiteCollectionDTOSchema,
  SiteCollectionItemDTOSchema,
  SitePostDTOSchema,
  SitePostPageDTOSchema,
} from '../../schemas/crm/site-blog'
import { SiteGlobalDTOSchema } from '../../schemas/crm/sites'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Sites — blog (posts, categorias, tags, autores, IA) e coleções. */

const TAG = ['CRM · Sites'] as ['CRM · Sites']
const BASE = '/workspaces/{id}/crm/sites/{siteId}'

const ID = (description: string) => ({
  description,
  example: 'ckw1abcd0000ab7d3k1e5xyz',
})
const SITE_ID = ID('Id do site.')
const POST_ID = ID('Id do post.')
const TERM_ID = ID('Id da categoria ou tag.')
const AUTHOR_ID = ID('Id do autor.')
const COLLECTION_ID = ID('Id da coleção.')
const ITEM_ID = ID('Id do item.')

const SITE_NOT_FOUND: ErrorEntry = {
  code: 'SITE_NOT_FOUND',
  when: 'Site inexistente, excluído ou de outro workspace',
}
const POST_NOT_FOUND: ErrorEntry = {
  code: 'SITE_POST_NOT_FOUND',
  when: 'Post inexistente ou de outro site',
}
const TERM_NOT_FOUND: ErrorEntry = {
  code: 'SITE_BLOG_TERM_NOT_FOUND',
  when: 'Categoria ou tag inexistente ou de outro site',
}
const AUTHOR_NOT_FOUND: ErrorEntry = {
  code: 'SITE_AUTHOR_NOT_FOUND',
  when: 'Autor inexistente ou de outro site',
}
const COLLECTION_NOT_FOUND: ErrorEntry = {
  code: 'SITE_COLLECTION_NOT_FOUND',
  when: 'Coleção inexistente ou de outro site',
}
const ITEM_NOT_FOUND: ErrorEntry = {
  code: 'SITE_COLLECTION_ITEM_NOT_FOUND',
  when: 'Item inexistente ou de outra coleção',
}
const LIMIT: ErrorEntry = {
  code: 'SITE_LIMIT_REACHED',
  when: 'O site chegou ao limite deste tipo de conteúdo',
}

const LIVE_POST =
  'Um post vai ao ar sozinho, sem publicar o site: PUBLISHED com data passada fica público na hora; uma data futura agenda (SCHEDULED) e o worker publica no horário. `publishedAt: null` com PUBLISHED publica agora.'

const view = crmAccess('landing-pages', 'VIEW')
const edit = crmAccess('landing-pages', 'EDIT')
const remove = crmAccess('landing-pages', 'DELETE')

export const crmSiteBlogRoutes: RouteConfig[] = [
  // ─── posts ──────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/blog/posts`,
    tags: TAG,
    summary: 'Listar posts do blog',
    description: describe(
      'Posts do site (sem o corpo), mais recentes primeiro, com filtros por status, categoria, tag, autor e busca no título/resumo.',
      view,
    ),
    params: { siteId: SITE_ID },
    query: ListSitePostsQuerySchema,
    responses: {
      200: { description: 'Página de posts.', schema: SitePostPageDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/blog/posts`,
    tags: TAG,
    summary: 'Criar post',
    description: describe(
      'Cria um post (rascunho por padrão). O endereço sai do título quando omitido. O corpo é o valor do editor Plate; o HTML público, o texto e o tempo de leitura são calculados no servidor.',
      edit,
      LIVE_POST,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSitePostSchema,
    responses: { 201: { description: 'Criado.', schema: SitePostDTOSchema } },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      TERM_NOT_FOUND,
      AUTHOR_NOT_FOUND,
      {
        code: 'SITE_POST_SLUG_TAKEN',
        when: 'Outro post do site já usa este endereço',
      },
      LIMIT,
    ],
  },
  {
    method: 'get',
    path: `${BASE}/blog/posts/{postId}`,
    tags: TAG,
    summary: 'Abrir post',
    description: describe('Post completo, com corpo e SEO.', view),
    params: { siteId: SITE_ID, postId: POST_ID },
    responses: { 200: { description: 'Post.', schema: SitePostDTOSchema } },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, POST_NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/blog/posts/{postId}`,
    tags: TAG,
    summary: 'Alterar post',
    description: describe(edit, LIVE_POST),
    params: { siteId: SITE_ID, postId: POST_ID },
    consent: true,
    body: UpdateSitePostSchema,
    responses: { 200: { description: 'Alterado.', schema: SitePostDTOSchema } },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      POST_NOT_FOUND,
      TERM_NOT_FOUND,
      AUTHOR_NOT_FOUND,
      {
        code: 'SITE_POST_SLUG_TAKEN',
        when: 'Outro post do site já usa este endereço',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/blog/posts/{postId}`,
    tags: TAG,
    summary: 'Excluir post',
    description: describe(remove),
    params: { siteId: SITE_ID, postId: POST_ID },
    consent: true,
    responses: { 200: 'Excluído.' },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, POST_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/blog/posts/bulk`,
    tags: TAG,
    summary: 'Ação em massa nos posts',
    description: describe(
      'Publicar, voltar para rascunho, destacar, tirar destaque, excluir ou adicionar/remover uma categoria. Ids de outros sites são ignorados. Excluir exige a permissão DELETE.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: BulkSitePostsSchema,
    responses: {
      200: {
        description: 'Posts afetados.',
        schema: SiteBulkPostsResultDTOSchema,
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, TERM_NOT_FOUND],
  },

  // ─── categories and tags ────────────────────────────────────────────────
  ...termRoutes('categories', 'categoria', {
    create: CreateSiteBlogCategorySchema,
    update: UpdateSiteBlogCategorySchema,
    dto: SiteBlogCategoryDTOSchema,
  }),
  ...termRoutes('tags', 'tag', {
    create: CreateSiteBlogTagSchema,
    update: UpdateSiteBlogTagSchema,
    dto: SiteBlogTagDTOSchema,
  }),

  // ─── authors ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/blog/authors`,
    tags: TAG,
    summary: 'Listar autores do blog',
    description: describe(view),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Autores.', schema: z.array(SiteAuthorDTOSchema) },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/blog/authors`,
    tags: TAG,
    summary: 'Criar autor',
    description: describe(
      'Perfil público (nome, foto, biografia, redes) de um membro do workspace ou de um autor convidado (sem `userId`).',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSiteAuthorSchema,
    responses: { 201: { description: 'Criado.', schema: SiteAuthorDTOSchema } },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      {
        code: 'SITE_AUTHOR_TAKEN',
        when: 'Endereço ou membro já usado por outro autor',
      },
      LIMIT,
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/blog/authors/{authorId}`,
    tags: TAG,
    summary: 'Alterar autor',
    description: describe(edit),
    params: { siteId: SITE_ID, authorId: AUTHOR_ID },
    consent: true,
    body: UpdateSiteAuthorSchema,
    responses: {
      200: { description: 'Alterado.', schema: SiteAuthorDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      AUTHOR_NOT_FOUND,
      {
        code: 'SITE_AUTHOR_TAKEN',
        when: 'Endereço ou membro já usado por outro autor',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/blog/authors/{authorId}`,
    tags: TAG,
    summary: 'Excluir autor',
    description: describe('Os posts do autor ficam sem autor.', edit),
    params: { siteId: SITE_ID, authorId: AUTHOR_ID },
    consent: true,
    responses: { 200: 'Excluído.' },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, AUTHOR_NOT_FOUND],
  },

  // ─── templates, preview, AI ─────────────────────────────────────────────
  {
    method: 'post',
    path: `${BASE}/blog/templates`,
    tags: TAG,
    summary: 'Criar as páginas (modelos) do blog',
    description: describe(
      'Cria os modelos que faltam (página do blog, post, categoria, tag e autor) como globais `TEMPLATE`, editáveis no canvas e publicados com o site. Idempotente: devolve todos.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    responses: {
      200: {
        description: 'Modelos do blog.',
        schema: z.array(SiteGlobalDTOSchema),
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/blog/preview`,
    tags: TAG,
    summary: 'Dados do blog para o editor',
    description: describe(
      'Posts (inclusive rascunhos), categorias, tags, autores e itens das coleções que o canvas do editor usa nos elementos de blog e coleção. Sem nenhum post, devolve um blog de exemplo (`sample: true`).',
      view,
    ),
    params: { siteId: SITE_ID },
    responses: {
      200: { description: 'Dados.', schema: SiteCmsPreviewDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/blog/ai`,
    tags: TAG,
    summary: 'IA do editor de posts',
    description: describe(
      'Escrever post a partir de um assunto/roteiro (`write`), gerar resumo (`summary`), sugerir títulos (`titles`) ou transformar o texto em perguntas frequentes (`faq`). Sempre um rascunho para revisão: nada é salvo. Usa o provedor e a cota mensal de IA do CRM.',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: SiteBlogAiSchema,
    responses: {
      200: { description: 'Rascunho.', schema: SiteBlogAiResultDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      {
        code: 'FEATURE_NOT_IN_PLAN',
        when: 'O plano não inclui o assistente de IA do CRM',
      },
      'AI_QUOTA_EXCEEDED',
      {
        code: 'SITE_BLOG_AI_FAILED',
        when: 'O provedor falhou ou devolveu um rascunho inválido',
      },
    ],
  },

  // ─── collections ────────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/collections`,
    tags: TAG,
    summary: 'Listar coleções do site',
    description: describe(view),
    params: { siteId: SITE_ID },
    responses: {
      200: {
        description: 'Coleções.',
        schema: z.array(SiteCollectionDTOSchema),
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/collections`,
    tags: TAG,
    summary: 'Criar coleção',
    description: describe(
      'Tipo de conteúdo com campos tipados (texto, texto formatado, imagem, número, data, link, referência a outra coleção, produto do CRM).',
      edit,
    ),
    params: { siteId: SITE_ID },
    consent: true,
    body: CreateSiteCollectionSchema,
    responses: {
      201: { description: 'Criada.', schema: SiteCollectionDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      COLLECTION_NOT_FOUND,
      {
        code: 'SITE_COLLECTION_SLUG_TAKEN',
        when: 'Outra coleção do site usa este endereço',
      },
      LIMIT,
    ],
  },
  {
    method: 'get',
    path: `${BASE}/collections/{collectionId}`,
    tags: TAG,
    summary: 'Abrir coleção',
    description: describe(view),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    responses: {
      200: { description: 'Coleção.', schema: SiteCollectionDTOSchema },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, COLLECTION_NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/collections/{collectionId}`,
    tags: TAG,
    summary: 'Alterar coleção',
    description: describe(edit),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    consent: true,
    body: UpdateSiteCollectionSchema,
    responses: {
      200: { description: 'Alterada.', schema: SiteCollectionDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      COLLECTION_NOT_FOUND,
      {
        code: 'SITE_COLLECTION_SLUG_TAKEN',
        when: 'Outra coleção do site usa este endereço',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/collections/{collectionId}`,
    tags: TAG,
    summary: 'Excluir coleção',
    description: describe(
      'Exclui a coleção, os itens e a página do item.',
      remove,
    ),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    consent: true,
    responses: { 200: 'Excluída.' },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, COLLECTION_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/collections/{collectionId}/template`,
    tags: TAG,
    summary: 'Criar a página do item',
    description: describe(
      'Cria o modelo da página de cada item (`/<coleção>/<item>`) a partir dos campos, como global `TEMPLATE`; devolve o existente quando já há um.',
      edit,
    ),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    consent: true,
    responses: { 200: { description: 'Modelo.', schema: SiteGlobalDTOSchema } },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, COLLECTION_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/collections/{collectionId}/items`,
    tags: TAG,
    summary: 'Listar itens da coleção',
    description: describe(
      'Na ordem da coleção; filtros `status` e `search`.',
      view,
    ),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    query: z.object({
      status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
      search: z.string().max(100).optional(),
    }),
    responses: {
      200: {
        description: 'Itens.',
        schema: z.array(SiteCollectionItemDTOSchema),
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, COLLECTION_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/collections/{collectionId}/items`,
    tags: TAG,
    summary: 'Criar item',
    description: describe(
      'Valores validados pelos campos da coleção (obrigatórios, tipos, referências do mesmo site; produto preenchido com nome e preço do CRM). Itens PUBLISHED aparecem no site na hora.',
      edit,
    ),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    consent: true,
    body: CreateSiteCollectionItemSchema,
    responses: {
      201: { description: 'Criado.', schema: SiteCollectionItemDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      COLLECTION_NOT_FOUND,
      {
        code: 'SITE_COLLECTION_ITEM_INVALID',
        when: 'Valores não batem com os campos',
      },
      {
        code: 'SITE_COLLECTION_ITEM_SLUG_TAKEN',
        when: 'Outro item da coleção usa este endereço',
      },
      LIMIT,
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/collections/{collectionId}/items/{itemId}`,
    tags: TAG,
    summary: 'Alterar item',
    description: describe(edit),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID, itemId: ITEM_ID },
    consent: true,
    body: UpdateSiteCollectionItemSchema,
    responses: {
      200: { description: 'Alterado.', schema: SiteCollectionItemDTOSchema },
    },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      COLLECTION_NOT_FOUND,
      ITEM_NOT_FOUND,
      {
        code: 'SITE_COLLECTION_ITEM_INVALID',
        when: 'Valores não batem com os campos',
      },
      {
        code: 'SITE_COLLECTION_ITEM_SLUG_TAKEN',
        when: 'Outro item da coleção usa este endereço',
      },
    ],
  },
  {
    method: 'delete',
    path: `${BASE}/collections/{collectionId}/items/{itemId}`,
    tags: TAG,
    summary: 'Excluir item',
    description: describe(remove),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID, itemId: ITEM_ID },
    consent: true,
    responses: { 200: 'Excluído.' },
    errors: [
      ...CRM_ERRORS,
      SITE_NOT_FOUND,
      COLLECTION_NOT_FOUND,
      ITEM_NOT_FOUND,
    ],
  },
  {
    method: 'post',
    path: `${BASE}/collections/{collectionId}/items/reorder`,
    tags: TAG,
    summary: 'Reordenar itens',
    description: describe(
      'Posições seguem `orderedIds`; devolve a lista.',
      edit,
    ),
    params: { siteId: SITE_ID, collectionId: COLLECTION_ID },
    consent: true,
    body: ReorderSiteCollectionItemsSchema,
    responses: {
      200: {
        description: 'Itens.',
        schema: z.array(SiteCollectionItemDTOSchema),
      },
    },
    errors: [...CRM_ERRORS, SITE_NOT_FOUND, COLLECTION_NOT_FOUND],
  },
]

function termRoutes(
  segment: 'categories' | 'tags',
  label: 'categoria' | 'tag',
  schemas: {
    create: z.ZodType
    update: z.ZodType
    dto: z.ZodType
  },
): RouteConfig[] {
  const plural = segment === 'categories' ? 'categorias' : 'tags'
  const taken: ErrorEntry = {
    code: 'SITE_BLOG_TERM_SLUG_TAKEN',
    when: `Outra ${label} do site usa este endereço`,
  }
  const page = `/blog/${segment === 'categories' ? 'categoria' : 'tag'}/<slug>`
  return [
    {
      method: 'get',
      path: `${BASE}/blog/${segment}`,
      tags: TAG,
      summary: `Listar ${plural} do blog`,
      description: describe(
        `Com a quantidade de posts de cada ${label}.`,
        view,
      ),
      params: { siteId: SITE_ID },
      responses: {
        200: { description: 'Lista.', schema: z.array(schemas.dto) },
      },
      errors: [...CRM_ERRORS, SITE_NOT_FOUND],
    },
    {
      method: 'post',
      path: `${BASE}/blog/${segment}`,
      tags: TAG,
      summary: `Criar ${label}`,
      description: describe(`Ganha a página pública ${page}.`, edit),
      params: { siteId: SITE_ID },
      consent: true,
      body: schemas.create,
      responses: { 201: { description: 'Criada.', schema: schemas.dto } },
      errors: [...CRM_ERRORS, SITE_NOT_FOUND, taken, LIMIT],
    },
    {
      method: 'patch',
      path: `${BASE}/blog/${segment}/{${segment === 'categories' ? 'categoryId' : 'tagId'}}`,
      tags: TAG,
      summary: `Alterar ${label}`,
      description: describe(edit),
      params: {
        siteId: SITE_ID,
        [segment === 'categories' ? 'categoryId' : 'tagId']: TERM_ID,
      },
      consent: true,
      body: schemas.update,
      responses: { 200: { description: 'Alterada.', schema: schemas.dto } },
      errors: [...CRM_ERRORS, SITE_NOT_FOUND, TERM_NOT_FOUND, taken],
    },
    {
      method: 'delete',
      path: `${BASE}/blog/${segment}/{${segment === 'categories' ? 'categoryId' : 'tagId'}}`,
      tags: TAG,
      summary: `Excluir ${label}`,
      description: describe('Os posts continuam, só sem esta marcação.', edit),
      params: {
        siteId: SITE_ID,
        [segment === 'categories' ? 'categoryId' : 'tagId']: TERM_ID,
      },
      consent: true,
      responses: { 200: 'Excluída.' },
      errors: [...CRM_ERRORS, SITE_NOT_FOUND, TERM_NOT_FOUND],
    },
  ]
}
