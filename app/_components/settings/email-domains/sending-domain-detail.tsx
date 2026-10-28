'use client'

import {
  Copy01Icon,
  Delete02Icon,
  InformationCircleIcon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import type {
  SendingDomainDmarcDTO,
  SendingDomainDTO,
} from '@/src/schemas/sending-domain.schema'
import {
  DOMAIN_STATUS,
  formatDomainDate,
  recordPurpose,
  recordStatus,
} from './sending-domain-format'
import { StatusBadge } from './sending-domain-status-badge'

/**
 * One domain: status, what to do next, the DNS records to copy, the DMARC
 * hint, "Verificar agora" and remove.
 */

export function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      className='size-7 shrink-0'
      aria-label={`Copiar ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        notify.success('Copiado')
      }}
    >
      <SteelIcon icon={Copy01Icon} strokeWidth={2} className='size-3.5' />
    </Button>
  )
}

function CopyableValue({ value, label }: { value: string; label: string }) {
  return (
    <div className='flex min-w-0 items-start gap-1'>
      <code className='min-w-0 flex-1 break-all font-mono text-xs'>
        {value}
      </code>
      <CopyButton value={value} label={label} />
    </div>
  )
}

function DnsRecordsTable({ domain }: { domain: SendingDomainDTO }) {
  if (domain.records.length === 0) {
    return (
      <Muted className='text-sm'>
        O provedor ainda não devolveu os registros. Clique em "Verificar agora"
        em alguns instantes.
      </Muted>
    )
  }
  return (
    <Table className='table-fixed' containerClassName='rounded-lg border'>
      <TableHeader>
        <TableRow>
          <TableHead className='w-20'>Tipo</TableHead>
          <TableHead className='w-[30%]'>Nome</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead className='w-32'>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {domain.records.map((record) => {
          const status = recordStatus(record.status)
          return (
            <TableRow key={`${record.record}-${record.type}-${record.name}`}>
              <TableCell className='align-top whitespace-normal'>
                <span className='block font-medium'>{record.type}</span>
                {typeof record.priority === 'number' ? (
                  <span className='block text-[11px] text-muted-foreground'>
                    prioridade {record.priority}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className='align-top whitespace-normal'>
                <CopyableValue value={record.name} label='nome' />
                <span className='mt-1 block text-[11px] text-muted-foreground'>
                  {recordPurpose(record)}
                </span>
              </TableCell>
              <TableCell className='align-top whitespace-normal'>
                <CopyableValue value={record.value} label='valor' />
              </TableCell>
              <TableCell className='align-top whitespace-normal'>
                <StatusBadge label={status.label} tone={status.tone} />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function DmarcHint({ dmarc }: { dmarc: SendingDomainDmarcDTO | undefined }) {
  if (!dmarc) return null
  if (dmarc.found === true) {
    return (
      <Alert>
        <SteelIcon icon={InformationCircleIcon} strokeWidth={2} />
        <AlertTitle>DMARC encontrado</AlertTitle>
        <AlertDescription className='flex min-w-0 flex-col gap-1'>
          <span>
            O domínio já tem uma política DMARC em{' '}
            <code className='break-all'>{dmarc.name}</code>:
          </span>
          <code className='break-all text-xs'>{dmarc.value}</code>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert>
      <SteelIcon icon={InformationCircleIcon} strokeWidth={2} />
      <AlertTitle>
        {dmarc.found === false
          ? 'Recomendado: adicione um registro DMARC'
          : 'Não foi possível consultar o DMARC agora'}
      </AlertTitle>
      <AlertDescription className='flex min-w-0 flex-col gap-2'>
        <span>
          Não é obrigatório para verificar o domínio, mas Gmail e Yahoo exigem
          DMARC de quem envia em volume. Sem ele, parte das newsletters pode
          cair no spam. Crie um registro TXT no domínio principal:
        </span>
        <div className='grid min-w-0 gap-2 sm:grid-cols-[auto_1fr] sm:items-start'>
          <span className='text-xs text-muted-foreground'>Nome</span>
          <CopyableValue value={dmarc.name} label='nome do DMARC' />
          <span className='text-xs text-muted-foreground'>Valor</span>
          <CopyableValue value={dmarc.suggested} label='valor do DMARC' />
        </div>
        <span className='text-xs'>
          Se o domínio já tiver DMARC com outro valor, não crie um segundo:
          mantenha o que existe.
        </span>
      </AlertDescription>
    </Alert>
  )
}

export function SendingDomainDetail({
  domain,
  loading,
  verifying,
  removing,
  onVerify,
  onRemove,
}: {
  domain: SendingDomainDTO | undefined
  loading: boolean
  verifying: boolean
  removing: boolean
  onVerify: () => void
  onRemove: () => void
}) {
  if (loading || !domain) {
    return (
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-6 w-48' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  const status = DOMAIN_STATUS[domain.status]
  const lastChecked = formatDomainDate(domain.lastCheckedAt)
  const verifiedAt = formatDomainDate(domain.verifiedAt)

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <div className='flex flex-col gap-1 text-sm'>
        <span>{status.hint}</span>
        {domain.failureReason ? (
          <span className='text-destructive'>{domain.failureReason}</span>
        ) : null}
        <Muted className='text-xs'>
          {verifiedAt ? `Verificado desde ${verifiedAt}. ` : ''}
          Última verificação: {lastChecked ?? 'nunca'}.
          {domain.status === 'VERIFIED'
            ? ' O Steel confere de novo uma vez por dia.'
            : ' O Steel confere sozinho a cada 10 minutos nas primeiras 72 horas e depois uma vez por dia.'}
        </Muted>
      </div>

      <div className='flex min-w-0 flex-col gap-2'>
        <span className='text-sm font-medium'>Registros DNS</span>
        <Muted className='text-xs'>
          Crie cada linha no painel de DNS de onde o domínio está registrado
          (Registro.br, Cloudflare, GoDaddy, Hostinger…). No campo "Nome", cole
          exatamente o que aparece aqui: a maioria dos painéis completa o
          domínio sozinha. No Cloudflare, deixe a nuvem cinza ("Somente DNS").
        </Muted>
        <DnsRecordsTable domain={domain} />
      </div>

      <DmarcHint dmarc={domain.dmarc} />

      <div className='flex flex-wrap items-center gap-2'>
        <Button type='button' disabled={verifying} onClick={onVerify}>
          <SteelIcon icon={RefreshIcon} strokeWidth={2} />
          {verifying ? 'Verificando…' : 'Verificar agora'}
        </Button>
        <Button
          type='button'
          variant='destructive'
          disabled={removing}
          onClick={onRemove}
        >
          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          Remover domínio
        </Button>
      </div>
    </div>
  )
}
