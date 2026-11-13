'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

const BG_PATTERN = '/landing-page-templates/agency/hero-bg-pattern.png'
const DOTS = '/landing-page-templates/agency/hero-dots.svg'
const SWIRL = '/landing-page-templates/agency/hero-swirl.svg'
const WAVE1 = '/landing-page-templates/agency/hero-wave-fill.svg'
const WAVE2 = '/landing-page-templates/agency/hero-wave2.svg'
const DEFAULT_PORTRAIT = '/landing-page-templates/agency/hero-portrait.png'

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    eyebrow: 'Vamos transformar o seu negócio',
    title: 'Acelere o seu negócio com a Sua Empresa.',
    subtitle:
      'Com vários blocos exclusivos, você monta sua página sem escrever código. Crie o site da sua consultoria em poucos minutos.',
    ctaLabel: 'Iniciar um projeto',
    ctaHref: '#footer',
    imageUrl: DEFAULT_PORTRAIT,
  }
}

export function AgencyHero({
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
    <section className='relative overflow-hidden bg-[#f4f7fa]'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 opacity-[0.02]'
        style={{
          backgroundImage: `url(${BG_PATTERN})`,
          backgroundSize: 'cover',
        }}
      />

      <div className='relative mx-auto grid max-w-[1600px] grid-cols-1 items-center gap-16 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-2 lg:gap-8 lg:px-[123px] lg:py-32'>
        <div className='flex flex-col items-start gap-6 text-left'>
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
            as='h1'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título principal'
            readOnly={readOnly}
            className='max-w-xl text-balance font-bold text-[#161c2d] text-[38px] leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px] lg:tracking-[-2px]'
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
              className='max-w-md text-[#161c2d]/70 text-[17px] leading-[1.7] sm:text-[19px]'
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
              className='mt-2 inline-flex items-center justify-center rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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
        </div>

        <div className='relative mx-auto aspect-square w-full max-w-[463px]'>
          <img
            src={DOTS}
            alt=''
            aria-hidden
            className='-top-6 -left-2 absolute h-20 w-20 opacity-70'
          />
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.title}
            className='size-full rounded-full'
          />
          <img
            src={SWIRL}
            alt=''
            aria-hidden
            className='absolute bottom-[8%] left-[2%] h-[110px] w-[125px] rotate-2'
          />
          <img
            src={WAVE1}
            alt=''
            aria-hidden
            className='absolute right-[-2%] bottom-[16%] h-20 w-3 opacity-80'
          />
          <img
            src={WAVE2}
            alt=''
            aria-hidden
            className='absolute right-[-4%] bottom-[14%] h-20 w-3 opacity-60'
          />
        </div>
      </div>
    </section>
  )
}
