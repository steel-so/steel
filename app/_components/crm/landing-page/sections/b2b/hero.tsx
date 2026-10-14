'use client'

import { PlayIcon } from '@hugeicons-pro/core-stroke-rounded'
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

const BASE = '/landing-page-templates/b2b'
const BG_PATTERN = `${BASE}/hero-bg-pattern.png`
const SHAPE_BLOB = `${BASE}/hero-shape-blob.svg`
const CIRCLE = `${BASE}/hero-circle.svg`
const DEFAULT_PORTRAIT = `${BASE}/hero-portrait.png`

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    // O schema não tem um tipo dedicado pra faixa "Alert" do Figma (banner
    // fino entre Hero e Content 01) — reaproveitamos `eyebrow`, que aqui não
    // é usado acima do título (o design de referência não tem esse texto ali),
    // pra guardar o texto da faixa de anúncio renderizada no rodapé do Hero.
    eyebrow: 'Interested how our software works for you?',
    title: 'Make your business powerful with Shade.',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next consultancy website within few minutes.',
    ctaLabel: 'Get A Free Quote',
    ctaHref: '#footer',
    imageUrl: DEFAULT_PORTRAIT,
  }
}

export function B2bHero({
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
    <section className='relative overflow-hidden bg-[#f8f8f8]'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 opacity-[0.02]'
        style={{
          backgroundImage: `url(${BG_PATTERN})`,
          backgroundSize: 'cover',
        }}
      />

      <div className='relative mx-auto grid max-w-[1600px] grid-cols-1 items-center gap-16 px-6 pt-16 pb-14 sm:px-10 sm:pt-24 lg:grid-cols-2 lg:gap-8 lg:px-[123px] lg:pt-32'>
        <div className='flex flex-col items-start gap-6 text-left'>
          <GhostInput
            as='h1'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título principal'
            readOnly={readOnly}
            className='max-w-xl text-balance font-bold text-[#161c2d] text-[38px] leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[58px] lg:leading-[64px] lg:tracking-[-1.8px]'
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

          <div className='mt-2 flex flex-wrap items-center gap-8'>
            {content.ctaLabel || !readOnly ? (
              <GhostLink
                href={content.ctaHref}
                onHrefChange={(href) =>
                  onChange?.({ ...content, ctaHref: href || undefined })
                }
                readOnly={readOnly}
                data-cta
                className='inline-flex items-center justify-center rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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

            <GhostLink
              href={hrefOf(content, 'video', '#video')}
              onHrefChange={(v) => onChange?.(withHref(content, 'video', v))}
              readOnly={readOnly}
              data-cta
              className='inline-flex items-center gap-2 font-bold text-[#161c2d] text-[13px] uppercase tracking-[1.6px] hover:opacity-80'
            >
              <SteelIcon icon={PlayIcon} strokeWidth={2} size={18} />
              <GhostInput
                value={textOf(content, 'video', 'Watch how we can help')}
                onCommit={(v) => onChange?.(withText(content, 'video', v))}
                placeholder='Texto do link'
                readOnly={readOnly}
                className='field-sizing-content w-auto text-inherit'
              />
            </GhostLink>
          </div>
        </div>

        <div className='relative mx-auto aspect-[467/636] w-full max-w-[467px]'>
          <img
            src={CIRCLE}
            alt=''
            aria-hidden
            className='-bottom-8 -right-6 absolute h-[170px] w-[170px]'
          />
          <img
            src={SHAPE_BLOB}
            alt=''
            aria-hidden
            className='-top-2 -right-2 absolute h-[70px] w-[70px]'
          />
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.title}
            className='relative size-full rounded-[20px]'
          />
        </div>
      </div>

      {content.eyebrow || !readOnly ? (
        <div className='relative flex items-center justify-center gap-3 bg-[#161c2d] px-6 py-6 text-center sm:px-10'>
          <SteelIcon
            icon={PlayIcon}
            strokeWidth={2}
            size={18}
            className='shrink-0 text-white'
          />
          <GhostInput
            value={content.eyebrow ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, eyebrow: v || undefined })
            }
            placeholder='Texto da faixa de anúncio'
            readOnly={readOnly}
            className='text-[15px] text-white sm:text-[17px]'
          />
        </div>
      ) : null}
    </section>
  )
}
