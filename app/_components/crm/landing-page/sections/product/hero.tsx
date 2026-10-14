'use client'

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

const BASE = '/landing-page-templates/product'
const DEFAULT_PRODUCT_PHOTO = `${BASE}/hero-airpod.png`

/**
 * Mesmo vetor exportado do Figma (`hero-play-icon.svg`, node 0:277) — inline
 * pra trocar `stroke`/`fill` de "white" pra `currentColor`, já que no design
 * de origem esse ícone assume um fundo escuro e aqui ele fica sobre a seção
 * branca do Hero. Geometria idêntica ao asset original, só a cor muda.
 */
function PlayIcon() {
  return (
    <svg
      viewBox='0 0 19 19'
      className='size-[18px]'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden
    >
      <circle cx='9.5' cy='9.5' r='9' stroke='currentColor' />
      <path
        d='M8.10786 6.25467C8.06123 6.22322 7.9994 6.21838 7.9477 6.24257C7.89616 6.26676 7.86364 6.31585 7.86364 6.3695V12.6304C7.86364 12.6841 7.89616 12.7332 7.9477 12.7574C7.96949 12.7676 7.99342 12.7727 8.01705 12.7727C8.04911 12.7727 8.08102 12.7635 8.10786 12.7453L12.7101 9.6148C12.7496 9.5879 12.7727 9.54521 12.7727 9.49997C12.7727 9.45472 12.7496 9.41203 12.7101 9.38513L8.10786 6.25467Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    eyebrow: 'Non-stop music for long time',
    title: 'Sound, that sounds better!',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next consultancy website within few minutes.',
    ctaLabel: 'Buy now - Starting at $99',
    ctaHref: '#pricing',
    imageUrl: DEFAULT_PRODUCT_PHOTO,
  }
}

export function ProductHero({
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
    <section className='bg-white px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px] lg:py-32'>
      <div className='mx-auto flex max-w-3xl flex-col items-center gap-6 text-center'>
        <GhostImage
          value={content.imageUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.title}
          className='aspect-[356/301] w-full max-w-[356px] object-contain'
        />

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
          className='text-balance font-bold text-[#161c2d] text-[38px] leading-[1.1] tracking-[-1px] sm:text-[48px] lg:text-[60px] lg:leading-[65px] lg:tracking-[-2px]'
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
            className='max-w-xl text-[#161c2d]/70 text-[17px] leading-[1.7] sm:text-[19px]'
          />
        ) : null}

        <div className='mt-2 flex flex-col items-center gap-5'>
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
            href={hrefOf(content, 'cta.secondary', '#pricing')}
            onHrefChange={(v) =>
              onChange?.(withHref(content, 'cta.secondary', v))
            }
            readOnly={readOnly}
            className='inline-flex items-center gap-2 font-bold text-[#161c2d] text-[13px] uppercase tracking-[1.6px] hover:opacity-70'
          >
            <PlayIcon />
            <GhostInput
              value={textOf(content, 'cta.secondary', 'Watch in action')}
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
    </section>
  )
}
