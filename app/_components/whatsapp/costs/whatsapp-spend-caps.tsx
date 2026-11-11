'use client'

import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useUpdateWhatsAppSpendCap,
  useWhatsAppSpendCaps,
} from '@/src/hooks/use-whatsapp-spend-caps'
import type {
  WhatsAppSpendCapModeDTO,
  WhatsAppSpendCapStatusDTO,
  WhatsAppSpendSourceDTO,
} from '@/types/whatsapp-spend-cap'
import { formatBrl, formatCount } from './whatsapp-costs-format'
import { parseMoneyInput } from './whatsapp-costs-settings'

const SOURCE_LABEL: Record<WhatsAppSpendSourceDTO, string> = {
  META_COST: 'Custo da Meta',
  META_VOLUME: 'Volume da Meta × tabela',
  STEEL_LEDGER: 'Só registros do Steel',
}

const SOURCE_HINT: Record<WhatsAppSpendSourceDTO, string> = {
  META_COST: 'Valor cobrado informado pela própria Meta.',
  META_VOLUME:
    'A Meta não liberou o valor cobrado para o Steel; usamos a quantidade de mensagens pagas que ela informa vezes a sua tabela de preços.',
  STEEL_LEDGER:
    'A Meta ainda não foi consultada neste mês; o valor vem dos envios registrados pelo Steel.',
}

const MODE_LABEL: Record<WhatsAppSpendCapModeDTO, string> = {
  WARN: 'Só avisar',
  BLOCK: 'Bloquear envios pagos',
}

/** "há 3 min" from an ISO instant; pure arithmetic, no time zone involved. */
export function formatFetchedAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'ainda não consultado na Meta'
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'agora há pouco'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

function moneyText(value: number | null): string {
  return value === null ? '' : String(value).replace('.', ',')
}

function StatusBadge({ status }: { status: WhatsAppSpendCapStatusDTO }) {
  if (status.status === 'NO_CAP') {
    return <Badge variant='outline'>Sem limite</Badge>
  }
  if (status.status === 'BLOCKED') {
    return <Badge variant='destructive'>Bloqueado</Badge>
  }
  return <Badge variant='secondary'>Liberado</Badge>
}

function CapProgress({ status }: { status: WhatsAppSpendCapStatusDTO }) {
  if (status.monthlyCapAmount === null) return null
  const percent = Math.min(100, status.percent ?? 0)
  return (
    <div className='space-y-1.5'>
      <div
        role='progressbar'
        aria-label={`Consumo do limite de ${status.label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className='h-2 overflow-hidden rounded-full bg-muted'
      >
        <div
          className={cn(
            'h-full rounded-full',
            status.level === 100
              ? 'bg-destructive'
              : status.level === 80
                ? 'bg-highlight'
                : 'bg-primary',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className='text-muted-foreground text-xs'>
        {formatBrl(status.spent)} de {formatBrl(status.monthlyCapAmount)} (
        {status.percent ?? 0}%) ·{' '}
        {status.capMode === 'BLOCK'
          ? 'bloqueia envios pagos ao atingir'
          : 'só avisa ao atingir'}
      </p>
    </div>
  )
}

/** Cap amount + mode of one number; also used in the connection settings. */
export function SpendCapDialog({
  workspaceId,
  status,
  open,
  onOpenChange,
}: {
  workspaceId: string
  status: WhatsAppSpendCapStatusDTO
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateWhatsAppSpendCap(workspaceId)
  const [amount, setAmount] = useState(moneyText(status.monthlyCapAmount))
  const [mode, setMode] = useState<WhatsAppSpendCapModeDTO>(
    status.capMode ?? 'BLOCK',
  )

  async function save(monthlyCapAmount: number | null) {
    try {
      await update.mutateAsync({
        connectionId: status.connectionId,
        monthlyCapAmount,
        capMode: mode,
      })
      notify.success(
        monthlyCapAmount === null ? 'Limite removido.' : 'Limite salvo.',
      )
      onOpenChange(false)
    } catch (error) {
      notify.error(error, 'Não foi possível salvar o limite.')
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const value = parseMoneyInput(amount)
    if (value === undefined || value === 0) {
      notify.error('Informe um limite válido (ex.: 1.500,00).')
      return
    }
    void save(value)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Limite de gasto — {status.label}</DialogTitle>
          <DialogDescription>
            Gasto do mês até agora: {formatBrl(status.spent)}, pelos dados da
            Meta. Respostas dentro da janela de 24 horas nunca são bloqueadas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor={`spendCap-${status.connectionId}`}>
              Limite mensal (R$)
            </Label>
            <Input
              id={`spendCap-${status.connectionId}`}
              inputMode='decimal'
              placeholder='Ex.: 1.500,00'
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor={`spendCapMode-${status.connectionId}`}>
              Ao atingir o limite
            </Label>
            <Select
              value={mode}
              onValueChange={(value) =>
                setMode((value as WhatsAppSpendCapModeDTO | null) ?? 'BLOCK')
              }
            >
              <SelectTrigger
                id={`spendCapMode-${status.connectionId}`}
                className='w-full'
              >
                <SelectValue>{MODE_LABEL[mode]}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='BLOCK'>{MODE_LABEL.BLOCK}</SelectItem>
                  <SelectItem value='WARN'>{MODE_LABEL.WARN}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              {mode === 'BLOCK'
                ? 'Templates (mensagens pagas) deixam de sair quando o próximo envio passaria do limite. Transmissões e campanhas param com o motivo.'
                : 'Os administradores são avisados a 80% e a 100%; nada é bloqueado.'}
            </p>
          </div>
          <DialogFooter className='gap-2'>
            {status.monthlyCapAmount !== null ? (
              <Button
                type='button'
                variant='outline'
                disabled={update.isPending}
                onClick={() => void save(null)}
              >
                Remover limite
              </Button>
            ) : null}
            <Button type='submit' disabled={update.isPending}>
              {update.isPending ? 'Salvando...' : 'Salvar limite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SpendCapRow({
  workspaceId,
  status,
}: {
  workspaceId: string
  status: WhatsAppSpendCapStatusDTO
}) {
  const [editing, setEditing] = useState(false)
  return (
    <li className='space-y-3 rounded-lg border p-4'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='min-w-0'>
          <p className='truncate font-medium text-sm'>{status.label}</p>
          <p className='text-muted-foreground text-xs'>{status.phoneNumber}</p>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge variant='outline' title={SOURCE_HINT[status.source]}>
            {SOURCE_LABEL[status.source]}
          </Badge>
          <StatusBadge status={status} />
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
        <div>
          <p className='text-muted-foreground text-xs'>Gasto no mês</p>
          <p className='font-semibold text-lg tabular-nums'>
            {formatBrl(status.spent)}
          </p>
          <p className='text-muted-foreground text-xs'>
            Meta {formatBrl(status.metaSpent)} + hoje{' '}
            {formatBrl(status.ledgerSpent)}
          </p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>Projeção do mês</p>
          <p className='font-semibold text-lg tabular-nums'>
            {formatBrl(status.projection)}
          </p>
          <p className='text-muted-foreground text-xs'>
            Pelo ritmo de {status.daysElapsed} de {status.daysInMonth} dias
          </p>
        </div>
        <div>
          <p className='text-muted-foreground text-xs'>Limite mensal</p>
          <p className='font-semibold text-lg tabular-nums'>
            {status.monthlyCapAmount === null
              ? 'Não definido'
              : formatBrl(status.monthlyCapAmount)}
          </p>
          <p className='text-muted-foreground text-xs'>
            {status.capMode ? MODE_LABEL[status.capMode] : 'Sem trava'}
          </p>
        </div>
      </div>

      <CapProgress status={status} />

      {status.byCategory.length > 0 ? (
        <ul className='flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs'>
          {status.byCategory.map((row) => (
            <li key={row.category}>
              {row.label}: {formatCount(row.volume)} msg ·{' '}
              {formatBrl(row.cost)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p
          className={cn(
            'text-xs',
            status.stale ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {status.stale && status.staleReason
            ? `${status.staleReason} `
            : null}
          {status.fetchedAt
            ? `Atualizado ${formatFetchedAgo(status.fetchedAt)}, direto da Meta.`
            : 'Ainda não lido na Meta neste mês; mostrando os envios registrados pelo Steel.'}
        </p>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() => setEditing(true)}
        >
          {status.monthlyCapAmount === null
            ? 'Definir limite'
            : 'Alterar limite'}
        </Button>
      </div>

      {editing ? (
        <SpendCapDialog
          workspaceId={workspaceId}
          status={status}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </li>
  )
}

/**
 * "Gasto real por número" on the costs tab (ADR 0064): Meta's month spend
 * of each number, the cap and whether paid sends are blocked.
 */
export function WhatsAppSpendCapsCard({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data, isLoading, error } = useWhatsAppSpendCaps(workspaceId)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gasto real por número (Meta)</CardTitle>
        <CardDescription>
          Valores lidos da Meta a cada acesso a esta página e a cada 15 minutos
          para os números com limite. A Meta informa os dias já encerrados (em
          UTC); o dia de hoje vem dos envios registrados pelo Steel. Com o
          modo bloquear, templates deixam de sair ao atingir o limite.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className='h-32 w-full rounded-lg' aria-busy />
        ) : error ? (
          <p className='text-destructive text-sm'>
            Não foi possível consultar o gasto dos números agora.
          </p>
        ) : data && data.length > 0 ? (
          <ul className='space-y-3'>
            {data.map((status) => (
              <SpendCapRow
                key={status.connectionId}
                workspaceId={workspaceId}
                status={status}
              />
            ))}
          </ul>
        ) : (
          <p className='text-muted-foreground text-sm'>
            Nenhum número da API oficial da Meta conectado. O limite de gasto
            vale só para números da Meta.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "Limite de gasto" button on a Meta connection card (connection
 * settings). Renders nothing for non-admins (the API refuses them).
 */
export function ConnectionSpendCapButton({
  workspaceId,
  connectionId,
}: {
  workspaceId: string
  connectionId: string
}) {
  const [open, setOpen] = useState(false)
  const { data } = useWhatsAppSpendCaps(workspaceId)
  const status = data?.find((row) => row.connectionId === connectionId)
  if (!status) return null
  return (
    <>
      <Button
        size='xs'
        variant='outline'
        title={`Gasto no mês: ${formatBrl(status.spent)} (Meta)`}
        onClick={() => setOpen(true)}
      >
        {status.monthlyCapAmount === null
          ? 'Limite de gasto'
          : `Limite: ${formatBrl(status.monthlyCapAmount)}`}
      </Button>
      {open ? (
        <SpendCapDialog
          workspaceId={workspaceId}
          status={status}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}
