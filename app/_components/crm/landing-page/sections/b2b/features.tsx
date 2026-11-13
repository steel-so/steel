'use client'

import {
  Add01Icon,
  Delete02Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { HugeiconPicker } from '@/app/_components/crm/landing-page/hugeicon-picker'
import { SectionIcon } from '@/app/_components/crm/landing-page/section-icon'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type FeaturesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'FEATURES' }
>

const BASE = '/landing-page-templates/b2b'

export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'Motivos para nos escolher e crescer hoje mesmo.',
    subtitle:
      'Compartilhamos tendências e estratégias para aumentar a sua receita e manter a sua empresa sempre em alta demanda.',
    items: [
      { title: 'Totalmente Responsivo', description: '' },
      { title: 'Layouts Elegantes', description: '' },
      { title: 'Fácil de Editar', description: '' },
      { title: 'Fontes do Google Incluídas', description: '' },
    ],
  }
}

export function B2bFeatures({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FeaturesContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ title: string; icon: string }>,
  ) {
    onChange?.({
      ...content,
      items: content.items.map((it, i) =>
        i === index ? { ...it, ...patch } : it,
      ),
    })
  }

  function addItem() {
    onChange?.({
      ...content,
      items: [...content.items, { title: 'Novo diferencial', description: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='overflow-hidden bg-white px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2'>
        <div className='relative mx-auto w-full max-w-sm'>
          <div
            aria-hidden
            className='-translate-x-1/4 absolute top-6 left-0 size-64 rounded-full bg-[#68d585]'
          />
          {/* FEATURES não tem campo `imageUrl` no schema compartilhado (só
              HERO/ABOUT/STEPS têm) — a task pede pra estender o componente
              visualmente sem tocar no schema, então a foto do "Content 02"
              fica fixa (não editável via conteúdo) nesta variante. */}
          <img
            src={`${BASE}/content02-photo.png`}
            alt=''
            className='relative aspect-[389/744] w-full object-cover object-top'
          />
        </div>

        <div className='flex flex-col gap-8'>
          <div className='flex flex-col gap-4'>
            <GhostInput
              as='h2'
              value={content.title}
              onCommit={(v) => onChange?.({ ...content, title: v })}
              placeholder='Título da seção'
              readOnly={readOnly}
              className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
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

          <div className='grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2'>
            {content.items.map((item, index) => (
              <div
                key={index}
                className='group/item relative flex items-center gap-3'
              >
                {!readOnly ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    className='-top-2 -right-2 absolute opacity-0 group-hover/item:opacity-100'
                    aria-label='Remover diferencial'
                    onClick={() => removeItem(index)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                  </Button>
                ) : null}
                <div className='relative shrink-0'>
                  <SectionIcon
                    value={item.icon}
                    size={18}
                    fallback={
                      <SteelIcon
                        icon={Tick02Icon}
                        strokeWidth={2.5}
                        size={18}
                        className='text-[#473bf0]'
                      />
                    }
                  />
                  {!readOnly ? (
                    <div className='-bottom-3 -right-3 absolute opacity-0 transition-opacity group-hover/item:opacity-100'>
                      <HugeiconPicker
                        value={item.icon}
                        onSelect={(icon) => updateItem(index, { icon })}
                      />
                    </div>
                  ) : null}
                </div>
                <GhostInput
                  value={item.title}
                  onCommit={(v) => updateItem(index, { title: v })}
                  placeholder='Título'
                  readOnly={readOnly}
                  className='font-bold text-[#161c2d] text-[19px]'
                />
              </div>
            ))}
            {!readOnly ? (
              <button
                type='button'
                onClick={addItem}
                className='flex min-h-10 items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
              >
                <SteelIcon icon={Add01Icon} strokeWidth={2} />
                Adicionar
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
