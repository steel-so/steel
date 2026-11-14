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

type FeaturesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'FEATURES' }
>

const BASE = '/landing-page-templates/web-application'

const ICONS = [
  `${BASE}/feature-layers.svg`,
  `${BASE}/feature-sync.svg`,
  `${BASE}/feature-chart.svg`,
]

export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'Organize suas campanhas',
    items: [
      {
        title: 'Organize suas campanhas',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Gerencie clientes',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Acompanhe o progresso com agilidade',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
      },
    ],
  }
}

/**
 * Título da seção não aparece no frame Figma (o bloco "Features" só tem os
 * 3 cards) — mantemos `title` (obrigatório no schema) preenchido com o
 * primeiro item pra não quebrar a validação, mas o componente não o
 * renderiza sozinho; cada card já mostra seu próprio título.
 */
export function WebApplicationFeatures({
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
    <section className='bg-white px-6 py-12 sm:px-10 lg:px-[123px]'>
      <div className='mx-auto grid max-w-[1112px] grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-3'>
        {content.items.map((item, index) => (
          <div key={index} className='group/item relative flex flex-col gap-4'>
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-0 right-0 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover diferencial'
                onClick={() => removeItem(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}
            <div className='relative flex size-[34px] shrink-0 items-center justify-center'>
              <SectionIcon
                value={item.icon}
                size={34}
                fallback={
                  <img
                    src={ICONS[index % ICONS.length]}
                    alt=''
                    aria-hidden
                    className='h-[34px] w-[34px]'
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
            <div className='flex flex-col gap-2'>
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
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-24 items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar diferencial
          </button>
        ) : null}
      </div>
    </section>
  )
}
