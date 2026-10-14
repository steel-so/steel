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

const DEFAULT_IMAGE =
  '/landing-page-templates/saas-subscription/hero-mockup.png'

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    title: 'Get things done by awesome remote team',
    subtitle:
      'We share common trends and strategies for improving your rental income and making sure you stay in high demand.',
    ctaLabel: 'Get started for free',
    ctaHref: '#footer',
    imageUrl: DEFAULT_IMAGE,
  }
}

export function SaasSubscriptionHero({
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
    <section className='bg-white px-6 pt-16 pb-20 sm:px-10 sm:pt-20 sm:pb-28 lg:px-[123px] lg:pt-24'>
      <div className='mx-auto flex max-w-3xl flex-col items-center gap-6 text-center'>
        <GhostInput
          as='h1'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título principal'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[34px] leading-[1.15] tracking-[-1.2px] sm:text-[48px] sm:leading-[58px] sm:tracking-[-1.8px]'
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
            className='max-w-lg text-[#161c2d]/70 text-[17px] leading-[1.7] sm:text-[19px]'
          />
        ) : null}

        <div className='mt-2 flex flex-wrap items-center justify-center gap-4'>
          {content.ctaLabel || !readOnly ? (
            <GhostLink
              href={content.ctaHref}
              onHrefChange={(href) =>
                onChange?.({ ...content, ctaHref: href || undefined })
              }
              readOnly={readOnly}
              data-cta
              className='inline-flex items-center gap-2 rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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
          <GhostLink
            href={hrefOf(content, 'cta.secondary', '#')}
            onHrefChange={(v) =>
              onChange?.(withHref(content, 'cta.secondary', v))
            }
            readOnly={readOnly}
            className='inline-flex items-center px-4 py-4 font-bold text-[#161c2d] text-[17px] tracking-[-0.6px] hover:opacity-70'
          >
            <GhostInput
              value={textOf(content, 'cta.secondary', 'Learn more')}
              onCommit={(v) =>
                onChange?.(withText(content, 'cta.secondary', v))
              }
              placeholder='Texto do link'
              readOnly={readOnly}
              className='text-inherit'
            />
          </GhostLink>
        </div>
      </div>

      <div className='relative mx-auto mt-16 w-full max-w-[844px]'>
        <GhostImage
          value={content.imageUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.title}
          className='aspect-[844/559] w-full rounded-[10px] object-cover shadow-[0px_42px_44px_-10px_rgba(1,23,48,0.12)]'
        />
      </div>
    </section>
  )
}
