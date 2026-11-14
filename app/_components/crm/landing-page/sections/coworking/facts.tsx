'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type FactsContent = Extract<CrmLandingPageSectionContent, { type: 'FACTS' }>

export function factsDefaultContent(): FactsContent {
  return {
    type: 'FACTS',
    items: [
      { value: '06', label: 'Escritórios disponíveis em diferentes países' },
      {
        value: '238',
        label: 'Lugares disponíveis agora, com suporte dedicado',
      },
      {
        value: '1,395',
        label: 'Pessoas usando nossos espaços de coworking agora',
      },
    ],
  }
}

export function CoworkingFacts({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FactsContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ value: string; label: string }>,
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
      items: [...content.items, { value: '0', label: 'Métrica' }],
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
      id='facts'
      className='border-[#161c2d]/10 border-b bg-white px-6 py-16 sm:px-10 lg:px-[123px]'
    >
      <div className='mx-auto grid max-w-5xl grid-cols-1 gap-10 sm:grid-cols-3'>
        {content.items.map((item, index) => (
          <div
            key={index}
            className='group/item relative flex flex-col items-center gap-3 text-center'
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-0 right-0 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover métrica'
                onClick={() => removeItem(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}
            <GhostInput
              value={item.value}
              onCommit={(v) => updateItem(index, { value: v })}
              placeholder='0'
              readOnly={readOnly}
              className='text-center font-bold text-[#161c2d] text-[36px] tracking-[-1.8px] sm:text-[48px]'
            />
            <GhostInput
              value={item.label}
              onCommit={(v) => updateItem(index, { label: v })}
              placeholder='Descrição da métrica'
              readOnly={readOnly}
              className='max-w-[260px] text-center text-[#161c2d]/70 text-[19px] leading-[1.7]'
            />
          </div>
        ))}
      </div>
      {!readOnly ? (
        <div className='mt-6 flex justify-center'>
          <Button type='button' variant='outline' size='sm' onClick={addItem}>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar métrica
          </Button>
        </div>
      ) : null}
    </section>
  )
}
