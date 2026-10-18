'use client'

import {
  AlertCircleIcon,
  ArrowDataTransferHorizontalIcon,
  Shield01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { useAnswerOAuthConsent } from '@/src/hooks/use-integration-grants'
import {
  MCP_CONSENT_WRITE_NOTICE,
  MCP_MODULE_LABELS,
  mcpConsentNotice,
} from '@/src/lib/mcp/consent-notice'
import type {
  IntegrationModuleDTO,
  OAuthConsentContextDTO,
} from '@/types/integration-grant'

const MODULE_DESCRIPTIONS: Record<IntegrationModuleDTO, string> = {
  SERVICE_DESK: 'Chamados, base de conhecimento e catálogo.',
  CRM: 'Leads, negócios, empresas e pessoas.',
  COMMUNICATION: 'Conversas e contatos do WhatsApp.',
}

type AccessLevel = 'read' | 'write'

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return letters || '?'
}

function ConsentCard({ children }: { children: React.ReactNode }) {
  return (
    <div className='w-full max-w-lg rounded-xl border border-border bg-card text-card-foreground shadow-sm'>
      {children}
    </div>
  )
}

export function OAuthConsentError({ message }: { message: string }) {
  return (
    <ConsentCard>
      <div className='flex flex-col items-start gap-4 p-6'>
        <div className='flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive'>
          <SteelIcon icon={AlertCircleIcon} size={20} />
        </div>
        <div className='flex flex-col gap-1'>
          <h1 className='text-lg font-semibold'>Não foi possível autorizar</h1>
          <Muted>{message}</Muted>
        </div>
        <Button variant='outline' size='sm' render={<Link href='/' />}>
          Ir para o Steel
        </Button>
      </div>
    </ConsentCard>
  )
}

export function OAuthConsentForm({
  context,
  oauthQuery,
  userEmail,
}: {
  context: OAuthConsentContextDTO
  oauthQuery: string
  userEmail: string
}) {
  const clientName = context.client.name?.trim() || 'Um app sem nome'
  const writeRequested = context.requestedScopes.includes('mcp:write')
  const answer = useAnswerOAuthConsent()

  const [workspaceId, setWorkspaceId] = useState<string | null>(
    context.workspaces[0]?.id ?? null,
  )
  const workspace = useMemo(
    () => context.workspaces.find((ws) => ws.id === workspaceId) ?? null,
    [context.workspaces, workspaceId],
  )
  const [modules, setModules] = useState<IntegrationModuleDTO[]>(
    context.workspaces[0]?.modules ?? [],
  )
  const [access, setAccess] = useState<AccessLevel>('read')
  const [leaving, setLeaving] = useState(false)

  const busy = answer.isPending || leaving
  const canAccept = !!workspace && modules.length > 0 && !busy

  function selectWorkspace(id: string | null) {
    setWorkspaceId(id)
    const next = context.workspaces.find((ws) => ws.id === id)
    setModules(next?.modules ?? [])
  }

  function toggleModule(module: IntegrationModuleDTO, checked: boolean) {
    setModules((current) =>
      checked
        ? [...new Set([...current, module])]
        : current.filter((m) => m !== module),
    )
  }

  async function submit(accept: boolean) {
    try {
      const result = await answer.mutateAsync(
        accept && workspace
          ? {
              accept: true,
              oauthQuery,
              workspaceId: workspace.id,
              modules,
              scopes:
                access === 'write' ? ['mcp:read', 'mcp:write'] : ['mcp:read'],
            }
          : { accept: false, oauthQuery },
      )
      setLeaving(true)
      window.location.assign(result.redirectUrl)
    } catch (error) {
      notify.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir a autorização',
      )
    }
  }

  return (
    <ConsentCard>
      <div className='flex flex-col gap-6 p-6'>
        <div className='flex items-center gap-3'>
          <Image
            src='/brand/logo.svg'
            alt='Steel'
            width={72}
            height={32}
            style={{ height: 'auto' }}
            className='invert dark:invert-0'
            priority
          />
          <SteelIcon
            icon={ArrowDataTransferHorizontalIcon}
            className='text-muted-foreground'
          />
          <div
            aria-hidden
            className='flex size-9 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground'
          >
            {initialsOf(clientName)}
          </div>
        </div>

        <div className='flex flex-col gap-1'>
          <h1 className='text-lg font-semibold text-balance'>
            {clientName} quer acessar o seu Steel
          </h1>
          <Muted>O app vai agir em seu nome, com as suas permissões.</Muted>
          <Muted className='text-xs'>
            Conectado como{' '}
            <span className='font-medium text-foreground [overflow-wrap:anywhere]'>
              {userEmail}
            </span>
          </Muted>
        </div>

        {context.workspaces.length === 0 ? (
          <div className='rounded-lg border border-border bg-muted/40 p-4'>
            <Muted>
              Nenhum workspace seu tem módulos habilitados. Peça a um
              administrador para habilitar o ServiceDesk, o CRM ou a Comunicação
              e tente de novo.
            </Muted>
          </div>
        ) : (
          <>
            <Field>
              <FieldLabel htmlFor='oauth-workspace'>Workspace</FieldLabel>
              <Select
                items={context.workspaces.map((ws) => ({
                  value: ws.id,
                  label: ws.name,
                }))}
                value={workspaceId ?? undefined}
                onValueChange={(value) => selectWorkspace(value ?? null)}
              >
                <SelectTrigger id='oauth-workspace' className='w-full h-9'>
                  <SelectValue placeholder='Selecione um workspace' />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {context.workspaces.map((ws) => (
                      <SelectItem key={ws.id} value={ws.id}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                O acesso vale só para este workspace.
              </FieldDescription>
            </Field>

            <FieldSet>
              <FieldLegend variant='label'>Módulos</FieldLegend>
              <div className='flex flex-col gap-3'>
                {(workspace?.modules ?? []).map((module) => (
                  <Field key={module} orientation='horizontal'>
                    <Checkbox
                      id={`oauth-module-${module}`}
                      checked={modules.includes(module)}
                      onCheckedChange={(checked) =>
                        toggleModule(module, checked === true)
                      }
                      disabled={busy}
                    />
                    <FieldContent>
                      <FieldLabel htmlFor={`oauth-module-${module}`}>
                        {MCP_MODULE_LABELS[module]}
                      </FieldLabel>
                      <FieldDescription>
                        {MODULE_DESCRIPTIONS[module]}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                ))}
              </div>
            </FieldSet>

            <FieldSet>
              <FieldLegend variant='label'>Nível de acesso</FieldLegend>
              <RadioGroup
                value={access}
                onValueChange={(value) => setAccess(value as AccessLevel)}
                className='flex flex-col gap-2'
              >
                <FieldLabel htmlFor='oauth-access-read'>
                  <Field orientation='horizontal' className='px-4 py-3'>
                    <FieldContent>
                      <FieldTitle>Somente ler</FieldTitle>
                      <FieldDescription>
                        Consultar registros, relatórios e artigos.
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value='read' id='oauth-access-read' />
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor='oauth-access-write'>
                  <Field
                    orientation='horizontal'
                    className='px-4 py-3'
                    data-disabled={!writeRequested || undefined}
                  >
                    <FieldContent>
                      <FieldTitle>Ler e alterar</FieldTitle>
                      <FieldDescription>
                        {writeRequested
                          ? 'Também criar e atualizar registros, quando o administrador do workspace permitir. Nada é excluído.'
                          : 'Este app pediu só leitura.'}
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem
                      value='write'
                      id='oauth-access-write'
                      disabled={!writeRequested}
                    />
                  </Field>
                </FieldLabel>
              </RadioGroup>
            </FieldSet>
          </>
        )}

        {workspace && modules.length > 0 && (
          <div className='flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3'>
            <SteelIcon
              icon={Shield01Icon}
              className='mt-0.5 shrink-0 text-muted-foreground'
            />
            <div className='flex flex-col gap-2'>
              <Muted className='text-xs'>
                {mcpConsentNotice({
                  clientName,
                  workspaceName: workspace.name,
                  modules,
                })}
              </Muted>
              {access === 'write' && (
                <Muted className='text-xs'>{MCP_CONSENT_WRITE_NOTICE}</Muted>
              )}
            </div>
          </div>
        )}

        <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
          <Button
            type='button'
            variant='outline'
            onClick={() => submit(false)}
            disabled={busy}
          >
            Recusar
          </Button>
          <Button
            type='button'
            onClick={() => submit(true)}
            disabled={!canAccept}
          >
            {busy ? 'Autorizando...' : 'Permitir acesso'}
          </Button>
        </div>
      </div>
    </ConsentCard>
  )
}
