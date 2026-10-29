'use client'

import { Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  useCreateWhatsAppAdSpend,
  useDeleteWhatsAppAdSpend,
  useWhatsAppAdSpends,
} from '@/src/hooks/use-whatsapp-ads'
import { formatBrl, formatFullDay } from '../costs/whatsapp-costs-format'
import { parseAdAmount } from './whatsapp-ads-format'

/** Typed ad spend: the Meta Ads account is not connected (yet). */
export function WhatsAppAdSpends({
  workspaceId,
  knownAds,
}: {
  workspaceId: string
  /** Ads already seen in the report, to pick the id from. */
  knownAds: { sourceId: string; name: string | null }[]
}) {
  const { data: spends, isLoading, error } = useWhatsAppAdSpends(workspaceId)
  const create = useCreateWhatsAppAdSpend(workspaceId)
  const remove = useDeleteWhatsAppAdSpend(workspaceId)
  const [sourceId, setSourceId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [amount, setAmount] = useState('')

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    const value = parseAdAmount(amount)
    if (value === undefined) {
      notify.error('Informe um valor válido (ex.: 1.500,00).')
      return
    }
    if (!periodStart || !periodEnd) {
      notify.error('Informe o período do gasto.')
      return
    }
    const known = knownAds.find((ad) => ad.sourceId === sourceId.trim())
    try {
      await create.mutateAsync({
        sourceId: sourceId.trim(),
        label: known?.name ?? undefined,
        periodStart,
        periodEnd,
        amount: value,
      })
      setSourceId('')
      setAmount('')
      notify.success('Gasto lançado.')
    } catch (err) {
      notify.error(err, 'Não foi possível lançar o gasto.')
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove.mutateAsync(id)
    } catch (err) {
      notify.error(err, 'Não foi possível excluir o gasto.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gasto por anúncio</CardTitle>
        <CardDescription>
          Lance quanto foi gasto em cada anúncio. O valor é dividido igualmente
          pelos dias do lançamento e o relatório soma só os dias do período
          consultado.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando gastos...</p>
        ) : error ? (
          <p className='text-destructive text-sm'>
            {error instanceof Error
              ? error.message
              : 'Não foi possível carregar os gastos.'}
          </p>
        ) : (spends ?? []).length > 0 ? (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Anúncio</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className='text-right'>Valor</TableHead>
                  <TableHead className='w-10'>
                    <span className='sr-only'>Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(spends ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className='max-w-64'>
                      <p className='truncate font-medium'>
                        {row.label ?? row.sourceId}
                      </p>
                      {row.label ? (
                        <p className='truncate text-muted-foreground text-xs'>
                          {row.sourceId}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {formatFullDay(row.periodStart)} a{' '}
                      {formatFullDay(row.periodEnd)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatBrl(row.amount)}
                    </TableCell>
                    <TableCell>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={`Excluir gasto de ${row.label ?? row.sourceId}`}
                        disabled={remove.isPending}
                        onClick={() => handleDelete(row.id)}
                      >
                        <SteelIcon icon={Delete02Icon} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>
            Nenhum gasto lançado ainda.
          </p>
        )}

        <form
          onSubmit={handleAdd}
          className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end'
        >
          <div className='space-y-1.5'>
            <Label htmlFor='adSpendSource'>Id do anúncio</Label>
            <Input
              id='adSpendSource'
              list='adSpendKnownAds'
              value={sourceId}
              maxLength={100}
              required
              onChange={(event) => setSourceId(event.target.value)}
            />
            <datalist id='adSpendKnownAds'>
              {knownAds.map((ad) => (
                <option key={ad.sourceId} value={ad.sourceId}>
                  {ad.name ?? ad.sourceId}
                </option>
              ))}
            </datalist>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='adSpendStart'>De</Label>
            <Input
              id='adSpendStart'
              type='date'
              value={periodStart}
              max={periodEnd || undefined}
              required
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='adSpendEnd'>Até</Label>
            <Input
              id='adSpendEnd'
              type='date'
              value={periodEnd}
              min={periodStart || undefined}
              required
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='adSpendAmount'>Valor (R$)</Label>
            <Input
              id='adSpendAmount'
              inputMode='decimal'
              placeholder='1.500,00'
              value={amount}
              required
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <Button type='submit' disabled={create.isPending}>
            Lançar gasto
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
