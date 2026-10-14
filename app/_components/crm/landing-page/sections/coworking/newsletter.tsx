'use client'

import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type NewsletterContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'NEWSLETTER' }
>

export function newsletterDefaultContent(): NewsletterContent {
  return {
    type: 'NEWSLETTER',
    title: 'Get latest updates',
    description:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    placeholder: 'Enter your email',
    ctaLabel: 'Subscribe',
  }
}

export function CoworkingNewsletter({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<NewsletterContent>) {
  return (
    <section className='bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto flex max-w-lg flex-col items-center gap-6 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance text-center font-bold text-[#161c2d] text-[36px] leading-tight tracking-[-1.8px] sm:text-[48px] sm:leading-[58px]'
        />
        {content.description || !readOnly ? (
          <GhostTextarea
            value={content.description ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, description: v || undefined })
            }
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='text-center text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}

        <div className='mt-4 flex w-full flex-col gap-4'>
          {readOnly ? (
            <input
              type='email'
              readOnly
              placeholder={content.placeholder || 'Enter your email'}
              className='w-full rounded-[8px] border border-[#e7e9ed] bg-white px-[22px] py-[15px] text-[#161c2d] text-[17px] tracking-[-0.2px] outline-none placeholder:text-[#161c2d]/70 focus-visible:ring-2 focus-visible:ring-ring/50'
            />
          ) : (
            // Edit mode: the field's placeholder is the visible copy, so it
            // becomes the editable text inside an identical-looking box.
            <div className='w-full rounded-[8px] border border-[#e7e9ed] bg-white px-[22px] py-[15px] text-left'>
              <GhostInput
                value={content.placeholder ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, placeholder: v || undefined })
                }
                placeholder='Enter your email'
                className='text-[#161c2d]/70 text-[17px] tracking-[-0.2px]'
              />
            </div>
          )}
          <GhostLink
            href={hrefOf(content, 'cta', '#')}
            onHrefChange={(v) => onChange?.(withHref(content, 'cta', v))}
            readOnly={readOnly}
            data-cta
            className='inline-flex w-full items-center justify-center rounded-[8px] bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
          >
            <GhostInput
              value={content.ctaLabel ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, ctaLabel: v || undefined })
              }
              placeholder='Texto do botão'
              readOnly={readOnly}
              className='text-inherit text-center'
            />
          </GhostLink>
        </div>

        <GhostTextarea
          value={textOf(
            content,
            'disclaimer',
            "We'll never share your details with third parties.\nView our Privacy Policy for more info.",
          )}
          onCommit={(v) => onChange?.(withText(content, 'disclaimer', v))}
          placeholder='Aviso de privacidade'
          readOnly={readOnly}
          as='p'
          className='whitespace-pre-line text-center text-[#161c2d]/70 text-[15px] leading-[1.7]'
        />
      </div>
    </section>
  )
}
