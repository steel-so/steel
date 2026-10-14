'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from './types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

export function heroDefaultContent(): HeroContent {
  return { type: 'HERO', title: 'Título de destaque da sua página' }
}

export function HeroSection({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<HeroContent>) {
  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, imageUrl: res.data.url })
  }

  return (
    <section className='flex flex-col items-center gap-6 rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 py-16 text-center sm:px-12 sm:py-24'>
      {content.eyebrow || !readOnly ? (
        <GhostInput
          value={content.eyebrow ?? ''}
          onCommit={(v) => onChange?.({ ...content, eyebrow: v || undefined })}
          placeholder='Texto de destaque'
          readOnly={readOnly}
          className='font-medium text-primary text-sm'
        />
      ) : null}

      <GhostInput
        as='h1'
        value={content.title}
        onCommit={(v) => onChange?.({ ...content, title: v })}
        placeholder='Título principal'
        readOnly={readOnly}
        className='max-w-2xl text-balance font-semibold text-3xl tracking-tight sm:text-5xl'
      />

      {content.subtitle || !readOnly ? (
        <GhostTextarea
          value={content.subtitle ?? ''}
          onCommit={(v) => onChange?.({ ...content, subtitle: v || undefined })}
          placeholder='Descrição de apoio'
          readOnly={readOnly}
          as='p'
          className='max-w-xl text-balance text-base text-muted-foreground sm:text-lg'
        />
      ) : null}

      {content.ctaLabel || !readOnly ? (
        <GhostLink
          href={content.ctaHref}
          onHrefChange={(href) =>
            onChange?.({ ...content, ctaHref: href || undefined })
          }
          readOnly={readOnly}
          data-cta
          className='mt-2 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground text-sm'
        >
          <GhostInput
            value={content.ctaLabel ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, ctaLabel: v || undefined })
            }
            placeholder='Texto do botão'
            readOnly={readOnly}
            className='text-inherit'
          />
        </GhostLink>
      ) : null}

      {content.imageUrl || !readOnly ? (
        <GhostImage
          value={content.imageUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.title}
          className='mt-4 aspect-video w-full max-w-3xl rounded-xl'
        />
      ) : null}
    </section>
  )
}
