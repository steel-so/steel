'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

const DEFAULT_BG = '/landing-page-templates/ecommerce/hero-bg.png'

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    eyebrow: 'Design de interiores minimalista',
    title: 'Menos desperdício em cada etapa do seu projeto.',
    imageUrl: DEFAULT_BG,
  }
}

export function EcommerceHero({
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
    <section className='px-6 pt-6 sm:px-10 lg:px-[123px]'>
      <div className='relative isolate overflow-hidden rounded-[10px] bg-[#0a0d17]'>
        <GhostImage
          value={content.imageUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt=''
          className='absolute inset-0 size-full object-cover opacity-60'
        />
        <div className='relative mx-auto flex min-h-[560px] max-w-3xl flex-col items-center justify-center gap-6 px-6 py-24 text-center sm:min-h-[700px] sm:py-32'>
          {content.eyebrow || !readOnly ? (
            <GhostInput
              value={content.eyebrow ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, eyebrow: v || undefined })
              }
              placeholder='Texto de destaque'
              readOnly={readOnly}
              className='font-bold text-[#f4f7fa] text-[13px] uppercase tracking-[1.6px]'
            />
          ) : null}

          <GhostInput
            as='h1'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título principal'
            readOnly={readOnly}
            className='text-balance font-bold text-[38px] text-white leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px] lg:tracking-[-2px]'
          />
        </div>
      </div>
    </section>
  )
}
