'use client'

import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { cn } from '@/lib/utils'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type PricingContent = Extract<CrmLandingPageSectionContent, { type: 'PRICING' }>
type Plan = PricingContent['plans'][number]

export function pricingDefaultContent(): PricingContent {
  return {
    type: 'PRICING',
    title: 'Pricing & Plans',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    plans: [
      {
        name: 'Starter',
        price: '$19',
        period: '/ month',
        yearlyPrice: '$190',
        yearlyPeriod: '/ year',
        features: [
          'Commercial License',
          '100+ HTML UI Elements',
          '01 Domain Support',
        ],
        ctaLabel: 'Start Free Trial',
        highlighted: false,
      },
      {
        name: 'Standard',
        price: '$49',
        period: '/ month',
        yearlyPrice: '$490',
        yearlyPeriod: '/ year',
        features: [
          'Commercial License',
          '100+ HTML UI Elements',
          'Unlimited Domain Support',
          '6 Month Premium Support',
        ],
        ctaLabel: 'Start Free Trial',
        highlighted: true,
      },
      {
        name: 'Premium',
        price: '$99',
        period: '/ month',
        yearlyPrice: '$990',
        yearlyPeriod: '/ year',
        features: [
          'Commercial License',
          '100+ HTML UI Elements',
          'Unlimited Domain Support',
          '6 Month Premium Support',
          'Lifetime Updates',
        ],
        ctaLabel: 'Start Free Trial',
        highlighted: false,
      },
    ],
  }
}

export function WebApplicationPricing({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<PricingContent>) {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly')
  const isYearly = billing === 'yearly'

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
        {
          name: 'Plano',
          price: '$0',
          period: '/ month',
          features: [],
          highlighted: false,
        },
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
    <section className='bg-[#ecf2f7] px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto mb-14 flex max-w-xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px]'
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
            className='text-balance text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}

        {/* Toggle mensal/anual — pill switch do frame "Full toggle" do Figma.
            Alterna qual par (price/period ou yearlyPrice/yearlyPeriod) fica
            visível e editável em cada card abaixo. */}
        <div className='mt-2 inline-flex items-center gap-1 rounded-full border border-[#e7e9ed] bg-white p-1'>
          <BillingOption
            active={!isYearly}
            label={textOf(content, 'toggle.monthly', 'Monthly')}
            onSelect={() => setBilling('monthly')}
            onLabelCommit={(v) =>
              onChange?.(withText(content, 'toggle.monthly', v))
            }
            readOnly={readOnly}
          />
          <BillingOption
            active={isYearly}
            label={textOf(content, 'toggle.yearly', 'Yearly')}
            onSelect={() => setBilling('yearly')}
            onLabelCommit={(v) =>
              onChange?.(withText(content, 'toggle.yearly', v))
            }
            readOnly={readOnly}
          />
        </div>
      </div>

      <div className='mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3'>
        {content.plans.map((plan, planIndex) => {
          // O par editado segue o toggle (permite criar o valor anual pela
          // primeira vez); o valor mostrado cai pro mensal enquanto o anual
          // não existir, pra nunca renderizar em branco.
          const priceField: 'price' | 'yearlyPrice' = isYearly
            ? 'yearlyPrice'
            : 'price'
          const periodField: 'period' | 'yearlyPeriod' = isYearly
            ? 'yearlyPeriod'
            : 'period'
          const hasYearly = Boolean(plan.yearlyPrice)
          const billingNoteKey =
            isYearly && hasYearly ? 'billing.yearly' : 'billing.monthly'
          const displayPrice = isYearly
            ? (plan.yearlyPrice ?? plan.price)
            : plan.price
          const displayPeriod = isYearly
            ? (plan.yearlyPeriod ?? plan.period)
            : plan.period

          return (
            <div
              key={planIndex}
              className={cn(
                'group/item relative flex flex-col gap-5 rounded-[10px] border border-[#e7e9ed] bg-white p-8',
                plan.highlighted &&
                  'shadow-[0px_42px_44px_-10px_rgba(1,23,48,0.12)]',
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
                className='font-bold text-[#473bf0] text-[13px] uppercase tracking-[1.6px]'
              />
              <div className='flex items-baseline gap-1'>
                <GhostInput
                  value={textOf(content, 'currency', '$')}
                  onCommit={(v) => onChange?.(withText(content, 'currency', v))}
                  placeholder='$'
                  readOnly={readOnly}
                  className='field-sizing-content w-auto font-bold text-[#161c2d] text-[24px]'
                />
                <GhostInput
                  value={displayPrice.replace(/^\$/, '')}
                  onCommit={(v) =>
                    updatePlan(planIndex, {
                      [priceField]: `$${v.replace(/^\$/, '')}`,
                    })
                  }
                  placeholder={isYearly ? '190' : '19'}
                  readOnly={readOnly}
                  className='font-bold text-[#161c2d] text-[60px] tracking-[-2px]'
                />
                {displayPeriod || !readOnly ? (
                  <GhostInput
                    value={displayPeriod ?? ''}
                    onCommit={(v) =>
                      updatePlan(planIndex, { [periodField]: v || undefined })
                    }
                    placeholder={isYearly ? '/ year' : '/ month'}
                    readOnly={readOnly}
                    className='text-[#161c2d] text-[17px]'
                  />
                ) : null}
              </div>
              <GhostInput
                key={billingNoteKey}
                as='p'
                value={textOf(
                  content,
                  billingNoteKey,
                  billingNoteKey === 'billing.yearly'
                    ? 'billed yearly'
                    : 'billed monthly',
                )}
                onCommit={(v) =>
                  onChange?.(withText(content, billingNoteKey, v))
                }
                placeholder='Cobrança'
                readOnly={readOnly}
                className='text-[#161c2d]/70 text-[15px]'
              />

              <ul className='flex flex-col gap-3'>
                {plan.features.map((feature, featureIndex) => (
                  <li
                    key={featureIndex}
                    className='group/feature flex items-center gap-2'
                  >
                    <SteelIcon
                      icon={Tick02Icon}
                      strokeWidth={2}
                      size={17}
                      className='shrink-0 text-[#68d585]'
                    />
                    <GhostInput
                      value={feature}
                      onCommit={(v) =>
                        updateFeature(planIndex, featureIndex, v)
                      }
                      readOnly={readOnly}
                      className='text-[#161c2d] text-[17px]'
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
                  className={cn(
                    'mt-auto inline-flex items-center justify-center gap-2 rounded-lg px-6 py-4 font-bold text-[17px] tracking-[-0.6px] transition-opacity hover:opacity-90',
                    plan.highlighted
                      ? 'bg-[#473bf0] text-white'
                      : 'bg-[#473bf0]/8 text-[#473bf0]',
                  )}
                >
                  <GhostInput
                    value={plan.ctaLabel ?? ''}
                    onCommit={(v) =>
                      updatePlan(planIndex, { ctaLabel: v || undefined })
                    }
                    placeholder='Start Free Trial'
                    readOnly={readOnly}
                    className='text-inherit'
                  />
                  <SteelIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2.5}
                    size={16}
                  />
                </GhostLink>
              ) : null}

              <GhostInput
                as='p'
                value={textOf(
                  content,
                  `plan.${planIndex}.note`,
                  'No credit card required',
                )}
                onCommit={(v) =>
                  onChange?.(withText(content, `plan.${planIndex}.note`, v))
                }
                placeholder='Observação'
                readOnly={readOnly}
                className='text-center text-[#161c2d]/50 text-[13px]'
              />
            </div>
          )
        })}
        {!readOnly ? (
          <button
            type='button'
            onClick={addPlan}
            className='flex min-h-52 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed text-muted-foreground text-sm hover:bg-white/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar plano
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * One pill of the monthly/yearly switch. A `<button>` can't host an
 * `<input>`, so in edit mode the pill is a plain element that still switches
 * the period on click/focus while its label stays editable in place.
 */
function BillingOption({
  active,
  label,
  onSelect,
  onLabelCommit,
  readOnly,
}: {
  active: boolean
  label: string
  onSelect: () => void
  onLabelCommit: (value: string) => void
  readOnly?: boolean
}) {
  const className = cn(
    'rounded-full px-5 py-2 font-bold text-[15px] transition-colors',
    active
      ? 'bg-[#473bf0] text-white'
      : 'text-[#161c2d]/60 hover:text-[#161c2d]',
  )

  if (readOnly) {
    return (
      <button type='button' onClick={onSelect} className={className}>
        {label}
      </button>
    )
  }

  return (
    <div onClick={onSelect} onFocusCapture={onSelect} className={className}>
      <GhostInput
        value={label}
        onCommit={onLabelCommit}
        placeholder='Rótulo'
        className='field-sizing-content w-auto text-inherit'
      />
    </div>
  )
}
