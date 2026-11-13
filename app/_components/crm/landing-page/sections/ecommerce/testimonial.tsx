'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type TestimonialContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'TESTIMONIAL' }
>

const BASE = '/landing-page-templates/ecommerce'
const STAR = `${BASE}/star-full.svg`
const QUOTE_ICON = `${BASE}/testimonial-quote-icon.svg`

export function testimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Uau! Nem acredito que ganhei um quarto novinho depois de contratar vocês. Foi superfácil comprar e começar.',
    authorName: 'Maria José Botín',
    authorRole: 'Designer de interiores',
    avatarUrl: `${BASE}/testimonial-avatar.png`,
    style: 'default',
  }
}

function Stars() {
  return (
    <div className='flex items-center gap-1' aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <img key={i} src={STAR} alt='' className='h-[17px] w-[19px]' />
      ))}
    </div>
  )
}

export function EcommerceTestimonial({
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
    <section className='px-6 py-16 sm:px-10 sm:py-20 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 rounded-[10px] bg-[#161c2d] p-8 sm:p-14 lg:grid-cols-[1fr_349px] lg:gap-16'>
        <div className='flex flex-col items-start gap-5'>
          <img
            src={QUOTE_ICON}
            alt=''
            aria-hidden
            className='h-[31px] w-[43px] rotate-180'
          />
          <Stars />
          <GhostTextarea
            value={content.quote}
            onCommit={(v) => onChange?.({ ...content, quote: v })}
            placeholder='Depoimento'
            readOnly={readOnly}
            as='p'
            className='max-w-lg text-[24px] text-white leading-[1.4] tracking-[-0.5px]'
          />
          <div className='flex flex-col gap-0.5'>
            <GhostInput
              value={content.authorName}
              onCommit={(v) => onChange?.({ ...content, authorName: v })}
              placeholder='Nome'
              readOnly={readOnly}
              className='font-bold text-[17px] text-white'
            />
            {content.authorRole || !readOnly ? (
              <GhostInput
                value={content.authorRole ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, authorRole: v || undefined })
                }
                placeholder='Cargo/empresa'
                readOnly={readOnly}
                className='text-[17px] text-white/70'
              />
            ) : null}
          </div>
        </div>

        <GhostImage
          value={content.avatarUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.authorName}
          className='mx-auto aspect-[349/463] w-full max-w-[349px] rounded-[10px] object-cover'
        />
      </div>
    </section>
  )
}
