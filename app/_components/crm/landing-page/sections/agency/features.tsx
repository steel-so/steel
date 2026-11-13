'use client'

import {
  Add01Icon,
  Clock01Icon,
  Delete02Icon,
  Layers01Icon,
  Message01Icon,
  UserIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { HugeiconPicker } from '@/app/_components/crm/landing-page/hugeicon-picker'
import { SectionIcon } from '@/app/_components/crm/landing-page/section-icon'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'
import { AGENCY_COLORS } from './colors'

type FeaturesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'FEATURES' }
>

const ICON_VARIANTS = [
  { icon: UserIcon, bg: AGENCY_COLORS.primary },
  { icon: Layers01Icon, bg: AGENCY_COLORS.red },
  { icon: Message01Icon, bg: AGENCY_COLORS.green },
  { icon: Clock01Icon, bg: AGENCY_COLORS.ink },
]

export function featuresDefaultContent(): FeaturesContent {
  return {
    type: 'FEATURES',
    title: 'As pessoas nos escolhem porque entregamos o melhor para todos',
    subtitle: 'Por que nos escolher',
    items: [
      {
        title: 'Gerente de projeto dedicado',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Tarefas organizadas',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Feedback sem complicação',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
      {
        title: 'Prazos sempre cumpridos',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
      },
    ],
    ctaTitle: 'Pronto para lançar o seu próximo projeto?',
    ctaDescription:
      'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
    ctaLabel: 'Iniciar um projeto',
    ctaHref: '#footer',
  }
}

export function AgencyFeatures({
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
    <section className='bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
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

      <div className='mx-auto grid max-w-4xl grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2'>
        {content.items.map((item, index) => {
          const variant = ICON_VARIANTS[index % ICON_VARIANTS.length]
          const Icon = variant.icon
          return (
            <div
              key={index}
              className='group/item relative flex items-start gap-5'
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
              <div
                className='relative flex size-16 shrink-0 items-center justify-center rounded-2xl'
                style={{ backgroundColor: `${variant.bg}1a` }}
              >
                <SectionIcon
                  value={item.icon}
                  size={28}
                  fallback={
                    <SteelIcon
                      icon={Icon}
                      strokeWidth={2}
                      size={28}
                      style={{ color: variant.bg }}
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

      {content.ctaTitle || content.ctaLabel || !readOnly ? (
        <div className='mx-auto mt-16 flex max-w-4xl flex-col items-start justify-between gap-6 border-[#161c2d]/10 border-t pt-10 sm:flex-row sm:items-center'>
          <div className='flex max-w-md flex-col gap-2'>
            <GhostInput
              as='h3'
              value={content.ctaTitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, ctaTitle: v || undefined })
              }
              placeholder='Título da chamada'
              readOnly={readOnly}
              className='font-bold text-[#161c2d] text-[24px] tracking-[-0.7px]'
            />
            <GhostTextarea
              value={content.ctaDescription ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, ctaDescription: v || undefined })
              }
              placeholder='Texto de apoio'
              readOnly={readOnly}
              as='p'
              className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
            />
          </div>

          {content.ctaLabel || !readOnly ? (
            <GhostLink
              href={content.ctaHref}
              onHrefChange={(href) =>
                onChange?.({ ...content, ctaHref: href || undefined })
              }
              readOnly={readOnly}
              data-cta
              className='inline-flex shrink-0 items-center justify-center rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
            >
              <GhostInput
                value={content.ctaLabel ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, ctaLabel: v || undefined })
                }
                placeholder='Texto do botão'
                readOnly={readOnly}
                className='text-inherit'
              />
            </GhostLink>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
