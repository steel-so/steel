'use client'

import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'
import { AGENCY_COLORS } from './colors'

type ServicesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'SERVICES' }
>

const BASE = '/landing-page-templates/agency'

// As 3 variantes de card do Figma (cor + ilustração), cicladas por índice —
// o design de referência só define exatamente 3 cards.
const CARD_VARIANTS = [
  {
    bg: AGENCY_COLORS.green,
    illustration: `${BASE}/services-illustration-design.svg`,
  },
  {
    bg: AGENCY_COLORS.primary,
    illustration: `${BASE}/services-illustration-dev-desk.svg`,
    illustrationOverlay: `${BASE}/services-illustration-dev-character.svg`,
  },
  {
    bg: AGENCY_COLORS.red,
    illustration: `${BASE}/services-illustration-writing-board.svg`,
    illustrationOverlay: `${BASE}/services-illustration-writing-character.svg`,
  },
]

export function servicesDefaultContent(): ServicesContent {
  return {
    type: 'SERVICES',
    title: 'We provide great services for our customers based on needs',
    items: [
      {
        title: 'Graphic Design',
        description:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
      },
      {
        title: 'Web Development',
        description:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
      },
      {
        title: 'Content Writing',
        description:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
      },
    ],
  }
}

export function AgencyServices({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<ServicesContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ title: string; description: string }>,
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
      items: [...content.items, { title: 'Novo serviço', description: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='relative overflow-hidden bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div
        aria-hidden
        className='pointer-events-none absolute right-10 bottom-10 hidden h-20 w-40 opacity-60 sm:block'
        style={{
          backgroundImage: `url(${BASE}/dot.svg)`,
          backgroundRepeat: 'repeat',
          backgroundSize: '18px 18px',
        }}
      />

      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          value={textOf(content, 'badge', 'Our services')}
          onCommit={(v) => onChange?.(withText(content, 'badge', v))}
          placeholder='Texto de destaque'
          readOnly={readOnly}
          className='text-center font-bold text-[#f64b4b] text-[13px] uppercase tracking-[1.6px]'
        />
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
        />
      </div>

      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
        {content.items.map((item, index) => {
          const variant = CARD_VARIANTS[index % CARD_VARIANTS.length]
          return (
            <div
              key={index}
              className='group/card relative flex flex-col items-center gap-6 rounded-[10px] px-8 pt-16 pb-10 text-center shadow-[0_32px_54px_0_rgba(22,28,45,0.16)]'
              style={{ backgroundColor: variant.bg }}
            >
              {!readOnly ? (
                <Button
                  type='button'
                  variant='secondary'
                  size='icon-xs'
                  className='absolute top-3 right-3 opacity-0 group-hover/card:opacity-100'
                  aria-label='Remover serviço'
                  onClick={() => removeItem(index)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                </Button>
              ) : null}

              <div className='relative flex h-32 w-full items-center justify-center'>
                <img
                  src={variant.illustration}
                  alt=''
                  aria-hidden
                  className='h-full object-contain'
                />
                {variant.illustrationOverlay ? (
                  <img
                    src={variant.illustrationOverlay}
                    alt=''
                    aria-hidden
                    className='absolute h-24 object-contain'
                  />
                ) : null}
              </div>

              <GhostInput
                as='h3'
                value={item.title}
                onCommit={(v) => updateItem(index, { title: v })}
                placeholder='Título do serviço'
                readOnly={readOnly}
                className='font-bold text-[24px] text-white tracking-[-0.5px]'
              />
              <GhostTextarea
                value={item.description}
                onCommit={(v) => updateItem(index, { description: v })}
                placeholder='Descrição do serviço'
                readOnly={readOnly}
                as='p'
                className='text-[17px] text-white/65 leading-[1.7]'
              />

              <GhostLink
                href={hrefOf(content, `item.${index}.cta`, '#footer')}
                onHrefChange={(v) =>
                  onChange?.(withHref(content, `item.${index}.cta`, v))
                }
                readOnly={readOnly}
                data-cta
                className='mt-2 inline-flex items-center gap-2 font-bold text-[17px] text-white tracking-[-0.6px] hover:opacity-90'
              >
                <GhostInput
                  value={textOf(content, `item.${index}.cta`, 'Learn more')}
                  onCommit={(v) =>
                    onChange?.(withText(content, `item.${index}.cta`, v))
                  }
                  placeholder='Texto do link'
                  readOnly={readOnly}
                  className='field-sizing-content w-auto text-inherit'
                />
                <SteelIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2.5}
                  size={16}
                />
              </GhostLink>
            </div>
          )
        })}

        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-[300px] flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed text-muted-foreground text-sm hover:bg-background'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar serviço
          </button>
        ) : null}
      </div>
    </section>
  )
}
