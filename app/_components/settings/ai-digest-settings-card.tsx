'use client'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useAiDigestSettings,
  useUpdateAiDigestSettings,
} from '@/src/hooks/use-ai-insights'

const CHANNELS = [
  {
    field: 'inApp',
    label: 'Na caixa de entrada',
    hint: 'Uma notificação com o resumo e o link para os alertas.',
  },
  {
    field: 'email',
    label: 'Por e-mail',
    hint: 'O resumo com cada alerta e o link para abrir no Steel.',
  },
] as const

/**
 * Daily proactive AI digest (ADR 0040): the person's own channels. Both on
 * by default (opt-out); off with the workspace switch, explained here.
 */
export function AiDigestSettingsCard({ workspaceId }: { workspaceId: string }) {
  const settings = useAiDigestSettings(workspaceId)
  const update = useUpdateAiDigestSettings(workspaceId)
  const data = settings.data
  const workspaceOff = data?.workspaceEnabled === false

  function save(field: 'inApp' | 'email', next: boolean) {
    update.mutate(
      { [field]: next },
      {
        onSuccess: () =>
          notify.success(
            next ? 'Resumo diário ligado' : 'Resumo diário desligado',
          ),
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo diário da IA</CardTitle>
        <CardDescription>
          A partir das 08:00 no seu fuso, os alertas que pedem a sua atenção
          (SLA, oportunidades paradas, conversas esperando, sentimento em
          queda). Só nos dias com alerta, e os números vêm direto do Steel.
          {workspaceOff
            ? ' A IA proativa está desligada neste espaço de trabalho; um administrador pode ligá-la em Ajustes > Steel IA.'
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {CHANNELS.map((channel) => (
          <div
            key={channel.field}
            className='flex items-center justify-between gap-4'
          >
            <div className='min-w-0'>
              <Label
                htmlFor={`ai-digest-${channel.field}`}
                className='font-medium'
              >
                {channel.label}
              </Label>
              <p className='text-muted-foreground text-xs'>{channel.hint}</p>
            </div>
            <Switch
              id={`ai-digest-${channel.field}`}
              checked={data ? data[channel.field] : false}
              disabled={!data || workspaceOff || update.isPending}
              onCheckedChange={(checked) =>
                save(channel.field, checked === true)
              }
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
