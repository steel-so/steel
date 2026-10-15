'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { SiteAiQuotaDTO } from '@/types/site-ai'

/** pt-BR price of an AI action ("US$ 0,04", "menos de US$ 0,01"). */
export function formatAiUsd(value: number): string {
  if (value > 0 && value < 0.01) return 'menos de US$ 0,01'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' })
}

/** "Custo estimado ≈ … · restam … de … este mês" line of every AI action
 * (the quota part only when it is given). */
export function AiCostLine({
  estimateUsd,
  quota,
  className,
}: {
  estimateUsd: number | null
  quota?: SiteAiQuotaDTO
  className?: string
}) {
  if (!quota && estimateUsd === null) return null
  const tight =
    quota !== undefined &&
    estimateUsd !== null &&
    !quota.exceeded &&
    estimateUsd > quota.remainingUsd
  return (
    <p
      className={cn('text-muted-foreground text-xs leading-relaxed', className)}
      data-testid='site-ai-cost'
    >
      {estimateUsd !== null ? (
        <>
          Custo estimado ≈{' '}
          <span className='font-medium text-foreground'>
            {formatAiUsd(estimateUsd)}
          </span>
          {quota ? ' · ' : null}
        </>
      ) : null}
      {!quota ? null : quota.exceeded ? (
        <span className='font-medium text-destructive'>
          A cota mensal de IA do workspace acabou.
        </span>
      ) : (
        <>
          Restam {formatAiUsd(quota.remainingUsd)} de{' '}
          {formatAiUsd(quota.quotaUsd)} da cota de IA deste mês.
        </>
      )}
      {tight ? (
        <span className='block text-destructive'>
          O custo estimado passa do que resta da cota: a ação pode não terminar.
        </span>
      ) : null}
    </p>
  )
}

export type ChoiceOption = { value: string; label: string }

/** Labelled select of the AI forms (pt-BR labels, string values). */
export function ChoiceSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  id?: string
  label: string
  value: string
  options: ChoiceOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const labels = Object.fromEntries(
    options.map((option) => [option.value, option.label]),
  )
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} className='w-full min-w-0'>
        <SelectValue>
          {(current: string | null) =>
            current ? (labels[current] ?? current) : 'Selecione'
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
