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

const BASE = '/landing-page-templates/coworking'

const ICONS = [
  `${BASE}/feature-desk.svg`,
  `${BASE}/feature-wifi.svg`,
  `${BASE}/feature-mug.svg`,
]

/**
 * Mapeia "Features" (grade de 3 ícones: Dedicated Desk / High Speed Internet
 * / Unlimited Coffee) pro tipo FEATURES. O frame do Figma não tem um título
 * de seção acima dos itens (só os 3 cards) — como `title` é obrigatório no
 * schema, usamos um rótulo pequeno e discreto pra satisfazer o contrato sem
 * adicionar peso visual que não existe no design de referência.
 */
export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'Tudo o que você precisa',
    items: [
      {
        title: 'Mesa Dedicada',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Internet de Alta Velocidade',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Café à Vontade',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
    ],
  }
}

export function CoworkingFeatures({
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
    <section className='bg-white px-6 py-16 sm:px-10 lg:px-[123px]'>
      <GhostInput
        as='h2'
        value={content.title}
        onCommit={(v) => onChange?.({ ...content, title: v })}
        placeholder='Título da seção (não exibido no design de referência)'
        readOnly={readOnly}
        className='mx-auto mb-6 max-w-5xl font-bold text-[#161c2d]/50 text-[13px] uppercase tracking-[1.6px]'
      />

      <div className='mx-auto grid max-w-5xl grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-3'>
        {content.items.map((item, index) => {
          const icon = ICONS[index % ICONS.length]
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
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                </Button>
              ) : null}
              <div className='relative inline-flex'>
                <SectionIcon
                  value={item.icon}
                  size={40}
                  fallback={
                    <img src={icon} alt='' aria-hidden className='h-10 w-11' />
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
          )
        })}
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
