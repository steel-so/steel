'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from './types'

type FeaturesContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'FEATURES' }
>

export function featuresDefaultContent(): FeaturesContent {
  return { type: 'FEATURES', title: 'Por que nos escolher', items: [] }
}

export function FeaturesSection({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FeaturesContent>) {
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
    <section className='flex flex-col items-center gap-10 rounded-2xl bg-muted/30 px-6 py-16 sm:px-12'>
      <div className='flex max-w-xl flex-col items-center gap-3 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='font-semibold text-2xl tracking-tight sm:text-3xl'
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
            className='text-balance text-muted-foreground text-sm sm:text-base'
          />
        ) : null}
      </div>

      <div className='grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2'>
        {content.items.map((item, index) => (
          <div
            key={index}
            className='group/item relative flex flex-col gap-1 rounded-xl border bg-card p-5'
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-2 right-2 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover diferencial'
                onClick={() => removeItem(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}
            <GhostInput
              as='h3'
              value={item.title}
              onCommit={(v) => updateItem(index, { title: v })}
              placeholder='Título'
              readOnly={readOnly}
              className='font-medium text-base'
            />
            <GhostTextarea
              value={item.description}
              onCommit={(v) => updateItem(index, { description: v })}
              placeholder='Descrição'
              readOnly={readOnly}
              as='p'
              className='text-muted-foreground text-sm'
            />
          </div>
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-background'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar diferencial
          </button>
        ) : null}
      </div>

      {content.ctaLabel || !readOnly ? (
        <GhostLink
          href={content.ctaHref}
          onHrefChange={(href) =>
            onChange?.({ ...content, ctaHref: href || undefined })
          }
          readOnly={readOnly}
          data-cta
          className='inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground text-sm'
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
    </section>
  )
}
