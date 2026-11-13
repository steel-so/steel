'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type WorksContent = Extract<CrmLandingPageSectionContent, { type: 'WORKS' }>

const BASE = '/landing-page-templates/coworking'

/**
 * Mapeia "Locations" (grade de 3 salas de coworking populares) pro tipo
 * WORKS — `category` carrega o número de assentos ("37 seats") em vez de uma
 * categoria de projeto, já que o schema é genérico o bastante pra isso.
 */
export function worksDefaultContent(): WorksContent {
  return {
    type: 'WORKS',
    title: 'Locais mais procurados',
    subtitle:
      'Com vários blocos prontos, você monta sua página facilmente, sem escrever código.',
    items: [
      {
        title: 'Beauview',
        category: '37 lugares',
        imageUrl: `${BASE}/location-1.jpg`,
      },
      {
        title: 'Haleyborough',
        category: '12 lugares',
        imageUrl: `${BASE}/location-2.jpg`,
      },
      {
        title: 'Jeromyshire',
        category: '28 lugares',
        imageUrl: `${BASE}/location-3.jpg`,
      },
    ],
  }
}

export function CoworkingLocations({
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
      items: [...content.items, { title: 'Nova sala', category: '' }],
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
      id='locations'
      className='bg-white px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'
    >
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[36px] leading-tight tracking-[-1.8px] sm:text-[48px] sm:leading-[58px]'
        />
        {content.subtitle || !readOnly ? (
          <GhostInput
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Subtítulo'
            readOnly={readOnly}
            className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-3'>
        {content.items.map((item, index) => (
          <div key={index} className='group/item relative flex flex-col gap-4'>
            {!readOnly ? (
              <Button
                type='button'
                variant='secondary'
                size='icon-xs'
                className='absolute top-2 right-2 z-10 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover local'
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
              className='aspect-[350/469] w-full rounded-[10px] shadow-[0px_32px_54px_0px_rgba(22,28,45,0.16)]'
            />
            <div className='flex flex-col items-center gap-1 text-center'>
              <GhostInput
                as='h3'
                value={item.title}
                onCommit={(v) => updateItem(index, { title: v })}
                placeholder='Nome da sala'
                readOnly={readOnly}
                className='text-center font-bold text-[#161c2d] text-[24px] tracking-[-0.5px]'
              />
              <GhostInput
                value={item.category}
                onCommit={(v) => updateItem(index, { category: v })}
                placeholder='Assentos'
                readOnly={readOnly}
                className='text-center text-[#161c2d]/70 text-[17px]'
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
            Adicionar local
          </button>
        ) : null}
      </div>
    </section>
  )
}
