'use client'

import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SCORE_BAND_LABELS,
  type SearchScoreBand,
  scoreBand,
} from '@/src/lib/sites/search/analyze'
import type {
  SearchCheck,
  SearchCheckStatus,
  SearchFix,
  SearchPillar,
} from '@/src/lib/sites/search/types'

/*
 * Shared pieces of the "Buscadores" screens. Score colors follow the
 * dataviz convention of the app (usage-charts): CSS variables defined per
 * theme on the screen root (`SEARCH_TONE_VARS`), never raw palette
 * utilities.
 */

/** Put on the root of every "Buscadores" screen. */
export const SEARCH_TONE_VARS =
  '[--sx-good:#1f8a4c] [--sx-fair:#b26b00] [--sx-poor:#c4352b] dark:[--sx-good:#4cc27e] dark:[--sx-fair:#f0a43a] dark:[--sx-poor:#f2685e]'

const BAND_VAR: Record<SearchScoreBand, string> = {
  good: 'var(--sx-good)',
  fair: 'var(--sx-fair)',
  poor: 'var(--sx-poor)',
}

const STATUS_BAND: Record<SearchCheckStatus, SearchScoreBand> = {
  pass: 'good',
  warn: 'fair',
  fail: 'poor',
}

const STATUS_LABEL: Record<SearchCheckStatus, string> = {
  pass: 'Ok',
  warn: 'Atenção',
  fail: 'Corrigir',
}

const STATUS_ICON = {
  pass: CheckmarkCircle02Icon,
  warn: Alert02Icon,
  fail: CancelCircleIcon,
}

/** Circular score (0–100) with its label. */
export function ScoreRing({
  score,
  label,
  size = 56,
  active,
}: {
  score: number
  label: string
  size?: number
  active?: boolean
}) {
  const band = scoreBand(score)
  const stroke = 5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <span className='flex flex-col items-center gap-1'>
      <span
        className='relative inline-flex items-center justify-center'
        style={{ width: size, height: size }}
        role='img'
        aria-label={`${label}: ${score} de 100 (${SCORE_BAND_LABELS[band]})`}
      >
        <svg width={size} height={size} aria-hidden className='-rotate-90'>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            stroke='currentColor'
            strokeWidth={stroke}
            className='text-muted'
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill='none'
            stroke={BAND_VAR[band]}
            strokeWidth={stroke}
            strokeLinecap='round'
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score / 100)}
          />
        </svg>
        <span className='absolute font-semibold text-sm tabular-nums'>
          {score}
        </span>
      </span>
      <span
        className={cn(
          'font-medium text-[11px]',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </span>
  )
}

/** Small pill with a score, colored by band. */
export function ScorePill({ score, label }: { score: number; label?: string }) {
  const band = scoreBand(score)
  return (
    <span
      className='inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-xs tabular-nums'
      style={{ color: BAND_VAR[band], borderColor: BAND_VAR[band] }}
      title={SCORE_BAND_LABELS[band]}
    >
      {label ? <span className='text-muted-foreground'>{label}</span> : null}
      {score}
    </span>
  )
}

/** Horizontal bar of a score (tables). */
export function ScoreBar({ score, label }: { score: number; label: string }) {
  const band = scoreBand(score)
  return (
    <div className='flex min-w-24 items-center gap-2'>
      <div
        className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'
        aria-hidden
      >
        <div
          className='h-full rounded-full'
          style={{ width: `${score}%`, background: BAND_VAR[band] }}
        />
      </div>
      <span className='sr-only'>{label}:</span>
      <span className='w-7 text-right font-medium text-xs tabular-nums'>
        {score}
      </span>
    </div>
  )
}

export function StatusIcon({ status }: { status: SearchCheckStatus }) {
  return (
    <SteelIcon
      icon={STATUS_ICON[status]}
      className='mt-0.5 size-4 shrink-0'
      color={BAND_VAR[STATUS_BAND[status]]}
      aria-label={STATUS_LABEL[status]}
    />
  )
}

/** One check: status, label, explanation and its one-click fix. */
export function CheckRow({
  check,
  onFix,
  busy,
  canFix = true,
}: {
  check: SearchCheck
  onFix?: (fix: SearchFix, check: SearchCheck) => void
  busy?: boolean
  canFix?: boolean
}) {
  return (
    <li
      className='flex gap-2 rounded-md px-2 py-2 hover:bg-muted/40'
      data-check={check.id}
      data-status={check.status}
    >
      <StatusIcon status={check.status} />
      <div className='grid min-w-0 flex-1 gap-0.5'>
        <p className='font-medium text-xs'>{check.label}</p>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {check.message}
        </p>
        {check.fix && onFix && canFix && check.status !== 'pass' ? (
          <div>
            <Button
              type='button'
              size='xs'
              variant='outline'
              className='mt-1'
              disabled={busy}
              onClick={() => check.fix && onFix(check.fix, check)}
            >
              {check.fix.label}
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** Checks sorted worst first (fail → warn → pass), heaviest first. */
export function sortChecks(checks: SearchCheck[]): SearchCheck[] {
  const order: Record<SearchCheckStatus, number> = { fail: 0, warn: 1, pass: 2 }
  return [...checks].sort(
    (a, b) => order[a.status] - order[b.status] || b.weight - a.weight,
  )
}

/** What each pillar measures (pt-BR). */
export const PILLAR_HINTS: Record<SearchPillar, string> = {
  seo: 'Busca clássica: Google e Bing.',
  aeo: 'Mecanismos de resposta: trechos em destaque, “As pessoas também perguntam” e assistentes de voz.',
  geo: 'Mecanismos generativos: ChatGPT, Perplexity, Gemini e as Visões gerais do Google.',
}
