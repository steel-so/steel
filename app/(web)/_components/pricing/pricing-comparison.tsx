import {
  CheckIcon,
  MinusSignIcon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { COMPETITOR_COMPARISON } from '@/src/config/competitor-comparison'
import {
  COMPARISON_TEAM_SIZE,
  formatListPrice,
  formatMoney,
  steelComparisonPlans,
  teamMonthlyCost,
  toBrlCents,
} from '@/src/lib/pricing/comparison'
import type {
  ComparisonBlock,
  ComparisonCatalog,
  ComparisonModule,
  CompetitorPlan,
  Currency,
  FeatureSupport,
} from '@/src/schemas/competitor-comparison.schema'
import { CompetitorLogo } from './competitor-logo'

const SUPPORT_LABELS: Record<FeatureSupport, string> = {
  yes: 'Sim',
  plan: 'Em alguns planos',
  addon: 'À parte',
  'no-info': 'Não informado',
}

const TAB_LABELS: Record<ComparisonModule, string> = {
  servicedesk: 'ServiceDesk',
  crm: 'CRM',
  comunicacao: 'Comunicação',
}

const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/** `2026-10` → `outubro de 2026`. */
export function formatCheckedAt(checkedAt: string): string {
  const [year, month] = checkedAt.split('-').map(Number)
  return `${MONTHS[month - 1]} de ${year}`
}

function SupportCell({ value }: { value: FeatureSupport }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1.5 text-xs',
        value === 'yes' && 'text-branding-600 dark:text-branding-400',
        value !== 'yes' && 'text-muted-foreground',
      )}
    >
      {value === 'yes' && (
        <SteelIcon icon={CheckIcon} size={18} strokeWidth={2.5} aria-hidden />
      )}
      {value === 'plan' && (
        <SteelIcon icon={PlusSignIcon} size={16} strokeWidth={2} aria-hidden />
      )}
      {(value === 'addon' || value === 'no-info') && (
        <SteelIcon icon={MinusSignIcon} size={16} strokeWidth={2} aria-hidden />
      )}
      <span className={cn(value === 'yes' && 'sr-only')}>
        {SUPPORT_LABELS[value]}
      </span>
    </span>
  )
}

function FeatureMatrix({ block }: { block: ComparisonBlock }) {
  return (
    <div className='relative w-full overflow-x-auto'>
      <table className='w-full min-w-[560px] border-collapse text-sm'>
        <caption className='sr-only'>
          Recursos: Steel e {block.competitors.map((c) => c.name).join(', ')}
        </caption>
        <thead>
          <tr className='border-b border-border'>
            <th scope='col' className='p-3 text-left font-medium'>
              Recurso
            </th>
            <th
              scope='col'
              className='bg-branding-400/5 p-3 text-center font-semibold'
            >
              Steel
            </th>
            {block.competitors.map((competitor) => (
              <th
                key={competitor.id}
                scope='col'
                className='p-3 text-center font-medium'
              >
                <span className='inline-flex flex-col items-center gap-1.5'>
                  <CompetitorLogo
                    domain={competitor.domain}
                    name={competitor.name}
                    size={24}
                    decorative
                  />
                  <span className='text-xs'>{competitor.name}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.features.map((feature) => (
            <tr key={feature.label} className='border-b border-border'>
              <th scope='row' className='p-3 text-left font-normal'>
                {feature.label}
              </th>
              <td className='bg-branding-400/5 p-3 text-center'>
                <SupportCell value={feature.steel} />
              </td>
              {block.competitors.map((competitor) => (
                <td key={competitor.id} className='p-3 text-center'>
                  <SupportCell value={feature.competitors[competitor.id]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanLine({
  plan,
  currency,
  usdBrl,
}: {
  plan: CompetitorPlan
  currency: Currency
  usdBrl: number
}) {
  const team = teamMonthlyCost(plan.price, currency)
  const brl =
    currency === 'USD' && plan.price.kind === 'per-seat' && plan.price.cents > 0
      ? formatMoney(toBrlCents(plan.price.cents, currency, usdBrl), 'BRL')
      : null

  return (
    <li className='flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0'>
      <span className='font-medium'>{plan.name}</span>
      <span>
        {formatListPrice(plan.price, currency)}
        {brl && <span className='text-muted-foreground'> (≈ {brl})</span>}
      </span>
      {team && (
        <span className='text-xs text-muted-foreground'>
          Equipe de {COMPARISON_TEAM_SIZE}: {team} por mês
        </span>
      )}
      {plan.note && (
        <span className='text-xs text-muted-foreground'>{plan.note}</span>
      )}
    </li>
  )
}

function PriceCard({
  title,
  logo,
  plans,
  currency,
  usdBrl,
  sourceUrl,
  steel = false,
}: {
  title: string
  logo?: ReactNode
  plans: CompetitorPlan[]
  currency: Currency
  usdBrl: number
  sourceUrl?: string
  steel?: boolean
}) {
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-border p-4 text-sm',
        steel && 'border-branding-400 bg-branding-400/5',
      )}
    >
      <header className='flex items-center gap-2'>
        {logo}
        <h4 className='font-semibold'>{title}</h4>
      </header>
      <ul className='flex flex-col'>
        {plans.map((plan) => (
          <PlanLine
            key={plan.name}
            plan={plan}
            currency={currency}
            usdBrl={usdBrl}
          />
        ))}
      </ul>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='mt-auto text-xs underline underline-offset-2'
        >
          Fonte: página de preços de {title}
        </a>
      )}
    </article>
  )
}

function ComparisonBlockView({
  block,
  usdBrl,
}: {
  block: ComparisonBlock
  usdBrl: number
}) {
  const headingId = `comparar-${block.module}`

  return (
    <section aria-labelledby={headingId} className='flex flex-col gap-8'>
      <h3 id={headingId} className='sr-only'>
        {block.title}
      </h3>
      <FeatureMatrix block={block} />
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <PriceCard
          title='Steel'
          plans={steelComparisonPlans()}
          currency='BRL'
          usdBrl={usdBrl}
          steel
        />
        {block.competitors.map((competitor) => (
          <PriceCard
            key={competitor.id}
            title={competitor.name}
            logo={
              <CompetitorLogo
                domain={competitor.domain}
                name={competitor.name}
                size={24}
                decorative
              />
            }
            plans={competitor.plans}
            currency={competitor.currency}
            usdBrl={usdBrl}
            sourceUrl={competitor.sourceUrl}
          />
        ))}
      </div>
      {block.notes.length > 0 && (
        <div className='flex flex-col gap-1 text-xs text-muted-foreground'>
          {block.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </section>
  )
}

interface PricingComparisonProps {
  catalog?: ComparisonCatalog
}

export function PricingComparison({
  catalog = COMPETITOR_COMPARISON,
}: PricingComparisonProps) {
  const { usdBrl } = catalog.exchangeRate

  return (
    <section
      id='comparar'
      aria-labelledby='comparar-titulo'
      className='flex w-full scroll-mt-20 flex-col gap-6 border-x border-b border-border px-4 py-12 sm:px-6'
    >
      <div className='flex max-w-3xl flex-col gap-3'>
        <h2 id='comparar-titulo' className='text-3xl font-normal'>
          Recurso por recurso
        </h2>
        <p className='text-muted-foreground'>
          O que cada produto informa na própria página pública, consultada em{' '}
          {formatCheckedAt(catalog.checkedAt)}. Um assento do Steel inclui os
          três módulos.
        </p>
      </div>
      <Tabs defaultValue={catalog.blocks[0].module} className='gap-6'>
        <TabsList>
          {catalog.blocks.map((block) => (
            <TabsTrigger key={block.module} value={block.module}>
              {TAB_LABELS[block.module]}
            </TabsTrigger>
          ))}
        </TabsList>
        {catalog.blocks.map((block) => (
          <TabsContent key={block.module} value={block.module} keepMounted>
            <ComparisonBlockView block={block} usdBrl={usdBrl} />
          </TabsContent>
        ))}
      </Tabs>
      <p className='text-xs text-muted-foreground'>
        Legenda: <strong>Sim</strong> = informado na página do produto;{' '}
        <strong>Em alguns planos</strong> = só em parte dos planos;{' '}
        <strong>À parte</strong> = vendido separadamente;{' '}
        <strong>Não informado</strong> = não consta na página consultada. Preços
        de lista com cobrança anual, sem impostos; o valor em reais de preços em
        dólar é aproximado (câmbio da calculadora acima).
      </p>
    </section>
  )
}
