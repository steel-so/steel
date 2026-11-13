'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type AboutContent = Extract<CrmLandingPageSectionContent, { type: 'ABOUT' }>

const BASE = '/landing-page-templates/product'

export function aboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Design moderno com mais qualidade de som.',
    description:
      'Compartilhamos tendências e estratégias para você melhorar seus resultados.',
    imageUrl: `${BASE}/about-earbuds-left.png`,
    imageUrls: [`${BASE}/about-earbuds-right.png`],
  }
}

export function ProductAbout({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<AboutContent>) {
  async function handleImage(index: number | null, file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    if (index === null) {
      onChange?.({ ...content, imageUrl: res.data.url })
      return
    }
    const imageUrls = [...content.imageUrls]
    imageUrls[index] = res.data.url
    onChange?.({ ...content, imageUrls })
  }

  const [image2] = content.imageUrls

  return (
    <section className='relative overflow-hidden bg-[#161c2d] px-6 py-20 text-center sm:px-10 sm:py-28'>
      <img
        src={`${BASE}/about-music-wave.png`}
        alt=''
        aria-hidden
        className='pointer-events-none absolute inset-0 size-full object-cover opacity-15'
      />

      <div className='relative mx-auto flex max-w-2xl flex-col items-center gap-4'>
        {content.eyebrow || !readOnly ? (
          <GhostInput
            value={content.eyebrow ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, eyebrow: v || undefined })
            }
            placeholder='Texto de destaque'
            readOnly={readOnly}
            className='font-bold text-[#f64b4b] text-[13px] uppercase tracking-[1.6px]'
          />
        ) : null}
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[32px] text-white leading-tight tracking-[-1.2px] sm:text-[40px]'
        />
        <GhostTextarea
          value={content.description}
          onCommit={(v) => onChange?.({ ...content, description: v })}
          placeholder='Descrição'
          readOnly={readOnly}
          as='p'
          className='text-[19px] text-white/65 leading-[1.7]'
        />
      </div>

      <div className='relative mx-auto mt-16 flex max-w-md items-end justify-center gap-6'>
        <GhostImage
          value={content.imageUrl}
          onUpload={(file) => handleImage(null, file)}
          readOnly={readOnly}
          alt={content.title}
          className='aspect-[220/305] w-1/2 rounded-[10px] object-contain'
        />
        {image2 || !readOnly ? (
          <GhostImage
            value={image2}
            onUpload={(file) => handleImage(0, file)}
            readOnly={readOnly}
            alt=''
            className='mb-10 aspect-[214/306] w-1/2 rounded-[10px] object-contain'
          />
        ) : null}
      </div>
    </section>
  )
}
