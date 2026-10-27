'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  type AccessLogFilter,
  accessLogExportUrl,
  downloadAccessLogCsv,
  useWorkspaceAccessLogs,
} from '@/src/hooks/use-workspace-access-logs'
import type { WorkspaceAccessLogDTO } from '@/types/workspace-access-log'

/**
 * Entry log of an IP-restricted workspace (ADR 0053): filters, the attempts
 * (allowed and blocked) and the CSV. Shared by Ajustes › Segurança and the
 * global admin panel; `basePath` picks the API. Times are always shown in
 * São Paulo, never in the browser's zone.
 */

export const ACCESS_LOG_TIMEZONE = 'America/Sao_Paulo'

const ANY = '__any__'

const OUTCOMES: Record<string, string> = {
  [ANY]: 'Permitidos e bloqueados',
  ALLOWED: 'Só permitidos',
  BLOCKED: 'Só bloqueados',
}

const SURFACES: Record<string, string> = {
  [ANY]: 'App e API',
  APP: 'Só app',
  API: 'Só API',
}

const integer = new Intl.NumberFormat('pt-BR')
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: ACCESS_LOG_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export function formatAccessLogDateTime(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** `2026-10-27` → `27/10/2026` (no time zone math: it is a civil day). */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split('-')
  return `${d}/${m}/${y}`
}

function OptionSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Record<string, string>
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  return (
    <Select
      value={value ?? ANY}
      onValueChange={(next) => {
        if (typeof next !== 'string') return
        onChange(next === ANY ? undefined : next)
      }}
    >
      <SelectTrigger aria-label={label} className='w-full sm:w-48'>
        <SelectValue>{(key: string) => options[key]}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {Object.entries(options).map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function EntryRow({ entry }: { entry: WorkspaceAccessLogDTO }) {
  const who = entry.userName ?? entry.userEmail ?? entry.userId ?? '—'
  return (
    <li className='flex flex-wrap items-start gap-x-4 gap-y-1 py-3'>
      <div className='min-w-0 flex-1 space-y-1'>
        <p className='break-words text-sm'>
          <span className='font-medium'>{who}</span>
          {entry.userEmail && entry.userName ? (
            <span className='text-muted-foreground'> · {entry.userEmail}</span>
          ) : null}
        </p>
        <p className='break-all text-muted-foreground text-xs'>
          <span className='font-mono'>{entry.ip ?? 'IP desconhecido'}</span>
          {entry.path ? ` · ${entry.path}` : ''}
        </p>
        {entry.userAgent ? (
          <p
            className='truncate text-muted-foreground text-xs'
            title={entry.userAgent}
          >
            {entry.userAgent}
          </p>
        ) : null}
      </div>
      <div className='flex flex-col items-end gap-1 text-right'>
        <div className='flex gap-1.5'>
          <Badge
            variant={entry.outcome === 'BLOCKED' ? 'destructive' : 'secondary'}
          >
            {entry.outcome === 'BLOCKED' ? 'Bloqueado' : 'Permitido'}
          </Badge>
          <Badge variant='outline'>
            {entry.surface === 'API' ? 'API' : 'App'}
          </Badge>
        </div>
        <p className='text-muted-foreground text-xs tabular-nums'>
          {formatAccessLogDateTime(entry.createdAt)}
        </p>
      </div>
    </li>
  )
}

export function AccessLogViewer({
  basePath,
  showAllowlist = false,
}: {
  basePath: string
  /** Shows the allowlist read-only above the log (Ajustes › Segurança). */
  showAllowlist?: boolean
}) {
  const [filter, setFilter] = useState<AccessLogFilter>({ page: 1 })
  const [userDraft, setUserDraft] = useState('')
  const [exporting, setExporting] = useState(false)
  const list = useWorkspaceAccessLogs(basePath, filter)
  const update = (patch: Partial<AccessLogFilter>) =>
    setFilter((current) => ({ ...current, ...patch, page: 1 }))

  const data = list.data
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0

  async function handleExport() {
    setExporting(true)
    try {
      await downloadAccessLogCsv(accessLogExportUrl(basePath, filter))
    } catch (error) {
      notify.error(error)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className='space-y-5'>
      {showAllowlist && data ? (
        <section className='space-y-2 rounded-xl border p-4'>
          <h4 className='font-medium text-sm'>Redes permitidas</h4>
          {data.allowedIps.length > 0 ? (
            <>
              <ul className='flex flex-wrap gap-1.5'>
                {data.allowedIps.map((entry) => (
                  <li key={entry}>
                    <Badge variant='outline' className='font-mono'>
                      {entry}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className='text-muted-foreground text-xs'>
                Fora dessas redes o app e a API ficam bloqueados. A lista é
                definida pela equipe da Stratus Telecom — fale com o suporte
                para alterá-la.
              </p>
            </>
          ) : (
            <p className='text-muted-foreground text-sm'>
              Sem restrição de IP: o workspace abre de qualquer rede e as
              entradas não são registradas. Para restringir, fale com o suporte
              da Stratus Telecom.
            </p>
          )}
        </section>
      ) : null}

      <div className='flex flex-wrap items-end gap-2'>
        <div className='w-full space-y-1 sm:w-40'>
          <Label htmlFor='access-log-from' className='text-xs'>
            De
          </Label>
          <Input
            id='access-log-from'
            type='date'
            value={filter.from ?? ''}
            max={filter.to}
            onChange={(event) =>
              update({ from: event.target.value || undefined })
            }
          />
        </div>
        <div className='w-full space-y-1 sm:w-40'>
          <Label htmlFor='access-log-to' className='text-xs'>
            Até
          </Label>
          <Input
            id='access-log-to'
            type='date'
            value={filter.to ?? ''}
            min={filter.from}
            onChange={(event) =>
              update({ to: event.target.value || undefined })
            }
          />
        </div>
        <OptionSelect
          label='Resultado'
          options={OUTCOMES}
          value={filter.outcome}
          onChange={(outcome) =>
            update({ outcome: outcome as AccessLogFilter['outcome'] })
          }
        />
        <OptionSelect
          label='Canal'
          options={SURFACES}
          value={filter.surface}
          onChange={(surface) =>
            update({ surface: surface as AccessLogFilter['surface'] })
          }
        />
        <form
          className='w-full sm:w-56'
          onSubmit={(event) => {
            event.preventDefault()
            update({ user: userDraft.trim() || undefined })
          }}
        >
          <Input
            aria-label='Usuário'
            placeholder='Nome ou e-mail'
            value={userDraft}
            onChange={(event) => setUserDraft(event.target.value)}
            onBlur={() => update({ user: userDraft.trim() || undefined })}
          />
        </form>
        <Button
          variant='outline'
          className='w-full sm:ml-auto sm:w-auto'
          disabled={exporting}
          onClick={handleExport}
        >
          <SteelIcon icon={Download01Icon} size={14} />
          {exporting ? 'Exportando...' : 'Exportar CSV'}
        </Button>
      </div>

      {data ? (
        <p className='text-muted-foreground text-xs'>
          {formatDayKey(data.period.from)} a {formatDayKey(data.period.to)} ·
          horários de São Paulo · entradas repetidas da mesma pessoa e rede
          contam uma vez a cada 30 min (permitidas) ou a cada minuto
          (bloqueadas)
        </p>
      ) : null}

      {list.isError ? (
        <p className='text-destructive text-sm'>{list.error.message}</p>
      ) : !data ? (
        <div className='space-y-2' data-testid='access-log-loading'>
          <Skeleton className='h-14 w-full' />
          <Skeleton className='h-14 w-full' />
        </div>
      ) : data.items.length === 0 ? (
        <p className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
          Nenhuma entrada com esses filtros.
        </p>
      ) : (
        <>
          <ul className='divide-y rounded-xl border px-4'>
            {data.items.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ul>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p className='text-muted-foreground text-xs'>
              {integer.format(first)}–{integer.format(last)} de{' '}
              {integer.format(data.total)}
            </p>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={data.page <= 1}
                onClick={() =>
                  setFilter((current) => ({
                    ...current,
                    page: (current.page ?? 1) - 1,
                  }))
                }
              >
                Anterior
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={last >= data.total}
                onClick={() =>
                  setFilter((current) => ({
                    ...current,
                    page: (current.page ?? 1) + 1,
                  }))
                }
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
