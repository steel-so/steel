'use client'

import { ActivityIcon, Alert02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type {
  CrmHealthFactorDTO,
  CrmHealthLevelDTO,
  CrmHealthNextActionDTO,
} from '@/types/crm-health'
import { HEALTH_FILL, HEALTH_TONE } from './health-tone'

/** "Última interação há 52 dias · 2 tarefas atrasadas" (até 3 fatores). */
export function healthReason(factors: CrmHealthFactorDTO[], max = 3): string {
  return factors
    .slice(0, max)
    .map((factor) => factor.detail)
    .join(' · ')
}

/** Os fatores que pontuaram, com a frase que explica cada um. */
export function HealthFactorList({
  factors,
  className,
}: {
  factors: CrmHealthFactorDTO[]
  className?: string
}) {
  if (factors.length === 0) return null
  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {factors.map((factor) => (
        <li key={factor.key} className='flex items-start gap-2 text-xs'>
          <span className='mt-1.5 size-1.5 shrink-0 rounded-full bg-current opacity-60' />
          <span className='min-w-0 flex-1'>
            <span className='font-medium'>{factor.label}</span>
            <span className='text-muted-foreground'> - {factor.detail}</span>
          </span>
          <span className='shrink-0 font-medium tabular-nums'>
            +{Math.round(factor.points)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Selo de risco. **Nunca mostra a nota sem o motivo** (mesma regra da ADR
 * 0016): os fatores vão no tooltip e no texto de leitor de tela. Sem fator
 * que explique, não há selo. Por padrão só aparece de `MEDIUM` para cima.
 */
export function HealthBadge({
  level,
  levelLabel,
  riskScore,
  factors,
  showLow,
  className,
}: {
  level: CrmHealthLevelDTO
  levelLabel: string
  riskScore: number
  factors: CrmHealthFactorDTO[]
  showLow?: boolean
  className?: string
}) {
  if (factors.length === 0) return null
  if (level === 'LOW' && !showLow) return null
  const reason = healthReason(factors)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-health-level={level}
            className={cn(
              'inline-flex h-5 items-center gap-1 rounded-md border px-1.5 font-medium text-[11px] tabular-nums',
              HEALTH_TONE[level],
              className,
            )}
          >
            <SteelIcon
              icon={level === 'HIGH' ? Alert02Icon : ActivityIcon}
              strokeWidth={2}
              className='size-3'
            />
            <span aria-hidden>{`${levelLabel} · ${riskScore}`}</span>
            <span className='sr-only'>
              {`${levelLabel}, nota de risco ${riskScore} de 100: ${reason}`}
            </span>
          </span>
        }
      />
      <TooltipContent className='max-w-xs'>
        <p className='font-medium'>
          {levelLabel} - {riskScore}/100
        </p>
        <HealthFactorList factors={factors} className='mt-1' />
      </TooltipContent>
    </Tooltip>
  )
}

/** Barra 0-100 da nota de risco. */
export function HealthBar({
  level,
  riskScore,
}: {
  level: CrmHealthLevelDTO
  riskScore: number
}) {
  return (
    <div
      className='h-1.5 overflow-hidden rounded-full bg-muted'
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={riskScore}
      aria-label='Nota de risco'
    >
      <div
        className={cn('h-full rounded-full transition-all', HEALTH_FILL[level])}
        style={{ width: `${Math.min(100, Math.max(0, riskScore))}%` }}
      />
    </div>
  )
}

/** A próxima ação sugerida (frase curta + o porquê em tooltip). */
export function HealthNextAction({
  action,
  className,
}: {
  action: CrmHealthNextActionDTO
  className?: string
}) {
  return (
    <p className={cn('text-xs', className)}>
      <span className='font-medium'>Próxima ação: </span>
      <span className='text-muted-foreground'>{action.label}</span>
    </p>
  )
}
