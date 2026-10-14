'use client'

import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  PlayIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
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
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type ServicesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'SERVICES' }
>

const BASE = '/landing-page-templates/b2b'

export function servicesDefaultContent(): ServicesContent {
  return {
    type: 'SERVICES',
    title: 'Services we offer for you',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    items: [
      {
        title: 'Digital Marketing',
        description:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
        imageUrl: `${BASE}/services-digital-marketing.png`,
      },
      {
        title: 'Business Growth',
        description:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
        imageUrl: `${BASE}/services-business-growth.png`,
      },
      {
        title: 'Content Marketing',
        description:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
        imageUrl: `${BASE}/services-content-marketing.png`,
      },
    ],
  }
}

export function B2bServices({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<ServicesContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ title: string; description: string; imageUrl?: string }>,
  ) {
    onChange?.({
      ...content,
      items: content.items.map((it, i) =>
        i === index ? { ...it, ...patch } : it,
      ),
    })
  }

  async function handleImage(index: number, file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    updateItem(index, { imageUrl: res.data.url })
  }

  async function handleVideo(file: File) {
    const res = await uploadCrmLandingPageVideo(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar o vídeo.')
      return
    }
    onChange?.({ ...content, videoUrl: res.data.url })
  }

  function addItem() {
    onChange?.({
      ...content,
      items: [...content.items, { title: 'Novo serviço', description: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
        />
        {content.subtitle || !readOnly ? (
          <GhostTextarea
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Subtítulo'
            readOnly={readOnly}
            as='p'
            className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3'>
        {content.items.map((item, index) => (
          <div key={index} className='group/card relative flex flex-col gap-5'>
            {!readOnly ? (
              <Button
                type='button'
                variant='secondary'
                size='icon-xs'
                className='absolute top-2 right-2 z-10 opacity-0 group-hover/card:opacity-100'
                aria-label='Remover serviço'
                onClick={() => removeItem(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}

            <GhostImage
              value={item.imageUrl}
              onUpload={(file) => handleImage(index, file)}
              readOnly={readOnly}
              alt={item.title}
              className='aspect-[350/165] w-full rounded-[10px] border border-[#e7e9ed] object-cover'
            />

            <GhostInput
              as='h3'
              value={item.title}
              onCommit={(v) => updateItem(index, { title: v })}
              placeholder='Título do serviço'
              readOnly={readOnly}
              className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
            />
            <GhostTextarea
              value={item.description}
              onCommit={(v) => updateItem(index, { description: v })}
              placeholder='Descrição do serviço'
              readOnly={readOnly}
              as='p'
              className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
            />

            <GhostLink
              href={hrefOf(content, `item.${index}.cta`, '#footer')}
              onHrefChange={(v) =>
                onChange?.(withHref(content, `item.${index}.cta`, v))
              }
              readOnly={readOnly}
              data-cta
              className='inline-flex items-center gap-2 font-bold text-[#473bf0] text-[17px] tracking-[-0.6px] hover:opacity-90'
            >
              <GhostInput
                value={textOf(content, `item.${index}.cta`, 'Learn more')}
                onCommit={(v) =>
                  onChange?.(withText(content, `item.${index}.cta`, v))
                }
                placeholder='Texto do link'
                readOnly={readOnly}
                className='field-sizing-content w-auto text-inherit'
              />
              <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={16} />
            </GhostLink>
          </div>
        ))}

        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-[300px] flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed text-muted-foreground text-sm hover:bg-background'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar serviço
          </button>
        ) : null}
      </div>

      {/* Bloco "Video" do Figma — sem tipo de seção dedicado no vocabulário
          compartilhado, então fica encaixado logo após a grade de serviços.
          `videoUrl` (opcional) troca a foto estática por um vídeo real em
          autoplay; sem ele, cai na foto + ícone de play decorativo. */}
      <div
        id='video'
        className='relative mx-auto mt-20 flex aspect-[1600/580] max-w-6xl items-center justify-center overflow-hidden rounded-[10px]'
      >
        {content.videoUrl || !readOnly ? (
          <GhostVideo
            value={content.videoUrl}
            onUpload={handleVideo}
            readOnly={readOnly}
            className='absolute inset-0 size-full object-cover'
          />
        ) : (
          <img
            src={`${BASE}/video-banner.png`}
            alt=''
            aria-hidden
            className='absolute inset-0 size-full object-cover'
          />
        )}
        <div
          aria-hidden
          className='pointer-events-none absolute inset-0 bg-[#161c2d]/50'
        />
        <div className='relative flex flex-col items-center gap-6 px-6 text-center'>
          <span className='flex size-[68px] shrink-0 items-center justify-center rounded-full bg-white'>
            <SteelIcon
              icon={PlayIcon}
              strokeWidth={2}
              size={24}
              className='text-[#473bf0]'
            />
          </span>
          <GhostInput
            as='h3'
            value={textOf(
              content,
              'video.title',
              'How do we help you to grow?',
            )}
            onCommit={(v) => onChange?.(withText(content, 'video.title', v))}
            placeholder='Título do vídeo'
            readOnly={readOnly}
            className='text-balance text-center font-bold text-[24px] text-white tracking-[-0.8px] sm:text-[36px] sm:tracking-[-1.2px]'
          />
          <GhostTextarea
            value={textOf(
              content,
              'video.description',
              'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
            )}
            onCommit={(v) =>
              onChange?.(withText(content, 'video.description', v))
            }
            placeholder='Texto de apoio'
            readOnly={readOnly}
            as='p'
            className='max-w-lg text-center text-[15px] text-white/65 leading-[1.7] sm:text-[19px]'
          />
        </div>
      </div>
    </section>
  )
}
