'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type TestimonialContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'TESTIMONIAL' }
>

const BASE = '/landing-page-templates/product'

export function testimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'You made it so simple. My new site is so much faster and easier to work with than my old site.',
    authorName: 'Rhoda Brady',
    avatarUrl: `${BASE}/testimonial-avatar.png`,
    style: 'spotlight',
  }
}

/**
 * Fiel ao frame "Content 02" — bloco roxo (título + depoimento) ao lado de
 * uma foto full-bleed. O título/descrição de marketing acima do depoimento
 * ("Comfortable buds with better sound.") não existe no schema TESTIMONIAL
 * (só quote/authorName/authorRole/avatarUrl/style), então usa os overrides
 * `texts.heading`/`texts.description`.
 */
export function ProductTestimonial({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<TestimonialContent>) {
  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, avatarUrl: res.data.url })
  }

  return (
    <section className='grid grid-cols-1 lg:grid-cols-2'>
      <div className='flex flex-col justify-center gap-10 bg-[#473bf0] px-6 py-16 sm:px-10 sm:py-24 lg:px-16'>
        <div className='flex flex-col gap-3'>
          <GhostInput
            as='h2'
            value={textOf(
              content,
              'heading',
              'Comfortable buds with better sound.',
            )}
            onCommit={(v) => onChange?.(withText(content, 'heading', v))}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[32px] text-white leading-tight tracking-[-1.2px] sm:text-[40px]'
          />
          <GhostTextarea
            value={textOf(
              content,
              'description',
              'We share common trends and strategies for improving your rental income.',
            )}
            onCommit={(v) => onChange?.(withText(content, 'description', v))}
            placeholder='Descrição de apoio'
            readOnly={readOnly}
            as='p'
            className='max-w-md text-[17px] text-white/65 leading-[1.7]'
          />
        </div>

        <div className='flex flex-col gap-4'>
          <GhostImage
            value={content.avatarUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.authorName}
            className='size-[54px] rounded-full object-cover'
          />
          <GhostTextarea
            value={content.quote}
            onCommit={(v) => onChange?.({ ...content, quote: v })}
            placeholder='Depoimento'
            readOnly={readOnly}
            as='p'
            className='max-w-md text-[21px] text-white leading-[1.5]'
          />
          <GhostInput
            value={content.authorName}
            onCommit={(v) => onChange?.({ ...content, authorName: v })}
            placeholder='Nome'
            readOnly={readOnly}
            className='font-bold text-[15px] text-white/65'
          />
        </div>
      </div>

      <div className='relative min-h-[320px] bg-[#fde7c3]'>
        <img
          src={`${BASE}/testimonial-photo.jpg`}
          alt=''
          aria-hidden
          className='size-full object-cover'
        />
      </div>
    </section>
  )
}
