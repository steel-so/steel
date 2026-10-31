'use client'

import { type FormEvent, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useAiActions,
  useCreateAiActionConnector,
  useDeleteAiActionConnector,
  useUpdateAiActionConnector,
  useUpdateAiActionSettings,
} from '@/src/hooks/use-ai-actions'
import { useSteelAgentMembers } from '@/src/hooks/use-steel-agents'
import type {
  AiActionConnectorDTO,
  AiActionSettingsDTO,
  AiActionZapToolDTO,
} from '@/types/ai-action'
import {
  type ConnectorFormState,
  EMPTY_CONNECTOR_FORM,
  slugifyKey,
  toConnectorInput,
  ZAP_TOOL_OPTIONS,
} from './ai-actions-form'

const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

function ConnectorDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateAiActionConnector(workspaceId)
  const [form, setForm] = useState<ConnectorFormState>(EMPTY_CONNECTOR_FORM)
  const set = <K extends keyof ConnectorFormState>(
    key: K,
    value: ConnectorFormState[K],
  ) => setForm((current) => ({ ...current, [key]: value }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    create.mutate(toConnectorInput(form), {
      onSuccess: () => {
        notify.success('Conector criado')
        setForm(EMPTY_CONNECTOR_FORM)
        onOpenChange(false)
      },
      onError: (cause) => notify.error(cause, 'Não foi possível criar o conector'),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'>
        <form onSubmit={handleSubmit} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>Novo conector</DialogTitle>
            <DialogDescription>
              Um endereço HTTPS público do sistema do cliente que a IA pode
              chamar. Endereços privados ou locais são recusados.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-1.5'>
            <Label htmlFor='connector-name'>Nome</Label>
            <Input
              id='connector-name'
              value={form.name}
              placeholder='Consultar pedido'
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='connector-key'>Identificador</Label>
            <Input
              id='connector-key'
              value={form.key}
              placeholder={slugifyKey(form.name) || 'consultar_pedido'}
              onChange={(e) => set('key', e.target.value)}
            />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='connector-description'>Quando a IA deve usar</Label>
            <Textarea
              id='connector-description'
              value={form.description}
              placeholder='Busca a situação de um pedido pelo número que o cliente informou.'
              onChange={(e) => set('description', e.target.value)}
              required
            />
          </div>
          <RadioGroup
            value={form.kind}
            onValueChange={(value) => set('kind', value as 'LOOKUP' | 'ACTION')}
            className='grid gap-2 sm:grid-cols-2'
          >
            <Label className='flex items-start gap-2 rounded-lg border p-3 font-normal'>
              <RadioGroupItem value='LOOKUP' className='mt-0.5' />
              <span>
                <span className='block font-medium text-sm'>Consulta</span>
                <span className='block text-muted-foreground text-xs'>
                  Só lê (GET). Roda sem aprovação.
                </span>
              </span>
            </Label>
            <Label className='flex items-start gap-2 rounded-lg border p-3 font-normal'>
              <RadioGroupItem value='ACTION' className='mt-0.5' />
              <span>
                <span className='block font-medium text-sm'>Ação</span>
                <span className='block text-muted-foreground text-xs'>
                  Altera dados. Leva chave de idempotência.
                </span>
              </span>
            </Label>
          </RadioGroup>
          {form.kind === 'ACTION' ? (
            <div className='grid gap-1.5'>
              <Label>Método</Label>
              <Select
                items={METHODS.map((m) => ({ value: m, label: m }))}
                value={form.method === 'GET' ? 'POST' : form.method}
                onValueChange={(next) =>
                  next && set('method', next as ConnectorFormState['method'])
                }
              >
                <SelectTrigger aria-label='Método HTTP' className='w-full sm:w-40'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className='grid gap-1.5'>
            <Label htmlFor='connector-url'>URL</Label>
            <Input
              id='connector-url'
              value={form.urlTemplate}
              placeholder='https://api.cliente.com.br/pedidos/{orderId}'
              onChange={(e) => set('urlTemplate', e.target.value)}
              required
            />
            <p className='text-muted-foreground text-xs'>
              Use {'{nome}'} no caminho para o que a IA preenche.
            </p>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='connector-params'>Parâmetros</Label>
            <Textarea
              id='connector-params'
              value={form.params}
              placeholder={'orderId: número do pedido\nobservacao?: texto livre'}
              onChange={(e) => set('params', e.target.value)}
            />
            <p className='text-muted-foreground text-xs'>
              Um por linha, no formato nome: descrição. Termine o nome com ? para
              opcional.
            </p>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='connector-headers'>Cabeçalhos (cifrados)</Label>
            <Textarea
              id='connector-headers'
              value={form.headers}
              placeholder='Authorization: Bearer ...'
              onChange={(e) => set('headers', e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type='submit' disabled={create.isPending}>
              {create.isPending ? 'Criando...' : 'Criar conector'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConnectorRow({
  workspaceId,
  connector,
}: {
  workspaceId: string
  connector: AiActionConnectorDTO
}) {
  const update = useUpdateAiActionConnector(workspaceId)
  const remove = useDeleteAiActionConnector(workspaceId)
  return (
    <li className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3'>
      <div className='min-w-0 space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium text-sm'>{connector.name}</span>
          <Badge variant='outline'>
            {connector.kind === 'LOOKUP' ? 'Consulta' : 'Ação'}
          </Badge>
          <Badge variant='secondary' className='font-mono'>
            {connector.key}
          </Badge>
        </div>
        <p className='break-all text-muted-foreground text-xs'>
          {connector.method} {connector.urlTemplate}
        </p>
      </div>
      <div className='flex items-center gap-3'>
        <Switch
          aria-label={`Ativar ${connector.name}`}
          checked={connector.enabled}
          onCheckedChange={(checked) =>
            update.mutate(
              { id: connector.id, data: { enabled: checked === true } },
              { onError: (cause) => notify.error(cause) },
            )
          }
        />
        <Button
          size='sm'
          variant='outline'
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(connector.id, {
              onSuccess: () => notify.success('Conector excluído'),
              onError: (cause) => notify.error(cause),
            })
          }
        >
          Excluir
        </Button>
      </div>
    </li>
  )
}

function ZapToolsCard({
  workspaceId,
  settings,
}: {
  workspaceId: string
  settings: AiActionSettingsDTO
}) {
  const update = useUpdateAiActionSettings(workspaceId)
  const members = useSteelAgentMembers(workspaceId)
  const admins = (members.data ?? []).filter(
    (m) => m.role === 'OWNER' || m.role === 'ADMIN',
  )

  function save(zapTools: AiActionZapToolDTO[]) {
    update.mutate(
      { zapTools },
      { onError: (cause) => notify.error(cause) },
    )
  }
  const entry = (toolName: string) =>
    settings.zapTools.find((t) => t.toolName === toolName)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resposta automática do WhatsApp</CardTitle>
        <CardDescription>
          Ferramentas que a IA pode usar enquanto conversa com o cliente. As
          que alteram dados começam pedindo aprovação (aparecem nas pendências
          da IA da caixa de entrada). Mesmo as automáticas passam a pedir
          aprovação quando a mensagem do cliente tenta dar ordens à IA.
        </CardDescription>
      </CardHeader>
      <CardContent className='grid gap-3'>
        {ZAP_TOOL_OPTIONS.map((option) => {
          const current = entry(option.toolName)
          return (
            <div
              key={option.toolName}
              className='flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3'
            >
              <div className='min-w-0'>
                <p className='font-medium text-sm'>{option.label}</p>
                <p className='text-muted-foreground text-xs'>{option.hint}</p>
              </div>
              <div className='flex items-center gap-4'>
                <Label className='gap-2 font-normal text-xs'>
                  <Switch
                    checked={Boolean(current)}
                    onCheckedChange={(checked) =>
                      save(
                        checked === true
                          ? [
                              ...settings.zapTools,
                              { toolName: option.toolName, mode: 'APPROVAL' },
                            ]
                          : settings.zapTools.filter(
                              (t) => t.toolName !== option.toolName,
                            ),
                      )
                    }
                  />
                  Permitir
                </Label>
                <Label className='gap-2 font-normal text-xs'>
                  <Switch
                    checked={current?.mode === 'AUTO'}
                    disabled={!current}
                    onCheckedChange={(checked) =>
                      save(
                        settings.zapTools.map((t) =>
                          t.toolName === option.toolName
                            ? { ...t, mode: checked === true ? 'AUTO' : 'APPROVAL' }
                            : t,
                        ),
                      )
                    }
                  />
                  Roda sozinha
                </Label>
              </div>
            </div>
          )
        })}
        <div className='grid gap-1.5'>
          <Label>Identidade da resposta automática</Label>
          <Select
            items={admins.map((m) => ({ value: m.userId, label: m.name }))}
            value={settings.zapActorId ?? undefined}
            onValueChange={(next) =>
              next &&
              update.mutate(
                { zapActorId: next as string },
                { onError: (cause) => notify.error(cause) },
              )
            }
          >
            <SelectTrigger aria-label='Identidade' className='w-full sm:w-72'>
              <SelectValue placeholder='Escolha um dono ou administrador' />
            </SelectTrigger>
            <SelectContent>
              {admins.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className='text-muted-foreground text-xs'>
            As ferramentas rodam com as permissões desta pessoa. Sem ela, a
            resposta automática não usa nenhuma ferramenta.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Ações da IA (T3): conectores HTTP com sistemas do cliente, a chave geral
 * (desligada por padrão) e as ferramentas liberadas para a resposta
 * automática do WhatsApp.
 */
export function AiActionsSection({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading, error } = useAiActions(workspaceId)
  const settings = useUpdateAiActionSettings(workspaceId)
  const [dialog, setDialog] = useState(false)

  if (isLoading) {
    return <p className='text-muted-foreground text-sm'>Carregando ações...</p>
  }
  if (!data) {
    return (
      <p className='text-destructive text-sm'>
        {error instanceof Error
          ? error.message
          : 'Só donos e administradores configuram as ações da IA.'}
      </p>
    )
  }

  return (
    <div className='grid gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>Ações em sistemas externos</CardTitle>
          <CardDescription>
            Deixe a IA consultar um pedido, redefinir uma senha ou liberar um
            acesso no sistema do cliente. Cada ação passa pela aprovação
            configurada, fica registrada na trilha e leva chave de
            idempotência. Desligado por padrão.
          </CardDescription>
        </CardHeader>
        <CardContent className='flex items-center justify-between gap-4'>
          <Label htmlFor='ai-actions-enabled' className='font-medium'>
            Permitir ações da IA neste workspace
          </Label>
          <Switch
            id='ai-actions-enabled'
            checked={data.settings.enabled}
            disabled={settings.isPending}
            onCheckedChange={(checked) =>
              settings.mutate(
                { enabled: checked === true },
                { onError: (cause) => notify.error(cause) },
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center justify-between gap-2'>
            Conectores
            <Button size='sm' onClick={() => setDialog(true)}>
              Novo conector
            </Button>
          </CardTitle>
          <CardDescription>
            Só os conectores listados aqui podem ser chamados pela IA. Máximo
            de {data.limit}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.connectors.length === 0 ? (
            <p className='rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm'>
              Nenhum conector ainda.
            </p>
          ) : (
            <ul className='grid gap-2'>
              {data.connectors.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  workspaceId={workspaceId}
                  connector={connector}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ZapToolsCard workspaceId={workspaceId} settings={data.settings} />
      <ConnectorDialog
        workspaceId={workspaceId}
        open={dialog}
        onOpenChange={setDialog}
      />
    </div>
  )
}
