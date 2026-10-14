'use client'

import { ArrowRight01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

const DEFAULT_BG = '/landing-page-templates/consultation/hero-bg.png'

export function consultationHeroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    title: 'Get help from the expert consultants.',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next consultancy website within few minutes.',
    ctaLabel: 'Get started now',
    ctaHref: '#footer',
    imageUrl: DEFAULT_BG,
  }
}

/**
 * The Figma "Alert" frame (purple strip "We've added a new exciting
 * feature...") has no section type of its own, so it is folded under the
 * Hero; its copy and link go through the `alert.*` overrides.
 */
function AlertStrip({
  content,
  onChange,
  readOnly,
}: Pick<
  LandingPageSectionProps<HeroContent>,
  'content' | 'onChange' | 'readOnly'
>) {
  return (
    <div className='flex items-center justify-center gap-3 bg-[#473bf0] px-6 py-6 text-center'>
      <span className='inline-flex shrink-0 items-center rounded-full bg-white px-3 py-1 font-bold text-[#473bf0] text-[13px] uppercase tracking-[1.6px]'>
        <GhostInput
          value={textOf(content, 'alert.badge', 'New')}
          onCommit={(v) => onChange?.(withText(content, 'alert.badge', v))}
          placeholder='Selo'
          readOnly={readOnly}
          className='field-sizing-content w-auto text-inherit'
        />
      </span>
      <p className='text-[17px] text-white leading-[29px] tracking-[-0.2px]'>
        <GhostInput
          value={textOf(
            content,
            'alert.text',
            'We’ve added a new exciting feature in v3.0.',
          )}
          onCommit={(v) => onChange?.(withText(content, 'alert.text', v))}
          placeholder='Texto do aviso'
          readOnly={readOnly}
          className='field-sizing-content w-auto text-inherit'
        />{' '}
        <GhostLink
          href={hrefOf(content, 'alert.link', '#footer')}
          onHrefChange={(v) => onChange?.(withHref(content, 'alert.link', v))}
          readOnly={readOnly}
          className='underline underline-offset-2'
        >
          <GhostInput
            value={textOf(content, 'alert.link', 'Get it now for $49')}
            onCommit={(v) => onChange?.(withText(content, 'alert.link', v))}
            placeholder='Texto do link'
            readOnly={readOnly}
            className='field-sizing-content w-auto text-inherit underline underline-offset-2'
          />
        </GhostLink>
        .
      </p>
    </div>
  )
}

export function ConsultationHero({
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
    <section className='relative isolate overflow-hidden bg-[#161c2d]'>
      <GhostImage
        value={content.imageUrl}
        onUpload={handleImage}
        readOnly={readOnly}
        alt=''
        className='absolute inset-0 -z-10 size-full object-cover'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-10 bg-gradient-to-l from-transparent to-[#161c2d] to-99%'
      />

      <div className='relative mx-auto flex max-w-[1600px] flex-col gap-16 px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px] lg:py-32'>
        <div className='flex max-w-xl flex-col items-start gap-6 text-left'>
          <GhostInput
            as='h1'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título principal'
            readOnly={readOnly}
            className='text-balance font-bold text-[38px] text-white leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px] lg:tracking-[-2px]'
          />

          {content.subtitle || !readOnly ? (
            <GhostTextarea
              value={content.subtitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, subtitle: v || undefined })
              }
              placeholder='Descrição de apoio'
              readOnly={readOnly}
              as='p'
              className='max-w-md text-[17px] text-white/65 leading-[1.7] sm:text-[19px]'
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
              className='mt-2 inline-flex items-center gap-2 rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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
              <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={16} />
            </GhostLink>
          ) : null}
        </div>
      </div>

      <AlertStrip content={content} onChange={onChange} readOnly={readOnly} />
    </section>
  )
}
