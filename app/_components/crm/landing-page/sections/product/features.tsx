'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { HugeiconPicker } from '@/app/_components/crm/landing-page/hugeicon-picker'
import { SectionIcon } from '@/app/_components/crm/landing-page/section-icon'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'
import { PRODUCT_COLORS } from './colors'

type FeaturesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'FEATURES' }
>

const BASE = '/landing-page-templates/product'
const DEFAULT_PHOTO = `${BASE}/features-runner.jpg`

const ICON_VARIANTS = [
  { icon: `${BASE}/icon-earbuds.svg`, bg: PRODUCT_COLORS.primary },
  { icon: `${BASE}/icon-soundwave.svg`, bg: PRODUCT_COLORS.red },
]

export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'Ouça música a qualquer hora, em qualquer lugar.',
    subtitle:
      'Compartilhamos tendências e estratégias para você melhorar seus resultados.',
    items: [
      {
        title: 'Fones confortáveis',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código.',
      },
      {
        title: 'Graves potentes',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código.',
      },
    ],
  }
}

export function ProductFeatures({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FeaturesContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ title: string; description: string; icon: string }>,
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
    <section className='bg-[#f4f7fa]'>
      <div className='grid grid-cols-1 lg:grid-cols-2'>
        <div className='relative bg-[#fde7c3]'>
          {/* Foto decorativa, fiel ao frame — FEATURES não tem campo de
          imagem no schema, então fica fixa (não editável) igual aos SVGs
          decorativos do Agency. */}
          <img
            src={DEFAULT_PHOTO}
            alt=''
            aria-hidden
            className='aspect-[632/948] w-full object-cover'
          />
        </div>

        <div className='flex flex-col justify-center gap-8 px-6 py-16 sm:px-10 sm:py-20 lg:px-16'>
          <div className='flex flex-col gap-4'>
            <GhostInput
              as='h2'
              value={content.title}
              onCommit={(v) => onChange?.({ ...content, title: v })}
              placeholder='Título da seção'
              readOnly={readOnly}
              className='text-balance font-bold text-[#161c2d] text-[32px] leading-tight tracking-[-1.2px] sm:text-[40px] sm:leading-[48px]'
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
                className='max-w-md text-[#161c2d]/70 text-[19px] leading-[1.7]'
              />
            ) : null}
          </div>

          <div className='grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2'>
            {content.items.map((item, index) => {
              const variant = ICON_VARIANTS[index % ICON_VARIANTS.length]
              return (
                <div
                  key={index}
                  className='group/item relative flex flex-col gap-3'
                >
                  {!readOnly ? (
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      className='absolute top-0 right-0 opacity-0 group-hover/item:opacity-100'
                      aria-label='Remover diferencial'
                      onClick={() => removeItem(index)}
                    >
                      <SteelIcon
                        icon={Delete02Icon}
                        strokeWidth={2}
                        size={14}
                      />
                    </Button>
                  ) : null}
                  <div
                    className='relative flex size-10 shrink-0 items-center justify-center rounded-full'
                    style={{ backgroundColor: `${variant.bg}4d` }}
                  >
                    <SectionIcon
                      value={item.icon}
                      size={20}
                      fallback={
                        <img
                          src={variant.icon}
                          alt=''
                          aria-hidden
                          className='size-5'
                        />
                      }
                    />
                    {!readOnly ? (
                      <div className='-bottom-2 -right-2 absolute opacity-0 transition-opacity group-hover/item:opacity-100'>
                        <HugeiconPicker
                          value={item.icon}
                          onSelect={(icon) => updateItem(index, { icon })}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className='flex flex-col gap-1'>
                    <GhostInput
                      as='h3'
                      value={item.title}
                      onCommit={(v) => updateItem(index, { title: v })}
                      placeholder='Título'
                      readOnly={readOnly}
                      className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
                    />
                    <GhostTextarea
                      value={item.description}
                      onCommit={(v) => updateItem(index, { description: v })}
                      placeholder='Descrição'
                      readOnly={readOnly}
                      as='p'
                      className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
                    />
                  </div>
                </div>
              )
            })}
            {!readOnly ? (
              <button
                type='button'
                onClick={addItem}
                className='flex min-h-24 items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-background'
              >
                <SteelIcon icon={Add01Icon} strokeWidth={2} />
                Adicionar diferencial
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
