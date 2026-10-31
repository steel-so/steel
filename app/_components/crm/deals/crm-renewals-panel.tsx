'use client'

import { PlusSignIcon, RefreshIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import {
  useCan,
  useIsPrivileged,
} from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCreateCrmContract,
  useCrmContracts,
  useCrmUpsell,
  useDeleteCrmContract,
  useRenewCrmContract,
  useScanCrmRenewals,
} from '@/src/hooks/use-crm-deals'
import { useCrmWorkspaceLookups } from '@/src/hooks/use-crm-workspace-lookups'
import type { CrmContractDTO, CrmContractStatusDTO } from '@/types/crm-deals'
import {
  formatBRL,
  formatDealDate,
  RENEWAL_STATE_TONE,
  UPSELL_TIMING_LABEL,
  UPSELL_TIMING_TONE,
} from './deals-tone'

const LOOKUP_KINDS = ['companies'] as ['companies']

const STATUS_FILTER: { value: CrmContractStatusDTO | 'ALL'; label: string }[] = [
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'EXPIRED', label: 'Vencidos' },
  { value: 'RENEWED', label: 'Renovados' },
  { value: 'CANCELED', label: 'Cancelados' },
  { value: 'ALL', label: 'Todos' },
]

function daysText(days: number): string {
  if (days < 0) return `venceu há ${Math.abs(days)} dia(s)`
  if (days === 0) return 'vence hoje'
  return `faltam ${days} dia(s)`
}

function UpsellBlock({
  workspaceId,
  companyId,
}: {
  workspaceId: string
  companyId: string
}) {
  const upsell = useCrmUpsell(workspaceId, companyId, true)
  if (upsell.isLoading) return <Skeleton className='h-14 w-full' />
  const data = upsell.data
  if (!data) return null
  return (
    <div className='flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        <Badge
          variant='outline'
          className={UPSELL_TIMING_TONE[data.timing]}
        >
          {UPSELL_TIMING_LABEL[data.timing]}
        </Badge>
        <span className='text-muted-foreground'>{data.timingReason}</span>
      </div>
      {data.suggestions.length === 0 ? (
        <p className='text-muted-foreground'>
          Ainda não há vendas ganhas de outros clientes para comparar.
        </p>
      ) : (
        <ul className='flex flex-col gap-1'>
          {data.suggestions.map((suggestion) => (
            <li key={suggestion.productId} className='flex flex-wrap gap-x-2'>
              <span className='font-medium'>{suggestion.name}</span>
              <span className='text-muted-foreground'>
                {suggestion.adoptionPct}% dos clientes parecidos compraram
                {suggestion.unitPrice !== null
                  ? ` · ${formatBRL(suggestion.unitPrice)}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NewContractDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const create = useCreateCrmContract(workspaceId)
  const [name, setName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [value, setValue] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [autoRenews, setAutoRenews] = useState(false)

  async function submit() {
    if (!name.trim() || !companyId || !start || !end) {
      notify.error('Preencha o nome, o cliente e as datas do contrato.')
      return
    }
    const parsedValue = value.trim() ? Number(value.replace(',', '.')) : null
    if (parsedValue !== null && !(parsedValue >= 0)) {
      notify.error('Informe um valor válido.')
      return
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        companyId,
        value: parsedValue,
        startDate: new Date(`${start}T12:00:00-03:00`).toISOString(),
        endDate: new Date(`${end}T12:00:00-03:00`).toISOString(),
        autoRenews,
      })
      notify.success('Contrato cadastrado')
      setName('')
      setValue('')
      setStart('')
      setEnd('')
      setAutoRenews(false)
      onOpenChange(false)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='contract-name'>Nome</Label>
            <Input
              id='contract-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='Plano anual'
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='contract-company'>Cliente</Label>
            <Select
              value={companyId}
              onValueChange={(v) => setCompanyId(v ?? '')}
            >
              <SelectTrigger id='contract-company'>
                <SelectValue placeholder='Escolha a empresa'>
                  {lookups.maps.companies[companyId]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {lookups.options.companies.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid grid-cols-3 gap-2'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='contract-value'>Valor (R$)</Label>
              <Input
                id='contract-value'
                inputMode='decimal'
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='contract-start'>Início</Label>
              <Input
                id='contract-start'
                type='date'
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='contract-end'>Fim</Label>
              <Input
                id='contract-end'
                type='date'
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <div className='flex items-center gap-2'>
            <Checkbox
              id='contract-auto'
              checked={autoRenews}
              onCheckedChange={(checked) => setAutoRenews(checked === true)}
            />
            <Label htmlFor='contract-auto'>
              Renova sozinho no fim do prazo
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type='button' disabled={create.isPending} onClick={submit}>
            {create.isPending ? 'Salvando…' : 'Cadastrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ContractRow({
  contract,
  workspaceId,
  canEdit,
}: {
  contract: CrmContractDTO
  workspaceId: string
  canEdit: boolean
}) {
  const renew = useRenewCrmContract(workspaceId)
  const remove = useDeleteCrmContract(workspaceId)
  const [showUpsell, setShowUpsell] = useState(false)

  async function handleRenew() {
    try {
      await renew.mutateAsync(contract.id)
      notify.success('Oportunidade de renovação criada')
    } catch (error) {
      notify.error(error)
    }
  }

  async function handleRemove() {
    try {
      await remove.mutateAsync(contract.id)
      notify.success('Contrato removido')
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <li className='flex flex-col gap-2 rounded-lg border bg-card p-3'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        <div className='min-w-0'>
          <p className='truncate font-medium'>{contract.name}</p>
          <p className='truncate text-muted-foreground text-sm'>
            {contract.companyName}
            {contract.value !== null ? ` · ${formatBRL(contract.value)}` : ''}
          </p>
        </div>
        <div className='ml-auto flex flex-wrap items-center gap-2'>
          {contract.status === 'ACTIVE' ? (
            <Badge
              variant='outline'
              className={cn(RENEWAL_STATE_TONE[contract.renewalState])}
            >
              {contract.renewalStateLabel}
            </Badge>
          ) : (
            <Badge variant='outline'>{contract.status === 'RENEWED' ? 'Renovado' : contract.status === 'EXPIRED' ? 'Vencido' : 'Cancelado'}</Badge>
          )}
          <span className='text-muted-foreground text-sm'>
            {formatDealDate(contract.endDate)}
            {contract.status === 'ACTIVE' ? ` · ${daysText(contract.daysLeft)}` : ''}
          </span>
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {contract.renewalOpportunityId ? (
          <span className='text-muted-foreground text-xs'>
            Oportunidade de renovação criada
            {contract.autoRenews ? ' · renova sozinho' : ''}
          </span>
        ) : contract.autoRenews ? (
          <span className='text-muted-foreground text-xs'>Renova sozinho</span>
        ) : null}
        <div className='ml-auto flex gap-2'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => setShowUpsell((v) => !v)}
          >
            {showUpsell ? 'Ocultar expansão' : 'Ver expansão'}
          </Button>
          {canEdit &&
          contract.status === 'ACTIVE' &&
          !contract.renewalOpportunityId ? (
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={renew.isPending}
              onClick={handleRenew}
            >
              Abrir renovação
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              disabled={remove.isPending}
              onClick={handleRemove}
            >
              Remover
            </Button>
          ) : null}
        </div>
      </div>
      {showUpsell ? (
        <UpsellBlock workspaceId={workspaceId} companyId={contract.companyId} />
      ) : null}
    </li>
  )
}

/**
 * Pós-venda (C9): contratos dos clientes com o aviso de vencimento, a
 * oportunidade de renovação (criada sozinha dentro da janela configurada) e
 * as sugestões de expansão, que usam a pesquisa de satisfação e a saúde do
 * cliente para dizer se é o momento de oferecer mais.
 */
export function CrmRenewalsPanel({ workspaceId }: { workspaceId: string }) {
  const isPrivileged = useIsPrivileged()
  const canEdit = useCan('companies', 'EDIT')
  const [status, setStatus] = useState<CrmContractStatusDTO | 'ALL'>('ACTIVE')
  const [dialogOpen, setDialogOpen] = useState(false)
  const contracts = useCrmContracts(
    workspaceId,
    status === 'ALL' ? undefined : status,
  )
  const scan = useScanCrmRenewals(workspaceId)

  async function handleScan() {
    try {
      const result = await scan.mutateAsync()
      notify.success(
        `Varredura concluída: ${result.alerted} aviso(s) e ${result.renewalsCreated} renovação(ões) criada(s).`,
      )
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-auto p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={status}
          onValueChange={(v) =>
            setStatus((v as CrmContractStatusDTO | 'ALL') ?? status)
          }
        >
          <SelectTrigger size='sm' className='w-40'>
            <SelectValue>
              {STATUS_FILTER.find((f) => f.value === status)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER.map((filter) => (
              <SelectItem key={filter.value} value={filter.value}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='ml-auto flex gap-2'>
          {isPrivileged ? (
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={scan.isPending}
              onClick={handleScan}
            >
              <SteelIcon icon={RefreshIcon} strokeWidth={2} />
              Varrer agora
            </Button>
          ) : null}
          {canEdit ? (
            <Button type='button' size='sm' onClick={() => setDialogOpen(true)}>
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Novo contrato
            </Button>
          ) : null}
        </div>
      </div>

      {contracts.isLoading ? (
        <Skeleton className='h-24 w-full' />
      ) : (contracts.data ?? []).length === 0 ? (
        <p className='py-10 text-center text-muted-foreground text-sm'>
          Nenhum contrato por aqui. Cadastre os contratos dos clientes para
          receber o aviso de vencimento e ter a renovação aberta sozinha.
        </p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {(contracts.data ?? []).map((contract) => (
            <ContractRow
              key={contract.id}
              contract={contract}
              workspaceId={workspaceId}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}

      <NewContractDialog
        workspaceId={workspaceId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
