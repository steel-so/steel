'use client'

import { Tag01Icon, Tick02Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSetWikiPageLabels, useWikiLabels } from '@/src/hooks/use-wiki-page'
import { WIKI_LABEL_TONE } from './wiki-label-colors'

/** The page's label chips plus a picker over the workspace's labels. */
export function WikiPageLabels({
  workspaceId,
  workspaceSlug,
  wikiPageId,
  initialLabelIds,
  readOnly = false,
}: {
  workspaceId: string
  workspaceSlug: string
  wikiPageId: string
  initialLabelIds: string[]
  /** Locked page: show the chips only, without the picker. */
  readOnly?: boolean
}) {
  const { data: labels = [] } = useWikiLabels(workspaceId)
  const setLabels = useSetWikiPageLabels(workspaceId, wikiPageId)
  const [selected, setSelected] = useState(initialLabelIds)

  useEffect(() => {
    setSelected(initialLabelIds)
  }, [initialLabelIds])

  function toggle(labelId: string) {
    const previous = selected
    const next = previous.includes(labelId)
      ? previous.filter((id) => id !== labelId)
      : [...previous, labelId]
    setSelected(next)
    setLabels.mutate(next, {
      onError: (error) => {
        setSelected(previous)
        notify.error(error)
      },
    })
  }

  // Ids of a deleted label linger until the page reloads; show only live ones.
  const applied = labels.filter((label) => selected.includes(label.id))

  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {applied.map((label) => (
        <span
          key={label.id}
          className={cn(
            'inline-flex h-6 items-center rounded-sm px-2 text-xs font-medium',
            WIKI_LABEL_TONE[label.color].chip,
          )}
        >
          {label.name}
        </span>
      ))}
      {!readOnly && (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant='ghost'
                size='xs'
                className='text-muted-foreground'
              />
            }
          >
            <SteelIcon icon={Tag01Icon} strokeWidth={2} />
            {applied.length === 0 ? 'Adicionar etiqueta' : 'Etiquetas'}
          </PopoverTrigger>
          <PopoverContent align='start' className='w-60 p-1'>
            {labels.length === 0 ? (
              <div className='space-y-2 p-2'>
                <Muted className='text-xs'>
                  Nenhuma etiqueta criada ainda.
                </Muted>
                <Link
                  href={`/${workspaceSlug}/settings/wiki`}
                  className='text-xs underline-offset-2 hover:underline'
                >
                  Criar em Ajustes › Wiki
                </Link>
              </div>
            ) : (
              <ul className='max-h-64 overflow-y-auto'>
                {labels.map((label) => {
                  const checked = selected.includes(label.id)
                  return (
                    <li key={label.id}>
                      <button
                        type='button'
                        role='menuitemcheckbox'
                        aria-checked={checked}
                        onClick={() => toggle(label.id)}
                        className='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'
                      >
                        <span
                          className={cn(
                            'size-2.5 shrink-0 rounded-full',
                            WIKI_LABEL_TONE[label.color].dot,
                          )}
                        />
                        <span className='flex-1 truncate'>{label.name}</span>
                        {checked && (
                          <SteelIcon icon={Tick02Icon} strokeWidth={2} />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
