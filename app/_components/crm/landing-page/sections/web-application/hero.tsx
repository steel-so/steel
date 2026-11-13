'use client'

import { PlayIcon } from '@hugeicons-pro/core-solid-rounded'
import { ArrowRight01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRef } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { GhostVideo } from '@/components/ui/ghost-video'
import { notify } from '@/lib/notify'
import {
  uploadCrmLandingPageImage,
  uploadCrmLandingPageVideo,
} from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type HeroContent = Extract<CrmLandingPageSectionContent, { type: 'HERO' }>

const DEFAULT_VIDEO = '/landing-page-templates/web-application/hero-video.png'

export function heroDefaultContent(): HeroContent {
  return {
    type: 'HERO',
    title: 'Mais visitantes, mais vendas.',
    subtitle:
      'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie seu próximo site em poucos minutos.',
    ctaLabel: 'Teste grátis',
    ctaHref: '#footer',
    imageUrl: DEFAULT_VIDEO,
  }
}

export function WebApplicationHero({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<HeroContent>) {
  const videoInputRef = useRef<HTMLInputElement | null>(null)

  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, imageUrl: res.data.url })
  }

  async function handleVideo(file: File) {
    const res = await uploadCrmLandingPageVideo(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar o vídeo.')
      return
    }
    onChange?.({ ...content, videoUrl: res.data.url })
  }

  return (
    <section className='relative overflow-hidden bg-[#161c2d]'>
      {/* Pontinhos decorativos do canto superior direito do frame Figma —
          recriados via gradiente CSS em vez de ~200 SVGs individuais. */}
      <div
        aria-hidden
        className='pointer-events-none absolute top-[175px] right-[95px] hidden h-[189px] w-[208px] opacity-40 lg:block'
        style={{
          backgroundImage:
            'radial-gradient(circle, #473bf0 1.5px, transparent 1.5px)',
          backgroundSize: '13px 13px',
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
              className='font-bold text-[#68d585] text-[13px] uppercase tracking-[1.6px]'
            />
          ) : null}

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
              className='mt-2 inline-flex items-center gap-2 font-bold text-[#68d585] text-[21px] tracking-[-1.2px] hover:opacity-80'
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
              <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={18} />
            </GhostLink>
          ) : null}
        </div>

        <div className='relative mx-auto w-full max-w-[541px]'>
          {content.videoUrl ? (
            <GhostVideo
              value={content.videoUrl}
              onUpload={handleVideo}
              readOnly={readOnly}
              className='aspect-[541/383] w-full rounded-[8px]'
            />
          ) : (
            <GhostImage
              value={content.imageUrl}
              onUpload={handleImage}
              readOnly={readOnly}
              alt={content.title}
              className='aspect-[541/383] w-full rounded-[8px]'
            />
          )}

          {/* Play button decorativo — some quando um vídeo real já foi
              enviado (o GhostVideo acima assume o autoplay). Em modo de
              edição, sem vídeo ainda, o próprio botão vira o gatilho de
              upload — sem mudar nada visualmente pra páginas já publicadas
              que nunca tiveram vídeo. */}
          {!content.videoUrl ? (
            readOnly ? (
              <div className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex size-[92px] items-center justify-center rounded-full bg-white shadow-lg'>
                <SteelIcon
                  icon={PlayIcon}
                  size={22}
                  style={{ color: '#473bf0' }}
                />
              </div>
            ) : (
              <>
                <button
                  type='button'
                  onClick={() => videoInputRef.current?.click()}
                  aria-label='Adicionar vídeo'
                  className='-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 flex size-[92px] items-center justify-center rounded-full bg-white shadow-lg transition-opacity hover:opacity-90'
                >
                  <SteelIcon
                    icon={PlayIcon}
                    size={22}
                    style={{ color: '#473bf0' }}
                  />
                </button>
                <input
                  ref={videoInputRef}
                  type='file'
                  accept='video/mp4,video/webm'
                  className='hidden'
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleVideo(file)
                    e.target.value = ''
                  }}
                />
              </>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}
