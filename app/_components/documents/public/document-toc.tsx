'use client'

import {
  Cancel01Icon,
  LeftToRightListBulletIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import {
  DOC_SECTION_ATTR,
  type DocumentSectionInfo,
} from '@/src/lib/canvas-document'

function scrollToSection(root: HTMLElement | null, id: string) {
  const target = root?.querySelector<HTMLElement>(
    `[${DOC_SECTION_ATTR}="${id.replace(/["\\]/g, '\\$&')}"]`,
  )
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** The section most on screen, followed while the reader scrolls. */
function useActiveSection(
  root: HTMLElement | null,
  sections: DocumentSectionInfo[],
): string | null {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null)
  useEffect(() => {
    if (!root || typeof IntersectionObserver === 'undefined') return
    const ratios = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute(DOC_SECTION_ATTR)
          if (id) ratios.set(id, entry.intersectionRatio)
        }
        let best: string | null = null
        let bestRatio = 0
        for (const [id, ratio] of ratios) {
          if (ratio > bestRatio) {
            best = id
            bestRatio = ratio
          }
        }
        if (best) setActive(best)
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    for (const element of root.querySelectorAll(`[${DOC_SECTION_ATTR}]`)) {
      observer.observe(element)
    }
    return () => observer.disconnect()
  }, [root, sections])
  return active
}

/**
 * Floating table of contents of the public link (`settings.showToc`): a
 * side list on wide screens and a button that opens a sheet on phones.
 */
export function DocumentToc({
  root,
  sections,
}: {
  root: HTMLElement | null
  sections: DocumentSectionInfo[]
}) {
  const [open, setOpen] = useState(false)
  const active = useActiveSection(root, sections)
  if (sections.length < 2) return null

  const list = (
    <ol className='grid gap-0.5'>
      {sections.map((section) => (
        <li key={section.id}>
          <button
            type='button'
            aria-current={active === section.id ? 'true' : undefined}
            onClick={() => {
              setOpen(false)
              scrollToSection(root, section.id)
            }}
            className={cn(
              'w-full rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              active === section.id
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <span className='line-clamp-2'>{section.name}</span>
          </button>
        </li>
      ))}
    </ol>
  )

  return (
    <>
      <nav
        aria-label='Sumário'
        className='fixed top-24 left-4 z-20 hidden max-h-[calc(100dvh-8rem)] w-56 overflow-y-auto rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur 2xl:block'
      >
        <p className='px-2.5 pt-1 pb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
          Sumário
        </p>
        {list}
      </nav>
      <div className='2xl:hidden'>
        <button
          type='button'
          onClick={() => setOpen(true)}
          aria-label='Abrir o sumário'
          className='fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex h-11 items-center gap-2 rounded-full border bg-background px-4 font-medium text-sm shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
        >
          <SteelIcon icon={LeftToRightListBulletIcon} className='size-4' />
          Sumário
        </button>
        {open ? (
          <div className='fixed inset-0 z-30 flex items-end justify-center bg-foreground/30 sm:items-center'>
            <button
              type='button'
              aria-label='Fechar o sumário'
              className='absolute inset-0 cursor-default'
              onClick={() => setOpen(false)}
            />
            <nav
              aria-label='Sumário'
              className='relative max-h-[75dvh] w-full overflow-y-auto rounded-t-2xl border bg-background p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-sm sm:rounded-2xl'
            >
              <div className='flex items-center justify-between px-2.5 pb-2'>
                <p className='font-medium text-sm'>Sumário</p>
                <button
                  type='button'
                  onClick={() => setOpen(false)}
                  aria-label='Fechar'
                  className='flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted'
                >
                  <SteelIcon icon={Cancel01Icon} className='size-4' />
                </button>
              </div>
              {list}
            </nav>
          </div>
        ) : null}
      </div>
    </>
  )
}
