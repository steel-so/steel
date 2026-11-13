'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type TestimonialContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'TESTIMONIAL' }
>

const BASE = '/landing-page-templates/saas-subscription'

export function testimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      '“Vocês deixaram tudo muito simples.” Meu novo site é muito mais rápido e fácil de usar que o antigo.',
    authorName: 'Corey Valdez',
    authorRole: 'Fundador na Zenix',
    avatarUrl: `${BASE}/testimonial-avatar-1.png`,
    style: 'default',
  }
}

export function testimonialSpotlightDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      '“Simplesmente o melhor.” Superior a todos os outros. Eu recomendaria este produto para iniciantes.',
    authorName: 'Ian Klein',
    authorRole: 'Profissional de marketing digital',
    avatarUrl: `${BASE}/testimonial-avatar-2.png`,
    style: 'spotlight',
  }
}

export function SaasSubscriptionTestimonial({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<TestimonialContent>) {
  const spotlight = content.style === 'spotlight'

  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, avatarUrl: res.data.url })
  }

  return (
    <section
      className={cn(
        'px-6 py-20 text-center sm:px-10 sm:py-24',
        spotlight ? 'bg-[#473bf0]' : 'bg-[#f4f7fa]',
      )}
    >
      <div className='mx-auto flex max-w-xl flex-col items-center gap-6'>
        <GhostImage
          value={content.avatarUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.authorName}
          className='size-[72px] rounded-full object-cover'
        />

        <GhostTextarea
          value={content.quote}
          onCommit={(v) => onChange?.({ ...content, quote: v })}
          placeholder='Depoimento'
          readOnly={readOnly}
          as='p'
          className={cn(
            'text-balance font-bold text-[22px] leading-[1.4] sm:text-[24px]',
            spotlight ? 'text-white' : 'text-[#161c2d]',
          )}
        />

        <div className='flex flex-col items-center gap-1'>
          <GhostInput
            value={content.authorName}
            onCommit={(v) => onChange?.({ ...content, authorName: v })}
            placeholder='Nome'
            readOnly={readOnly}
            className={cn(
              'font-bold text-[17px]',
              spotlight ? 'text-white' : 'text-[#161c2d]',
            )}
          />
          {content.authorRole || !readOnly ? (
            <GhostInput
              value={content.authorRole ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, authorRole: v || undefined })
              }
              placeholder='Cargo/empresa'
              readOnly={readOnly}
              className={cn(
                'text-[15px]',
                spotlight ? 'text-white/70' : 'text-[#161c2d]/70',
              )}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
}
