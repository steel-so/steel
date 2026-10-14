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
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type ServicesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'SERVICES' }
>

export function servicesDefaultContent(): ServicesContent {
  return {
    type: 'SERVICES',
    title: 'Jobs by category',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding.',
    items: [
      { title: 'Design', description: '47 Jobs' },
      { title: 'Marketing', description: '51 Jobs' },
      { title: 'Engineering', description: '89 Jobs' },
      { title: 'Management', description: '16 Jobs' },
      { title: 'Finance', description: '23 Jobs' },
      { title: 'Customer Support', description: '34 Jobs' },
    ],
  }
}

export function JobSiteServices({
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
      items: [...content.items, { title: 'Nova categoria', description: '' }],
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
      id='categories'
      className='bg-[#161c2d] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'
    >
      <div className='mx-auto mb-12 flex max-w-6xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-end'>
        <div className='flex max-w-md flex-col gap-3'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[28px] text-white leading-tight tracking-[-1px] sm:text-[36px]'
          />
          {content.subtitle || !readOnly ? (
            <GhostInput
              value={content.subtitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, subtitle: v || undefined })
              }
              placeholder='Descrição de apoio'
              readOnly={readOnly}
              className='text-[19px] text-white/65'
            />
          ) : null}
        </div>

        <GhostLink
          href={hrefOf(content, 'explore', '#categories')}
          onHrefChange={(v) => onChange?.(withHref(content, 'explore', v))}
          readOnly={readOnly}
          className='inline-flex shrink-0 items-center gap-2 font-bold text-[#68d585] text-[17px] tracking-[-0.6px] hover:opacity-80'
        >
          <GhostInput
            value={textOf(content, 'explore', 'Explore all categories')}
            onCommit={(v) => onChange?.(withText(content, 'explore', v))}
            placeholder='Texto do link'
            readOnly={readOnly}
            className='field-sizing-content text-inherit'
          />
          <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={16} />
        </GhostLink>
      </div>

      <div className='mx-auto grid max-w-6xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3'>
        {content.items.map((item, index) => {
          const highlighted = index === 0
          return (
            <div
              key={index}
              className={
                highlighted
                  ? 'group/card relative flex items-center justify-between gap-4 rounded-[10px] bg-[#473bf0] px-8 py-7 shadow-[0_34px_33px_-23px_rgba(22,28,45,0.13)]'
                  : 'group/card relative flex items-center justify-between gap-4 rounded-[10px] bg-white px-8 py-7'
              }
            >
              {!readOnly ? (
                <Button
                  type='button'
                  variant='secondary'
                  size='icon-xs'
                  className='absolute top-3 right-3 opacity-0 group-hover/card:opacity-100'
                  aria-label='Remover categoria'
                  onClick={() => removeItem(index)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                </Button>
              ) : null}

              <div className='flex flex-col gap-2'>
                <GhostInput
                  as='h3'
                  value={item.title}
                  onCommit={(v) => updateItem(index, { title: v })}
                  placeholder='Categoria'
                  readOnly={readOnly}
                  className={
                    highlighted
                      ? 'font-bold text-[21px] text-white tracking-[-0.5px]'
                      : 'font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
                  }
                />
                <GhostInput
                  value={item.description}
                  onCommit={(v) => updateItem(index, { description: v })}
                  placeholder='N Jobs'
                  readOnly={readOnly}
                  className={
                    highlighted
                      ? 'text-[15px] text-white/65'
                      : 'text-[#161c2d]/70 text-[15px]'
                  }
                />
              </div>

              {highlighted ? (
                <span className='flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15'>
                  <SteelIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                    size={18}
                    className='text-white'
                  />
                </span>
              ) : null}
            </div>
          )
        })}

        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-24 flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed border-white/20 text-sm text-white/60 hover:bg-white/5'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar categoria
          </button>
        ) : null}
      </div>
    </section>
  )
}
