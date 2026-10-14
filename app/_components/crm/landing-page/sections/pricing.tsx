'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { cn } from '@/lib/utils'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from './types'

type PricingContent = Extract<CrmLandingPageSectionContent, { type: 'PRICING' }>
type Plan = PricingContent['plans'][number]

export function pricingDefaultContent(): PricingContent {
  return { type: 'PRICING', title: 'Planos e preços', plans: [] }
}

export function PricingSection({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<PricingContent>) {
  function updatePlan(index: number, patch: Partial<Plan>) {
    onChange?.({
      ...content,
      plans: content.plans.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    })
  }

  function addPlan() {
    onChange?.({
      ...content,
      plans: [
        ...content.plans,
        { name: 'Plano', price: '$0', features: [], highlighted: false },
      ],
    })
  }

  function removePlan(index: number) {
    onChange?.({
      ...content,
      plans: content.plans.filter((_, i) => i !== index),
    })
  }

  function updateFeature(planIndex: number, featureIndex: number, v: string) {
    const plan = content.plans[planIndex]
    if (!plan) return
    updatePlan(planIndex, {
      features: plan.features.map((f, i) => (i === featureIndex ? v : f)),
    })
  }

  function addFeature(planIndex: number) {
    const plan = content.plans[planIndex]
    if (!plan) return
    updatePlan(planIndex, { features: [...plan.features, 'Novo benefício'] })
  }

  function removeFeature(planIndex: number, featureIndex: number) {
    const plan = content.plans[planIndex]
    if (!plan) return
    updatePlan(planIndex, {
      features: plan.features.filter((_, i) => i !== featureIndex),
    })
  }

  return (
    <section className='flex flex-col items-center gap-10 px-6 py-16 sm:px-12'>
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

      <div className='grid w-full max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3'>
        {content.plans.map((plan, planIndex) => (
          <div
            key={planIndex}
            className={cn(
              'group/item relative flex flex-col gap-4 rounded-xl border p-6',
              plan.highlighted && 'border-primary bg-primary/5',
            )}
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-2 right-2 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover plano'
                onClick={() => removePlan(planIndex)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}
            <GhostInput
              value={plan.name}
              onCommit={(v) => updatePlan(planIndex, { name: v })}
              placeholder='Nome do plano'
              readOnly={readOnly}
              className='font-medium text-sm uppercase tracking-wide'
            />
            <div className='flex items-baseline gap-1'>
              <GhostInput
                value={plan.price}
                onCommit={(v) => updatePlan(planIndex, { price: v })}
                placeholder='$0'
                readOnly={readOnly}
                className='font-semibold text-3xl'
              />
              {plan.period || !readOnly ? (
                <GhostInput
                  value={plan.period ?? ''}
                  onCommit={(v) =>
                    updatePlan(planIndex, { period: v || undefined })
                  }
                  placeholder='/ mês'
                  readOnly={readOnly}
                  className='text-muted-foreground text-sm'
                />
              ) : null}
            </div>

            <ul className='flex flex-col gap-2'>
              {plan.features.map((feature, featureIndex) => (
                <li
                  key={featureIndex}
                  className='group/feature flex items-center gap-1'
                >
                  <GhostInput
                    value={feature}
                    onCommit={(v) => updateFeature(planIndex, featureIndex, v)}
                    readOnly={readOnly}
                    className='text-sm'
                  />
                  {!readOnly ? (
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-xs'
                      className='opacity-0 group-hover/feature:opacity-100'
                      aria-label='Remover benefício'
                      onClick={() => removeFeature(planIndex, featureIndex)}
                    >
                      <SteelIcon
                        icon={Delete02Icon}
                        strokeWidth={2}
                        size={12}
                      />
                    </Button>
                  ) : null}
                </li>
              ))}
              {!readOnly ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label='Adicionar benefício'
                  onClick={() => addFeature(planIndex)}
                >
                  <SteelIcon icon={Add01Icon} strokeWidth={2} size={12} />
                </Button>
              ) : null}
            </ul>

            {plan.ctaLabel || !readOnly ? (
              <GhostLink
                href={plan.ctaHref}
                onHrefChange={(href) =>
                  updatePlan(planIndex, { ctaHref: href || undefined })
                }
                readOnly={readOnly}
                data-cta
                className='mt-auto inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground text-sm'
              >
                <GhostInput
                  value={plan.ctaLabel ?? ''}
                  onCommit={(v) =>
                    updatePlan(planIndex, { ctaLabel: v || undefined })
                  }
                  placeholder='Assinar'
                  readOnly={readOnly}
                  className='text-inherit'
                />
              </GhostLink>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addPlan}
            className='flex min-h-52 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar plano
          </button>
        ) : null}
      </div>
    </section>
  )
}
