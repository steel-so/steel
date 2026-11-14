'use client'

import {
  ArrowUp02Icon,
  Attachment01Icon,
  Loading03Icon,
  StopIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type CSSProperties, type Ref, useId, useRef, useState } from 'react'
import { useShortcut } from '@/app/_components/shortcuts/shortcuts-provider'
import { useQuickSend } from '@/app/_components/shortcuts/use-quick-send'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { AiChatModelDTO, AiConversationModeDTO } from '@/types/steel-ai'
import {
  SteelAiAttachmentTray,
  type SteelAiDraftAttachment,
} from './steel-ai-attachments'
import { SteelAiModeSwitch } from './steel-ai-mode-switch'
import { SteelAiModelPicker } from './steel-ai-model-picker'
import {
  filterSkillOptions,
  type SteelAiSkillOption,
  SteelAiSkillPicker,
  skillOptionId,
  skillQueryOf,
} from './steel-ai-skill-picker'

export const STEEL_AI_MAX_MESSAGE = 8000

export interface SteelAiComposerAttachments {
  items: SteelAiDraftAttachment[]
  onAdd: (files: File[]) => void
  onRemove: (localId: string) => void
  accept: string[]
}

export interface SteelAiComposerModel {
  models: AiChatModelDTO[]
  value: string | null
  onChange: (modelKey: string) => void
}

/**
 * Prompt box shared by the welcome and the chat screens: a single-border
 * card with an auto-growing textarea, attachments (button, paste and
 * drag-and-drop), Ask | Build | Autopilot, the model picker and send/stop.
 * Enter (or Ctrl+Enter, per the "Envio rápido" preference) sends; the
 * other combination breaks the line. With `skills`, typing "/" opens
 * the skill picker (↑↓, Enter/Tab, Esc); picking one may switch the mode.
 */
export function SteelAiComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  mode,
  onModeChange,
  agentModeEnabled,
  autopilotEnabled = false,
  attachments,
  model,
  skills,
  isStreaming = false,
  isSubmitting = false,
  disabled = false,
  placeholder = 'Pergunte qualquer coisa ao Steel AI…',
  autoFocus,
  containerRef,
  className,
  style,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onStop?: () => void
  mode: AiConversationModeDTO
  onModeChange: (mode: AiConversationModeDTO) => void
  agentModeEnabled: boolean
  autopilotEnabled?: boolean
  attachments?: SteelAiComposerAttachments
  model?: SteelAiComposerModel
  /** Enabled skills for the "/" picker. */
  skills?: SteelAiSkillOption[]
  isStreaming?: boolean
  isSubmitting?: boolean
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
  containerRef?: Ref<HTMLFormElement>
  className?: string
  style?: CSSProperties
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const quickSend = useQuickSend()
  // Esc stops the answer in progress; Alt+M flips Explorar ↔ Agente.
  useShortcut(
    'ai.stop',
    () => {
      if (!isStreaming || !onStop) return false
      onStop()
    },
    { enabled: Boolean(onStop) },
  )
  useShortcut(
    'ai.toggle-mode',
    () => {
      if (!agentModeEnabled || disabled) return false
      onModeChange(mode === 'EXPLORE' ? 'AGENT' : 'EXPLORE')
    },
    { enabled: agentModeEnabled },
  )
  const pickerId = useId()
  const [dragging, setDragging] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const skillQuery = skills && !disabled ? skillQueryOf(value) : null
  const skillMatches =
    skillQuery === null ? [] : filterSkillOptions(skills ?? [], skillQuery)
  const pickerOpen = skillMatches.length > 0 && dismissedFor !== value
  const active = Math.min(activeIndex, skillMatches.length - 1)
  const items = attachments?.items ?? []
  const uploading = items.some(
    (item) => item.status === 'uploading' || item.status === 'error',
  )
  const hasFiles = items.length > 0
  const canSend =
    !disabled &&
    !isStreaming &&
    !isSubmitting &&
    !uploading &&
    (value.trim().length > 0 || hasFiles) &&
    value.length <= STEEL_AI_MAX_MESSAGE
  const busy = isStreaming || isSubmitting

  function modeAllowed(next: AiConversationModeDTO): boolean {
    if (next === 'EXPLORE') return true
    if (next === 'AGENT') return agentModeEnabled
    return agentModeEnabled && autopilotEnabled
  }

  function pickSkill(option: SteelAiSkillOption) {
    onChange(`/${option.slug} `)
    setActiveIndex(0)
    if (option.mode && option.mode !== mode && modeAllowed(option.mode)) {
      onModeChange(option.mode)
    }
    textRef.current?.focus()
  }

  function addFiles(list: FileList | File[] | null | undefined) {
    if (!attachments || !list) return
    const files = Array.from(list)
    if (files.length > 0) attachments.onAdd(files)
  }

  return (
    <form
      ref={containerRef}
      style={style}
      data-tour='ai-composer'
      className={cn('w-full', className)}
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) onSubmit()
      }}
      onDragOver={(event) => {
        if (!attachments || disabled) return
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!attachments || disabled) return
        event.preventDefault()
        setDragging(false)
        addFiles(event.dataTransfer.files)
      }}
    >
      <div
        className={cn(
          'relative flex flex-col rounded-2xl border border-border bg-background shadow-xs transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:shadow-sm motion-reduce:transition-none dark:bg-input/30',
          disabled && 'opacity-60',
          dragging && 'border-primary border-dashed',
        )}
      >
        {pickerOpen ? (
          <SteelAiSkillPicker
            id={pickerId}
            options={skillMatches}
            activeIndex={active}
            onPick={pickSkill}
            onActiveChange={setActiveIndex}
          />
        ) : null}
        {attachments ? (
          <SteelAiAttachmentTray
            items={items}
            onRemove={attachments.onRemove}
            disabled={busy}
          />
        ) : null}
        <textarea
          ref={textRef}
          data-composer
          aria-label='Mensagem para o Steel AI'
          {...(skills && {
            role: 'combobox',
            'aria-autocomplete': 'list' as const,
            'aria-expanded': pickerOpen,
            'aria-controls': pickerOpen ? pickerId : undefined,
            'aria-activedescendant': pickerOpen
              ? skillOptionId(pickerId, active)
              : undefined,
          })}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={dragging ? 'Solte os arquivos para anexar' : placeholder}
          maxLength={STEEL_AI_MAX_MESSAGE}
          rows={1}
          onChange={(event) => {
            setActiveIndex(0)
            onChange(event.target.value)
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? [])
            if (!attachments || files.length === 0) return
            event.preventDefault()
            addFiles(files)
          }}
          onKeyDown={(event) => {
            if (pickerOpen && !event.nativeEvent.isComposing) {
              const count = skillMatches.length
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActiveIndex((active + step + count) % count)
                return
              }
              if (
                (event.key === 'Enter' || event.key === 'Tab') &&
                !event.shiftKey
              ) {
                event.preventDefault()
                pickSkill(skillMatches[active])
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDismissedFor(value)
                return
              }
            }
            if (quickSend.isSend(event)) {
              event.preventDefault()
              if (canSend) onSubmit()
            }
          }}
          className='field-sizing-content block max-h-60 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed sm:text-sm'
        />
        <div className='flex min-w-0 items-center gap-1 px-2 pt-1 pb-2.5 sm:gap-1.5 sm:px-2.5'>
          {attachments ? (
            <>
              <input
                ref={fileRef}
                type='file'
                multiple
                hidden
                accept={attachments.accept.join(',')}
                data-testid='steel-ai-file-input'
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label='Anexar arquivos ou fotos'
                      data-tour='ai-attach'
                      className='shrink-0 rounded-full text-muted-foreground'
                      disabled={disabled || busy}
                      onClick={() => fileRef.current?.click()}
                    />
                  }
                >
                  <SteelIcon icon={Attachment01Icon} strokeWidth={2} />
                </TooltipTrigger>
                <TooltipContent side='top'>
                  Anexar arquivos ou fotos (ou cole / arraste aqui)
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}
          <SteelAiModeSwitch
            value={mode}
            onChange={onModeChange}
            agentModeEnabled={agentModeEnabled}
            autopilotEnabled={autopilotEnabled}
            disabled={busy}
          />
          {model ? (
            <SteelAiModelPicker
              models={model.models}
              value={model.value}
              onChange={model.onChange}
              disabled={busy}
              className='max-w-28 sm:max-w-44'
            />
          ) : null}
          <span className='ml-auto' />
          {isStreaming && onStop ? (
            <Button
              type='button'
              size='icon-sm'
              aria-label='Parar resposta'
              className='shrink-0 rounded-full'
              onClick={onStop}
            >
              <SteelIcon icon={StopIcon} strokeWidth={2} />
            </Button>
          ) : (
            <Button
              type='submit'
              size='icon-sm'
              aria-label='Enviar mensagem'
              className='shrink-0 rounded-full'
              disabled={!canSend}
            >
              <SteelIcon
                icon={isSubmitting ? Loading03Icon : ArrowUp02Icon}
                strokeWidth={2}
                className={cn(isSubmitting && 'motion-safe:animate-spin')}
              />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
