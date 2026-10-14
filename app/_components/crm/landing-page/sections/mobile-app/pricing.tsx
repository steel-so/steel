'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { cn } from '@/lib/utils'
import { MOBILE_APP_COLORS } from '@/src/lib/landing-page-templates/mobile-app/colors'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type PricingContent = Extract<CrmLandingPageSectionContent, { type: 'PRICING' }>
type Plan = PricingContent['plans'][number]

const DOTS = '/landing-page-templates/mobile-app/pricing-dots.svg'

export function pricingDefaultContent(): PricingContent {
  return {
    type: 'PRICING',
    title: 'Pricing made easy',
    subtitle:
      'With lots of unique blocks, you can easily build a page easily without any coding.',
    plans: [
      {
        name: 'Starter',
        price: '$19',
        period: '/ mo',
        features: [
          'Upto 100 Team Members',
          '100 GB Cloud Storage',
          'Unlimited Meetings',
          'Premium Support',
        ],
        ctaLabel: 'Get Started Now',
        ctaHref: '#footer',
        highlighted: false,
      },
      {
        name: 'Unlimited',
        price: '$99',
        period: '/ mo',
        features: [
          'Unlimited Team Members',
          'Unlimited Cloud Storage',
          'Unlimited Meetings',
          'Premium Support',
        ],
        ctaLabel: 'Get Started Now',
        ctaHref: '#footer',
        highlighted: true,
      },
    ],
  }
}

export function MobileAppPricing({
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
        {
          name: 'Plano',
          price: '$0',
          period: '/ mo',
          features: [],
          ctaLabel: 'Get Started Now',
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
    <section className='relative overflow-hidden bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <img
        src={DOTS}
        alt=''
        aria-hidden
        className='pointer-events-none absolute right-10 bottom-10 hidden h-24 w-24 opacity-70 lg:block'
      />

      <div className='relative mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[36px] leading-tight tracking-[-1.8px] sm:text-[48px]'
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
            className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}
      </div>

      <div className='relative mx-auto grid w-full max-w-3xl grid-cols-1 gap-8 sm:grid-cols-2'>
        {content.plans.map((plan, planIndex) => (
          <div
            key={planIndex}
            className={cn(
              'group/item relative flex flex-col gap-6 rounded-[10px] border border-[#e7e9ed] bg-white p-10',
              plan.highlighted &&
                'border-transparent shadow-[0_32px_64px_0_rgba(22,28,45,0.08)]',
            )}
          >
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-3 right-3 opacity-0 group-hover/item:opacity-100'
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
              className='text-center font-bold text-[#f74d4d] text-[13px] uppercase tracking-[1.6px]'
            />

            <div className='flex items-baseline justify-center gap-1'>
              <GhostInput
                value={plan.price}
                onCommit={(v) => updatePlan(planIndex, { price: v })}
                placeholder='$0'
                readOnly={readOnly}
                className='font-bold text-[#161c2d] text-[60px] tracking-[-2px]'
              />
              {plan.period || !readOnly ? (
                <GhostInput
                  value={plan.period ?? ''}
                  onCommit={(v) =>
                    updatePlan(planIndex, { period: v || undefined })
                  }
                  placeholder='/ mo'
                  readOnly={readOnly}
                  className='text-[#161c2d] text-[17px]'
                />
              ) : null}
            </div>

            <ul className='flex flex-col'>
              {plan.features.map((feature, featureIndex) => (
                <li
                  key={featureIndex}
                  className='group/feature flex items-center justify-center gap-1 border-[#e7e9ed] border-t py-4'
                >
                  <GhostInput
                    value={feature}
                    onCommit={(v) => updateFeature(planIndex, featureIndex, v)}
                    readOnly={readOnly}
                    className='text-center text-[#161c2d] text-[19px]'
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
                <li className='flex justify-center pt-4'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    aria-label='Adicionar benefício'
                    onClick={() => addFeature(planIndex)}
                  >
                    <SteelIcon icon={Add01Icon} strokeWidth={2} size={12} />
                  </Button>
                </li>
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
                className='inline-flex w-full items-center justify-center rounded-lg px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
                style={{
                  backgroundColor: plan.highlighted
                    ? MOBILE_APP_COLORS.red
                    : MOBILE_APP_COLORS.ink,
                }}
              >
                <GhostInput
                  value={plan.ctaLabel ?? ''}
                  onCommit={(v) =>
                    updatePlan(planIndex, { ctaLabel: v || undefined })
                  }
                  placeholder='Texto do botão'
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
            className='flex min-h-64 flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed text-muted-foreground text-sm hover:bg-white/40'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar plano
          </button>
        ) : null}
      </div>
    </section>
  )
}
