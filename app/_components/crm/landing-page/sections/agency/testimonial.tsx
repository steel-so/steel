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

const BASE = '/landing-page-templates/agency'

export function testimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'OMG! I cannot believe that I have got a brand new landing page after getting Albino. It was super easy to edit and publish.',
    authorName: 'Franklin Hicks',
    authorRole: 'Web Developer',
    avatarUrl: `${BASE}/testimonial-avatar-1.png`,
    style: 'default',
  }
}

export function testimonialSpotlightDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      "Simply the best. Better than all the rest. I'd recommend this product to beginners and advanced users.",
    authorName: 'Ian Klein',
    authorRole: 'Digital Marketer',
    avatarUrl: `${BASE}/testimonial-avatar-2.png`,
    style: 'spotlight',
  }
}

function Stars() {
  return (
    <div className='flex items-center gap-1' aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          viewBox='0 0 21 19'
          className='h-[19px] w-[21px] fill-[#ffb800]'
        >
          <path d='M10.5 0 13 6.8l7.2.3-5.7 4.4L16.5 19l-6-4.3L4.5 19l1.9-7.5L.6 7.1l7.2-.3z' />
        </svg>
      ))}
    </div>
  )
}

export function AgencyTestimonial({
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

  if (content.style === 'spotlight') {
    return (
      <section className='relative overflow-hidden bg-[#473bf0] px-6 py-20 text-center sm:px-10 sm:py-28'>
        <img
          src={`${BASE}/testimonial-spotlight-lines.svg`}
          alt=''
          aria-hidden
          className='pointer-events-none absolute inset-0 size-full object-cover opacity-40'
        />

        <div className='relative mx-auto flex max-w-2xl flex-col items-center gap-6'>
          <GhostInput
            value={textOf(content, 'badge', 'Testimonial')}
            onCommit={(v) => onChange?.(withText(content, 'badge', v))}
            placeholder='Texto de destaque'
            readOnly={readOnly}
            className='text-center font-bold text-[#68d585] text-[13px] uppercase tracking-[1.6px]'
          />

          <GhostTextarea
            value={content.quote}
            onCommit={(v) => onChange?.({ ...content, quote: v })}
            placeholder='Depoimento'
            readOnly={readOnly}
            as='p'
            className='text-balance font-bold text-[22px] text-white leading-[1.4] sm:text-[32px]'
          />

          <GhostImage
            value={content.avatarUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.authorName}
            className='mt-2 size-[76px] rounded-full object-cover'
          />

          <div className='flex flex-col items-center gap-1'>
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
                className='text-[15px] text-white/65'
              />
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className='border-[#161c2d]/10 border-b bg-white px-6 py-16 sm:px-10 sm:py-20 lg:px-[123px]'>
      <div className='mx-auto flex max-w-6xl flex-col items-center gap-8 sm:flex-row sm:items-center'>
        <GhostImage
          value={content.avatarUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.authorName}
          className='size-[164px] shrink-0 rounded-full object-cover'
        />

        <div className='flex flex-col items-center gap-4 text-center sm:items-start sm:text-left'>
          <Stars />

          <GhostTextarea
            value={content.quote}
            onCommit={(v) => onChange?.({ ...content, quote: v })}
            placeholder='Depoimento'
            readOnly={readOnly}
            as='p'
            className='max-w-2xl text-balance font-bold text-[#161c2d] text-[20px] leading-[1.4] sm:text-[24px]'
          />

          <div className='flex items-center gap-1 text-[17px]'>
            <GhostInput
              value={content.authorName}
              onCommit={(v) => onChange?.({ ...content, authorName: v })}
              placeholder='Nome'
              readOnly={readOnly}
              className='font-bold text-[#161c2d]'
            />
            {content.authorRole || !readOnly ? (
              <>
                <span className='text-[#161c2d]/70'>·</span>
                <GhostInput
                  value={content.authorRole ?? ''}
                  onCommit={(v) =>
                    onChange?.({ ...content, authorRole: v || undefined })
                  }
                  placeholder='Cargo/empresa'
                  readOnly={readOnly}
                  className='text-[#161c2d]/70'
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
