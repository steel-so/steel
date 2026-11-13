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

const BASE = '/landing-page-templates/saas-subscription'

// Os 3 ícones do frame Figma, ciclados por índice — o design de referência
// só define exatamente 3 diferenciais.
const ICONS = [
  `${BASE}/feature-code.svg`,
  `${BASE}/feature-countdown.svg`,
  `${BASE}/feature-smartphone.svg`,
]

export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'Tudo o que você precisa para gerenciar projetos',
    items: [
      {
        title: 'Gestão de projetos',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Controle de horas',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Aplicativo mobile elegante',
        description:
          'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.',
      },
    ],
  }
}

export function SaasSubscriptionFeatures({
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
      <div className='mx-auto mb-14 flex max-w-2xl flex-col items-center gap-4 text-center'>
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
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
        />
      </div>

      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-x-12 gap-y-12 sm:grid-cols-3'>
        {content.items.map((item, index) => {
          const fallbackIcon = ICONS[index % ICONS.length]
          return (
            <div
              key={index}
              className='group/item relative flex flex-col gap-5'
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
              <div className='relative flex h-10 w-11 items-center'>
                <SectionIcon
                  value={item.icon}
                  size={32}
                  fallback={
                    <img
                      src={fallbackIcon}
                      alt=''
                      aria-hidden
                      className='h-full w-auto'
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
              <div className='flex flex-col gap-3'>
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
