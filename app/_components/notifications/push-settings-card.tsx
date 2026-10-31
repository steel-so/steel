'use client'

import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { PushPermissionError, usePushDevice } from '@/src/hooks/use-push'

const BLOCKED_MESSAGE =
  'O navegador bloqueou as notificações deste site. Libere nas configurações do navegador e tente de novo.'

/** pt-BR list of what reaches the phone (mirrors PUSH_NOTIFICATION_KINDS). */
export const PUSH_NOTIFICATION_SCOPE =
  'nova conversa para você, SLA perto de estourar, aprovação pendente e lead atribuído a você'

/**
 * Settings card: push of this device (the app installed or open in a closed
 * tab). Hidden while the server has no VAPID keys.
 */
export function PushSettingsCard() {
  const push = usePushDevice()

  if (push.loading || !push.configured) return null

  const unsupported = push.support === 'unsupported'
  const blocked = push.permission === 'denied'

  async function toggle(next: boolean) {
    try {
      if (next) await push.enable()
      else await push.disable()
      notify.success(
        next
          ? 'Notificações push ativadas neste dispositivo'
          : 'Notificações push desativadas neste dispositivo',
      )
    } catch (error) {
      if (error instanceof PushPermissionError) {
        notify.error(BLOCKED_MESSAGE)
        return
      }
      notify.error(error, 'Não foi possível salvar a preferência')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificações push (app instalado)</CardTitle>
        <CardDescription>
          Receba no celular ou no computador, mesmo com o Steel fechado:{' '}
          {PUSH_NOTIFICATION_SCOPE}. O aviso mostra só um título curto; os
          detalhes ficam dentro do app. Respeita os tipos que você silenciou.
          Para instalar o Steel, use "Instalar app" ou "Adicionar à tela
          inicial" no menu do navegador.
          {unsupported ? ' Este navegador não oferece push.' : ''}
          {blocked ? ` ${BLOCKED_MESSAGE}` : ''}
          {push.devices > 0
            ? ` Dispositivos ativos: ${push.devices}.`
            : ''}
        </CardDescription>
        <CardAction>
          <Switch
            checked={push.thisDevice}
            disabled={unsupported || push.saving || (blocked && !push.thisDevice)}
            onCheckedChange={toggle}
            aria-label='Notificações push neste dispositivo'
          />
        </CardAction>
      </CardHeader>
    </Card>
  )
}
