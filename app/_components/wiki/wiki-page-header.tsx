'use client'

import { SmileIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerFooter,
  EmojiPickerSearch,
} from '@/components/ui/emoji-picker'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { WikiPageLabels } from './wiki-page-labels'

function IconPicker({
  onSelect,
  onRemove,
}: {
  onSelect: (emoji: string) => void
  onRemove?: () => void
}) {
  return (
    <div className='flex h-80 w-72 flex-col'>
      <EmojiPicker
        className='min-h-0 w-full flex-1'
        onEmojiSelect={({ emoji }) => onSelect(emoji)}
      >
        <EmojiPickerSearch placeholder='Buscar emoji' />
        <EmojiPickerContent />
        <EmojiPickerFooter />
      </EmojiPicker>
      {onRemove && (
        <div className='border-t p-1'>
          <Button
            variant='ghost'
            size='xs'
            className='w-full justify-start text-muted-foreground'
            onClick={onRemove}
          >
            Remover ícone
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The page's own header, Notion style: the icon on its own line, the title
 * below it, then the labels — all on the editor's text column. Without an
 * icon nothing is reserved; "Adicionar ícone" shows on hover in the header's
 * top padding.
 */
export function WikiPageHeader({
  workspaceId,
  workspaceSlug,
  wikiPageId,
  icon,
  title,
  labelIds,
  readOnly,
  columnClassName,
  onTitleChange,
  onTitleCommit,
  onIconChange,
}: {
  workspaceId: string
  workspaceSlug: string
  wikiPageId: string
  icon: string | null
  title: string
  labelIds: string[]
  readOnly: boolean
  /** Horizontal padding shared with the editor's text column. */
  columnClassName: string
  onTitleChange: (title: string) => void
  onTitleCommit: () => void
  onIconChange: (icon: string | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  function choose(next: string | null) {
    onIconChange(next)
    setPickerOpen(false)
  }

  return (
    <header
      className={cn(
        'group/header relative space-y-2 pt-12 pb-3 sm:pt-14',
        columnClassName,
      )}
    >
      {icon ? (
        readOnly ? (
          <span
            role='img'
            aria-label='Ícone da página'
            className='block text-[4.5rem] leading-none'
          >
            {icon}
          </span>
        ) : (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger
              render={
                <button
                  type='button'
                  aria-label='Trocar ícone'
                  title='Trocar ícone'
                  className='-ml-1 block cursor-pointer rounded-md px-1 text-[4.5rem] leading-none transition-colors hover:bg-accent'
                />
              }
            >
              {icon}
            </PopoverTrigger>
            <PopoverContent align='start' className='w-auto p-0'>
              <IconPicker onSelect={choose} onRemove={() => choose(null)} />
            </PopoverContent>
          </Popover>
        )
      ) : (
        !readOnly && (
          <div
            className={cn(
              'absolute top-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover/header:opacity-100 sm:top-4',
              pickerOpen && 'opacity-100',
            )}
          >
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant='ghost'
                    size='xs'
                    className='-ml-2 text-muted-foreground'
                  />
                }
              >
                <SteelIcon icon={SmileIcon} strokeWidth={2} />
                Adicionar ícone
              </PopoverTrigger>
              <PopoverContent align='start' className='w-auto p-0'>
                <IconPicker onSelect={choose} />
              </PopoverContent>
            </Popover>
          </div>
        )
      )}
      <input
        value={title}
        readOnly={readOnly}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            // Moving the focus blurs the field, which commits the title.
            document.querySelector<HTMLElement>('[data-slate-editor]')?.focus()
          }
        }}
        placeholder='Sem título'
        aria-label='Título da página'
        className='w-full bg-transparent font-semibold text-3xl tracking-tight outline-none placeholder:text-muted-foreground/60 sm:text-4xl'
      />
      <WikiPageLabels
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        wikiPageId={wikiPageId}
        initialLabelIds={labelIds}
        readOnly={readOnly}
      />
    </header>
  )
}
