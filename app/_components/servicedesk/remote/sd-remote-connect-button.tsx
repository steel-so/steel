'use client'

import { ComputerIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import {
  useSdRemoteConnect,
  useSdRemoteEndpoints,
  useSdRemoteSettings,
} from '@/src/hooks/use-sd-remote'
import { SD_REMOTE_PROVIDERS } from '@/src/lib/servicedesk/remote-access'

/**
 * "Conectar" (S4): abre o RustDesk/AnyDesk do técnico no ativo. Só aparece
 * quando o workspace ligou o acesso remoto. Sem ID cadastrado para o provedor
 * escolhido, o botão fica desabilitado e explica o motivo.
 */
export function SdRemoteConnectButton({
  workspaceId,
  configItemId,
  ticketId,
  size = 'sm',
}: {
  workspaceId: string
  configItemId: string
  ticketId?: string
  size?: 'xs' | 'sm'
}) {
  const settings = useSdRemoteSettings(workspaceId)
  const endpoints = useSdRemoteEndpoints(workspaceId, configItemId)
  const connect = useSdRemoteConnect(workspaceId)

  if (!settings.data?.enabled) return null

  const provider = settings.data.provider
  const label = SD_REMOTE_PROVIDERS[provider].label
  const hasEndpoint = (endpoints.data ?? []).some(
    (endpoint) => endpoint.provider === provider,
  )

  function open() {
    connect.mutate(
      { configItemId, ticketId },
      {
        onSuccess: (result) => {
          notify.success(`Abrindo o ${label}. A sessão foi registrada.`)
          window.location.assign(result.link)
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <Button
      type='button'
      size={size}
      variant='outline'
      disabled={!hasEndpoint || connect.isPending}
      title={
        hasEndpoint
          ? `Conectar pelo ${label}`
          : `Cadastre o ID do ${label} na aba Dados do ativo`
      }
      onClick={open}
    >
      <SteelIcon icon={ComputerIcon} strokeWidth={2} />
      Conectar
    </Button>
  )
}
