'use client'

import {
  Cancel01Icon,
  Copy01Icon,
  Money03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCancelProposalCharge,
  useCreateProposalCharge,
  useProposalCheckout,
  useSimulateProposalPayment,
} from '@/src/hooks/use-crm-deals'
import type { CrmProposalChargeDTO } from '@/types/crm-deals'
import {
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_TONE,
  formatBRL,
  formatDealDate,
  formatDealDateTime,
} from './deals-tone'

const METHOD_LABEL = { PIX: 'Pix', BOLETO: 'Boleto' } as const

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify.success('Código copiado')
  } catch {
    notify.error('Não foi possível copiar o código')
  }
}

function ChargeRow({
  charge,
  workspaceId,
  proposalId,
  canSimulate,
}: {
  charge: CrmProposalChargeDTO
  workspaceId: string
  proposalId: string
  canSimulate: boolean
}) {
  const cancel = useCancelProposalCharge(workspaceId, proposalId)
  const simulate = useSimulateProposalPayment(workspaceId, proposalId)

  async function run(action: 'cancel' | 'simulate') {
    try {
      if (action === 'cancel') await cancel.mutateAsync(charge.id)
      else await simulate.mutateAsync(charge.id)
      notify.success(
        action === 'cancel' ? 'Cobrança cancelada' : 'Pagamento simulado',
      )
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <li className='flex flex-col gap-2 rounded-md border bg-card p-3 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{METHOD_LABEL[charge.method]}</span>
        <span className='tabular-nums'>{formatBRL(charge.amount)}</span>
        <Badge
          variant='outline'
          className={cn('ml-auto', CHARGE_STATUS_TONE[charge.status])}
        >
          {CHARGE_STATUS_LABEL[charge.status]}
        </Badge>
      </div>
      <p className='text-muted-foreground text-xs'>
        {charge.status === 'PAID' && charge.paidAt
          ? `Paga em ${formatDealDateTime(charge.paidAt)}`
          : `Vence em ${formatDealDate(charge.expiresAt)}`}
        {charge.isTest ? ' · provedor de teste (não movimenta dinheiro)' : ''}
      </p>
      {charge.status === 'PENDING' ? (
        <>
          <code className='break-all rounded bg-muted px-2 py-1 text-xs'>
            {charge.paymentCode}
          </code>
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() => copy(charge.paymentCode)}
            >
              <SteelIcon icon={Copy01Icon} strokeWidth={2} />
              Copiar código
            </Button>
            {canSimulate && charge.isTest ? (
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={simulate.isPending}
                onClick={() => run('simulate')}
              >
                Simular pagamento
              </Button>
            ) : null}
            <Button
              type='button'
              size='sm'
              variant='ghost'
              disabled={cancel.isPending}
              onClick={() => run('cancel')}
            >
              Cancelar
            </Button>
          </div>
        </>
      ) : null}
    </li>
  )
}

/**
 * Cobrança Pix/boleto e assinaturas de uma proposta enviada. A cobrança vem
 * desligada: o administrador liga em Configurações do CRM, e só existe o
 * provedor de teste (nenhum dinheiro de verdade passa por aqui).
 */
export function ProposalCheckoutDrawer({
  workspaceId,
  proposalId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  proposalId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isPrivileged = useIsPrivileged()
  const checkout = useProposalCheckout(workspaceId, proposalId, open)
  const create = useCreateProposalCharge(workspaceId, proposalId)

  const [method, setMethod] = useState<'PIX' | 'BOLETO'>('PIX')
  const [amount, setAmount] = useState('')
  const [days, setDays] = useState('7')

  async function handleCreate() {
    const parsedAmount = amount.trim() ? Number(amount.replace(',', '.')) : undefined
    const parsedDays = Number(days)
    if (parsedAmount !== undefined && !(parsedAmount > 0)) {
      notify.error('Informe um valor maior que zero.')
      return
    }
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 30) {
      notify.error('A cobrança pode valer de 1 a 30 dias.')
      return
    }
    try {
      await create.mutateAsync({
        method,
        amount: parsedAmount,
        expiresInDays: parsedDays,
      })
      setAmount('')
      notify.success('Cobrança criada')
    } catch (error) {
      notify.error(error)
    }
  }

  const data = checkout.data

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className='!w-[480px] !max-w-[480px] overflow-auto p-0'
      >
        <div className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
          <SteelIcon icon={Money03Icon} strokeWidth={2} />
          <span className='font-semibold text-sm'>Cobrança e assinatura</span>
          <SheetClose
            className='ml-auto'
            nativeButton={true}
            render={
              <Button variant='ghost' size='icon-sm' aria-label='Fechar'>
                <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            }
          />
        </div>

        <div className='flex flex-col gap-5 p-3'>
          {checkout.isLoading || !data ? (
            <Skeleton className='h-32 w-full' />
          ) : (
            <>
              <section className='flex flex-col gap-3'>
                <h3 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                  Cobrança
                </h3>
                {data.paymentEnabled ? (
                  <div className='flex flex-col gap-3 rounded-md border p-3'>
                    <div className='grid grid-cols-3 gap-2'>
                      <div className='flex flex-col gap-1.5'>
                        <Label htmlFor='charge-method'>Forma</Label>
                        <Select
                          value={method}
                          onValueChange={(v) =>
                            setMethod((v as 'PIX' | 'BOLETO') ?? method)
                          }
                        >
                          <SelectTrigger id='charge-method' size='sm'>
                            <SelectValue>{METHOD_LABEL[method]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='PIX'>Pix</SelectItem>
                            <SelectItem value='BOLETO'>Boleto</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className='flex flex-col gap-1.5'>
                        <Label htmlFor='charge-amount'>Valor (R$)</Label>
                        <Input
                          id='charge-amount'
                          inputMode='decimal'
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          placeholder='Da oportunidade'
                        />
                      </div>
                      <div className='flex flex-col gap-1.5'>
                        <Label htmlFor='charge-days'>Validade (dias)</Label>
                        <Input
                          id='charge-days'
                          type='number'
                          min={1}
                          max={30}
                          value={days}
                          onChange={(e) => setDays(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      className='self-end'
                      disabled={create.isPending}
                      onClick={handleCreate}
                    >
                      {create.isPending ? 'Criando…' : 'Criar cobrança'}
                    </Button>
                  </div>
                ) : (
                  <p className='rounded-md border border-dashed p-3 text-muted-foreground text-sm'>
                    A cobrança na proposta está desligada. Um administrador pode
                    ligá-la em Configurações do CRM. Hoje só existe o provedor
                    de teste, que não movimenta dinheiro de verdade.
                  </p>
                )}

                {data.charges.length === 0 ? (
                  <p className='py-3 text-center text-muted-foreground text-sm'>
                    Nenhuma cobrança nesta proposta.
                  </p>
                ) : (
                  <ul className='flex flex-col gap-2'>
                    {data.charges.map((charge) => (
                      <ChargeRow
                        key={charge.id}
                        charge={charge}
                        workspaceId={workspaceId}
                        proposalId={proposalId}
                        canSimulate={isPrivileged}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <section className='flex flex-col gap-2'>
                <h3 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                  Assinaturas
                </h3>
                {data.signatures.length === 0 ? (
                  <p className='py-3 text-center text-muted-foreground text-sm'>
                    {data.signatureEnabled
                      ? 'O cliente ainda não assinou.'
                      : 'A assinatura digital está desligada nas Configurações do CRM.'}
                  </p>
                ) : (
                  <ul className='flex flex-col gap-2'>
                    {data.signatures.map((signature) => (
                      <li
                        key={signature.id}
                        className='flex flex-col gap-1 rounded-md border bg-card p-3 text-sm'
                      >
                        <span className='font-medium'>
                          {signature.signerName}
                        </span>
                        <span className='text-muted-foreground text-xs'>
                          Assinou em {formatDealDateTime(signature.signedAt)}
                        </span>
                        <span className='break-all text-muted-foreground text-xs'>
                          SHA-256 da proposta: {signature.proposalSha256}
                        </span>
                        <a
                          className='text-primary text-xs underline-offset-2 hover:underline'
                          target='_blank'
                          rel='noreferrer'
                          href={`/api/workspaces/${encodeURIComponent(workspaceId)}/crm/proposals/${proposalId}/signatures/${signature.id}/image`}
                        >
                          Ver a assinatura
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
