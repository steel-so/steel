'use client'

import { useRouter } from 'next/navigation'
import { useWebPhone } from '@/app/_components/webphone/webphone-context'
import { notify } from '@/lib/notify'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import { useOpenCustomerWhatsapp } from '@/src/hooks/use-customer-360'
import { useUser } from '@/src/hooks/use-user'
import { useStartWhatsAppPhoneCall } from '@/src/hooks/use-whatsapp-conversations'
import { toStoredPhone } from '@/src/lib/phone-br'

export interface CustomerContactTarget {
  personId?: string
  companyId?: string
  opportunityId?: string
  /** A specific phone of the record; defaults to its first usable one. */
  phone?: string
}

const NO_CONNECTION =
  'Nenhum número de WhatsApp conectado. Peça a um administrador para conectar um número em Ajustes > WhatsApp.'

/**
 * Backs the "WhatsApp" and "Ligar" buttons of person, company and deal.
 * `whatsapp` opens (or creates) the conversation and goes to it; `call` opens
 * the same conversation, then rings through the browser phone or the PABX
 * extension of the user, exactly like the phone button inside the chat.
 */
export function useCustomerContact(workspaceId: string, slug: string) {
  const router = useRouter()
  const open = useOpenCustomerWhatsapp(workspaceId)
  const startCall = useStartWhatsAppPhoneCall(workspaceId)
  const webPhone = useWebPhone()
  const currentUser = useUser()
  const hasPabx = Boolean(
    currentUser.data?.pabxExtension && currentUser.data?.pabxDeviceId,
  )

  function fail(error: unknown, fallback: string) {
    if (isApiErrorCode(error, 'WHATSAPP_CONNECTION_NOT_FOUND')) {
      notify.error(NO_CONNECTION)
      return
    }
    notify.error(error, fallback)
  }

  function whatsapp(target: CustomerContactTarget) {
    open.mutate(target, {
      onSuccess: (result) =>
        router.push(`/${slug}/zap?conversa=${result.conversationId}`),
      onError: (error) =>
        fail(error, 'Não foi possível abrir a conversa no WhatsApp.'),
    })
  }

  async function call(target: CustomerContactTarget) {
    if (!webPhone.enabled && !hasPabx) {
      notify.error('Configure seu ramal e device no perfil para ligar.')
      return
    }
    if (webPhone.enabled) {
      if (webPhone.call && webPhone.call.state !== 'ended') {
        notify.error('Já existe uma ligação em andamento.')
        return
      }
      if (webPhone.status !== 'online') {
        notify.error(
          webPhone.status === 'other-tab'
            ? 'O telefone web está aberto em outra aba.'
            : webPhone.status === 'connecting'
              ? 'O telefone web ainda está conectando. Tente em instantes.'
              : (webPhone.error ?? 'O telefone web está sem conexão.'),
        )
        return
      }
    }
    try {
      const opened = await open.mutateAsync(target)
      if (webPhone.enabled) {
        await webPhone.dial(
          toStoredPhone(opened.phone) ?? opened.phone,
          null,
          { conversationId: opened.conversationId },
        )
        return
      }
      const placed = await startCall.mutateAsync(opened.conversationId)
      notify.success(`Atenda o ramal ${placed.extension} para falar com o contato.`)
    } catch (error) {
      fail(error, 'Não foi possível iniciar a ligação.')
    }
  }

  return {
    whatsapp,
    call,
    pending: open.isPending || startCall.isPending,
    /** Why "Ligar" would fail right now, for the button tooltip. */
    callHint:
      webPhone.enabled || hasPabx
        ? null
        : 'Configure seu ramal e device no perfil para ligar',
  }
}
