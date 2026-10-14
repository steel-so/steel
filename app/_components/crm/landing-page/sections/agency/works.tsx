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
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type WorksContent = Extract<CrmLandingPageSectionContent, { type: 'WORKS' }>

const BASE = '/landing-page-templates/agency'

export function worksDefaultContent(): WorksContent {
  return {
    type: 'WORKS',
    title: 'Our works describe why we are the best in the business',
    subtitle: 'Case studies',
    items: [
      {
        title: 'Aura Branding Design',
        category: 'Graphic Design',
        imageUrl: `${BASE}/work-1.png`,
      },
      {
        title: 'AB.S Snack Packaging',
        category: 'Graphic Design',
        imageUrl: `${BASE}/work-3.png`,
      },
      {
        title: 'Gradient Website Development',
        category: 'Web Development',
        imageUrl: `${BASE}/work-2.png`,
      },
      {
        title: 'Magazine Content Writing',
        category: 'Content Writing',
        imageUrl: `${BASE}/work-4.png`,
      },
    ],
  }
}

export function AgencyWorks({
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
      items: [...content.items, { title: 'Novo projeto', category: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section
      id='works'
      className='bg-white px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'
    >
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        {content.subtitle || !readOnly ? (
          <GhostInput
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Texto de destaque'
            readOnly={readOnly}
            className='font-bold text-[#f64b4b] text-[13px] uppercase tracking-[1.6px]'
          />
        ) : null}
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
        />
      </div>

      <div className='mx-auto grid max-w-5xl grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-2'>
        {content.items.map((item, index) => (
          <div key={index} className={index % 2 === 1 ? 'sm:mt-20' : undefined}>
            <div className='group/item relative flex flex-col gap-3'>
              {!readOnly ? (
                <Button
                  type='button'
                  variant='secondary'
                  size='icon-xs'
                  className='absolute top-2 right-2 z-10 opacity-0 group-hover/item:opacity-100'
                  aria-label='Remover projeto'
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
                className={
                  index % 2 === 0
                    ? 'aspect-[500/540] w-full rounded-[10px]'
                    : 'aspect-[500/346] w-full rounded-[10px]'
                }
              />
              <GhostInput
                value={item.category}
                onCommit={(v) => updateItem(index, { category: v })}
                placeholder='Categoria'
                readOnly={readOnly}
                className='text-[#161c2d]/70 text-[15px]'
              />
              <GhostInput
                as='h3'
                value={item.title}
                onCommit={(v) => updateItem(index, { title: v })}
                placeholder='Título do projeto'
                readOnly={readOnly}
                className='font-bold text-[#161c2d] text-[24px] tracking-[-0.5px]'
              />
            </div>
          </div>
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-52 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar projeto
          </button>
        ) : null}
      </div>

      <div className='mt-14 flex justify-center'>
        <GhostLink
          href={hrefOf(content, 'more', '#works')}
          onHrefChange={(v) => onChange?.(withHref(content, 'more', v))}
          readOnly={readOnly}
          className='inline-flex items-center gap-2 font-bold text-[#473bf0] text-[21px] tracking-[-1.2px] hover:opacity-80'
        >
          <GhostInput
            value={textOf(content, 'more', 'See all works')}
            onCommit={(v) => onChange?.(withText(content, 'more', v))}
            placeholder='Texto do link'
            readOnly={readOnly}
            className='field-sizing-content w-auto text-inherit'
          />
          <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={18} />
        </GhostLink>
      </div>
    </section>
  )
}
