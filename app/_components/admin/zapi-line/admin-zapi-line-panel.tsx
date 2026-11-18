'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import {
  useDisconnectPlatformZapiLine,
  usePlatformZapiLine,
  usePlatformZapiLineQrCode,
  useRemovePlatformZapiLine,
  useRestartPlatformZapiLine,
} from '@/src/hooks/use-platform-zapi-line'
import type {
  PlatformZapiLineDTO,
  PlatformZapiLineStatusDTO,
} from '@/types/platform-zapi-line'
import {
  AdminPanel,
  EmptyState,
  formatDateTime,
  StatusPill,
} from '../shell/admin-ui'
import { ConfirmActionDialog } from '../shell/confirm-action-dialog'
import { AdminZapiLineForm } from './admin-zapi-line-form'

type Action = 'restart' | 'disconnect' | 'remove'

const STATUS_PILL: Record<
  PlatformZapiLineStatusDTO,
  ['ok' | 'warn' | 'bad', string]
> = {
  CONNECTED: ['ok', 'Conectada'],
  AWAITING_QR: ['warn', 'Aguardando QR Code'],
  DISCONNECTED: ['bad', 'Desconectada'],
  ERROR: ['bad', 'Erro'],
}

/** Digits of the paired number as `+55 11 99999-9999`-ish, without guessing. */
function formatPhone(phone: string | null): string {
  return phone ? `+${phone}` : '—'
}

function QrPanel() {
  const qr = usePlatformZapiLineQrCode(true)

  if (qr.isError) {
    return (
      <div className='space-y-3'>
        <p role='alert' className='text-destructive text-sm'>
          {qr.error instanceof Error && qr.error.message
            ? qr.error.message
            : 'Não foi possível buscar o QR Code.'}{' '}
          Confira o ID da instância e os tokens da Z-API.
        </p>
        <Button
          size='sm'
          variant='outline'
          disabled={qr.isFetching}
          onClick={() => qr.refetch()}
        >
          {qr.isFetching ? 'Tentando...' : 'Tentar de novo'}
        </Button>
      </div>
    )
  }

  if (qr.data?.status === 'connected') {
    return <p className='text-sm'>Conectada com sucesso!</p>
  }

  if (qr.data?.qrCodeBase64) {
    return (
      <div className='flex flex-col items-start gap-3 sm:flex-row sm:items-center'>
        <img
          src={qr.data.qrCodeBase64}
          alt='QR Code de conexão da linha de verificação'
          className='size-56 rounded-md border border-border bg-white p-2'
        />
        <ol className='list-decimal space-y-1 pl-4 text-muted-foreground text-sm'>
          <li>Abra o WhatsApp no celular da linha de verificação.</li>
          <li>Vá em Aparelhos conectados e toque em Conectar um aparelho.</li>
          <li>
            Escaneie o código. Ele muda a cada poucos segundos e é atualizado
            sozinho.
          </li>
        </ol>
      </div>
    )
  }

  return <p className='text-muted-foreground text-sm'>Carregando QR Code...</p>
}

function LineSummary({ line }: { line: PlatformZapiLineDTO }) {
  const rows: [string, string][] = [
    ['Instância', line.instanceIdMasked ?? '—'],
    ['Número', formatPhone(line.phone)],
    ['Nome', line.label ?? '—'],
    ['Conectada desde', formatDateTime(line.connectedAt)],
    ['Última verificação', formatDateTime(line.statusCheckedAt)],
  ]
  return (
    <dl className='grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2'>
      {rows.map(([label, value]) => (
        <div key={label} className='flex min-w-0 gap-2'>
          <dt className='shrink-0 text-muted-foreground'>{label}:</dt>
          <dd className='min-w-0 truncate font-medium'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const ACTION_COPY: Record<
  Action,
  { title: string; confirm: string; pending: string; description: string }
> = {
  restart: {
    title: 'Reiniciar a linha',
    confirm: 'Reiniciar',
    pending: 'Reiniciando...',
    description:
      'Reinicia a sessão da instância na Z-API. A conexão com o celular costuma continuar; as verificações em andamento podem falhar e ficar como "não checado".',
  },
  disconnect: {
    title: 'Desconectar a linha',
    confirm: 'Desconectar',
    pending: 'Desconectando...',
    description:
      'Desvincula o celular da instância. Enquanto a linha estiver desconectada, nenhum workspace consegue validar números e as validações em andamento terminam com os números restantes como "não checado". Será preciso ler o QR Code de novo.',
  },
  remove: {
    title: 'Remover a linha',
    confirm: 'Remover',
    pending: 'Removendo...',
    description:
      'Apaga as credenciais do Steel. A instância continua na Z-API (desconecte antes se quiser desvincular o celular). Sem linha, a validação de números fica indisponível para todos os workspaces.',
  },
}

/**
 * Global admin: the platform verification line (ADR 0069). One Z-API number,
 * paired here by scanning its QR code, answers the "has WhatsApp?" check of
 * every workspace.
 */
export function AdminZapiLinePanel({
  initial,
}: {
  initial: PlatformZapiLineDTO
}) {
  const query = usePlatformZapiLine(initial)
  const line = query.data
  const [replacing, setReplacing] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const disconnect = useDisconnectPlatformZapiLine()
  const restart = useRestartPlatformZapiLine()
  const remove = useRemovePlatformZapiLine()

  const mutation = { restart, disconnect, remove }
  const running = action ? mutation[action] : null

  function runAction(reason: string) {
    if (!action) return
    const done = action
    mutation[done].mutate(
      { reason },
      {
        onSuccess: () => {
          setAction(null)
          notify.success(
            done === 'restart'
              ? 'Linha reiniciada'
              : done === 'disconnect'
                ? 'Linha desconectada'
                : 'Linha removida',
          )
        },
        onError: (error) =>
          notify.error(error, 'Não foi possível concluir a ação'),
      },
    )
  }

  const intro = (
    <p className='max-w-3xl text-muted-foreground text-sm'>
      Este número confere, para todos os workspaces da plataforma, se os números
      de contatos têm WhatsApp (Validar números). Só o número é enviado à Z-API,
      nunca o nome. Recomendamos um número dedicado, que só faz consultas e não
      conversa com ninguém: uma consulta em volume pode levar o WhatsApp a
      limitar ou banir o número, e a validação de todos para.
    </p>
  )

  if (!line.configured || replacing) {
    return (
      <AdminPanel
        title='Linha de verificação (Z-API)'
        description={
          replacing
            ? 'Substituir as credenciais desconecta a linha atual até a leitura de um novo QR Code.'
            : 'Informe as credenciais da instância, copiadas do painel da Z-API.'
        }
      >
        <div className='space-y-5'>
          {intro}
          {!line.configured && (
            <EmptyState
              title='Nenhuma linha configurada'
              description='Enquanto não houver uma linha conectada, a validação de números fica indisponível para todos os workspaces.'
            />
          )}
          <AdminZapiLineForm
            replacing={line.configured}
            onSaved={() => setReplacing(false)}
            onCancel={line.configured ? () => setReplacing(false) : undefined}
          />
        </div>
      </AdminPanel>
    )
  }

  const status = line.status ?? 'DISCONNECTED'
  const [tone, statusLabel] = STATUS_PILL[status]
  const connected = status === 'CONNECTED'
  const copy = action ? ACTION_COPY[action] : null

  return (
    <div className='grid gap-4'>
      {!connected && (
        <div
          role='alert'
          className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-destructive text-sm'
        >
          <p className='font-medium'>
            A linha de verificação está desconectada.
          </p>
          <p>
            Enquanto isso, nenhum workspace consegue validar números.
            {status === 'ERROR' && line.statusError
              ? ` ${line.statusError}`
              : ' Leia o QR Code abaixo com o celular da linha para reconectar.'}
          </p>
        </div>
      )}

      <AdminPanel
        title='Linha de verificação (Z-API)'
        description='Um único número atende a validação de todos os workspaces.'
        actions={
          <>
            <StatusPill tone={tone} pulse={status === 'AWAITING_QR'}>
              {statusLabel}
            </StatusPill>
            <Button
              size='xs'
              variant='outline'
              disabled={query.isFetching}
              onClick={() =>
                query.refetch().then((result) => {
                  if (result.isError) {
                    notify.error(
                      result.error,
                      'Não foi possível atualizar o status',
                    )
                  }
                })
              }
            >
              {query.isFetching ? 'Atualizando...' : 'Atualizar status'}
            </Button>
          </>
        }
      >
        <div className='space-y-5'>
          {intro}
          <LineSummary line={line} />
          <div className='flex flex-wrap gap-2'>
            {connected && (
              <>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setAction('restart')}
                >
                  Reconectar
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setAction('disconnect')}
                >
                  Desconectar
                </Button>
              </>
            )}
            <Button
              size='sm'
              variant='outline'
              onClick={() => setReplacing(true)}
            >
              Substituir credenciais
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() => setAction('remove')}
            >
              Remover
            </Button>
          </div>
        </div>
      </AdminPanel>

      {!connected && (
        <AdminPanel
          title='Conectar o número'
          description='Leia o QR Code com o WhatsApp do celular que será a linha de verificação.'
        >
          <QrPanel />
        </AdminPanel>
      )}

      {copy && (
        <ConfirmActionDialog
          open
          onOpenChange={(open) => {
            if (!open) setAction(null)
          }}
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          pendingLabel={copy.pending}
          destructive={action !== 'restart'}
          requireSlug={action === 'remove' ? 'remover' : undefined}
          pending={running?.isPending ?? false}
          onConfirm={({ reason }) => runAction(reason)}
        />
      )}
    </div>
  )
}
