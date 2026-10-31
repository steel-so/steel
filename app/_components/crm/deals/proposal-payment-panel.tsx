'use client'

import { Copy01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useCallback, useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CrmProposalPublicCheckoutDTO } from '@/types/crm-deals'
import {
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_TONE,
  formatBRL,
  formatDealDate,
  formatDealDateTime,
} from './deals-tone'

const METHOD_LABEL = { PIX: 'Pix', BOLETO: 'Boleto' } as const
const POLL_MS = 8000

/**
 * Pagamento da proposta na página pública: a cobrança Pix/boleto gerada pelo
 * vendedor, com o código para copiar. Enquanto houver cobrança pendente a
 * página consulta o estado de tempos em tempos e troca por "paga" sozinha.
 */
export function ProposalPaymentPanel({
  token,
  initial,
  refreshKey = 0,
}: {
  token: string
  initial: CrmProposalPublicCheckoutDTO
  /** Muda quando o cliente acabou de aceitar, para buscar a cobrança. */
  refreshKey?: number
}) {
  const [state, setState] = useState(initial)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/crm/proposals/${token}/checkout`)
      const json = await res.json().catch(() => null)
      if (res.ok && json?.success) {
        setState(json.data as CrmProposalPublicCheckoutDTO)
      }
    } catch {
      // The next tick tries again.
    }
  }, [token])

  const hasPending = state.charges.some((charge) => charge.status === 'PENDING')

  useEffect(() => {
    if (refreshKey > 0) void refresh()
  }, [refreshKey, refresh])

  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [hasPending, refresh])

  if (!state.paymentEnabled || state.charges.length === 0) return null

  async function copy(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setCopied(null)
    }
  }

  return (
    <section className='mt-8 flex flex-col gap-3 border-t pt-6'>
      <h2 className='font-semibold text-base'>Pagamento</h2>
      <ul className='flex flex-col gap-3'>
        {state.charges.map((charge) => (
          <li
            key={charge.id}
            className='flex flex-col gap-2 rounded-md border bg-card p-4 text-sm'
          >
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>
                {METHOD_LABEL[charge.method]} · {formatBRL(charge.amount)}
              </span>
              <Badge
                variant='outline'
                className={cn('ml-auto', CHARGE_STATUS_TONE[charge.status])}
              >
                {CHARGE_STATUS_LABEL[charge.status]}
              </Badge>
            </div>
            <p className='text-muted-foreground'>{charge.description}</p>
            {charge.status === 'PAID' && charge.paidAt ? (
              <p className='text-muted-foreground'>
                Pagamento confirmado em {formatDealDateTime(charge.paidAt)}.
                Obrigado!
              </p>
            ) : (
              <>
                <p className='text-muted-foreground'>
                  Pague até {formatDealDate(charge.expiresAt)}.
                  {charge.isTest
                    ? ' Esta é uma cobrança de teste: nenhum banco consegue liquidá-la.'
                    : ''}
                </p>
                <code className='break-all rounded bg-muted px-2 py-1.5 text-xs'>
                  {charge.paymentCode}
                </code>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  className='self-start'
                  onClick={() => copy(charge.id, charge.paymentCode)}
                >
                  <SteelIcon icon={Copy01Icon} strokeWidth={2} />
                  {copied === charge.id
                    ? 'Código copiado'
                    : charge.method === 'PIX'
                      ? 'Copiar Pix copia e cola'
                      : 'Copiar linha digitável'}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
