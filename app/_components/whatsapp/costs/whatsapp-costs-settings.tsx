'use client'

import { Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { type FormEvent, useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  useCreateWhatsAppPrice,
  useDeleteWhatsAppPrice,
  useUpdateWhatsAppCostSettings,
  useWhatsAppCostSettings,
  useWhatsAppPrices,
} from '@/src/hooks/use-whatsapp-costs'
import type { WhatsAppCostSettingsDTO } from '@/types/whatsapp-cost'
import { formatBrlPrice, formatFullDay } from './whatsapp-costs-format'

const CATEGORY_LABEL = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
} as const

type PriceCategory = keyof typeof CATEGORY_LABEL

/** "1.234,56", "1234.56" and "12,5" all become numbers; blank is null. */
export function parseMoneyInput(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : trimmed
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function moneyText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}

function PriceTable({ workspaceId }: { workspaceId: string }) {
  const { data: prices, isLoading, error } = useWhatsAppPrices(workspaceId)
  const createPrice = useCreateWhatsAppPrice(workspaceId)
  const deletePrice = useDeleteWhatsAppPrice(workspaceId)
  const [category, setCategory] = useState<PriceCategory>('MARKETING')
  const [country, setCountry] = useState('BR')
  const [price, setPrice] = useState('')
  const [litePrice, setLitePrice] = useState('')
  const [validFrom, setValidFrom] = useState('')

  async function handleAdd(event: FormEvent) {
    event.preventDefault()
    const unitPrice = parseMoneyInput(price)
    if (unitPrice === null || unitPrice === undefined) {
      notify.error('Informe um preço válido (ex.: 0,3625).')
      return
    }
    // Marketing Messages Lite price: MARKETING only, blank = same price.
    const lite =
      category === 'MARKETING' && litePrice.trim() !== ''
        ? parseMoneyInput(litePrice)
        : null
    if (lite === undefined) {
      notify.error('Informe um preço válido para a Marketing Messages Lite.')
      return
    }
    try {
      await createPrice.mutateAsync({
        category,
        country: country.trim() || 'BR',
        unitPrice,
        liteUnitPrice: lite,
        // Midnight of the chosen day in São Paulo.
        ...(validFrom ? { validFrom: `${validFrom}T03:00:00.000Z` } : {}),
      })
      setPrice('')
      setLitePrice('')
      setValidFrom('')
      notify.success('Preço salvo.')
    } catch (err) {
      notify.error(err, 'Não foi possível salvar o preço.')
    }
  }

  async function handleDelete(id: string) {
    try {
      await deletePrice.mutateAsync(id)
    } catch (err) {
      notify.error(err, 'Não foi possível excluir o preço.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tabela de preços da Meta</CardTitle>
        <CardDescription>
          Preço por mensagem de template, por categoria e país. Cada envio
          guarda o preço vigente no momento; alterar a tabela não muda o
          histórico. Em Marketing, o preço da Marketing Messages Lite é
          opcional: em branco, as mensagens enviadas por ela custam o mesmo.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <p className='rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-xs'>
          Valores de referência — confira na sua conta Meta. A Meta reajusta os
          preços e eles variam por país; os valores iniciais são apenas um ponto
          de partida editável.
        </p>

        {isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando preços...</p>
        ) : error ? (
          <p className='text-destructive text-sm'>
            {error instanceof Error
              ? error.message
              : 'Não foi possível carregar a tabela de preços.'}
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categoria</TableHead>
                  <TableHead>País</TableHead>
                  <TableHead className='text-right'>Preço</TableHead>
                  <TableHead className='text-right'>Marketing Lite</TableHead>
                  <TableHead>Vale a partir de</TableHead>
                  <TableHead className='w-10'>
                    <span className='sr-only'>Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(prices ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className='font-medium'>
                      {CATEGORY_LABEL[row.category]}
                    </TableCell>
                    <TableCell>{row.country}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatBrlPrice(row.unitPrice)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {row.liteUnitPrice === null ||
                      row.liteUnitPrice === undefined
                        ? '—'
                        : formatBrlPrice(row.liteUnitPrice)}
                    </TableCell>
                    <TableCell>
                      {row.reference ? (
                        <Badge variant='outline'>Referência</Badge>
                      ) : (
                        formatFullDay(row.validFrom.slice(0, 10))
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        aria-label={`Excluir preço de ${CATEGORY_LABEL[row.category]} (${row.country})`}
                        disabled={deletePrice.isPending}
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
        )}

        <form
          onSubmit={handleAdd}
          className='grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end'
        >
          <div className='space-y-1.5'>
            <Label htmlFor='costPriceCategory'>Categoria</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as PriceCategory)}
            >
              <SelectTrigger id='costPriceCategory' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {(Object.keys(CATEGORY_LABEL) as PriceCategory[]).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {CATEGORY_LABEL[key]}
                      </SelectItem>
                    ),
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='costPriceCountry'>País (2 letras)</Label>
            <Input
              id='costPriceCountry'
              value={country}
              maxLength={2}
              onChange={(event) => setCountry(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='costPriceValue'>Preço (R$)</Label>
            <Input
              id='costPriceValue'
              inputMode='decimal'
              placeholder='0,3625'
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='costPriceLite'>Marketing Lite (R$)</Label>
            <Input
              id='costPriceLite'
              inputMode='decimal'
              placeholder='Igual ao preço'
              disabled={category !== 'MARKETING'}
              value={litePrice}
              onChange={(event) => setLitePrice(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='costPriceFrom'>Vale a partir de</Label>
            <Input
              id='costPriceFrom'
              type='date'
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
            />
          </div>
          <Button type='submit' disabled={createPrice.isPending}>
            {createPrice.isPending ? 'Salvando...' : 'Salvar preço'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function BudgetAndFees({
  workspaceId,
  settings,
}: {
  workspaceId: string
  settings: WhatsAppCostSettingsDTO
}) {
  const update = useUpdateWhatsAppCostSettings(workspaceId)
  const [budget, setBudget] = useState(moneyText(settings.monthlyCostBudget))
  const [fees, setFees] = useState<Record<string, string>>({})

  useEffect(() => {
    setBudget(moneyText(settings.monthlyCostBudget))
    setFees(
      Object.fromEntries(
        settings.connections.map((c) => [c.id, moneyText(c.monthlyFee)]),
      ),
    )
  }, [settings])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const monthlyCostBudget = parseMoneyInput(budget)
    if (monthlyCostBudget === undefined) {
      notify.error(
        'Informe um orçamento válido (ex.: 500,00) ou deixe em branco.',
      )
      return
    }
    const connectionFees: {
      connectionId: string
      monthlyFee: number | null
    }[] = []
    for (const connection of settings.connections) {
      const monthlyFee = parseMoneyInput(fees[connection.id] ?? '')
      if (monthlyFee === undefined) {
        notify.error(`Mensalidade inválida em "${connection.label}".`)
        return
      }
      connectionFees.push({ connectionId: connection.id, monthlyFee })
    }
    try {
      await update.mutateAsync({ monthlyCostBudget, connectionFees })
      notify.success('Orçamento e mensalidades salvos.')
    } catch (err) {
      notify.error(err, 'Não foi possível salvar.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orçamento e mensalidades</CardTitle>
        <CardDescription>
          O orçamento só avisa os administradores ao chegar a 80% e a 100% do
          mês; nenhum envio é bloqueado. A mensalidade é o valor fixo pago pela
          linha (por exemplo, a instância da Z-API) e entra no custo por
          mensagem.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='max-w-xs space-y-1.5'>
            <Label htmlFor='costBudget'>Orçamento mensal (R$)</Label>
            <Input
              id='costBudget'
              inputMode='decimal'
              placeholder='Sem orçamento'
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
          </div>
          {settings.connections.length > 0 ? (
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {settings.connections.map((connection) => (
                <div key={connection.id} className='space-y-1.5'>
                  <Label htmlFor={`costFee-${connection.id}`}>
                    Mensalidade — {connection.label}
                    <span className='ml-1 text-muted-foreground text-xs'>
                      {connection.provider === 'META' ? 'Meta' : 'Z-API'}
                    </span>
                  </Label>
                  <Input
                    id={`costFee-${connection.id}`}
                    inputMode='decimal'
                    placeholder='Sem mensalidade'
                    value={fees[connection.id] ?? ''}
                    onChange={(event) =>
                      setFees((current) => ({
                        ...current,
                        [connection.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}
          <Button type='submit' disabled={update.isPending}>
            {update.isPending ? 'Salvando...' : 'Salvar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Price table, budget and monthly fees — OWNER/ADMIN only (API enforces). */
export function WhatsAppCostsSettings({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data, isLoading, error } = useWhatsAppCostSettings(workspaceId)
  return (
    <div className='space-y-4'>
      {isLoading ? (
        <p className='text-muted-foreground text-sm'>Carregando...</p>
      ) : data ? (
        <BudgetAndFees workspaceId={workspaceId} settings={data} />
      ) : (
        <p className='text-destructive text-sm'>
          {error instanceof Error
            ? error.message
            : 'Não foi possível carregar o orçamento.'}
        </p>
      )}
      <PriceTable workspaceId={workspaceId} />
    </div>
  )
}
