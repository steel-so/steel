'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { SimpleCarousel } from '@/components/ui/simple-carousel'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type ProductsContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'PRODUCTS' }
>

const BASE = '/landing-page-templates/ecommerce'
const STAR = `${BASE}/star-full.svg`

export function productsDefaultContent(): ProductsContent {
  return {
    type: 'PRODUCTS',
    title: 'Explore All Products',
    items: [
      {
        title: 'Safavieh Couture',
        price: '$899',
        originalPrice: '$1,350',
        imageUrl: `${BASE}/product-safavieh-couture.png`,
      },
      {
        title: 'Fair Trade Ghana',
        price: '$34',
        imageUrl: `${BASE}/product-fair-trade-ghana.png`,
      },
      {
        title: 'KingSo Round Table',
        price: '$44.99',
        imageUrl: `${BASE}/product-kingso-round-table.png`,
      },
      {
        title: 'Porthos Dining Chair',
        price: '$120',
        originalPrice: '$350',
        imageUrl: `${BASE}/product-porthos-dining-chair.png`,
      },
      {
        title: 'Trade Folding Stool',
        price: '$31.49',
        imageUrl: `${BASE}/product-trade-folding-stool.png`,
      },
      {
        title: 'Rivet Accent Chair',
        price: '$120',
        originalPrice: '$350',
        imageUrl: `${BASE}/product-rivet-accent-chair.png`,
      },
      {
        title: 'Armen Living Chair',
        price: '$110',
        originalPrice: '$350',
        imageUrl: `${BASE}/product-armen-living-chair.png`,
      },
      {
        title: 'Knight Chair',
        price: '$120',
        originalPrice: '$350',
        imageUrl: `${BASE}/product-knight-chair.png`,
      },
    ],
  }
}

function Stars() {
  return (
    <div className='flex items-center gap-1' aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <img key={i} src={STAR} alt='' className='h-[15px] w-[17px]' />
      ))}
    </div>
  )
}

export function EcommerceProducts({
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
      items: [...content.items, { title: 'Novo produto', price: '$0' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='bg-white px-6 py-16 sm:px-10 sm:py-20 lg:px-[123px]'>
      <div className='mx-auto mb-12 flex max-w-2xl flex-col items-center gap-3 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[32px]'
        />
      </div>

      <SimpleCarousel trackClassName='mx-auto max-w-6xl'>
        {content.items.map((item, index) => (
          <div
            key={index}
            className='group/item relative flex w-[80vw] shrink-0 snap-start flex-col gap-3 sm:w-56'
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

            <div className='relative aspect-[255/300] w-full overflow-hidden rounded-[10px] bg-[#f4f7fa]'>
              <GhostImage
                value={item.imageUrl}
                onUpload={(file) => handleImage(index, file)}
                readOnly={readOnly}
                alt={item.title}
                className='size-full object-contain p-4'
              />
              {index < 4 ? (
                <div className='absolute bottom-4 left-1/2 -translate-x-1/2'>
                  <GhostLink
                    href={hrefOf(content, `product.${index}.cta`, '#')}
                    onHrefChange={(v) =>
                      onChange?.(withHref(content, `product.${index}.cta`, v))
                    }
                    readOnly={readOnly}
                    className='inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-[#473bf0] px-6 py-3 font-bold text-[15px] text-white tracking-[-0.5px]'
                  >
                    <GhostInput
                      value={textOf(
                        content,
                        `product.${index}.cta`,
                        '+ Add to cart',
                      )}
                      onCommit={(v) =>
                        onChange?.(withText(content, `product.${index}.cta`, v))
                      }
                      placeholder='Texto do botão'
                      readOnly={readOnly}
                      className='field-sizing-content text-inherit'
                    />
                  </GhostLink>
                </div>
              ) : null}
            </div>

            <div className='flex flex-col items-center gap-1 text-center'>
              <Stars />
              <GhostInput
                as='h3'
                value={item.title}
                onCommit={(v) => updateItem(index, { title: v })}
                placeholder='Título do produto'
                readOnly={readOnly}
                className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
              />
              <div className='flex items-center gap-2'>
                <GhostInput
                  value={item.price}
                  onCommit={(v) => updateItem(index, { price: v })}
                  placeholder='$0.00'
                  readOnly={readOnly}
                  className='font-bold text-[#68d585] text-[17px] tracking-[-0.2px]'
                />
                {item.originalPrice || !readOnly ? (
                  <GhostInput
                    value={item.originalPrice ?? ''}
                    onCommit={(v) =>
                      updateItem(index, { originalPrice: v || undefined })
                    }
                    placeholder='$0.00'
                    readOnly={readOnly}
                    className='text-[#161c2d]/70 text-[15px] line-through tracking-[-0.1px]'
                  />
                ) : null}
              </div>
            </div>
          </div>
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-52 w-[80vw] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed text-muted-foreground text-sm hover:bg-muted/40 sm:w-56'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar produto
          </button>
        ) : null}
      </SimpleCarousel>
    </section>
  )
}
