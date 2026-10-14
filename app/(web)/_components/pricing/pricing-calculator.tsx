'use client'

import { useState } from 'react'
import { Muted } from '@/components/typography/text/muted'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { COMPETITOR_COMPARISON } from '@/src/config/competitor-comparison'
import {
  type CalculatorCost,
  competitorYearlyCost,
  steelYearlyCost,
} from '@/src/lib/pricing/comparison'
import type {
  ComparisonCatalog,
  ComparisonModule,
  Competitor,
} from '@/src/schemas/competitor-comparison.schema'
import { CompetitorLogo } from './competitor-logo'
import { formatCurrency } from './plans'

/** Yearly totals read better in whole reais. */
function formatYearly(cents: number) {
  return formatCurrency(Math.round(cents / 100) * 100)
}

const MIN_SEATS = 1
const MAX_SEATS = 500
const DEFAULT_SEATS = 10

const MODULE_LABELS: Record<ComparisonModule, string> = {
  servicedesk: 'Software de ServiceDesk',
  crm: 'Software de CRM',
  comunicacao: 'Plataforma de WhatsApp',
}

function clampSeats(value: number) {
  if (Number.isNaN(value)) return MIN_SEATS
  return Math.min(Math.max(Math.round(value), MIN_SEATS), MAX_SEATS)
}

function users(seats: number) {
  return `${seats} ${seats === 1 ? 'usuário' : 'usuários'}`
}

/** `2026-10-14` → `14/10/2026`. */
function formatRateDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

interface PricingCalculatorProps {
  catalog?: ComparisonCatalog
}

export function PricingCalculator({
  catalog = COMPETITOR_COMPARISON,
}: PricingCalculatorProps) {
  const { usdBrl, date } = catalog.exchangeRate
  const [seats, setSeats] = useState(DEFAULT_SEATS)
  const [selected, setSelected] = useState<Record<ComparisonModule, string>>(
    () =>
      Object.fromEntries(
        catalog.blocks.map((block) => [block.module, block.competitors[0].id]),
      ) as Record<ComparisonModule, string>,
  )

  const picks = catalog.blocks.map((block) => {
    const competitor =
      block.competitors.find((c) => c.id === selected[block.module]) ??
      block.competitors[0]
    return {
      module: block.module,
      competitor,
      cost: competitorYearlyCost(competitor, seats, usdBrl),
    }
  })

  const current = picks.reduce(
    (sum, pick) => sum + (pick.cost?.yearlyBrlCents ?? 0),
    0,
  )
  const steel = steelYearlyCost(seats)
  const savings = Math.max(current - steel, 0)

  return (
    <div
      id='calculadora'
      className='grid w-full scroll-mt-20 overflow-hidden border border-border lg:grid-cols-3'
    >
      <div className='flex w-full flex-col lg:col-span-2'>
        <div className='flex w-full flex-col gap-8 p-6 pb-4 sm:p-8 sm:pb-4'>
          <div className='flex flex-col gap-4'>
            <div className='flex items-center justify-between gap-4'>
              <Label htmlFor='calculadora-membros' className='text-base'>
                Número de membros
              </Label>
              <Input
                id='calculadora-membros'
                type='number'
                inputMode='numeric'
                min={MIN_SEATS}
                max={MAX_SEATS}
                value={seats}
                onChange={(e) => setSeats(clampSeats(Number(e.target.value)))}
                className='w-20 bg-muted text-center'
              />
            </div>
            <Slider
              min={MIN_SEATS}
              max={MAX_SEATS}
              value={[seats]}
              onValueChange={(value) =>
                setSeats(clampSeats(Array.isArray(value) ? value[0] : value))
              }
              aria-label='Número de membros'
              className='w-full'
            />
          </div>
          {catalog.blocks.map((block) => (
            <ToolSelect
              key={block.module}
              label={MODULE_LABELS[block.module]}
              name={`calculadora-${block.module}`}
              tools={block.competitors}
              value={selected[block.module]}
              onValueChange={(id) =>
                setSelected((prev) => ({ ...prev, [block.module]: id }))
              }
            />
          ))}
        </div>
        <div className='grid w-full gap-6 border-t border-border p-6 pt-4 sm:grid-cols-3 sm:p-8 sm:pt-4'>
          {picks.map((pick) => (
            <PickCost
              key={pick.module}
              competitor={pick.competitor}
              cost={pick.cost}
              seats={seats}
            />
          ))}
        </div>
        <p className='border-t border-border px-6 py-4 text-xs text-muted-foreground sm:px-8'>
          Preço de lista do plano pago de entrada de cada produto, com cobrança
          anual e sem impostos. Valores em dólar convertidos pela PTAX de venda
          do Banco Central de {formatRateDate(date)} (US$ 1 = R${' '}
          {usdBrl.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}).
          Tarifas da Meta por conversa no WhatsApp ficam de fora em todos os
          casos, inclusive no Steel.
        </p>
      </div>
      <div className='flex flex-col gap-8 border-t border-border p-6 sm:p-8 lg:col-span-1 lg:border-t-0 lg:border-l'>
        <h3 className='text-lg'>Nós fizemos as contas para você.</h3>
        <div className='flex flex-1 flex-col justify-evenly gap-6'>
          <ResultCard
            title='Custo anual das ferramentas escolhidas'
            value={formatYearly(current)}
          />
          <ResultCard
            title={`Custo anual com o Steel Pro (${users(seats)})`}
            value={formatYearly(steel)}
          />
          <ResultCard
            title='Economia com o Steel'
            value={formatYearly(savings)}
            highlight
          />
        </div>
      </div>
    </div>
  )
}

function PickCost({
  competitor,
  cost,
  seats,
}: {
  competitor: Competitor
  cost: CalculatorCost | null
  seats: number
}) {
  return (
    <div className='flex flex-col gap-2'>
      <Muted>
        {competitor.name}
        {cost && ` · ${cost.plan.name}`}
        {cost && (cost.perAccount ? ', preço por conta' : `, ${users(seats)}`)}
      </Muted>
      <div className='rounded-md bg-card p-3 text-sm'>
        {cost
          ? `${formatYearly(cost.yearlyBrlCents)} por ano`
          : 'Preço sob consulta'}
      </div>
    </div>
  )
}

function ToolSelect({
  label,
  name,
  tools,
  value,
  onValueChange,
}: {
  label: string
  name: string
  tools: Competitor[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <fieldset className='flex flex-col gap-2'>
      <legend className='mb-3 text-base text-muted-foreground'>{label}</legend>
      <div className='flex flex-wrap items-center gap-2'>
        {tools.map((tool) => (
          <label
            key={tool.id}
            title={tool.name}
            className={cn(
              'flex h-14 w-15 cursor-pointer items-center justify-center rounded-lg border-2 border-border p-3 transition-colors',
              'hover:bg-muted',
              'has-checked:border-branding-400 has-checked:bg-branding-400/5',
              'has-focus-visible:ring-2 has-focus-visible:ring-ring',
            )}
          >
            <input
              type='radio'
              name={name}
              value={tool.id}
              checked={value === tool.id}
              onChange={() => onValueChange(tool.id)}
              className='sr-only'
            />
            <CompetitorLogo domain={tool.domain} name={tool.name} size={32} />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ResultCard({
  title,
  value,
  highlight = false,
}: {
  title: string
  value: string
  highlight?: boolean
}) {
  return (
    <Card
      className={cn(
        'flex h-full flex-col items-center justify-center gap-2 rounded-xl px-4 py-6 text-center',
        highlight && 'border-branding-400',
      )}
    >
      <CardDescription className='text-base font-normal'>
        {title}
      </CardDescription>
      <CardTitle className='text-2xl font-normal'>{value}</CardTitle>
    </Card>
  )
}
