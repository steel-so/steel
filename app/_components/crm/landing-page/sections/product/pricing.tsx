'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type ProductsContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'PRODUCTS' }
>

const BASE = '/landing-page-templates/product'

/**
 * Fiel ao frame "Pricing" — 3 variantes de cor do mesmo AirPods, não planos
 * tiered, então o tipo PRODUCTS encaixa melhor que PRICING (ver instrução
 * do orquestrador). A cor entra no `title` de cada item; o texto
 * "AirPods (2nd gen)…", o "Buy now -" e o destino do botão não têm campo
 * no schema (`ProductItemSchema` só tem title/price/originalPrice/rating/
 * imageUrl), então ficam nos overrides `item.<i>.description`/`item.<i>.cta`
 * por índice. O "CTA Image" (a foto full-bleed do frame que fecha a seção,
 * sem texto próprio) segue como decoração fixa.
 */
export function pricingDefaultContent(): ProductsContent {
  return {
    type: 'PRODUCTS',
    title: 'Get your airpod now.',
    subtitle:
      'We share common trends and strategies for improving your rental income.',
    items: [
      {
        title: 'AirPods — Midnight Green',
        price: '$99',
        imageUrl: `${BASE}/product-midnight-green.png`,
      },
      {
        title: 'AirPods — Silver',
        price: '$99',
        imageUrl: `${BASE}/product-silver.png`,
      },
      {
        title: 'AirPods — Gold',
        price: '$99',
        imageUrl: `${BASE}/product-gold.png`,
      },
    ],
  }
}

export function ProductPricing({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<ProductsContent>) {
  function updateItem(
    index: number,
    patch: Partial<{
      title: string
      price: string
      originalPrice?: string
      imageUrl?: string
    }>,
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
      items: [...content.items, { title: 'AirPods — Nova cor', price: '$99' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section id='pricing' className='bg-white px-6 py-20 sm:px-10 sm:py-28'>
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[32px] leading-tight tracking-[-1.2px] sm:text-[40px]'
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
            className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-5xl grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-3'>
        {content.items.map((item, index) => (
          <div
            key={index}
            className='group/item relative flex flex-col items-center gap-4 text-center'
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='secondary'
                size='icon-xs'
                className='absolute top-2 right-2 z-10 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover produto'
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
              className='aspect-[226/155] w-full max-w-[226px] rounded-lg bg-white object-contain'
            />
            <GhostTextarea
              value={textOf(
                content,
                `item.${index}.description`,
                'AirPods (2nd gen) iPhone Colors with Wireless Charging Case',
              )}
              onCommit={(v) =>
                onChange?.(withText(content, `item.${index}.description`, v))
              }
              placeholder='Descrição do produto'
              readOnly={readOnly}
              as='p'
              className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
            />
            <GhostInput
              value={item.title}
              onCommit={(v) => updateItem(index, { title: v })}
              placeholder='Nome do produto'
              readOnly={readOnly}
              className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
            />
            <GhostLink
              href={hrefOf(content, `item.${index}.cta`, '#pricing')}
              onHrefChange={(v) =>
                onChange?.(withHref(content, `item.${index}.cta`, v))
              }
              readOnly={readOnly}
              data-cta
              className='inline-flex items-center justify-center gap-1 rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.5px] transition-opacity hover:opacity-90'
            >
              <GhostInput
                value={textOf(content, `item.${index}.cta`, 'Buy now -')}
                onCommit={(v) =>
                  onChange?.(withText(content, `item.${index}.cta`, v))
                }
                placeholder='Texto do botão'
                readOnly={readOnly}
                className='field-sizing-content w-auto text-inherit'
              />
              <GhostInput
                value={item.price}
                onCommit={(v) => updateItem(index, { price: v })}
                placeholder='$0'
                readOnly={readOnly}
                className='field-sizing-content w-auto text-inherit'
              />
            </GhostLink>
          </div>
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-52 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar produto
          </button>
        ) : null}
      </div>

      <img
        src={`${BASE}/pricing-cta-band.jpg`}
        alt=''
        aria-hidden
        className='mx-auto mt-24 aspect-[1600/792] w-full max-w-6xl rounded-[24px] object-cover'
      />
    </section>
  )
}
