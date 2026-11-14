'use client'

import {
  Calendar03Icon,
  DashboardSquare01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

/**
 * Alternância quadro ↔ calendário das telas de mudança.
 *
 * Decisão: o calendário é uma **rota própria** (`/changes/calendar`) em vez
 * de um estado da tela de mudanças. Assim ele tem link direto (um agente de
 * plantão abre o calendário do mês sem passar pelo quadro), mantém o
 * `SdTicketBoard` intacto (fatia ticket-ui) e carrega só o que cada tela
 * precisa — o quadro não paga o calendário e vice-versa.
 */
export function SdChangeViewSwitch({
  slug,
  active,
}: {
  slug: string
  active: 'board' | 'calendar'
}) {
  const base = `/${slug}/servicedesk/changes`
  const item = (isActive: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium text-sm transition-colors',
      isActive
        ? 'bg-background text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground',
    )

  return (
    <nav
      className='inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5'
      aria-label='Visão das mudanças'
      data-tour='sd-change-views'
    >
      <Link
        href={base}
        aria-current={active === 'board' ? 'page' : undefined}
        className={item(active === 'board')}
      >
        <SteelIcon
          icon={DashboardSquare01Icon}
          strokeWidth={2}
          className='size-4'
        />
        Quadro
      </Link>
      <Link
        href={`${base}/calendar`}
        aria-current={active === 'calendar' ? 'page' : undefined}
        className={item(active === 'calendar')}
      >
        <SteelIcon icon={Calendar03Icon} strokeWidth={2} className='size-4' />
        Calendário
      </Link>
    </nav>
  )
}
