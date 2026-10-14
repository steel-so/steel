'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import { MOBILE_APP_HERO_GRADIENT } from '@/src/lib/landing-page-templates/mobile-app/colors'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

const BASE = '/landing-page-templates/mobile-app'
const DOTS = `${BASE}/hero-dots.png`
const WAVE = `${BASE}/hero-wave.svg`
const APP_STORE = `${BASE}/app-store-badge.png`
const PLAY_STORE = `${BASE}/play-store-badge.png`
const DEFAULT_MOCKUP = `${BASE}/hero-app-mockup.png`

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    title: 'Manage your remote team work',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next consultancy website within few minutes.',
    ctaLabel: 'Explore more',
    ctaHref: '#footer',
    imageUrl: DEFAULT_MOCKUP,
  }
}

export function MobileAppHero({
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
    <section
      style={{ backgroundImage: MOBILE_APP_HERO_GRADIENT }}
      className='relative overflow-hidden'
    >
      <img
        src={DOTS}
        alt=''
        aria-hidden
        className='pointer-events-none absolute top-[136px] right-[123px] hidden h-28 w-28 opacity-90 lg:block'
      />

      <div className='relative mx-auto grid max-w-[1600px] grid-cols-1 items-center gap-16 px-6 pt-16 pb-24 sm:px-10 sm:pt-20 lg:grid-cols-2 lg:gap-8 lg:px-[123px] lg:pt-24 lg:pb-32'>
        <div className='flex flex-col items-start gap-6 text-left'>
          <GhostInput
            as='h1'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título principal'
            readOnly={readOnly}
            className='max-w-xl text-balance font-bold text-[38px] text-white leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px] lg:tracking-[-2px]'
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
              className='mt-2 inline-flex items-center justify-center rounded-lg bg-[#f74d4d] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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

          <div className='mt-8 flex flex-col gap-4'>
            <GhostInput
              value={textOf(content, 'download.title', 'Download our app')}
              onCommit={(v) =>
                onChange?.(withText(content, 'download.title', v))
              }
              placeholder='Texto de destaque'
              readOnly={readOnly}
              className='font-bold text-[#f4f7fa] text-[13px] uppercase tracking-[1.6px]'
            />
            <div className='flex items-center gap-3'>
              <GhostLink
                href={hrefOf(content, 'download.appStore', '#')}
                onHrefChange={(v) =>
                  onChange?.(withHref(content, 'download.appStore', v))
                }
                readOnly={readOnly}
                aria-label='App Store'
              >
                <img
                  src={APP_STORE}
                  alt='App Store'
                  className='h-[42px] w-auto'
                />
              </GhostLink>
              <GhostLink
                href={hrefOf(content, 'download.playStore', '#')}
                onHrefChange={(v) =>
                  onChange?.(withHref(content, 'download.playStore', v))
                }
                readOnly={readOnly}
                aria-label='Google Play'
              >
                <img
                  src={PLAY_STORE}
                  alt='Google Play'
                  className='h-[42px] w-auto'
                />
              </GhostLink>
            </div>
          </div>
        </div>

        <div className='relative mx-auto w-full max-w-[420px]'>
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.title}
            className='aspect-[676/739] w-full rounded-2xl'
          />
        </div>
      </div>

      <img
        src={WAVE}
        alt=''
        aria-hidden
        className='pointer-events-none block h-auto w-full'
      />
    </section>
  )
}
