import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { Value } from 'platejs'
import type { EditorMentionableMember } from '@/components/editor/editor-document-context'
import type { WikiLabelDTO, WikiSettingsDTO } from '@/types/wiki-label'
import type { WikiAiAction, WikiPageDTO } from '@/types/wiki-page'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

function wikiPagesKey(workspaceId: string) {
  return ['wiki-pages', workspaceId] as const
}

function baseRoute(workspaceId: string) {
  return `/api/workspaces/${workspaceId}/wiki`
}

/**
 * `initialPages` (from the server render) paints the tree at once instead of
 * an empty sidebar while the first request is in flight.
 */
export function useWikiPages(
  workspaceId: string,
  initialPages?: WikiPageDTO[] | null,
) {
  return useQuery({
    queryKey: wikiPagesKey(workspaceId),
    initialData: initialPages ?? undefined,
    queryFn: () =>
      apiFetch<WikiPageDTO[]>(
        baseRoute(workspaceId),
        undefined,
        'Erro ao buscar páginas de wiki',
      ),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}

export function useCreateWikiPage(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { title?: string; parentId?: string; icon?: string }) =>
      apiFetchJson<WikiPageDTO>(
        baseRoute(workspaceId),
        'POST',
        data,
        'Erro ao criar página',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiPagesKey(workspaceId) })
    },
  })
}

export function useUpdateWikiPage(workspaceId: string, wikiPageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      title?: string
      icon?: string | null
      coverImage?: string | null
      content?: Value
    }) =>
      apiFetchJson<WikiPageDTO>(
        `${baseRoute(workspaceId)}/${wikiPageId}`,
        'PATCH',
        data,
        'Erro ao salvar página',
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<WikiPageDTO[]>(
        wikiPagesKey(workspaceId),
        (old) => old?.map((p) => (p.id === updated.id ? updated : p)),
      )
    },
  })
}

function withoutSubtree(pages: WikiPageDTO[], rootId: string) {
  const removed = new Set([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const page of pages) {
      if (
        page.parentId &&
        removed.has(page.parentId) &&
        !removed.has(page.id)
      ) {
        removed.add(page.id)
        grew = true
      }
    }
  }
  return pages.filter((page) => !removed.has(page.id))
}

export function useArchiveWikiPage(workspaceId: string, wikiPageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiFetchJson<WikiPageDTO>(
        `${baseRoute(workspaceId)}/${wikiPageId}/archive`,
        'PATCH',
        {},
        'Erro ao arquivar página',
      ),
    // The server archives the whole subtree, so drop the descendants too.
    onSuccess: () => {
      queryClient.setQueryData<WikiPageDTO[]>(
        wikiPagesKey(workspaceId),
        (old) => old && withoutSubtree(old, wikiPageId),
      )
    },
  })
}

/** Public read-only path of a published page. */
export function wikiPublicPath(publicToken: string) {
  return `/w/${publicToken}`
}

function useReplacePageMutation(
  workspaceId: string,
  request: () => Promise<WikiPageDTO>,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: request,
    onSuccess: (updated) => {
      queryClient.setQueryData<WikiPageDTO[]>(
        wikiPagesKey(workspaceId),
        (old) => old?.map((p) => (p.id === updated.id ? updated : p)),
      )
    },
  })
}

/** Creates the public link (`publicToken`) and stamps `publishedAt`. */
export function usePublishWikiPage(workspaceId: string, wikiPageId: string) {
  return useReplacePageMutation(workspaceId, () =>
    apiFetchJson<WikiPageDTO>(
      `${baseRoute(workspaceId)}/${wikiPageId}/publish`,
      'POST',
      {},
      'Erro ao publicar a página',
    ),
  )
}

/** Revokes the public link: the old URL stops working. */
export function useUnpublishWikiPage(workspaceId: string, wikiPageId: string) {
  return useReplacePageMutation(workspaceId, () =>
    apiFetch<WikiPageDTO>(
      `${baseRoute(workspaceId)}/${wikiPageId}/publish`,
      { method: 'DELETE' },
      'Erro ao cancelar a publicação',
    ),
  )
}

export function useLockWikiPage(workspaceId: string, wikiPageId: string) {
  return useReplacePageMutation(workspaceId, () =>
    apiFetchJson<WikiPageDTO>(
      `${baseRoute(workspaceId)}/${wikiPageId}/lock`,
      'POST',
      {},
      'Erro ao bloquear a edição',
    ),
  )
}

export function useUnlockWikiPage(workspaceId: string, wikiPageId: string) {
  return useReplacePageMutation(workspaceId, () =>
    apiFetch<WikiPageDTO>(
      `${baseRoute(workspaceId)}/${wikiPageId}/lock`,
      { method: 'DELETE' },
      'Erro ao desbloquear a edição',
    ),
  )
}

/** `true` favorites the page for the viewer, `false` removes it. */
export function useFavoriteWikiPage(workspaceId: string, wikiPageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (favorite: boolean) =>
      apiFetch<WikiPageDTO>(
        `${baseRoute(workspaceId)}/${wikiPageId}/favorite`,
        { method: favorite ? 'PUT' : 'DELETE' },
        'Erro ao atualizar os favoritos',
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<WikiPageDTO[]>(
        wikiPagesKey(workspaceId),
        (old) => old?.map((p) => (p.id === updated.id ? updated : p)),
      )
    },
  })
}

/** Copies the page (title, icon, content, labels) next to the original. */
export function useDuplicateWikiPage(workspaceId: string, wikiPageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiFetchJson<WikiPageDTO>(
        `${baseRoute(workspaceId)}/${wikiPageId}/duplicate`,
        'POST',
        {},
        'Erro ao duplicar a página',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiPagesKey(workspaceId) })
    },
  })
}

/**
 * Rewrites `text` with the workspace's AI provider. `summarize` over the whole
 * page's markdown is the toolbar's "Resumo com IA".
 */
export function useWikiAi(workspaceId: string, wikiPageId: string) {
  return useMutation({
    mutationFn: (data: { action: WikiAiAction; text: string }) =>
      apiFetchJson<{ text: string }>(
        `${baseRoute(workspaceId)}/${wikiPageId}/ai`,
        'POST',
        data,
        'Erro ao gerar o texto com IA',
      ),
  })
}

export function useSetWikiPageLabels(workspaceId: string, wikiPageId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (labelIds: string[]) =>
      apiFetchJson<WikiPageDTO>(
        `${baseRoute(workspaceId)}/${wikiPageId}/labels`,
        'PUT',
        { labelIds },
        'Erro ao salvar as etiquetas',
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<WikiPageDTO[]>(
        wikiPagesKey(workspaceId),
        (old) => old?.map((p) => (p.id === updated.id ? updated : p)),
      )
      // Page counts on Ajustes > Wiki.
      queryClient.invalidateQueries({ queryKey: wikiLabelsKey(workspaceId) })
    },
  })
}

export function useWikiMentionableMembers(workspaceId: string, q: string) {
  return useQuery({
    queryKey: ['wiki-members', workspaceId, q] as const,
    queryFn: () =>
      apiFetch<EditorMentionableMember[]>(
        `${baseRoute(workspaceId)}/members?${new URLSearchParams({ q })}`,
        undefined,
        'Erro ao buscar membros',
      ),
    enabled: !!workspaceId,
    placeholderData: keepPreviousData,
  })
}

// ─── Ajustes > Wiki ─────────────────────────────────────────────────────────

function wikiSettingsKey(workspaceId: string) {
  return ['wiki-settings', workspaceId] as const
}

function wikiLabelsKey(workspaceId: string) {
  return ['wiki-labels', workspaceId] as const
}

export function useWikiSettings(workspaceId: string) {
  return useQuery({
    queryKey: wikiSettingsKey(workspaceId),
    queryFn: () =>
      apiFetch<WikiSettingsDTO>(
        `${baseRoute(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar os ajustes da Wiki',
      ),
    enabled: !!workspaceId,
  })
}

export function useUpdateWikiSettings(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { enabled: boolean }) =>
      apiFetchJson<WikiSettingsDTO>(
        `${baseRoute(workspaceId)}/settings`,
        'PATCH',
        data,
        'Erro ao salvar os ajustes da Wiki',
      ),
    onSuccess: (settings) => {
      queryClient.setQueryData(wikiSettingsKey(workspaceId), settings)
    },
  })
}

export function useWikiLabels(workspaceId: string) {
  return useQuery({
    queryKey: wikiLabelsKey(workspaceId),
    queryFn: () =>
      apiFetch<WikiLabelDTO[]>(
        `${baseRoute(workspaceId)}/labels`,
        undefined,
        'Erro ao buscar as etiquetas',
      ),
    enabled: !!workspaceId,
    staleTime: 60 * 1000,
  })
}

export function useCreateWikiLabel(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; color: string }) =>
      apiFetchJson<WikiLabelDTO>(
        `${baseRoute(workspaceId)}/labels`,
        'POST',
        data,
        'Erro ao criar a etiqueta',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiLabelsKey(workspaceId) })
    },
  })
}

export function useUpdateWikiLabel(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      labelId,
      ...data
    }: {
      labelId: string
      name?: string
      color?: string
    }) =>
      apiFetchJson<WikiLabelDTO>(
        `${baseRoute(workspaceId)}/labels/${labelId}`,
        'PATCH',
        data,
        'Erro ao salvar a etiqueta',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wikiLabelsKey(workspaceId) })
    },
  })
}

export function useDeleteWikiLabel(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (labelId: string) =>
      apiSend(
        `${baseRoute(workspaceId)}/labels/${labelId}`,
        { method: 'DELETE' },
        'Erro ao excluir a etiqueta',
      ),
    onSuccess: (_data, labelId) => {
      queryClient.invalidateQueries({ queryKey: wikiLabelsKey(workspaceId) })
      // The label is gone from every page too (cascade).
      queryClient.setQueryData<WikiPageDTO[]>(
        wikiPagesKey(workspaceId),
        (old) =>
          old?.map((p) => ({
            ...p,
            labelIds: p.labelIds.filter((id) => id !== labelId),
          })),
      )
    },
  })
}
