'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type FactsContent = Extract<CrmLandingPageSectionContent, { type: 'FACTS' }>

export function consultationFactsDefaultContent(): FactsContent {
  return {
    type: 'FACTS',
    items: [
      { value: '1M+', label: 'Clientes nos visitam todos os meses' },
      { value: '93%', label: 'Índice de satisfação dos nossos clientes.' },
      { value: '4.9', label: 'Nota média dos clientes, em 5,00!' },
    ],
  }
}

export function ConsultationFacts({
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
    <section className='border-[#161c2d]/10 border-b bg-white px-6 py-10 sm:px-10 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-3'>
        {content.items.map((item, index) => (
          <div
            key={index}
            className='group/item relative flex items-center gap-4'
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='-top-3 -right-3 absolute opacity-0 group-hover/item:opacity-100'
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
              className='shrink-0 font-bold text-[#161c2d] text-[36px] tracking-[-1.8px] sm:text-[48px]'
            />
            <GhostInput
              value={item.label}
              onCommit={(v) => updateItem(index, { label: v })}
              placeholder='Descrição da métrica'
              readOnly={readOnly}
              className='max-w-[220px] text-[#161c2d]/70 text-[17px] leading-[1.5] tracking-[-0.2px]'
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
