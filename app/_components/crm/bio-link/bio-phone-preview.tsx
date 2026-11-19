'use client'

import { useMemo } from 'react'
import { BioLinkView } from '@/app/_components/bio-link/bio-link-view'
import { visibleBioBlocks } from '@/src/lib/bio-link/visibility'
import type { BioBlockDTO, BioThemeDTO } from '@/src/schemas/bio-link.schema'

export interface BioPreviewDraft {
  name: string
  title: string
  description: string
  avatarUrl: string | null
  theme: BioThemeDTO
  blocks: BioBlockDTO[]
}

/**
 * Live preview in a phone frame: the same view the public page renders, fed
 * with the unsaved draft. Items that are off or incomplete stay out; the
 * schedule is ignored here so a future item can still be reviewed.
 */
export function BioPhonePreview({ draft }: { draft: BioPreviewDraft }) {
  const blocks = useMemo(
    () =>
      visibleBioBlocks(
        draft.blocks.map((block) => ({
          ...block,
          startsAt: null,
          endsAt: null,
        })),
        new Date(),
      ),
    [draft.blocks],
  )
  return (
    <div
      data-testid='bio-phone-preview'
      className='mx-auto w-[300px] max-w-full rounded-[2.6rem] border border-foreground/20 bg-foreground/90 p-2.5 shadow-xl'
    >
      <div className='mx-auto mb-1.5 h-1.5 w-16 rounded-full bg-background/30' />
      <div className='h-[560px] overflow-y-auto overscroll-contain rounded-[2rem] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        <BioLinkView
          className='min-h-full'
          title={draft.title.trim() || draft.name}
          description={draft.description.trim() || null}
          avatarUrl={draft.avatarUrl}
          theme={draft.theme}
          blocks={blocks}
        />
      </div>
    </div>
  )
}
