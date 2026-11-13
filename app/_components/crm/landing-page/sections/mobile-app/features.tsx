'use client'

import {
  Add01Icon,
  Clock01Icon,
  CreditCardIcon,
  Delete02Icon,
  Route01Icon,
  Share01Icon,
  UserGroupIcon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { HugeiconPicker } from '@/app/_components/crm/landing-page/hugeicon-picker'
import { SectionIcon } from '@/app/_components/crm/landing-page/section-icon'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import {
  MOBILE_APP_COLORS,
  MOBILE_APP_NAVY_GRADIENT,
} from '@/src/lib/landing-page-templates/mobile-app/colors'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type FeaturesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'FEATURES' }
>

const WAVE = '/landing-page-templates/mobile-app/features-wave.svg'

const ICONS = [
  Route01Icon,
  UserGroupIcon,
  Share01Icon,
  Video01Icon,
  Clock01Icon,
  CreditCardIcon,
]

export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'Criamos este app para resolver os seus problemas.',
    items: [
      {
        title: 'Projetos ilimitados',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
      },
      {
        title: 'Gestão de equipes',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
      },
      {
        title: 'Compartilhamento de arquivos',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
      },
      {
        title: 'Reuniões em vídeo',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
      },
      {
        title: 'Controle de horas',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
      },
      {
        title: 'Sistema de pagamentos',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
      },
    ],
  }
}

export function MobileAppFeatures({
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
    <section
      style={{ backgroundImage: MOBILE_APP_NAVY_GRADIENT }}
      className='relative px-6 pt-24 pb-20 sm:px-10 sm:pb-28 lg:px-[123px]'
    >
      <img
        src={WAVE}
        alt=''
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-auto w-full'
      />

      <div className='relative mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[32px] text-white leading-tight tracking-[-1.5px] sm:text-[48px]'
        />
      </div>

      <div className='relative mx-auto grid max-w-5xl grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-3'>
        {content.items.map((item, index) => {
          const Icon = ICONS[index % ICONS.length]
          return (
            <div
              key={index}
              className='group/item relative flex items-start gap-4'
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
              <div className='relative mt-1 shrink-0'>
                <SectionIcon
                  value={item.icon}
                  size={24}
                  fallback={
                    <SteelIcon
                      icon={Icon}
                      strokeWidth={2}
                      size={24}
                      color={MOBILE_APP_COLORS.green}
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
                  className='font-bold text-[17px] text-white tracking-[-0.4px]'
                />
                <GhostTextarea
                  value={item.description}
                  onCommit={(v) => updateItem(index, { description: v })}
                  placeholder='Descrição'
                  readOnly={readOnly}
                  as='p'
                  className='text-[15px] text-white/65 leading-[1.6]'
                />
              </div>
            </div>
          )
        })}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-24 items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 text-sm text-white/60 hover:bg-white/5'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar diferencial
          </button>
        ) : null}
      </div>
    </section>
  )
}
