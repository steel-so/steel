'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { cn } from '@/lib/utils'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type PricingContent = Extract<CrmLandingPageSectionContent, { type: 'PRICING' }>
type Plan = PricingContent['plans'][number]

const WAVE = '/landing-page-templates/saas-subscription/pricing-wave.svg'

const BLURB =
  'Com vários blocos exclusivos, você monta uma página sem escrever código. Crie sua próxima landing page.'

export function pricingDefaultContent(): PricingContent {
  return {
    type: 'PRICING',
    title: 'Planos e preços',
    subtitle: BLURB,
    plans: [
      {
        name: 'Básico',
        price: 'R$ 29',
        period: 'Pagamento único',
        features: [BLURB],
        ctaLabel: 'Comece grátis',
        ctaHref: '#footer',
        highlighted: false,
      },
      {
        name: 'Padrão',
        price: 'R$ 49',
        period: 'Pagamento único',
        features: [BLURB],
        ctaLabel: 'Comece grátis',
        ctaHref: '#footer',
        highlighted: false,
      },
      {
        name: 'Premium',
        price: 'R$ 99',
        period: 'Pagamento único',
        features: [BLURB],
        ctaLabel: 'Comece grátis',
        ctaHref: '#footer',
        highlighted: false,
      },
    ],
  }
}

export function SaasSubscriptionPricing({
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
          price: 'R$ 0',
          period: 'Pagamento único',
          features: [BLURB],
          ctaLabel: 'Comece grátis',
          ctaHref: '#footer',
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
    <section className='relative bg-[#161c2d] px-6 pt-16 pb-20 sm:px-10 sm:pb-24 lg:px-[123px]'>
      <img
        src={WAVE}
        alt=''
        aria-hidden
        className='-top-px absolute inset-x-0 h-auto w-full'
      />

      <div className='relative mx-auto mb-14 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[28px] text-white leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
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
            className='text-[19px] text-white/65 leading-[1.7]'
          />
        ) : null}
      </div>

      <div className='relative mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-3'>
        {content.plans.map((plan, planIndex) => (
          <div
            key={planIndex}
            className={cn(
              'group/item relative flex flex-col gap-6 rounded-[10px] border border-[#e7e9ed] bg-white px-6 py-8 text-center',
              plan.highlighted && 'ring-2 ring-[#473bf0]',
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

            <span className='mx-auto inline-flex items-center rounded-full bg-[#473bf0]/10 px-4 py-1.5'>
              <GhostInput
                value={plan.name}
                onCommit={(v) => updatePlan(planIndex, { name: v })}
                placeholder='Nome do plano'
                readOnly={readOnly}
                className='font-bold text-[#473bf0] text-[13px] uppercase tracking-[1.6px]'
              />
            </span>

            <GhostInput
              value={plan.price}
              onCommit={(v) => updatePlan(planIndex, { price: v })}
              placeholder='R$ 0'
              readOnly={readOnly}
              className='text-center font-bold text-[#161c2d] text-[48px] tracking-[-1.8px]'
            />

            {plan.period || !readOnly ? (
              <GhostInput
                value={plan.period ?? ''}
                onCommit={(v) =>
                  updatePlan(planIndex, { period: v || undefined })
                }
                placeholder='Período'
                readOnly={readOnly}
                className='-mt-4 text-center text-[#161c2d]/70 text-[17px]'
              />
            ) : null}

            <ul className='flex flex-col gap-2'>
              {plan.features.map((feature, featureIndex) => (
                <li
                  key={featureIndex}
                  className='group/feature flex items-center justify-center gap-1'
                >
                  <GhostTextarea
                    value={feature}
                    onCommit={(v) => updateFeature(planIndex, featureIndex, v)}
                    readOnly={readOnly}
                    as='p'
                    className='text-center text-[#161c2d]/70 text-[17px] leading-[1.7]'
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
                  className='mx-auto'
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
                className='mt-auto inline-flex items-center justify-center rounded-lg bg-[#473bf0] px-4 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
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
            className='flex min-h-[300px] flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-white/30 text-sm text-white/60 hover:bg-white/5'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar plano
          </button>
        ) : null}
      </div>
    </section>
  )
}
