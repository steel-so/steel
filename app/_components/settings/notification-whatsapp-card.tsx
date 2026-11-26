'use client'

import { useState } from 'react'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useNotificationWhatsapp,
  useNotificationWhatsappActions,
} from '@/src/hooks/use-notification-whatsapp'

/** What the user should expect from a Meta line outside the 24 h window. */
function metaTemplateHint(status: string | null): string {
  if (status === 'APPROVED') {
    return 'Fora das 24 h da sua última mensagem, os avisos seguem por um modelo aprovado pela Meta.'
  }
  if (status === 'REJECTED' || status === 'PAUSED' || status === 'DISABLED') {
    return 'O modelo de aviso foi recusado ou pausado na Meta: só chegam avisos dentro de 24 h da sua última mensagem para o número da conexão. Peça a um administrador para revisar os templates.'
  }
  return 'O modelo de aviso será enviado à Meta para aprovação ao pedir o código (costuma levar alguns minutos). Até lá, só chegam avisos dentro de 24 h da sua última mensagem para o número da conexão.'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro ao salvar'
}

/**
 * Settings → Notificações: receive the platform notices on WhatsApp, sent by
 * the workspace's own Comunicação line. The number is confirmed with a code.
 */
export function NotificationWhatsappCard({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data, isLoading, isError } = useNotificationWhatsapp(workspaceId)
  const { sendCode, confirm, setEnabled, remove } =
    useNotificationWhatsappActions(workspaceId)
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [changing, setChanging] = useState(false)

  if (isLoading) return <Muted>Carregando WhatsApp…</Muted>
  if (isError || !data) {
    return <Muted>Não foi possível carregar o canal de WhatsApp.</Muted>
  }

  const busy =
    sendCode.isPending ||
    confirm.isPending ||
    setEnabled.isPending ||
    remove.isPending
  const showNumberForm = !data.verified || changing

  function requestCode() {
    sendCode.mutate(number, {
      onSuccess: () => {
        setChanging(false)
        setCode('')
        notify.success('Código enviado para o seu WhatsApp')
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  function confirmCode() {
    confirm.mutate(code, {
      onSuccess: () => {
        setCode('')
        setNumber('')
        notify.success('Avisos por WhatsApp ativados')
      },
      onError: (error) => notify.error(errorMessage(error)),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Avisos por WhatsApp</CardTitle>
        <CardDescription>
          Receba os avisos da plataforma no seu WhatsApp, enviados pela conexão
          da Comunicação deste workspace.
        </CardDescription>
        {data.verified && !changing ? (
          <CardAction>
            <Switch
              checked={data.enabled}
              disabled={busy}
              aria-label='Receber avisos por WhatsApp'
              onCheckedChange={(checked) =>
                setEnabled.mutate(checked, {
                  onError: (error) => notify.error(errorMessage(error)),
                })
              }
            />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-4'>
        {!data.available ? (
          <Muted>
            Nenhuma conexão da Comunicação está conectada. Peça a um
            administrador para conectar um número em Comunicação.
          </Muted>
        ) : null}

        {data.available && data.verified && !changing ? (
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <span className='text-sm'>
              Número confirmado: <strong>{data.numberMasked}</strong>
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() => setChanging(true)}
              >
                Trocar número
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => notify.success('Número removido'),
                    onError: (error) => notify.error(errorMessage(error)),
                  })
                }
              >
                Remover
              </Button>
            </div>
          </div>
        ) : null}

        {data.available && showNumberForm ? (
          <div className='space-y-3'>
            <div className='flex flex-wrap gap-2'>
              <Input
                className='max-w-60'
                inputMode='tel'
                autoComplete='tel'
                placeholder='(11) 99999-0000'
                aria-label='Seu número de WhatsApp'
                value={number}
                onChange={(event) => setNumber(event.target.value)}
              />
              <Button
                size='sm'
                disabled={busy || number.trim().length < 8}
                onClick={requestCode}
              >
                {data.codePending ? 'Enviar novo código' : 'Enviar código'}
              </Button>
              {changing ? (
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={busy}
                  onClick={() => setChanging(false)}
                >
                  Cancelar
                </Button>
              ) : null}
            </div>
            {data.provider === 'META' ? (
              <Muted>{metaTemplateHint(data.noticeTemplate)}</Muted>
            ) : null}
          </div>
        ) : null}

        {data.available && data.codePending && !data.verified ? (
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              className='max-w-40 tracking-widest'
              inputMode='numeric'
              autoComplete='one-time-code'
              maxLength={6}
              placeholder='000000'
              aria-label='Código de 6 dígitos'
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ''))
              }
            />
            <Button
              size='sm'
              disabled={busy || code.length !== 6}
              onClick={confirmCode}
            >
              Confirmar
            </Button>
            <Muted>
              Enviado para {data.numberMasked}. Vale por 10 minutos.
            </Muted>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
