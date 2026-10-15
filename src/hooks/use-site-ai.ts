'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { readSteelAiStream } from '@/src/lib/steel-ai-stream'
import type {
  GenerateSiteInput,
  GenerateSiteSectionInput,
  RewriteSitePageInput,
  SuggestSiteImagesInput,
} from '@/src/schemas/site-ai.schema'
import type { SiteDTO } from '@/types/site'
import type {
  SiteAiContextDTO,
  SiteAiEvent,
  SiteAiImagesResultDTO,
  SiteAiRewriteResultDTO,
  SiteAiSectionResultDTO,
  SiteAiStep,
} from '@/types/site-ai'
import { apiFetch, apiFetchJson } from './_fetch'
import { crmSitesKeys } from './use-crm-sites'

/**
 * Client of the AI site generator (S4): the context of the guided form,
 * the streamed generation and the three editor actions. Errors surface as
 * `ApiError` (pt-BR message + code, e.g. `AI_QUOTA_EXCEEDED`).
 */

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/crm/sites`

export function siteAiApi(workspaceId: string) {
  const root = base(workspaceId)
  return {
    context: () => apiFetch<SiteAiContextDTO>(`${root}/ai`),
    section: (siteId: string, dto: GenerateSiteSectionInput) =>
      apiFetchJson<SiteAiSectionResultDTO>(
        `${root}/${siteId}/ai/section`,
        'POST',
        dto,
      ),
    rewrite: (siteId: string, dto: RewriteSitePageInput) =>
      apiFetchJson<SiteAiRewriteResultDTO>(
        `${root}/${siteId}/ai/rewrite`,
        'POST',
        dto,
      ),
    images: (siteId: string, dto: SuggestSiteImagesInput) =>
      apiFetchJson<SiteAiImagesResultDTO>(
        `${root}/${siteId}/ai/images`,
        'POST',
        dto,
      ),
  }
}

export const siteAiKeys = {
  context: (workspaceId: string) =>
    ['crm-sites', workspaceId, 'ai-context'] as const,
}

/** Prefill, quota and estimates; refetched after every AI action. */
export function useSiteAiContext(workspaceId: string, enabled = true) {
  return useQuery<SiteAiContextDTO>({
    queryKey: siteAiKeys.context(workspaceId),
    queryFn: () => siteAiApi(workspaceId).context(),
    enabled,
    staleTime: 30_000,
  })
}

export type SiteAiGenerationState =
  | { status: 'idle' }
  | { status: 'running'; steps: SiteAiStep[] }
  | {
      status: 'done'
      steps: SiteAiStep[]
      site: SiteDTO
      costUsd: number
      warnings: string[]
    }
  | {
      status: 'error'
      steps: SiteAiStep[]
      code: string | null
      message: string
    }

/** Folds one stream event into the generation state (pure). */
export function applySiteAiEvent(
  state: SiteAiGenerationState,
  event: SiteAiEvent,
): SiteAiGenerationState {
  const steps = state.status === 'idle' ? [] : state.steps
  switch (event.type) {
    case 'steps':
      return { status: 'running', steps: event.steps }
    case 'step':
      return {
        status: 'running',
        steps: steps.map((step) =>
          step.id === event.id
            ? { ...step, label: event.label, status: event.status }
            : step,
        ),
      }
    case 'done':
      return {
        status: 'done',
        steps,
        site: event.site,
        costUsd: event.costUsd,
        warnings: event.warnings,
      }
    case 'error':
      return {
        status: 'error',
        steps,
        code: event.code,
        message: event.message,
      }
    default:
      return state
  }
}

async function readError(res: Response) {
  const body = await res.json().catch(() => null)
  return {
    code: (body?.error?.code as string | undefined) ?? null,
    message:
      (body?.message as string | undefined) ??
      'Não foi possível gerar o site. Tente novamente.',
  }
}

/**
 * "Gerar com IA": posts the brief and follows the event stream. The
 * server keeps generating if the user closes the dialog, so `reset` only
 * forgets the local state.
 */
export function useSiteAiGeneration(workspaceId: string) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SiteAiGenerationState>({
    status: 'idle',
  })
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const update = useCallback(
    (next: (current: SiteAiGenerationState) => SiteAiGenerationState) => {
      if (mounted.current) setState(next)
    },
    [],
  )

  const start = useCallback(
    async (dto: GenerateSiteInput): Promise<SiteAiGenerationState> => {
      if (running.current) return state
      running.current = true
      let current: SiteAiGenerationState = { status: 'running', steps: [] }
      update(() => current)
      try {
        const res = await fetch(`${base(workspaceId)}/ai/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(dto),
        })
        if (!res.ok || !res.body) {
          const error = res.ok
            ? { code: null, message: 'Resposta vazia do servidor.' }
            : await readError(res)
          current = { status: 'error', steps: [], ...error }
        } else {
          await readSteelAiStream(res.body, (raw) => {
            current = applySiteAiEvent(current, raw as unknown as SiteAiEvent)
            update(() => current)
          })
          if (current.status === 'running') {
            current = {
              status: 'error',
              steps: current.steps,
              code: null,
              message: 'A conexão caiu antes do fim. Confira a lista de sites.',
            }
          }
        }
      } catch {
        current = {
          status: 'error',
          steps: current.status === 'idle' ? [] : current.steps,
          code: null,
          message: 'A conexão caiu antes do fim. Confira a lista de sites.',
        }
      }
      running.current = false
      update(() => current)
      void queryClient.invalidateQueries({
        queryKey: siteAiKeys.context(workspaceId),
      })
      if (current.status === 'done') {
        void queryClient.invalidateQueries({
          queryKey: crmSitesKeys.list(workspaceId),
        })
      }
      return current
    },
    [workspaceId, queryClient, update, state],
  )

  const reset = useCallback(() => update(() => ({ status: 'idle' })), [update])

  return { state, start, reset }
}
