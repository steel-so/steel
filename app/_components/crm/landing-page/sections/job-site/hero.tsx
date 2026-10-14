'use client'

import {
  ArrowDown01Icon,
  Search01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

const DEFAULT_PORTRAIT = '/landing-page-templates/job-site/hero-portrait.png'

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    title: 'Find a dream job that changes life.',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next job website.',
    ctaLabel: 'Search',
    ctaHref: '#jobs',
    imageUrl: DEFAULT_PORTRAIT,
  }
}

export function JobSiteHero({
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
    <section className='relative overflow-hidden bg-[#e8f6ea]'>
      <div
        aria-hidden
        className='pointer-events-none absolute right-[-8%] bottom-[-18%] size-[420px] rounded-full bg-[#f4b6bc]/50'
      />
      <div
        aria-hidden
        className='pointer-events-none absolute top-16 right-[8%] h-24 w-24 opacity-60'
        style={{
          backgroundImage:
            'radial-gradient(circle, #161c2d 1.5px, transparent 1.5px)',
          backgroundSize: '12px 12px',
        }}
      />

      <div className='relative mx-auto grid max-w-[1600px] grid-cols-1 items-center gap-16 px-6 py-16 sm:px-10 sm:py-24 lg:grid-cols-2 lg:gap-8 lg:px-[123px] lg:py-32'>
        <div className='flex flex-col items-start gap-6 text-left'>
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

          {/* Decorative search form — not part of the HERO schema; its
              visible copy lives in the `texts` overrides (`search.*`). */}
          <div className='mt-2 flex w-full max-w-xl flex-col gap-3 rounded-xl bg-[#473bf0] p-2 shadow-[0_54px_53px_-23px_rgba(22,28,45,0.14)] sm:flex-row sm:items-center'>
            <div className='flex flex-1 items-center gap-2 rounded-lg bg-white px-4 py-3'>
              <SteelIcon
                icon={Search01Icon}
                strokeWidth={2}
                size={16}
                className='text-[#161c2d]/40'
              />
              <GhostInput
                value={textOf(
                  content,
                  'search.keyword',
                  'Job title or keyword',
                )}
                onCommit={(v) =>
                  onChange?.(withText(content, 'search.keyword', v))
                }
                placeholder='Texto do campo'
                readOnly={readOnly}
                className='text-[#161c2d]/70 text-[15px]'
              />
            </div>
            <div className='flex flex-1 items-center justify-between gap-2 rounded-lg border border-[#e7e9ed] bg-white px-4 py-3'>
              <GhostInput
                value={textOf(content, 'search.city', 'City')}
                onCommit={(v) =>
                  onChange?.(withText(content, 'search.city', v))
                }
                placeholder='Texto do campo'
                readOnly={readOnly}
                className='text-[#161c2d] text-[15px]'
              />
              <SteelIcon
                icon={ArrowDown01Icon}
                strokeWidth={2}
                size={14}
                className='text-[#161c2d]/50'
              />
            </div>

            {content.ctaLabel || !readOnly ? (
              <GhostLink
                href={content.ctaHref}
                onHrefChange={(href) =>
                  onChange?.({ ...content, ctaHref: href || undefined })
                }
                readOnly={readOnly}
                data-cta
                className='inline-flex shrink-0 items-center justify-center rounded-lg bg-[#161c2d] px-8 py-3 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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
          <GhostInput
            as='p'
            value={textOf(
              content,
              'search.hint',
              'Try Product Designer, Software Engineer etc.',
            )}
            onCommit={(v) => onChange?.(withText(content, 'search.hint', v))}
            placeholder='Dica de busca'
            readOnly={readOnly}
            className='text-[#161c2d]/70 text-[15px]'
          />
        </div>

        <div className='relative mx-auto aspect-[428/610] w-full max-w-[428px]'>
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.title}
            className='size-full rounded-[24px]'
          />
        </div>
      </div>
    </section>
  )
}
