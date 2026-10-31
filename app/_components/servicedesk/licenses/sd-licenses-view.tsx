'use client'

import { PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatSdDate } from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import {
  SdConfirmDelete,
  SdPill,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import {
  SdField,
  SdInfoRow,
} from '@/app/_components/servicedesk/directory/shared/sd-form-bits'
import {
  type SdColumn,
  SdDataTable,
  SdFilterField,
  SdFilterSelect,
} from '@/app/_components/servicedesk/table/sd-data-table'
import { useSdTableState } from '@/app/_components/servicedesk/table/use-sd-table-state'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useSdConfigItemOptions } from '@/src/hooks/use-sd-config-items'
import {
  type SdLicenseFormInput,
  useArchiveSdLicense,
  useCreateSdLicense,
  useSdLicense,
  useSdLicenses,
  useSetSdLicenseAssets,
  useUpdateSdLicense,
} from '@/src/hooks/use-sd-licenses'
import type { SdLicenseDetailDTO, SdLicenseDTO } from '@/types/sd-license'
import {
  formatSdLicenseCents,
  SD_LICENSE_STATUS_LABEL,
  SD_LICENSE_STATUS_OPTIONS,
  SD_LICENSE_STATUS_TONE,
  sdLicenseBalanceText,
  sdLicenseExpiryText,
} from './sd-license-format'

const COLUMNS: SdColumn<SdLicenseDTO>[] = [
  {
    id: 'name',
    header: 'Licença',
    hideable: false,
    cell: (l) => (
      <div className='flex min-w-44 flex-col'>
        <span className='font-medium'>{l.name}</span>
        <span className='text-muted-foreground text-xs'>
          {l.vendor ?? 'Sem fornecedor'}
          {l.archived ? ' · arquivada' : ''}
        </span>
      </div>
    ),
  },
  {
    id: 'seats',
    header: 'Licenças',
    cell: (l) => <span className='tabular-nums'>{l.seats}</span>,
  },
  {
    id: 'installed',
    header: 'Instaladas',
    cell: (l) => <span className='tabular-nums'>{l.installed}</span>,
  },
  {
    id: 'balance',
    header: 'Saldo',
    cell: (l) => sdLicenseBalanceText(l.balance),
  },
  {
    id: 'expires',
    header: 'Vencimento',
    cell: (l) => (
      <div className='flex flex-col'>
        <span>{formatSdDate(l.expiresAt)}</span>
        <span className='text-muted-foreground text-xs'>
          {sdLicenseExpiryText(l.expiryState, l.daysLeft)}
        </span>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Situação',
    cell: (l) => (
      <SdPill className={SD_LICENSE_STATUS_TONE[l.status]}>
        {SD_LICENSE_STATUS_LABEL[l.status]}
      </SdPill>
    ),
  },
]

function SummaryCards({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useSdLicenses(workspaceId, {})
  const summary = data?.summary
  const items = [
    { label: 'Licenças cadastradas', value: summary?.total },
    { label: 'Em conformidade', value: summary?.compliant },
    { label: 'Faltam licenças', value: summary?.underLicensed },
    { label: 'Licenças sobrando', value: summary?.surplusSeats },
    { label: 'Perto de vencer', value: summary?.expiring },
    { label: 'Vencidas', value: summary?.expired },
  ]
  return (
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
      {items.map((item) => (
        <div
          key={item.label}
          className='flex flex-col gap-1 rounded-xl border border-border bg-card px-4 py-3'
        >
          <span className='text-muted-foreground text-xs'>{item.label}</span>
          {isLoading ? (
            <Skeleton className='h-6 w-10' />
          ) : (
            <span className='font-semibold text-xl tabular-nums'>
              {item.value ?? 0}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

interface FormState {
  name: string
  vendor: string
  matchPattern: string
  seats: string
  unitCost: string
  purchasedAt: string
  expiresAt: string
  renewalNoticeDays: string
  notes: string
}

const EMPTY_FORM: FormState = {
  name: '',
  vendor: '',
  matchPattern: '',
  seats: '1',
  unitCost: '',
  purchasedAt: '',
  expiresAt: '',
  renewalNoticeDays: '30',
  notes: '',
}

function formFrom(license: SdLicenseDTO | null): FormState {
  if (!license) return EMPTY_FORM
  return {
    name: license.name,
    vendor: license.vendor ?? '',
    matchPattern: license.matchPattern,
    seats: String(license.seats),
    unitCost:
      license.unitCostCents === null
        ? ''
        : (license.unitCostCents / 100).toFixed(2).replace('.', ','),
    purchasedAt: license.purchasedAt ?? '',
    expiresAt: license.expiresAt ?? '',
    renewalNoticeDays: String(license.renewalNoticeDays),
    notes: license.notes ?? '',
  }
}

/** "1.234,56" / "12,5" / "12.5" → centavos (nulo se vazio ou inválido). */
function parseCents(value: string): number | null | undefined {
  const text = value.trim()
  if (!text) return null
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text
  const number = Number(normalized)
  if (!Number.isFinite(number) || number < 0) return undefined
  return Math.round(number * 100)
}

function LicenseFormDialog({
  workspaceId,
  license,
  onClose,
}: {
  workspaceId: string
  license: SdLicenseDTO | null
  onClose: () => void
}) {
  const [form, setForm] = useState<FormState>(() => formFrom(license))
  const [error, setError] = useState<string | null>(null)
  const create = useCreateSdLicense(workspaceId)
  const update = useUpdateSdLicense(workspaceId)
  const busy = create.isPending || update.isPending
  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  function submit() {
    const seats = Number(form.seats)
    const notice = Number(form.renewalNoticeDays)
    const cents = parseCents(form.unitCost)
    if (!form.name.trim()) return setError('Informe o nome da licença.')
    if (form.matchPattern.trim().length < 2) {
      return setError('Informe parte do nome do software instalado.')
    }
    if (!Number.isInteger(seats) || seats < 0) {
      return setError('A quantidade de licenças deve ser um número inteiro.')
    }
    if (!Number.isInteger(notice) || notice < 0 || notice > 365) {
      return setError('O aviso de renovação vai de 0 a 365 dias.')
    }
    if (cents === undefined) return setError('Custo unitário inválido.')
    setError(null)

    const body: SdLicenseFormInput = {
      name: form.name.trim(),
      vendor: form.vendor.trim() || null,
      matchPattern: form.matchPattern.trim(),
      seats,
      unitCostCents: cents,
      purchasedAt: form.purchasedAt || null,
      expiresAt: form.expiresAt || null,
      renewalNoticeDays: notice,
      notes: form.notes.trim() || null,
    }
    const done = {
      onSuccess: () => {
        notify.success(license ? 'Licença salva.' : 'Licença cadastrada.')
        onClose()
      },
      onError: (err: unknown) => notify.error(err),
    }
    if (license) update.mutate({ id: license.id, data: body }, done)
    else create.mutate(body, done)
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {license ? 'Editar licença' : 'Nova licença de software'}
          </DialogTitle>
          <DialogDescription>
            A licença é comparada com o software instalado no inventário. Não
            guarde a chave aqui: ela não é armazenada.
          </DialogDescription>
        </DialogHeader>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <SdField label='Nome' htmlFor='sd-lic-name' className='sm:col-span-2'>
            <Input
              id='sd-lic-name'
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder='Ex.: Microsoft 365 Business'
            />
          </SdField>
          <SdField label='Fornecedor' htmlFor='sd-lic-vendor'>
            <Input
              id='sd-lic-vendor'
              value={form.vendor}
              onChange={(e) => set('vendor', e.target.value)}
            />
          </SdField>
          <SdField
            label='Software no inventário'
            htmlFor='sd-lic-pattern'
            hint='Trecho do nome do programa instalado, sem diferenciar maiúsculas.'
          >
            <Input
              id='sd-lic-pattern'
              value={form.matchPattern}
              onChange={(e) => set('matchPattern', e.target.value)}
              placeholder='Ex.: Microsoft Office'
            />
          </SdField>
          <SdField label='Quantidade de licenças' htmlFor='sd-lic-seats'>
            <Input
              id='sd-lic-seats'
              inputMode='numeric'
              value={form.seats}
              onChange={(e) => set('seats', e.target.value)}
            />
          </SdField>
          <SdField label='Custo por licença (R$)' htmlFor='sd-lic-cost'>
            <Input
              id='sd-lic-cost'
              inputMode='decimal'
              value={form.unitCost}
              onChange={(e) => set('unitCost', e.target.value)}
              placeholder='0,00'
            />
          </SdField>
          <SdField label='Data de compra' htmlFor='sd-lic-purchased'>
            <Input
              id='sd-lic-purchased'
              type='date'
              value={form.purchasedAt}
              onChange={(e) => set('purchasedAt', e.target.value)}
            />
          </SdField>
          <SdField label='Vencimento' htmlFor='sd-lic-expires'>
            <Input
              id='sd-lic-expires'
              type='date'
              value={form.expiresAt}
              onChange={(e) => set('expiresAt', e.target.value)}
            />
          </SdField>
          <SdField
            label='Avisar com antecedência (dias)'
            htmlFor='sd-lic-notice'
            hint='Os administradores recebem um aviso quando faltar este prazo.'
          >
            <Input
              id='sd-lic-notice'
              inputMode='numeric'
              value={form.renewalNoticeDays}
              onChange={(e) => set('renewalNoticeDays', e.target.value)}
            />
          </SdField>
          <SdField
            label='Observações'
            htmlFor='sd-lic-notes'
            className='sm:col-span-2'
          >
            <Textarea
              id='sd-lic-notes'
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
          </SdField>
        </div>
        {error ? <p className='text-destructive text-sm'>{error}</p> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Atribui ativos da CMDB à licença (busca + lista dos já atribuídos). */
function AssetsEditor({
  workspaceId,
  license,
  isAdmin,
}: {
  workspaceId: string
  license: SdLicenseDetailDTO
  isAdmin: boolean
}) {
  const [term, setTerm] = useState('')
  const set = useSetSdLicenseAssets(workspaceId)
  const options = useSdConfigItemOptions(workspaceId, {
    q: term.trim() || undefined,
    enabled: isAdmin && term.trim().length > 0,
  })
  const assignedIds = license.assets.map((a) => a.configItemId)

  function save(ids: string[], message: string) {
    set.mutate(
      { id: license.id, configItemIds: ids },
      {
        onSuccess: () => notify.success(message),
        onError: (err) => notify.error(err),
      },
    )
  }

  return (
    <section className='flex flex-col gap-2'>
      <h4 className='font-semibold text-sm'>
        Ativos com licença ({license.assets.length})
      </h4>
      {license.assets.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Nenhum ativo da CMDB foi marcado como coberto por esta licença.
        </p>
      ) : (
        <ul className='flex flex-col gap-1.5'>
          {license.assets.map((asset) => (
            <li
              key={asset.configItemId}
              className='flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm'
            >
              <span className='truncate'>
                {asset.name}
                {asset.code ? ` · ${asset.code}` : ''}
              </span>
              {isAdmin ? (
                <Button
                  size='xs'
                  variant='ghost'
                  disabled={set.isPending}
                  onClick={() =>
                    save(
                      assignedIds.filter((id) => id !== asset.configItemId),
                      'Ativo removido da licença.',
                    )
                  }
                >
                  Remover
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {isAdmin ? (
        <div className='flex flex-col gap-2'>
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder='Buscar ativo da CMDB para atribuir…'
          />
          {term.trim() && (options.data ?? []).length > 0 ? (
            <ul className='flex max-h-48 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border'>
              {(options.data ?? [])
                .filter((o) => !assignedIds.includes(o.id))
                .map((option) => (
                  <li
                    key={option.id}
                    className='flex items-center justify-between gap-3 px-3 py-1.5 text-sm'
                  >
                    <span className='min-w-0 truncate'>
                      {option.label}
                      {option.sublabel ? (
                        <span className='text-muted-foreground text-xs'>
                          {' '}
                          · {option.sublabel}
                        </span>
                      ) : null}
                    </span>
                    <Button
                      size='xs'
                      variant='outline'
                      disabled={set.isPending}
                      onClick={() => {
                        save([...assignedIds, option.id], 'Ativo atribuído.')
                        setTerm('')
                      }}
                    >
                      Atribuir
                    </Button>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function LicenseSheet({
  workspaceId,
  slug,
  licenseId,
  isAdmin,
  onClose,
  onEdit,
}: {
  workspaceId: string
  slug: string
  licenseId: string | null
  isAdmin: boolean
  onClose: () => void
  onEdit: (license: SdLicenseDTO) => void
}) {
  const { data, isLoading } = useSdLicense(workspaceId, licenseId)
  const archive = useArchiveSdLicense(workspaceId)
  const [confirming, setConfirming] = useState(false)

  return (
    <Sheet
      open={!!licenseId}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <SheetContent className='w-full gap-0 overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{data?.name ?? 'Licença'}</SheetTitle>
          <SheetDescription>
            {data
              ? `${SD_LICENSE_STATUS_LABEL[data.status]} · ${sdLicenseBalanceText(data.balance)}`
              : 'Carregando…'}
          </SheetDescription>
        </SheetHeader>
        {isLoading || !data ? (
          <div className='flex flex-col gap-2 p-4'>
            <Skeleton className='h-5 w-1/2' />
            <Skeleton className='h-5 w-2/3' />
          </div>
        ) : (
          <div className='flex flex-col gap-5 p-4'>
            {isAdmin ? (
              <div className='flex gap-2'>
                <Button size='xs' onClick={() => onEdit(data)}>
                  Editar
                </Button>
                {data.archived ? (
                  <Button
                    size='xs'
                    variant='outline'
                    disabled={archive.isPending}
                    onClick={() =>
                      archive.mutate(
                        { id: data.id, archived: false },
                        {
                          onSuccess: () =>
                            notify.success('Licença restaurada.'),
                          onError: (err) => notify.error(err),
                        },
                      )
                    }
                  >
                    Restaurar
                  </Button>
                ) : (
                  <Button
                    size='xs'
                    variant='outline'
                    onClick={() => setConfirming(true)}
                  >
                    Arquivar
                  </Button>
                )}
              </div>
            ) : null}
            <dl>
              <SdInfoRow label='Fornecedor'>{data.vendor}</SdInfoRow>
              <SdInfoRow label='Software'>{data.matchPattern}</SdInfoRow>
              <SdInfoRow label='Licenças'>{data.seats}</SdInfoRow>
              <SdInfoRow label='Instaladas'>{data.installed}</SdInfoRow>
              <SdInfoRow label='Sem licença atribuída'>
                {data.unassignedCount}
              </SdInfoRow>
              <SdInfoRow label='Custo unitário'>
                {formatSdLicenseCents(data.unitCostCents)}
              </SdInfoRow>
              <SdInfoRow label='Compra'>
                {formatSdDate(data.purchasedAt)}
              </SdInfoRow>
              <SdInfoRow label='Vencimento'>
                {data.expiresAt
                  ? `${formatSdDate(data.expiresAt)} · ${sdLicenseExpiryText(data.expiryState, data.daysLeft)}`
                  : null}
              </SdInfoRow>
              <SdInfoRow label='Observações'>{data.notes}</SdInfoRow>
            </dl>

            <AssetsEditor
              workspaceId={workspaceId}
              license={data}
              isAdmin={isAdmin}
            />

            <section className='flex flex-col gap-2'>
              <h4 className='font-semibold text-sm'>
                Equipamentos com o software ({data.installed})
              </h4>
              {data.devices.length === 0 ? (
                <p className='text-muted-foreground text-xs'>
                  Nenhum equipamento do inventário tem um programa com esse
                  nome.
                </p>
              ) : (
                <ul className='max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border'>
                  {data.devices.map((device) => (
                    <li
                      key={device.deviceId}
                      className='flex items-center justify-between gap-3 px-3 py-1.5 text-sm'
                    >
                      <span className='flex min-w-0 flex-col'>
                        <span className='truncate'>
                          {device.configItemId ? (
                            <Link
                              className='text-primary underline-offset-2 hover:underline'
                              href={`/${slug}/servicedesk/config-items?record=${device.configItemId}`}
                            >
                              {device.hostname}
                            </Link>
                          ) : (
                            device.hostname
                          )}
                        </span>
                        <span className='truncate text-muted-foreground text-xs'>
                          {device.softwareName} {device.softwareVersion}
                        </span>
                      </span>
                      <SdPill
                        className={
                          device.assigned
                            ? SD_LICENSE_STATUS_TONE.COMPLIANT
                            : SD_LICENSE_STATUS_TONE.EXPIRING
                        }
                      >
                        {device.assigned ? 'Com licença' : 'Sem atribuição'}
                      </SdPill>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
      <SdConfirmDelete
        open={confirming}
        onOpenChange={setConfirming}
        title='Arquivar licença?'
        description='A licença some da lista e deixa de gerar avisos. Dá para restaurá-la depois.'
        onConfirm={async () => {
          if (!data) return
          try {
            await archive.mutateAsync({ id: data.id, archived: true })
            notify.success('Licença arquivada.')
            onClose()
          } catch (error) {
            notify.error(error, 'Não foi possível arquivar.')
          }
        }}
      />
    </Sheet>
  )
}

export function SdLicensesView({
  workspaceId,
  slug,
  isAdmin,
}: {
  workspaceId: string
  slug: string
  isAdmin: boolean
}) {
  const table = useSdTableState({
    sort: 'name',
    filters: { status: '', archived: '' },
  })
  const { data, isLoading, error } = useSdLicenses(workspaceId, {
    search: table.q || undefined,
    status: (table.filters.status as SdLicenseDTO['status'] | '') || undefined,
    includeArchived: table.filters.archived === 'true',
  })
  const [detailId, setDetailId] = useState<string | null>(null)
  const [form, setForm] = useState<{
    open: boolean
    license: SdLicenseDTO | null
  }>({ open: false, license: null })

  // Deep link (`?record=<id>`, vindo do detalhe de um ativo): abre a licença.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('record')
    if (id) setDetailId(id)
  }, [])

  return (
    <div className='flex min-h-0 flex-col gap-4'>
      <SummaryCards workspaceId={workspaceId} />
      <SdDataTable
        storageKey='licenses'
        columns={COLUMNS}
        rows={data?.items ?? []}
        total={data?.items.length ?? 0}
        page={1}
        pageSize={200}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        search={table.search}
        onSearchChange={table.setSearch}
        searchPlaceholder='Nome ou fornecedor…'
        isLoading={isLoading}
        error={error ? error.message : null}
        onRowClick={(row) => setDetailId(row.id)}
        activeFilterCount={table.activeFilterCount}
        onClearFilters={table.clearFilters}
        actions={
          isAdmin ? (
            <Button
              size='sm'
              onClick={() => setForm({ open: true, license: null })}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Nova licença
            </Button>
          ) : null
        }
        filters={
          <>
            <SdFilterField label='Situação'>
              <SdFilterSelect
                value={table.filters.status}
                onChange={(v) => table.setFilter('status', v)}
                options={SD_LICENSE_STATUS_OPTIONS}
                allLabel='Todas'
              />
            </SdFilterField>
            <SdFilterField label='Arquivadas'>
              <SdFilterSelect
                value={table.filters.archived}
                onChange={(v) => table.setFilter('archived', v)}
                options={[{ value: 'true', label: 'Incluir arquivadas' }]}
                allLabel='Ocultar'
              />
            </SdFilterField>
          </>
        }
        emptyTitle='Nenhuma licença cadastrada'
        emptyDescription='Cadastre as licenças de software para comparar com o que está instalado no inventário e receber avisos de vencimento.'
      />
      <LicenseSheet
        workspaceId={workspaceId}
        slug={slug}
        licenseId={detailId}
        isAdmin={isAdmin}
        onClose={() => setDetailId(null)}
        onEdit={(license) => setForm({ open: true, license })}
      />
      {form.open ? (
        <LicenseFormDialog
          workspaceId={workspaceId}
          license={form.license}
          onClose={() => setForm({ open: false, license: null })}
        />
      ) : null}
    </div>
  )
}
