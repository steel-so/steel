'use client'

import {
  Image01Icon,
  TouchInteraction01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { type ComponentProps, type KeyboardEvent, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import {
  matchQuickReplies,
  quickReplyQueryOf,
} from '@/src/lib/whatsapp/quick-reply-match'
import type { WhatsAppQuickReplyDTO } from '@/types/whatsapp-quick-reply'

export const QUICK_REPLY_LIST_ID = 'whatsapp-quick-reply-list'

/**
 * `/` typed as the whole message opens the quick-reply picker: ↑↓ choose,
 * Enter/Tab apply (the exact shortcut is ranked first, so `/saudacao` +
 * Enter expands `saudacao`), Esc closes it for the current text.
 */
export function useQuickReplySlash({
  text,
  quickReplies,
  onApply,
}: {
  text: string
  quickReplies: readonly WhatsAppQuickReplyDTO[] | undefined
  onApply: (quickReply: WhatsAppQuickReplyDTO) => void
}) {
  const [active, setActive] = useState(0)
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  const query = quickReplyQueryOf(text)
  const matches =
    query === null || dismissedFor === text
      ? []
      : matchQuickReplies(quickReplies ?? [], query)
  const activeIndex = Math.min(active, matches.length - 1)

  function apply(quickReply: WhatsAppQuickReplyDTO) {
    setActive(0)
    onApply(quickReply)
  }

  /** Handles the picker keys; true when the event was consumed. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (matches.length === 0 || event.nativeEvent.isComposing) return false
    const count = matches.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((activeIndex + step + count) % count)
      return true
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault()
      apply(matches[activeIndex])
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setDismissedFor(text)
      return true
    }
    return false
  }

  return { matches, activeIndex, apply, onKeyDown, open: matches.length > 0 }
}

/** The picker floating above the composer's textarea. */
export function QuickReplySlashMenu({
  matches,
  activeIndex,
  onApply,
}: {
  matches: readonly WhatsAppQuickReplyDTO[]
  activeIndex: number
  onApply: (quickReply: WhatsAppQuickReplyDTO) => void
}) {
  if (matches.length === 0) return null
  return (
    <div
      id={QUICK_REPLY_LIST_ID}
      role='listbox'
      aria-label='Mensagens rápidas'
      className='absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
    >
      {matches.map((quickReply, index) => (
        <QuickReplyOption
          key={quickReply.id}
          quickReply={quickReply}
          role='option'
          aria-selected={index === activeIndex}
          // Keep the textarea focused while clicking an entry.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onApply(quickReply)}
          className={cn(index === activeIndex && 'bg-muted')}
        />
      ))}
      <p className='px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground'>
        ↑↓ para escolher · Enter ou Tab para usar · Esc para fechar
      </p>
    </div>
  )
}

/** One quick reply entry: `/shortcut`, title, a preview of the text. */
export function QuickReplyOption({
  quickReply,
  className,
  ...props
}: ComponentProps<'button'> & { quickReply: WhatsAppQuickReplyDTO }) {
  const shortcut = quickReply.shortcut.replace(/^\/+/, '')
  return (
    <button
      type='button'
      {...props}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted',
        className,
      )}
    >
      <span className='flex w-full min-w-0 items-center gap-1.5'>
        <span className='font-medium'>/{shortcut}</span>
        {quickReply.title && quickReply.title !== shortcut ? (
          <span className='truncate text-muted-foreground text-xs'>
            {quickReply.title}
          </span>
        ) : null}
        <span className='ml-auto flex shrink-0 items-center gap-1 text-muted-foreground'>
          {quickReply.mediaUrl ? (
            <SteelIcon icon={Image01Icon} size={14} aria-label='Com anexo' />
          ) : null}
          {quickReply.buttons.length > 0 ? (
            <SteelIcon
              icon={TouchInteraction01Icon}
              size={14}
              aria-label='Com botões'
            />
          ) : null}
        </span>
      </span>
      <span className='line-clamp-1 text-muted-foreground text-xs'>
        {quickReply.body}
      </span>
    </button>
  )
}
