'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applySteelAiStreamEvent,
  emptySteelAiLiveMessage,
  readSteelAiStream,
  type SteelAiLiveMessage,
} from '@/src/lib/steel-ai-stream'
import type {
  CreateAiConversationDTO,
  SendAiMessageInput,
  UpdateAiConversationDTO,
} from '@/src/schemas/steel-ai.schema'
import type {
  AiAttachmentDTO,
  AiCapabilitiesDTO,
  AiConversationDTO,
  AiMessageDTO,
  AiPendingActionDTO,
  AiPendingActionStatusDTO,
} from '@/types/steel-ai'
import { ApiError, apiFetch, apiSend, isApiErrorCode } from './_fetch'

/** @deprecated use AiCapabilitiesDTO from types/steel-ai */
export type SteelAiCapabilitiesDTO = AiCapabilitiesDTO

const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/ai`

export const STEEL_AI_KEY = (workspaceId: string) =>
  ['steel-ai', workspaceId] as const
export const STEEL_AI_CONVERSATIONS_KEY = (workspaceId: string) =>
  [...STEEL_AI_KEY(workspaceId), 'conversations'] as const
export const STEEL_AI_MESSAGES_KEY = (
  workspaceId: string,
  conversationId: string,
) => [...STEEL_AI_KEY(workspaceId), 'messages', conversationId] as const
export const STEEL_AI_CAPABILITIES_KEY = (workspaceId: string) =>
  [...STEEL_AI_KEY(workspaceId), 'capabilities'] as const

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function useSteelAiCapabilities(workspaceId: string) {
  return useQuery({
    queryKey: STEEL_AI_CAPABILITIES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<SteelAiCapabilitiesDTO>(
        `${base(workspaceId)}/capabilities`,
        undefined,
        'Erro ao carregar o Steel AI',
      ),
    staleTime: 60 * 1000,
  })
}

/** Conversations of the current user (pinned first, then most recent). */
export function useSteelAiConversations(workspaceId: string, q = '') {
  const query = q.trim()
  return useQuery({
    queryKey: [...STEEL_AI_CONVERSATIONS_KEY(workspaceId), query],
    queryFn: () =>
      apiFetch<AiConversationDTO[]>(
        `${base(workspaceId)}/conversations${
          query ? `?q=${encodeURIComponent(query)}` : ''
        }`,
        undefined,
        'Erro ao carregar as conversas',
      ),
    placeholderData: (previous) => previous,
  })
}

export function useSteelAiConversation(
  workspaceId: string,
  conversationId: string,
) {
  return useQuery({
    queryKey: [
      ...STEEL_AI_CONVERSATIONS_KEY(workspaceId),
      'one',
      conversationId,
    ],
    queryFn: () =>
      apiFetch<AiConversationDTO>(
        `${base(workspaceId)}/conversations/${conversationId}`,
        undefined,
        'Erro ao carregar a conversa',
      ),
  })
}

export function useCreateSteelAiConversation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<CreateAiConversationDTO>) =>
      apiFetch<AiConversationDTO>(
        `${base(workspaceId)}/conversations`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
        'Erro ao criar a conversa',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AI_CONVERSATIONS_KEY(workspaceId),
      }),
  })
}

export function useUpdateSteelAiConversation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      conversationId,
      data,
    }: {
      conversationId: string
      data: UpdateAiConversationDTO
    }) =>
      apiFetch<AiConversationDTO>(
        `${base(workspaceId)}/conversations/${conversationId}`,
        {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(data),
        },
        'Erro ao atualizar a conversa',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AI_CONVERSATIONS_KEY(workspaceId),
      }),
  })
}

export function useDeleteSteelAiConversation(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) =>
      apiSend(
        `${base(workspaceId)}/conversations/${conversationId}`,
        { method: 'DELETE' },
        'Erro ao excluir a conversa',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: STEEL_AI_CONVERSATIONS_KEY(workspaceId),
      }),
  })
}

export function useSteelAiMessages(
  workspaceId: string,
  conversationId: string,
) {
  return useQuery({
    queryKey: STEEL_AI_MESSAGES_KEY(workspaceId, conversationId),
    queryFn: () =>
      apiFetch<AiMessageDTO[]>(
        `${base(workspaceId)}/conversations/${conversationId}/messages`,
        undefined,
        'Erro ao carregar as mensagens',
      ),
  })
}

export function useSteelAiActions(
  workspaceId: string,
  filter: { status?: AiPendingActionStatusDTO; conversationId?: string } = {},
) {
  const params = new URLSearchParams()
  if (filter.status) params.set('status', filter.status)
  if (filter.conversationId) params.set('conversationId', filter.conversationId)
  const search = params.toString()
  return useQuery({
    queryKey: [...STEEL_AI_KEY(workspaceId), 'actions', search],
    queryFn: () =>
      apiFetch<AiPendingActionDTO[]>(
        `${base(workspaceId)}/actions${search ? `?${search}` : ''}`,
        undefined,
        'Erro ao carregar as ações',
      ),
  })
}

/** Replaces an action inside every cached transcript that contains it. */
function patchCachedAction(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  action: AiPendingActionDTO,
) {
  queryClient.setQueriesData<AiMessageDTO[]>(
    { queryKey: [...STEEL_AI_KEY(workspaceId), 'messages'] },
    (messages) =>
      messages?.map((message) =>
        message.pendingActions.some((entry) => entry.id === action.id)
          ? {
              ...message,
              pendingActions: message.pendingActions.map((entry) =>
                entry.id === action.id ? action : entry,
              ),
            }
          : message,
      ),
  )
}

/**
 * The refreshed action of an `AI_PENDING_ACTION_CHANGED` refusal: the
 * records changed after the preview, so the server kept the action PENDING
 * with a fresh preview (`error.details.action`) for a new confirmation.
 */
export function changedPendingAction(
  error: unknown,
): AiPendingActionDTO | null {
  if (!isApiErrorCode(error, 'AI_PENDING_ACTION_CHANGED')) return null
  const details = (error as ApiError).details as
    | { action?: AiPendingActionDTO }
    | undefined
  return details?.action ?? null
}

export function useConfirmSteelAiAction(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      actionId,
      doubleConfirmed,
    }: {
      actionId: string
      doubleConfirmed?: boolean
    }) =>
      apiFetch<AiPendingActionDTO>(
        `${base(workspaceId)}/actions/${actionId}/confirm`,
        {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(doubleConfirmed ? { doubleConfirmed } : {}),
        },
        'Erro ao executar a ação',
      ),
    onError: (error) => {
      const fresh = changedPendingAction(error)
      if (fresh) patchCachedAction(queryClient, workspaceId, fresh)
    },
    onSuccess: (action) => {
      patchCachedAction(queryClient, workspaceId, action)
      // The executed write is appended to the history as a TOOL message.
      if (action.conversationId) {
        queryClient.invalidateQueries({
          queryKey: STEEL_AI_MESSAGES_KEY(workspaceId, action.conversationId),
        })
      }
    },
  })
}

export function useCancelSteelAiAction(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (actionId: string) =>
      apiFetch<AiPendingActionDTO>(
        `${base(workspaceId)}/actions/${actionId}/cancel`,
        { method: 'POST' },
        'Erro ao cancelar a ação',
      ),
    onSuccess: (action) => patchCachedAction(queryClient, workspaceId, action),
  })
}

/** Uploads a file or photo for the next message (multipart `file`). */
export function useUploadSteelAiAttachment(workspaceId: string) {
  return useMutation({
    mutationFn: ({
      conversationId,
      file,
    }: {
      conversationId: string
      file: File
    }) => {
      const body = new FormData()
      body.append('file', file)
      return apiFetch<AiAttachmentDTO>(
        `${base(workspaceId)}/conversations/${conversationId}/attachments`,
        { method: 'POST', body },
        'Erro ao enviar o anexo',
      )
    },
  })
}

/** Removes an attachment that was not sent yet. */
export function useDeleteSteelAiAttachment(workspaceId: string) {
  return useMutation({
    mutationFn: ({
      conversationId,
      attachmentId,
    }: {
      conversationId: string
      attachmentId: string
    }) =>
      apiSend(
        `${base(workspaceId)}/conversations/${conversationId}/attachments/${attachmentId}`,
        { method: 'DELETE' },
        'Erro ao remover o anexo',
      ),
  })
}

export interface SteelAiStreamError {
  code: string | null
  message: string
  status: number | null
}

export interface SteelAiStreamState {
  /** The user's message, shown until the persisted transcript is refetched. */
  pendingUserMessage: string | null
  /** Files sent with that message (shown in the pending bubble). */
  pendingAttachments: AiAttachmentDTO[]
  live: SteelAiLiveMessage | null
  isStreaming: boolean
  error: SteelAiStreamError | null
}

export interface SteelAiSendResult {
  ok: boolean
  stopped: boolean
  /** `status` set ⇒ rejected before streaming (nothing was persisted). */
  error: SteelAiStreamError | null
}

const IDLE: SteelAiStreamState = {
  pendingUserMessage: null,
  pendingAttachments: [],
  live: null,
  isStreaming: false,
  error: null,
}

async function readErrorBody(res: Response): Promise<SteelAiStreamError> {
  const body = await res.json().catch(() => null)
  return {
    code: body?.error?.code ?? null,
    message: body?.message ?? 'Não foi possível falar com o Steel AI.',
    status: res.status,
  }
}

/**
 * Sends a message and follows the SSE reply, appending deltas to the live
 * assistant message. `stop()` aborts the request; leaving the screen does
 * too (deferred, so React StrictMode's remount does not kill the stream).
 */
export function useSteelAiStream(workspaceId: string, conversationId: string) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SteelAiStreamState>(IDLE)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      setTimeout(() => {
        if (!mountedRef.current) controllerRef.current?.abort()
      }, 0)
    }
  }, [])

  const settle = useCallback(async () => {
    // Keep the live message on screen until the persisted transcript (with
    // the user message and the reply) is back, so nothing flashes.
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: STEEL_AI_MESSAGES_KEY(workspaceId, conversationId),
      }),
      queryClient.invalidateQueries({
        queryKey: STEEL_AI_CONVERSATIONS_KEY(workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: STEEL_AI_CAPABILITIES_KEY(workspaceId),
      }),
    ])
  }, [queryClient, workspaceId, conversationId])

  const send = useCallback(
    async (
      input: SendAiMessageInput,
      preview: { attachments?: AiAttachmentDTO[] } = {},
    ): Promise<SteelAiSendResult> => {
      if (controllerRef.current) {
        return { ok: false, stopped: false, error: null }
      }
      const controller = new AbortController()
      controllerRef.current = controller
      setState({
        pendingUserMessage: input.content ?? '',
        pendingAttachments: preview.attachments ?? [],
        live: emptySteelAiLiveMessage(),
        isStreaming: true,
        error: null,
      })

      let failure: SteelAiStreamError | null = null
      try {
        const res = await fetch(
          `${base(workspaceId)}/conversations/${conversationId}/messages`,
          {
            method: 'POST',
            headers: { ...JSON_HEADERS, Accept: 'text/event-stream' },
            body: JSON.stringify(input),
            signal: controller.signal,
          },
        )
        if (!res.ok || !res.body) {
          failure = res.ok
            ? {
                code: null,
                message: 'Resposta vazia do Steel AI.',
                status: res.status,
              }
            : await readErrorBody(res)
        } else {
          await readSteelAiStream(res.body, (event) => {
            if (event.type === 'conversation.title') {
              queryClient.invalidateQueries({
                queryKey: STEEL_AI_CONVERSATIONS_KEY(workspaceId),
              })
            }
            if (event.type === 'error') {
              failure = {
                code: event.code,
                message: event.message,
                status: null,
              }
            }
            setState((current) => ({
              ...current,
              live: current.live
                ? applySteelAiStreamEvent(current.live, event)
                : current.live,
            }))
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          failure = {
            code: error instanceof ApiError ? error.code : null,
            message: 'A conexão com o Steel AI caiu. Tente novamente.',
            status: null,
          }
        }
      }

      controllerRef.current = null
      const stopped = controller.signal.aborted
      if (failure && !stopped) {
        const error: SteelAiStreamError = failure
        if (error.status !== null) {
          // Rejected up front (quota, mode, validation): nothing was
          // persisted, so the user message goes away and the caller gives
          // the text back to the composer.
          setState({ ...IDLE, error })
          return { ok: false, stopped: false, error }
        }
        // Failed mid-stream: whatever the server persisted is refetched.
        setState((current) => ({ ...current, isStreaming: false, error }))
        await settle()
        if (mountedRef.current) setState({ ...IDLE, error })
        return { ok: false, stopped: false, error }
      }

      setState((current) => ({
        ...current,
        isStreaming: false,
        live: current.live
          ? {
              ...current.live,
              status: stopped ? 'stopped' : current.live.status,
            }
          : null,
      }))
      await settle()
      if (mountedRef.current) setState(IDLE)
      return { ok: !stopped, stopped, error: null }
    },
    [workspaceId, conversationId, queryClient, settle],
  )

  const stop = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const clearError = useCallback(() => {
    setState((current) => ({ ...current, error: null }))
  }, [])

  return { ...state, send, stop, clearError }
}
