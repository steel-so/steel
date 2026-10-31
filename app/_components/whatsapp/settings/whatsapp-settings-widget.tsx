'use client'

import { type FormEvent, useEffect, useState } from 'react'
import { useIsPrivileged } from '@/app/_components/workspace/workspace-permissions'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useRotateWhatsAppWidgetKey,
  useUpdateWhatsAppWidgetSettings,
  useWhatsAppWidgetSettings,
} from '@/src/hooks/use-whatsapp-widget'
import { useWhatsAppTeams } from '@/src/hooks/use-whatsapp-teams'
import type { WhatsAppWidgetPositionDTO } from '@/types/whatsapp-widget'

const NO_TEAM = '__none'

const POSITION_ITEMS = [
  { value: 'RIGHT', label: 'Canto direito' },
  { value: 'LEFT', label: 'Canto esquerdo' },
]

function SwitchRow({
  id,
  title,
  hint,
  checked,
  onChange,
}: {
  id: string
  title: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
      <div>
        <Label htmlFor={id} className='font-medium text-sm'>
          {title}
        </Label>
        <p className='text-muted-foreground text-xs'>{hint}</p>
      </div>
      <Switch id={id} aria-label={title} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/**
 * Chat para o site (E1), só OWNER/ADMIN: liga o widget, mostra o trecho de
 * código para colar no site, os sites autorizados e como o chat se comporta
 * (aparência, dados antes de começar, fora do horário, equipe, portal e
 * pesquisa).
 */
export function WhatsappSettingsWidget({
  workspaceId,
}: {
  workspaceId: string
}) {
  const isAdmin = useIsPrivileged()
  const settings = useWhatsAppWidgetSettings(workspaceId, isAdmin)
  const teams = useWhatsAppTeams(workspaceId)
  const update = useUpdateWhatsAppWidgetSettings(workspaceId)
  const rotate = useRotateWhatsAppWidgetKey(workspaceId)

  const [enabled, setEnabled] = useState(false)
  const [origins, setOrigins] = useState('')
  const [title, setTitle] = useState('')
  const [welcome, setWelcome] = useState('')
  const [color, setColor] = useState('#2563eb')
  const [position, setPosition] = useState<WhatsAppWidgetPositionDTO>('RIGHT')
  const [preChat, setPreChat] = useState(false)
  const [askEmail, setAskEmail] = useState(true)
  const [askPhone, setAskPhone] = useState(false)
  const [offline, setOffline] = useState(true)
  const [offlineMessage, setOfflineMessage] = useState('')
  const [teamId, setTeamId] = useState(NO_TEAM)
  const [showPortal, setShowPortal] = useState(false)
  const [showSurvey, setShowSurvey] = useState(false)

  useEffect(() => {
    const data = settings.data
    if (!data) return
    setEnabled(data.enabled)
    setOrigins(data.allowedOrigins.join('\n'))
    setTitle(data.title)
    setWelcome(data.welcomeMessage)
    setColor(data.accentColor)
    setPosition(data.position)
    setPreChat(data.preChatEnabled)
    setAskEmail(data.preChatAskEmail)
    setAskPhone(data.preChatAskPhone)
    setOffline(data.offlineEnabled)
    setOfflineMessage(data.offlineMessage)
    setTeamId(data.teamId ?? NO_TEAM)
    setShowPortal(data.showPortal)
    setShowSurvey(data.showSurvey)
  }, [settings.data])

  if (!isAdmin) return null

  const teamItems = [
    { value: NO_TEAM, label: 'Fila geral (sem equipe)' },
    ...(teams.data ?? []).map((team) => ({ value: team.id, label: team.name })),
  ]

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    update.mutate(
      {
        enabled,
        allowedOrigins: origins
          .split(/[\n,]+/)
          .map((line) => line.trim())
          .filter(Boolean),
        title,
        welcomeMessage: welcome,
        accentColor: color,
        position,
        preChatEnabled: preChat,
        preChatAskEmail: askEmail,
        preChatAskPhone: askPhone,
        offlineEnabled: offline,
        offlineMessage,
        teamId: teamId === NO_TEAM ? null : teamId,
        showPortal,
        showSurvey,
      },
      {
        onSuccess: () => notify.success('Chat do site salvo'),
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  async function copySnippet() {
    if (!settings.data?.snippet) return
    try {
      await navigator.clipboard.writeText(settings.data.snippet)
      notify.success('Código copiado')
    } catch {
      notify.error(new Error('Copie o código manualmente'), 'Não foi possível copiar')
    }
  }

  function handleRotate() {
    if (
      !window.confirm(
        'Os sites que já usam o código atual deixam de abrir o chat até receberem o novo. Continuar?',
      )
    ) {
      return
    }
    rotate.mutate(undefined, {
      onSuccess: () => notify.success('Nova chave gerada'),
      onError: (error) => notify.error(error, 'Não foi possível gerar a chave'),
    })
  }

  const snippet = settings.data?.snippet ?? ''

  return (
    <form onSubmit={handleSubmit} className='max-w-2xl space-y-4'>
      <SwitchRow
        id='widgetEnabled'
        title='Chat no site'
        hint='Um chat que o visitante abre no seu site. As conversas caem no mesmo inbox do WhatsApp, com equipes, SLA, chatbot e a IA de atendimento. Desligado por padrão.'
        checked={enabled}
        onChange={setEnabled}
      />

      <div className='space-y-1.5'>
        <Label htmlFor='widgetOrigins'>Sites autorizados</Label>
        <Textarea
          id='widgetOrigins'
          rows={3}
          value={origins}
          onChange={(event) => setOrigins(event.target.value)}
          placeholder={'https://www.empresa.com.br\nhttps://*.empresa.com.br'}
        />
        <p className='text-muted-foreground text-xs'>
          Um por linha, com https://. Use *. para liberar todos os subdomínios.
          O chat só abre nesses endereços; para ligar é preciso ao menos um.
        </p>
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label htmlFor='widgetTitle'>Título</Label>
          <Input
            id='widgetTitle'
            value={title}
            maxLength={60}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='widgetColor'>Cor</Label>
          <div className='flex items-center gap-2'>
            <Input
              id='widgetColor'
              type='color'
              value={color}
              className='h-9 w-14 p-1'
              onChange={(event) => setColor(event.target.value)}
            />
            <span className='text-muted-foreground text-xs'>{color}</span>
          </div>
        </div>
        <div className='space-y-1.5 sm:col-span-2'>
          <Label htmlFor='widgetWelcome'>Mensagem de boas-vindas</Label>
          <Textarea
            id='widgetWelcome'
            rows={2}
            maxLength={280}
            value={welcome}
            onChange={(event) => setWelcome(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='widgetPosition'>Posição</Label>
          <Select
            items={POSITION_ITEMS}
            value={position}
            onValueChange={(next) => {
              if (next) setPosition(next as WhatsAppWidgetPositionDTO)
            }}
          >
            <SelectTrigger id='widgetPosition' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {POSITION_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='widgetTeam'>Equipe que recebe</Label>
          <Select
            items={teamItems}
            value={teamId}
            onValueChange={(next) => {
              if (next) setTeamId(next)
            }}
          >
            <SelectTrigger id='widgetTeam' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {teamItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      <SwitchRow
        id='widgetPreChat'
        title='Pedir os dados antes de começar'
        hint='O visitante informa nome (e e-mail ou telefone, se marcados) antes da primeira mensagem.'
        checked={preChat}
        onChange={setPreChat}
      />
      {preChat ? (
        <div className='ml-3 space-y-2'>
          <SwitchRow
            id='widgetAskEmail'
            title='Pedir o e-mail'
            hint='Campo obrigatório no formulário.'
            checked={askEmail}
            onChange={setAskEmail}
          />
          <SwitchRow
            id='widgetAskPhone'
            title='Pedir o telefone'
            hint='Campo obrigatório no formulário.'
            checked={askPhone}
            onChange={setAskPhone}
          />
        </div>
      ) : null}

      <SwitchRow
        id='widgetOffline'
        title='Avisar fora do horário'
        hint='Fora do horário de atendimento (Atendimento › Horário de atendimento) o visitante recebe o aviso abaixo, e a mensagem espera na fila.'
        checked={offline}
        onChange={setOffline}
      />
      {offline ? (
        <div className='space-y-1.5'>
          <Label htmlFor='widgetOfflineMessage'>Aviso fora do horário</Label>
          <Textarea
            id='widgetOfflineMessage'
            rows={2}
            maxLength={280}
            value={offlineMessage}
            onChange={(event) => setOfflineMessage(event.target.value)}
          />
        </div>
      ) : null}

      <SwitchRow
        id='widgetPortal'
        title='Mostrar o portal do solicitante'
        hint='Mostra no chat um link para o portal de chamados do ServiceDesk (/suporte).'
        checked={showPortal}
        onChange={setShowPortal}
      />
      <SwitchRow
        id='widgetSurvey'
        title='Pedir a avaliação do atendimento'
        hint='Quando a conversa é fechada, o chat mostra a pesquisa (NPS, CSAT ou CES) que estiver ligada em Pesquisas.'
        checked={showSurvey}
        onChange={setShowSurvey}
      />

      <Button type='submit' disabled={update.isPending || settings.isLoading}>
        {update.isPending ? 'Salvando...' : 'Salvar chat do site'}
      </Button>

      <div className='space-y-2 rounded-md border p-3'>
        <p className='font-medium text-sm'>Código para colar no site</p>
        {snippet ? (
          <>
            <pre className='overflow-x-auto rounded bg-muted p-2 text-xs'>
              {snippet}
            </pre>
            <p className='text-muted-foreground text-xs'>
              Cole antes do fechamento da tag &lt;/body&gt;. O chat aparece só
              nos sites autorizados e enquanto estiver ligado.
            </p>
            <div className='flex gap-2'>
              <Button type='button' variant='outline' onClick={copySnippet}>
                Copiar código
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={rotate.isPending}
                onClick={handleRotate}
              >
                Gerar nova chave
              </Button>
            </div>
          </>
        ) : (
          <p className='text-muted-foreground text-xs'>
            Salve as configurações para gerar o código.
          </p>
        )}
      </div>
    </form>
  )
}
