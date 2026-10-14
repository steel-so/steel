'use client'

import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, withHref } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type ServicesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'SERVICES' }
>

const BASE = '/landing-page-templates/consultation'
const TAIL = `${BASE}/services-card-tail.svg`

export function consultationServicesDefaultContent(): ServicesContent {
  return {
    type: 'SERVICES',
    title: 'Services we offer for you',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    items: [
      {
        title: 'Digital Marketing',
        description: '',
        imageUrl: `${BASE}/services-digital-marketing.png`,
      },
      {
        title: 'Content Writing',
        description: '',
        imageUrl: `${BASE}/services-content-writing.png`,
      },
      {
        title: 'Graphic Design',
        description: '',
        imageUrl: `${BASE}/services-graphic-design.png`,
      },
      {
        title: 'SEO for Business',
        description: '',
        imageUrl: `${BASE}/services-seo.png`,
      },
    ],
  }
}

export function ConsultationServices({
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
    <section className='bg-white px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1.2px] sm:text-[36px] sm:leading-[48px]'
        />
        {content.subtitle || !readOnly ? (
          <GhostInput
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Descrição de apoio'
            readOnly={readOnly}
            className='text-[#161c2d]/70 text-[19px] leading-[1.7] tracking-[-0.2px]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4'>
        {content.items.map((item, index) => (
          <div
            key={index}
            className='group/card relative flex flex-col overflow-hidden rounded-[10px] border border-[#e7e9ed]'
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='secondary'
                size='icon-xs'
                className='absolute top-3 right-3 z-10 opacity-0 group-hover/card:opacity-100'
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
              className='aspect-[255/167] w-full object-cover'
            />

            <div className='relative flex items-center px-[22px] py-[19px]'>
              <GhostLink
                href={hrefOf(content, `item.${index}`, '#footer')}
                onHrefChange={(v) =>
                  onChange?.(withHref(content, `item.${index}`, v))
                }
                readOnly={readOnly}
                className='flex w-full items-center justify-between gap-2'
              >
                <GhostInput
                  as='h3'
                  value={item.title}
                  onCommit={(v) => updateItem(index, { title: v })}
                  placeholder='Serviço'
                  readOnly={readOnly}
                  className='font-normal text-[#161c2d] text-[17px] tracking-[-0.2px]'
                />
                <SteelIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  size={16}
                  className='shrink-0 text-[#161c2d]'
                />
              </GhostLink>
              <img
                src={TAIL}
                alt=''
                aria-hidden
                className='-bottom-[10px] absolute right-[19px] h-[10px] w-[15px]'
              />
            </div>
          </div>
        ))}

        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-[226px] flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed text-muted-foreground text-sm hover:bg-muted/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar serviço
          </button>
        ) : null}
      </div>
    </section>
  )
}
