'use client'

import { Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import {
  useSdRemoteEndpointMutations,
  useSdRemoteEndpoints,
  useSdRemoteSessions,
  useSdRemoteSettings,
} from '@/src/hooks/use-sd-remote'
import { SD_REMOTE_PROVIDERS } from '@/src/lib/servicedesk/remote-access'
import { SdRemoteConnectButton } from './sd-remote-connect-button'

function sessionTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: timeZone ?? 'America/Sao_Paulo',
  }).format(new Date(iso))
}

/**
 * Bloco "Acesso remoto" do detalhe do ativo: ID do provedor do workspace,
 * botão Conectar e as últimas sessões. Invisível com o recurso desligado.
 */
export function SdRemotePanel({
  workspaceId,
  configItemId,
}: {
  workspaceId: string
  configItemId: string
}) {
  const settings = useSdRemoteSettings(workspaceId)
  const endpoints = useSdRemoteEndpoints(workspaceId, configItemId)
  const sessions = useSdRemoteSessions(workspaceId, configItemId)
  const { save, remove } = useSdRemoteEndpointMutations(workspaceId)
  const [draft, setDraft] = useState('')

  if (!settings.data?.enabled) return null
  const provider = settings.data.provider
  const label = SD_REMOTE_PROVIDERS[provider].label
  const current = (endpoints.data ?? []).find((e) => e.provider === provider)

  function submit() {
    const remoteId = draft.trim()
    if (!remoteId) return
    save.mutate(
      { configItemId, provider, remoteId },
      {
        onSuccess: () => {
          setDraft('')
          notify.success('ID de acesso remoto salvo')
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <section className='mt-6 flex flex-col gap-3 rounded-xl border border-border p-4'>
      <header className='flex items-center justify-between gap-3'>
        <div>
          <h4 className='text-sm font-semibold'>Acesso remoto ({label})</h4>
          <p className='text-xs text-muted-foreground'>
            Só o ID público da máquina é guardado; nunca a senha.
          </p>
        </div>
        <SdRemoteConnectButton
          workspaceId={workspaceId}
          configItemId={configItemId}
        />
      </header>

      {current ? (
        <div className='flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2'>
          <span className='text-sm'>
            ID <code className='font-mono'>{current.remoteId}</code>
            {current.source === 'INVENTORY' ? (
              <span className='ml-2 text-xs text-muted-foreground'>
                veio do inventário
              </span>
            ) : null}
          </span>
          <Button
            type='button'
            size='icon-xs'
            variant='ghost'
            aria-label='Remover o ID'
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(current.id, {
                onError: (error) => notify.error(error),
              })
            }
          >
            <SteelIcon
              icon={Delete02Icon}
              strokeWidth={2}
              className='text-destructive'
            />
          </Button>
        </div>
      ) : null}

      <form
        className='flex gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            current ? `Trocar o ID do ${label}` : `ID do ${label} desta máquina`
          }
          aria-label={`ID do ${label}`}
        />
        <Button
          type='submit'
          variant='secondary'
          disabled={!draft.trim() || save.isPending}
        >
          Salvar
        </Button>
      </form>

      {(sessions.data ?? []).length > 0 ? (
        <div className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted-foreground'>
            Últimas sessões
          </span>
          <ul className='divide-y text-sm'>
            {(sessions.data ?? []).slice(0, 5).map((session) => (
              <li key={session.id} className='flex justify-between py-1.5'>
                <span>{session.user.name}</span>
                <span className='text-xs text-muted-foreground'>
                  {SD_REMOTE_PROVIDERS[session.provider].label} ·{' '}
                  {sessionTime(session.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
