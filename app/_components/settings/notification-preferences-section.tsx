'use client'

import { useMemo } from 'react'
import { NotificationKindIcon } from '@/app/_components/notifications/notification-kind-icon'
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
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/src/hooks/use-notification-preferences'
import { useNotificationWhatsapp } from '@/src/hooks/use-notification-whatsapp'
import type { UpdateNotificationPreferencesDTO } from '@/src/schemas/notification-preference.schema'
import type { NotificationPreferenceDTO } from '@/types/notification'

type PreferenceInput = UpdateNotificationPreferencesDTO['preferences'][number]

/** Module order on screen (product order); unknown modules go last. */
const MODULE_ORDER = ['CRM', 'COMMUNICATION', 'OTHER']

const MODULE_DESCRIPTIONS: Record<string, string> = {
  CRM: 'Leads, oportunidades, tarefas, propostas, formulários, campanhas, workflows e redes sociais.',
  COMMUNICATION: 'Conversas e alertas do WhatsApp.',
  OTHER: 'Membros, exportações, assinatura e cota de IA do workspace.',
}

interface ModuleGroup {
  module: string
  label: string
  items: NotificationPreferenceDTO[]
}

function groupByModule(items: NotificationPreferenceDTO[]): ModuleGroup[] {
  const groups = new Map<string, ModuleGroup>()
  for (const item of items) {
    const group = groups.get(item.module) ?? {
      module: item.module,
      label: item.moduleLabel,
      items: [],
    }
    group.items.push(item)
    groups.set(item.module, group)
  }
  const rank = (module: string) => {
    const index = MODULE_ORDER.indexOf(module)
    return index === -1 ? MODULE_ORDER.length : index
  }
  return [...groups.values()].sort((a, b) => rank(a.module) - rank(b.module))
}

/**
 * Settings → Notificações: mute or unmute each non-ServiceDesk kind for the
 * current user in this workspace (the ServiceDesk keeps its own screen).
 */
export function NotificationPreferencesSection({
  workspaceId,
}: {
  workspaceId: string
}) {
  const { data, isLoading, isError } = useNotificationPreferences(workspaceId)
  const update = useUpdateNotificationPreferences(workspaceId)
  const whatsapp = useNotificationWhatsapp(workspaceId)
  const whatsappOn = whatsapp.data?.enabled ?? false
  const groups = useMemo(() => groupByModule(data ?? []), [data])

  function save(preferences: PreferenceInput[]) {
    update.mutate(
      { preferences },
      {
        onSuccess: () => notify.success('Preferências de notificação salvas'),
        onError: (error) =>
          notify.error(
            error instanceof Error ? error.message : 'Erro ao salvar',
          ),
      },
    )
  }

  if (isLoading) return <Muted>Carregando preferências…</Muted>
  if (isError || !data) {
    return <Muted>Não foi possível carregar as preferências.</Muted>
  }

  return (
    <div className='space-y-6'>
      {groups.map((group) => {
        const allOn = group.items.every((item) => item.inApp)
        return (
          <Card key={group.module}>
            <CardHeader>
              <CardTitle>{group.label}</CardTitle>
              <CardDescription>
                {MODULE_DESCRIPTIONS[group.module] ??
                  'Avisos deste módulo na caixa de entrada.'}
              </CardDescription>
              <CardAction>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={update.isPending}
                  onClick={() =>
                    save(
                      group.items.map((item) => ({
                        kind: item.kind,
                        inApp: !allOn,
                      })),
                    )
                  }
                >
                  {allOn ? 'Silenciar todas' : 'Ativar todas'}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className='divide-y'>
              {group.items.map((item) => {
                const id = `notification-pref-${item.kind}`
                return (
                  <div
                    key={item.kind}
                    className='flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0'
                  >
                    <label
                      htmlFor={id}
                      className='flex min-w-0 items-center gap-3 text-sm'
                    >
                      <NotificationKindIcon
                        icon={item.icon}
                        color={item.color}
                        size={14}
                        className='size-7'
                      />
                      <span className='truncate'>{item.label}</span>
                    </label>
                    <div className='flex items-center gap-4'>
                      {whatsappOn ? (
                        <span className='flex items-center gap-2 text-muted-foreground text-xs'>
                          WhatsApp
                          <Switch
                            checked={item.whatsapp}
                            disabled={update.isPending}
                            aria-label={`${item.whatsapp ? 'Parar de enviar' : 'Enviar'} ${item.label} por WhatsApp`}
                            onCheckedChange={(checked) =>
                              save([{ kind: item.kind, whatsapp: checked }])
                            }
                          />
                        </span>
                      ) : null}
                      <Switch
                        id={id}
                        checked={item.inApp}
                        disabled={update.isPending}
                        aria-label={`${item.inApp ? 'Silenciar' : 'Ativar'} ${item.label}`}
                        onCheckedChange={(checked) =>
                          save([{ kind: item.kind, inApp: checked }])
                        }
                      />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
