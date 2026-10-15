'use client'

import { useQuery } from '@tanstack/react-query'
import type {
  BulkSitePostsDTO,
  CreateSiteAuthorDTO,
  CreateSiteBlogCategoryDTO,
  CreateSiteBlogTagDTO,
  CreateSitePostDTO,
  ListSitePostsQueryDTO,
  SiteBlogAiDTO,
  UpdateSiteAuthorDTO,
  UpdateSiteBlogCategoryDTO,
  UpdateSiteBlogTagDTO,
  UpdateSitePostDTO,
} from '@/src/schemas/site-blog.schema'
import type {
  CreateSiteCollectionDTO,
  CreateSiteCollectionItemDTO,
  UpdateSiteCollectionDTO,
  UpdateSiteCollectionItemDTO,
} from '@/src/schemas/site-collection.schema'
import type { SiteGlobalDTO } from '@/types/site'
import type {
  SiteAuthorDTO,
  SiteBlogAiResultDTO,
  SiteBlogCategoryDTO,
  SiteBlogTagDTO,
  SiteBulkPostsResultDTO,
  SiteCmsPreviewDTO,
  SiteCollectionDTO,
  SiteCollectionItemDTO,
  SitePostDTO,
  SitePostPageDTO,
} from '@/types/site-blog'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/**
 * Client of the site blog and collections (slice site-blog): posts,
 * categories, tags, authors, the blog templates, the AI helpers, the
 * editor canvas preview data and the collections/items. Mutations throw
 * `ApiError` with the pt-BR message.
 */
export function siteBlogApi(workspaceId: string, siteId: string) {
  const base = `/api/workspaces/${workspaceId}/crm/sites/${siteId}`
  const blog = `${base}/blog`
  const collections = `${base}/collections`
  return {
    posts: (query: Partial<ListSitePostsQueryDTO> = {}) => {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') params.set(key, String(value))
      }
      const search = params.toString()
      return apiFetch<SitePostPageDTO>(
        `${blog}/posts${search ? `?${search}` : ''}`,
      )
    },
    post: (postId: string) => apiFetch<SitePostDTO>(`${blog}/posts/${postId}`),
    createPost: (dto: CreateSitePostDTO) =>
      apiFetchJson<SitePostDTO>(
        `${blog}/posts`,
        'POST',
        dto,
        'Não foi possível criar o post',
      ),
    updatePost: (postId: string, dto: UpdateSitePostDTO) =>
      apiFetchJson<SitePostDTO>(
        `${blog}/posts/${postId}`,
        'PATCH',
        dto,
        'Não foi possível salvar o post',
      ),
    removePost: (postId: string) =>
      apiSend(
        `${blog}/posts/${postId}`,
        { method: 'DELETE' },
        'Não foi possível excluir o post',
      ),
    bulkPosts: (dto: BulkSitePostsDTO) =>
      apiFetchJson<SiteBulkPostsResultDTO>(
        `${blog}/posts/bulk`,
        'POST',
        dto,
        'Não foi possível aplicar a ação',
      ),

    categories: () => apiFetch<SiteBlogCategoryDTO[]>(`${blog}/categories`),
    createCategory: (dto: CreateSiteBlogCategoryDTO) =>
      apiFetchJson<SiteBlogCategoryDTO>(`${blog}/categories`, 'POST', dto),
    updateCategory: (id: string, dto: UpdateSiteBlogCategoryDTO) =>
      apiFetchJson<SiteBlogCategoryDTO>(
        `${blog}/categories/${id}`,
        'PATCH',
        dto,
      ),
    removeCategory: (id: string) =>
      apiSend(`${blog}/categories/${id}`, { method: 'DELETE' }),

    tags: () => apiFetch<SiteBlogTagDTO[]>(`${blog}/tags`),
    createTag: (dto: CreateSiteBlogTagDTO) =>
      apiFetchJson<SiteBlogTagDTO>(`${blog}/tags`, 'POST', dto),
    updateTag: (id: string, dto: UpdateSiteBlogTagDTO) =>
      apiFetchJson<SiteBlogTagDTO>(`${blog}/tags/${id}`, 'PATCH', dto),
    removeTag: (id: string) =>
      apiSend(`${blog}/tags/${id}`, { method: 'DELETE' }),

    authors: () => apiFetch<SiteAuthorDTO[]>(`${blog}/authors`),
    createAuthor: (dto: CreateSiteAuthorDTO) =>
      apiFetchJson<SiteAuthorDTO>(`${blog}/authors`, 'POST', dto),
    updateAuthor: (id: string, dto: UpdateSiteAuthorDTO) =>
      apiFetchJson<SiteAuthorDTO>(`${blog}/authors/${id}`, 'PATCH', dto),
    removeAuthor: (id: string) =>
      apiSend(`${blog}/authors/${id}`, { method: 'DELETE' }),

    ensureTemplates: () =>
      apiFetchJson<SiteGlobalDTO[]>(
        `${blog}/templates`,
        'POST',
        undefined,
        'Não foi possível criar as páginas do blog',
      ),
    preview: () => apiFetch<SiteCmsPreviewDTO>(`${blog}/preview`),
    ai: (dto: SiteBlogAiDTO) =>
      apiFetchJson<SiteBlogAiResultDTO>(
        `${blog}/ai`,
        'POST',
        dto,
        'A IA não conseguiu gerar o rascunho',
      ),

    collections: () => apiFetch<SiteCollectionDTO[]>(collections),
    collection: (id: string) =>
      apiFetch<SiteCollectionDTO>(`${collections}/${id}`),
    createCollection: (dto: CreateSiteCollectionDTO) =>
      apiFetchJson<SiteCollectionDTO>(
        collections,
        'POST',
        dto,
        'Não foi possível criar a coleção',
      ),
    updateCollection: (id: string, dto: UpdateSiteCollectionDTO) =>
      apiFetchJson<SiteCollectionDTO>(
        `${collections}/${id}`,
        'PATCH',
        dto,
        'Não foi possível salvar a coleção',
      ),
    removeCollection: (id: string) =>
      apiSend(`${collections}/${id}`, { method: 'DELETE' }),
    ensureItemTemplate: (id: string) =>
      apiFetchJson<SiteGlobalDTO>(
        `${collections}/${id}/template`,
        'POST',
        undefined,
        'Não foi possível criar a página do item',
      ),
    items: (id: string) =>
      apiFetch<SiteCollectionItemDTO[]>(`${collections}/${id}/items`),
    createItem: (id: string, dto: CreateSiteCollectionItemDTO) =>
      apiFetchJson<SiteCollectionItemDTO>(
        `${collections}/${id}/items`,
        'POST',
        dto,
        'Não foi possível criar o item',
      ),
    updateItem: (
      id: string,
      itemId: string,
      dto: UpdateSiteCollectionItemDTO,
    ) =>
      apiFetchJson<SiteCollectionItemDTO>(
        `${collections}/${id}/items/${itemId}`,
        'PATCH',
        dto,
        'Não foi possível salvar o item',
      ),
    removeItem: (id: string, itemId: string) =>
      apiSend(`${collections}/${id}/items/${itemId}`, { method: 'DELETE' }),
    reorderItems: (id: string, orderedIds: string[]) =>
      apiFetchJson<SiteCollectionItemDTO[]>(
        `${collections}/${id}/items/reorder`,
        'POST',
        { orderedIds },
      ),
  }
}

export type SiteBlogApi = ReturnType<typeof siteBlogApi>

export const siteBlogKeys = {
  all: (workspaceId: string, siteId: string) =>
    ['site-blog', workspaceId, siteId] as const,
  posts: (
    workspaceId: string,
    siteId: string,
    query: Partial<ListSitePostsQueryDTO> = {},
  ) => ['site-blog', workspaceId, siteId, 'posts', query] as const,
  post: (workspaceId: string, siteId: string, postId: string) =>
    ['site-blog', workspaceId, siteId, 'post', postId] as const,
  categories: (workspaceId: string, siteId: string) =>
    ['site-blog', workspaceId, siteId, 'categories'] as const,
  tags: (workspaceId: string, siteId: string) =>
    ['site-blog', workspaceId, siteId, 'tags'] as const,
  authors: (workspaceId: string, siteId: string) =>
    ['site-blog', workspaceId, siteId, 'authors'] as const,
  preview: (workspaceId: string, siteId: string) =>
    ['site-blog', workspaceId, siteId, 'preview'] as const,
  collections: (workspaceId: string, siteId: string) =>
    ['site-blog', workspaceId, siteId, 'collections'] as const,
  items: (workspaceId: string, siteId: string, collectionId: string) =>
    ['site-blog', workspaceId, siteId, 'items', collectionId] as const,
}

export function useSitePosts(
  workspaceId: string,
  siteId: string,
  query: Partial<ListSitePostsQueryDTO> = {},
) {
  return useQuery<SitePostPageDTO>({
    queryKey: siteBlogKeys.posts(workspaceId, siteId, query),
    queryFn: () => siteBlogApi(workspaceId, siteId).posts(query),
    placeholderData: (previous) => previous,
  })
}

export function useSitePost(
  workspaceId: string,
  siteId: string,
  postId: string,
) {
  return useQuery<SitePostDTO>({
    queryKey: siteBlogKeys.post(workspaceId, siteId, postId),
    queryFn: () => siteBlogApi(workspaceId, siteId).post(postId),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSiteBlogCategories(workspaceId: string, siteId: string) {
  return useQuery<SiteBlogCategoryDTO[]>({
    queryKey: siteBlogKeys.categories(workspaceId, siteId),
    queryFn: () => siteBlogApi(workspaceId, siteId).categories(),
  })
}

export function useSiteBlogTags(workspaceId: string, siteId: string) {
  return useQuery<SiteBlogTagDTO[]>({
    queryKey: siteBlogKeys.tags(workspaceId, siteId),
    queryFn: () => siteBlogApi(workspaceId, siteId).tags(),
  })
}

export function useSiteAuthors(workspaceId: string, siteId: string) {
  return useQuery<SiteAuthorDTO[]>({
    queryKey: siteBlogKeys.authors(workspaceId, siteId),
    queryFn: () => siteBlogApi(workspaceId, siteId).authors(),
  })
}

/** Posts, terms and collection items the editor canvas renders. */
export function useSiteCmsPreview(workspaceId: string, siteId: string) {
  return useQuery<SiteCmsPreviewDTO>({
    queryKey: siteBlogKeys.preview(workspaceId, siteId),
    queryFn: () => siteBlogApi(workspaceId, siteId).preview(),
    staleTime: 60_000,
  })
}

export function useSiteCollections(workspaceId: string, siteId: string) {
  return useQuery<SiteCollectionDTO[]>({
    queryKey: siteBlogKeys.collections(workspaceId, siteId),
    queryFn: () => siteBlogApi(workspaceId, siteId).collections(),
  })
}

export function useSiteCollectionItems(
  workspaceId: string,
  siteId: string,
  collectionId: string,
) {
  return useQuery<SiteCollectionItemDTO[]>({
    queryKey: siteBlogKeys.items(workspaceId, siteId, collectionId),
    queryFn: () => siteBlogApi(workspaceId, siteId).items(collectionId),
    enabled: Boolean(collectionId),
  })
}
