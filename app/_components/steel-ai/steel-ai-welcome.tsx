'use client'

import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AiInsightHighlights } from '@/app/_components/steel-ai-insights/ai-insight-highlights'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useEnabledAiSkills } from '@/src/hooks/use-ai-skills'
import {
  useCreateSteelAiConversation,
  useSteelAiCapabilities,
} from '@/src/hooks/use-steel-ai'
import { AI_SKILL_SLUG_PATTERN } from '@/src/lib/ai/context/skill-command'
import { isQuotaExceeded } from '@/src/lib/ai/quota'
import type { AiConversationModeDTO } from '@/types/steel-ai'
import {
  STEEL_AI_DEFAULT_ATTACHMENT_LIMITS,
  useSteelAiDraftAttachments,
} from './steel-ai-attachments'
import { SteelAiComposer } from './steel-ai-composer'
import { useSteelAiWorkspace } from './steel-ai-context'
import { stashSteelAiPrompt } from './steel-ai-handoff'
import { allowedSteelAiMode } from './steel-ai-mode-switch'
import {
  STEEL_AI_DISABLED_MESSAGE,
  STEEL_AI_QUOTA_MESSAGE,
  SteelAiNotice,
} from './steel-ai-notice'
import { STEEL_AI_MODULE_META, steelAiStartersFor } from './steel-ai-starters'
import { SteelAiTopBar } from './steel-ai-top-bar'

/** `?skill=my-work` → "my-work" (only a valid command). */
export function skillFromSearch(search: string): string | null {
  const slug = new URLSearchParams(search).get('skill')?.toLowerCase() ?? ''
  return AI_SKILL_SLUG_PATTERN.test(slug) ? slug : null
}

/** Longest prefilled prompt accepted from the URL. */
const MAX_PROMPT_FROM_URL = 2000

/**
 * `?prompt=…` → the text to prefill (the "Perguntar ao Steel AI" button of
 * the proactive AI insights, ADR 0040). Only fills the composer: the user
 * reviews and sends it.
 */
export function promptFromSearch(search: string): string | null {
  const prompt = new URLSearchParams(search).get('prompt')?.trim() ?? ''
  return prompt ? prompt.slice(0, MAX_PROMPT_FROM_URL) : null
}

/** Starters shown on phones — the rest appear from `sm` up. */
const MOBILE_STARTERS = 4

/**
 * New chat: greeting, centered composer and prompt starters. Submitting
 * creates the conversation, hands the prompt to the chat screen and
 * navigates there — the chat screen docks the composer and streams.
 */
export function SteelAiWelcome() {
  const { workspaceId, slug, firstName } = useSteelAiWorkspace()
  const router = useRouter()
  const capabilities = useSteelAiCapabilities(workspaceId)
  const skills = useEnabledAiSkills(workspaceId)
  const createConversation = useCreateSteelAiConversation(workspaceId)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<AiConversationModeDTO>('EXPLORE')
  const [modelKey, setModelKey] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const caps = capabilities.data
  // "Usar no chat" on the Skills page links here with ?skill=<slug>.
  useEffect(() => {
    const slug = skillFromSearch(window.location.search)
    if (slug) setDraft(`/${slug} `)
    const prompt = promptFromSearch(window.location.search)
    if (prompt) setDraft(prompt)
  }, [])
  // No conversation yet: files wait until it is created on submit.
  const files = useSteelAiDraftAttachments({
    workspaceId,
    conversationId: null,
    limits: caps?.attachments ?? STEEL_AI_DEFAULT_ATTACHMENT_LIMITS,
    onReject: (message) => notify.error(message),
  })

  const agentModeEnabled = caps?.agentModeEnabled ?? false
  const autopilotEnabled = caps?.autopilotEnabled ?? false
  const aiDisabled = caps?.aiEnabled === false
  const effectiveMode = caps ? allowedSteelAiMode(mode, caps) : 'EXPLORE'
  const selectedModel = modelKey ?? caps?.modelKey ?? null
  const quota = caps?.quota
  const quotaExhausted = quota
    ? isQuotaExceeded(quota.usedUsd, quota.quotaUsd)
    : false
  const starters = capabilities.data
    ? steelAiStartersFor(capabilities.data.modules, agentModeEnabled)
    : []

  async function start(
    content: string,
    startMode: AiConversationModeDTO,
    withFiles = false,
  ) {
    const text = content.trim()
    const hasFiles = withFiles && files.items.length > 0
    if ((!text && !hasFiles) || createConversation.isPending || leaving) return
    setError(null)
    setLeaving(true)
    try {
      const conversation = await createConversation.mutateAsync({
        mode: startMode,
        ...(selectedModel && { modelKey: selectedModel }),
      })
      const attachments = hasFiles ? await files.uploadAll(conversation.id) : []
      if (!attachments) {
        setLeaving(false)
        setError(
          'Não foi possível enviar um dos anexos. Remova-o ou tente de novo.',
        )
        return
      }
      stashSteelAiPrompt(conversation.id, {
        content: text,
        mode: startMode,
        modelKey: selectedModel,
        attachments,
      })
      router.push(`/${slug}/ai/${conversation.id}`)
    } catch (err) {
      setLeaving(false)
      setError(
        err instanceof Error ? err.message : 'Não foi possível iniciar o chat.',
      )
    }
  }

  return (
    <div className='flex h-full w-full min-w-0 flex-col'>
      <SteelAiTopBar />
      <div className='flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 py-6 sm:px-6 sm:py-8'>
        <div className='my-auto flex w-full max-w-2xl flex-col items-center gap-5 sm:gap-6'>
          <div
            className={cn(
              'flex flex-col items-center gap-3 text-center motion-safe:transition-all motion-safe:duration-300',
              leaving && '-translate-y-2 opacity-0',
            )}
          >
            <span className='hidden size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex'>
              <SteelIcon
                icon={AiMagicIcon}
                strokeWidth={2}
                className='size-6'
              />
            </span>
            <div className='space-y-1'>
              <h1 className='font-semibold text-xl tracking-tight sm:text-2xl'>
                {firstName ? `Olá, ${firstName}` : 'Olá'}
              </h1>
              <p className='text-muted-foreground text-sm'>
                Como o Steel AI pode ajudar hoje?
              </p>
            </div>
          </div>

          {aiDisabled ? (
            <SteelAiNotice className='w-full'>
              {STEEL_AI_DISABLED_MESSAGE}
            </SteelAiNotice>
          ) : quotaExhausted ? (
            <SteelAiNotice className='w-full'>
              {STEEL_AI_QUOTA_MESSAGE}
            </SteelAiNotice>
          ) : null}
          {error ? (
            <SteelAiNotice className='w-full'>{error}</SteelAiNotice>
          ) : null}

          <SteelAiComposer
            value={draft}
            onChange={setDraft}
            onSubmit={() => start(draft, effectiveMode, true)}
            mode={effectiveMode}
            onModeChange={setMode}
            agentModeEnabled={agentModeEnabled}
            autopilotEnabled={autopilotEnabled}
            attachments={{
              items: files.items,
              onAdd: files.add,
              onRemove: files.discard,
              accept: (caps?.attachments ?? STEEL_AI_DEFAULT_ATTACHMENT_LIMITS)
                .accept,
            }}
            model={
              caps
                ? {
                    models: caps.models,
                    value: selectedModel,
                    onChange: setModelKey,
                  }
                : undefined
            }
            skills={skills}
            isSubmitting={leaving}
            disabled={quotaExhausted || aiDisabled}
            autoFocus
          />

          <div
            className={cn(
              'w-full motion-safe:transition-opacity motion-safe:duration-300',
              leaving && 'opacity-0',
            )}
          >
            {capabilities.isLoading ? (
              <div
                className='grid grid-cols-1 gap-2 sm:grid-cols-2'
                aria-hidden
              >
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className='h-10 rounded-xl sm:h-14' />
                ))}
              </div>
            ) : starters.length > 0 ? (
              <ul className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                {starters.map((starter, index) => {
                  const meta = STEEL_AI_MODULE_META[starter.module]
                  return (
                    <li
                      key={starter.prompt}
                      className={cn(
                        'min-w-0',
                        index >= MOBILE_STARTERS && 'hidden sm:block',
                      )}
                    >
                      <button
                        type='button'
                        disabled={quotaExhausted || aiDisabled || leaving}
                        onClick={() => start(starter.prompt, starter.mode)}
                        className='flex h-full w-full items-center gap-2.5 rounded-xl border border-border/70 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:items-start sm:py-2.5'
                      >
                        <SteelIcon
                          icon={meta.icon}
                          strokeWidth={2}
                          className='size-4 shrink-0 text-muted-foreground sm:mt-0.5'
                        />
                        <span className='min-w-0 space-y-0.5'>
                          <span className='block truncate font-medium text-sm sm:whitespace-normal'>
                            {starter.label}
                          </span>
                          <span className='hidden text-muted-foreground text-xs sm:block'>
                            {meta.label}
                            {starter.mode === 'AGENT' ? ' · Build' : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>

          {aiDisabled ? null : (
            <div
              className={cn(
                'w-full motion-safe:transition-opacity motion-safe:duration-300',
                leaving && 'opacity-0',
              )}
            >
              <AiInsightHighlights workspaceId={workspaceId} slug={slug} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
