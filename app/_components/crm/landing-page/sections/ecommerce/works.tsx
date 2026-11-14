'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { SimpleCarousel } from '@/components/ui/simple-carousel'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type WorksContent = Extract<CrmLandingPageSectionContent, { type: 'WORKS' }>

const BASE = '/landing-page-templates/ecommerce'

export function worksDefaultContent(): WorksContent {
  return {
    type: 'WORKS',
    title: 'Compre por ambiente',
    subtitle: 'Categorias',
    items: [
      {
        title: 'Sala de estar',
        category: '23 itens',
        imageUrl: `${BASE}/category-living-room.png`,
      },
      {
        title: 'Sala de jantar',
        category: '36 itens',
        imageUrl: `${BASE}/category-dining-room.png`,
      },
      {
        title: 'Quarto',
        category: '17 itens',
        imageUrl: `${BASE}/category-bed-room.png`,
      },
      {
        title: 'Cozinha',
        category: '11 itens',
        imageUrl: `${BASE}/category-kitchen.png`,
      },
      {
        title: 'Escritório',
        category: '09 itens',
        imageUrl: `${BASE}/category-office.png`,
      },
      {
        title: 'Área externa',
        category: '45 itens',
        imageUrl: `${BASE}/category-outdoor.png`,
      },
    ],
  }
}

export function EcommerceWorks({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<WorksContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ title: string; category: string; imageUrl?: string }>,
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
      items: [...content.items, { title: 'Novo item', category: '' }],
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
        {content.subtitle || !readOnly ? (
          <GhostInput
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Texto de destaque'
            readOnly={readOnly}
            className='font-bold text-[#68d585] text-[13px] uppercase tracking-[1.6px]'
          />
        ) : null}
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
                aria-label='Remover item'
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
            </div>

            <div className='flex flex-col gap-1'>
              <GhostInput
                as='h3'
                value={item.title}
                onCommit={(v) => updateItem(index, { title: v })}
                placeholder='Título'
                readOnly={readOnly}
                className='font-bold text-[#161c2d] text-[24px] tracking-[-0.5px]'
              />
              <GhostInput
                value={item.category}
                onCommit={(v) => updateItem(index, { category: v })}
                placeholder='Categoria'
                readOnly={readOnly}
                className='text-[#161c2d]/70 text-[17px]'
              />
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
            Adicionar item
          </button>
        ) : null}
      </SimpleCarousel>
    </section>
  )
}
