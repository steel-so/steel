'use client'

import { useCallback, useRef } from 'react'
import type { GhostAiAssist } from '@/components/ui/ghost-ai'
import type { CrmTextAiSurface } from '@/src/schemas/crm-text-ai.schema'
import type { CrmTextAiReplyDTO } from '@/types/crm-text-ai'
import { apiFetchJson } from './_fetch'

export type CrmTextAiContext = { title?: string; platform?: string }

/**
 * `assist` for a `GhostAiProvider` around a CRM surface: every AI field
 * below it talks to `POST /crm/ai/text` with that surface. `getContext` is
 * read at call time (the page or proposal title can change while editing).
 */
export function useCrmTextAi(
  workspaceId: string,
  surface: CrmTextAiSurface,
  getContext?: () => CrmTextAiContext,
): GhostAiAssist {
  const contextRef = useRef(getContext)
  contextRef.current = getContext

  return useCallback<GhostAiAssist>(
    ({ section, ...request }) => {
      const context = contextRef.current?.() ?? {}
      return apiFetchJson<CrmTextAiReplyDTO>(
        `/api/workspaces/${workspaceId}/crm/ai/text`,
        'POST',
        {
          surface,
          ...request,
          context: {
            title: context.title?.trim() || undefined,
            platform: context.platform,
            section,
          },
        },
        'A IA não conseguiu responder agora.',
      )
    },
    [workspaceId, surface],
  )
}
