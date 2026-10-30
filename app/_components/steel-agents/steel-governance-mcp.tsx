'use client'

import { Delete02Icon, RefreshIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCreateSteelMcpServer,
  useDeleteSteelMcpServer,
  useRefreshSteelMcpServer,
  useSteelMcpServers,
  useUpdateSteelMcpServer,
} from '@/src/hooks/use-steel-governance'
import type { SteelMcpServerDTO } from '@/types/steel-mcp'
import { formatAgentDate } from './steel-agent-labels'

const TIMEZONE = 'America/Sao_Paulo'

function ServerCard({
  workspaceId,
  server,
}: {
  workspaceId: string
  server: SteelMcpServerDTO
}) {
  const update = useUpdateSteelMcpServer(workspaceId)
  const refresh = useRefreshSteelMcpServer(workspaceId)
  const remove = useDeleteSteelMcpServer(workspaceId)
  const allowed = server.tools.filter((t) => t.allowed).map((t) => t.name)

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action()
      notify.success(message)
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <li className='space-y-3 px-4 py-3.5'>
      <div className='flex flex-wrap items-start gap-3'>
        <div className='min-w-0 flex-1 space-y-0.5'>
          <div className='flex items-center gap-2'>
            <span className='truncate font-medium text-sm'>{server.name}</span>
            <Badge variant={server.enabled ? 'secondary' : 'outline'}>
              {server.enabled ? 'Ligado' : 'Desligado'}
            </Badge>
          </div>
          <p className='truncate text-muted-foreground text-xs'>{server.url}</p>
          <p className='text-muted-foreground text-xs'>
            {server.hasAuth
              ? `Credencial guardada (${server.authHeaderName})`
              : 'Sem credencial'}
            {' · '}Ferramentas lidas em{' '}
            {formatAgentDate(server.discoveredAt, TIMEZONE)}
          </p>
        </div>
        <div className='flex items-center gap-1'>
          <Switch
            checked={server.enabled}
            aria-label={`Ligar ${server.name}`}
            onCheckedChange={(next) =>
              run(
                () =>
                  update.mutateAsync({
                    serverId: server.id,
                    enabled: next,
                  }),
                next ? 'Servidor ligado.' : 'Servidor desligado.',
              )
            }
          />
          <Button
            size='icon'
            variant='ghost'
            aria-label='Atualizar ferramentas'
            disabled={refresh.isPending}
            onClick={() =>
              run(
                () => refresh.mutateAsync(server.id),
                'Ferramentas atualizadas.',
              )
            }
          >
            <SteelIcon icon={RefreshIcon} strokeWidth={2} />
          </Button>
          <Button
            size='icon'
            variant='ghost'
            aria-label='Remover servidor'
            disabled={remove.isPending}
            onClick={() =>
              run(() => remove.mutateAsync(server.id), 'Servidor removido.')
            }
          >
            <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      </div>
      {server.lastError ? (
        <p className='text-destructive text-xs'>{server.lastError}</p>
      ) : null}
      {server.tools.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Nenhuma ferramenta encontrada. Use “Atualizar ferramentas”.
        </p>
      ) : (
        <div className='space-y-1.5'>
          <p className='font-medium text-xs'>
            Ferramentas liberadas para os agentes ({allowed.length} de{' '}
            {server.tools.length})
          </p>
          <ul className='max-h-56 divide-y divide-border overflow-y-auto rounded-lg border'>
            {server.tools.map((tool) => {
              const id = `mcp-${server.id}-${tool.name}`
              return (
                <li
                  key={tool.name}
                  className='flex items-start gap-2 px-3 py-2'
                >
                  <Checkbox
                    id={id}
                    checked={tool.allowed}
                    disabled={update.isPending}
                    className='mt-0.5'
                    onCheckedChange={(next) =>
                      run(
                        () =>
                          update.mutateAsync({
                            serverId: server.id,
                            allowedTools:
                              next === true
                                ? [...allowed, tool.name]
                                : allowed.filter((n) => n !== tool.name),
                          }),
                        'Lista de ferramentas salva.',
                      )
                    }
                  />
                  <div className='min-w-0 flex-1'>
                    <label htmlFor={id} className='font-medium text-sm'>
                      {tool.name}
                    </label>
                    {tool.description ? (
                      <p className='line-clamp-2 text-muted-foreground text-xs'>
                        {tool.description}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant='outline' className='font-normal'>
                    {tool.readOnly ? 'Leitura' : 'Escrita'}
                  </Badge>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </li>
  )
}

function AddServerForm({ workspaceId }: { workspaceId: string }) {
  const create = useCreateSteelMcpServer(workspaceId)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [header, setHeader] = useState('Authorization')
  const [secret, setSecret] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    try {
      await create.mutateAsync({
        name,
        url,
        authHeaderName: header,
        authValue: secret.trim() || null,
      })
      setName('')
      setUrl('')
      setSecret('')
      notify.success(
        'Servidor adicionado. Escolha quais ferramentas os agentes podem usar.',
      )
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-label='Adicionar servidor MCP'
      className='space-y-3 rounded-xl border border-border/80 bg-card p-4'
    >
      <h3 className='font-semibold text-sm'>Adicionar servidor MCP</h3>
      <div className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='mcp-name'>Nome</FieldLabel>
          <Input
            id='mcp-name'
            value={name}
            maxLength={60}
            required
            onChange={(e) => setName(e.target.value)}
            placeholder='Ex.: GitHub'
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='mcp-url'>URL do servidor (HTTPS)</FieldLabel>
          <Input
            id='mcp-url'
            type='url'
            value={url}
            maxLength={500}
            required
            onChange={(e) => setUrl(e.target.value)}
            placeholder='https://mcp.exemplo.com/mcp'
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='mcp-header'>
            Cabeçalho de autenticação
          </FieldLabel>
          <Input
            id='mcp-header'
            value={header}
            maxLength={64}
            onChange={(e) => setHeader(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='mcp-secret'>Valor (guardado cifrado)</FieldLabel>
          <Input
            id='mcp-secret'
            type='password'
            autoComplete='off'
            value={secret}
            maxLength={2000}
            onChange={(e) => setSecret(e.target.value)}
            placeholder='Bearer …'
          />
        </Field>
      </div>
      <FieldDescription>
        Só servidores públicos com HTTPS. O valor nunca é mostrado depois de
        salvo. Nenhuma ferramenta fica liberada até você escolher.
      </FieldDescription>
      <div className='flex justify-end'>
        <Button type='submit' disabled={create.isPending}>
          Adicionar
        </Button>
      </div>
    </form>
  )
}

/** A8: external MCP servers the agents may call, with a tool allow-list. */
export function SteelGovernanceMcp({ workspaceId }: { workspaceId: string }) {
  const servers = useSteelMcpServers(workspaceId)

  return (
    <div className='space-y-4'>
      <p className='max-w-prose text-muted-foreground text-sm'>
        Conecte servidores MCP externos (Slack, GitHub, Google…) para os agentes
        chamarem. Só as ferramentas que você liberar aparecem no agente; as que
        escrevem seguem a regra de aprovação, como qualquer outra.
      </p>
      {servers.isLoading ? (
        <Skeleton className='h-24 rounded-xl' />
      ) : servers.isError ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar os servidores MCP.
        </p>
      ) : (servers.data ?? []).length === 0 ? (
        <p className='rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground text-sm'>
          Nenhum servidor conectado.
        </p>
      ) : (
        <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card'>
          {(servers.data ?? []).map((server) => (
            <ServerCard
              key={server.id}
              workspaceId={workspaceId}
              server={server}
            />
          ))}
        </ul>
      )}
      <AddServerForm workspaceId={workspaceId} />
    </div>
  )
}
