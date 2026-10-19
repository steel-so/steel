'use client'

import {
  GithubIcon,
  GitlabIcon,
  RefreshIcon,
  SlackIcon,
  UserSearch01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import {
  useCrmApolloConnection,
  useCrmApolloMailingLists,
  useUpdateCrmApolloSettings,
} from '@/src/hooks/use-crm-apollo'
import {
  useWorkspaceIntegrationMutations,
  useWorkspaceIntegrations,
  workspaceSlackConnectUrl,
} from '@/src/hooks/use-workspace-integrations'
import type {
  WorkspaceIntegrationKindDTO,
  WorkspaceIntegrationProviderDTO,
} from '@/types/workspace-integration'
import {
  ConnectionActivity,
  CopyField,
  Field,
  IntegrationStatusBadge,
  PlainSelect,
} from './integration-kit'
import { SlackRules } from './slack-rules'

/**
 * Ajustes > Integrações (ADR 0024): Slack, GitHub and GitLab, connected once
 * per workspace and used by every module. Tokens and secrets only go in —
 * no response brings them back, so the page can never show them.
 */

const PROVIDER_COPY: Record<
  WorkspaceIntegrationKindDTO,
  { title: string; description: string; icon: typeof SlackIcon }
> = {
  SLACK: {
    title: 'Slack',
    description:
      'Avisos de todos os módulos no canal escolhido, chamado aberto a partir de uma mensagem e respostas da thread no histórico do chamado.',
    icon: SlackIcon,
  },
  GITHUB: {
    title: 'GitHub',
    description:
      'Vincule issues e pull requests a chamados, abra issues a partir do chamado e receba o estado (fechada, reaberta, mesclada) por webhook.',
    icon: GithubIcon,
  },
  GITLAB: {
    title: 'GitLab',
    description:
      'Os mesmos recursos do GitHub com issues e merge requests, no gitlab.com ou numa instância própria (self-managed).',
    icon: GitlabIcon,
  },
  APOLLO: {
    title: 'Apollo.io',
    description:
      'Busque pessoas na base da Apollo com a chave da sua própria conta e importe como leads do CRM. A busca não gasta créditos; a importação consome os créditos da sua conta Apollo.',
    icon: UserSearch01Icon,
  },
}

/* ------------------------------ card actions ------------------------------ */

function CardActions({
  workspaceId,
  provider,
}: {
  workspaceId: string
  provider: WorkspaceIntegrationProviderDTO
}) {
  const { test, disconnect } = useWorkspaceIntegrationMutations(workspaceId)
  const copy = PROVIDER_COPY[provider.kind]
  if (!provider.connection) return null
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={test.isPending || !provider.available}
        onClick={() =>
          test.mutate(provider.kind, {
            onSuccess: (result) =>
              result.ok
                ? notify.success(result.message)
                : notify.error(result.message),
            onError: (error) => notify.error(error.message),
          })
        }
      >
        <SteelIcon icon={RefreshIcon} strokeWidth={2} />
        Testar conexão
      </Button>
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button type='button' variant='destructive' size='sm'>
              Desconectar
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar o {copy.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              {provider.kind === 'APOLLO'
                ? 'A chave é apagada e as novas buscas e importações param na hora. Os leads já importados continuam no CRM.'
                : 'O token é apagado e as atualizações param na hora, em todos os módulos. Os vínculos já registrados ficam no histórico dos chamados.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnect.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(provider.kind, {
                  onSuccess: () => notify.success(`${copy.title} desconectado`),
                  onError: (error) => notify.error(error.message),
                })
              }
            >
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ProviderCard({
  workspaceId,
  provider,
  children,
}: {
  workspaceId: string
  provider: WorkspaceIntegrationProviderDTO
  children?: React.ReactNode
}) {
  const copy = PROVIDER_COPY[provider.kind]
  const connection = provider.connection
  return (
    <Card aria-label={copy.title}>
      <CardHeader>
        <div className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
          <div className='flex min-w-0 items-start gap-3'>
            <span className='flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40'>
              <SteelIcon icon={copy.icon} strokeWidth={2} />
            </span>
            <div className='min-w-0 space-y-1'>
              <CardTitle className='flex flex-wrap items-center gap-2'>
                {copy.title}
                <IntegrationStatusBadge provider={provider} />
              </CardTitle>
              <CardDescription>{copy.description}</CardDescription>
            </div>
          </div>
          <CardActions workspaceId={workspaceId} provider={provider} />
        </div>
      </CardHeader>
      <CardContent className='flex min-w-0 flex-col gap-4'>
        {!provider.available ? (
          <p className='rounded-lg border border-dashed border-border p-3 text-muted-foreground text-sm'>
            {provider.unavailableReason}
          </p>
        ) : null}
        {connection ? (
          <div className='flex min-w-0 flex-col gap-2'>
            <p className='break-words text-sm'>
              Conectado a{' '}
              <strong>
                {connection.externalName ?? connection.externalId}
              </strong>
              {connection.baseUrl ? (
                <span className='text-muted-foreground'>
                  {' '}
                  em {connection.baseUrl}
                </span>
              ) : null}
            </p>
            {connection.statusError ? (
              <p role='alert' className='break-words text-destructive text-xs'>
                {connection.statusError}
              </p>
            ) : null}
            <ConnectionActivity connection={connection} />
          </div>
        ) : null}
        {children}
      </CardContent>
    </Card>
  )
}

/* ---------------------------------- Slack ---------------------------------- */

function SlackCard({
  workspaceId,
  provider,
  enabledModules,
}: {
  workspaceId: string
  provider: WorkspaceIntegrationProviderDTO
  enabledModules: Parameters<typeof SlackRules>[0]['enabledModules']
}) {
  const connection = provider.connection
  return (
    <ProviderCard workspaceId={workspaceId} provider={provider}>
      {provider.available && !connection ? (
        <div>
          <a
            href={workspaceSlackConnectUrl(workspaceId)}
            className={buttonVariants()}
          >
            <SteelIcon icon={SlackIcon} strokeWidth={2} />
            Conectar o Slack
          </a>
        </div>
      ) : null}
      {provider.webhookUrl ? (
        <CopyField
          label='Request URL do app do Slack'
          value={provider.webhookUrl}
        />
      ) : null}
      {connection?.slack ? (
        <SlackRules
          workspaceId={workspaceId}
          settings={connection.slack}
          enabledModules={enabledModules}
        />
      ) : null}
    </ProviderCard>
  )
}

/* --------------------------------- Apollo --------------------------------- */

const APOLLO_KEY_URL = 'https://app.apollo.io/#/settings/integrations/api'
const NO_LIST = '__none__'

function ApolloCard({
  workspaceId,
  provider,
  crmEnabled,
}: {
  workspaceId: string
  provider: WorkspaceIntegrationProviderDTO
  crmEnabled: boolean
}) {
  const { connectApollo } = useWorkspaceIntegrationMutations(workspaceId)
  const [apiKey, setApiKey] = useState('')
  const connection = provider.connection
  const settings = useCrmApolloConnection(workspaceId)
  const lists = useCrmApolloMailingLists(workspaceId)
  const updateSettings = useUpdateCrmApolloSettings(workspaceId)
  const showDefaultList = crmEnabled && !!connection

  return (
    <ProviderCard workspaceId={workspaceId} provider={provider}>
      {connection ? (
        <p className='text-muted-foreground text-sm'>
          Chave em uso: <code>{connection.externalName ?? '••••'}</code>
        </p>
      ) : null}
      <form
        className='flex min-w-0 flex-col gap-3'
        onSubmit={(event) => {
          event.preventDefault()
          connectApollo.mutate(
            { apiKey: apiKey.trim() },
            {
              onSuccess: () => {
                setApiKey('')
                notify.success(
                  connection ? 'Chave da Apollo trocada' : 'Apollo conectada',
                )
              },
              onError: (error) => notify.error(error.message),
            },
          )
        }}
      >
        <Field
          id='apollo-api-key'
          label={connection ? 'Trocar a chave de API' : 'Chave de API'}
          hint='Só administradores veem esta tela. A chave é guardada cifrada e nunca é exibida de novo.'
        >
          <div className='flex min-w-0 items-center gap-2'>
            <Input
              id='apollo-api-key'
              type='password'
              autoComplete='off'
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className='min-w-0'
            />
            <Button
              type='submit'
              disabled={connectApollo.isPending || apiKey.trim().length < 10}
            >
              {connection ? 'Salvar' : 'Conectar a Apollo'}
            </Button>
          </div>
        </Field>
        <a
          href={APOLLO_KEY_URL}
          target='_blank'
          rel='noopener noreferrer'
          className='w-fit text-primary text-sm underline-offset-4 hover:underline'
        >
          Onde encontro minha chave? Apollo › Settings › Integrations › API
        </a>
      </form>
      {showDefaultList ? (
        <Field
          id='apollo-default-list'
          label='Lista de e-mail padrão das importações'
          hint='Sugerida ao importar; dá para trocar a cada importação.'
        >
          <PlainSelect
            ariaLabel='Lista de e-mail padrão'
            value={settings.data?.defaultMailingListId ?? NO_LIST}
            disabled={updateSettings.isPending || !lists.data}
            options={[
              { value: NO_LIST, label: 'Nenhuma' },
              ...(lists.data ?? []).map((list) => ({
                value: list.id,
                label: list.name,
              })),
            ]}
            onChange={(value) =>
              updateSettings.mutate(
                { defaultMailingListId: value === NO_LIST ? null : value },
                {
                  onSuccess: () => notify.success('Lista padrão salva'),
                  onError: (error) => notify.error(error.message),
                },
              )
            }
          />
        </Field>
      ) : null}
    </ProviderCard>
  )
}

/* ---------------------------- GitHub and GitLab ---------------------------- */

function SecretRotation({
  workspaceId,
  kind,
}: {
  workspaceId: string
  kind: 'GITHUB' | 'GITLAB'
}) {
  const { updateCredentials } = useWorkspaceIntegrationMutations(workspaceId)
  const [token, setToken] = useState('')
  const [secret, setSecret] = useState('')
  const prefix = kind === 'GITHUB' ? 'github' : 'gitlab'
  return (
    <div className='grid min-w-0 gap-3 md:grid-cols-2'>
      <Field id={`${prefix}-rotate-token`} label='Trocar o token'>
        <div className='flex min-w-0 items-center gap-2'>
          <Input
            id={`${prefix}-rotate-token`}
            type='password'
            autoComplete='off'
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className='min-w-0'
          />
          <Button
            type='button'
            variant='outline'
            disabled={updateCredentials.isPending || token.trim().length < 20}
            onClick={() =>
              updateCredentials.mutate(
                { kind, token: token.trim() },
                {
                  onSuccess: () => {
                    setToken('')
                    notify.success('Token trocado')
                  },
                  onError: (error) => notify.error(error.message),
                },
              )
            }
          >
            Salvar
          </Button>
        </div>
      </Field>
      <Field id={`${prefix}-rotate-secret`} label='Trocar o segredo do webhook'>
        <div className='flex min-w-0 items-center gap-2'>
          <Input
            id={`${prefix}-rotate-secret`}
            type='password'
            autoComplete='off'
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            className='min-w-0'
          />
          <Button
            type='button'
            variant='outline'
            disabled={updateCredentials.isPending || secret.trim().length < 16}
            onClick={() =>
              updateCredentials.mutate(
                { kind, webhookSecret: secret.trim() },
                {
                  onSuccess: () => {
                    setSecret('')
                    notify.success('Segredo trocado')
                  },
                  onError: (error) => notify.error(error.message),
                },
              )
            }
          >
            Salvar
          </Button>
        </div>
      </Field>
    </div>
  )
}

interface RepoForm {
  baseUrl: string
  project: string
  token: string
  secret: string
}

const EMPTY_FORM: RepoForm = { baseUrl: '', project: '', token: '', secret: '' }

function RepoCard({
  workspaceId,
  provider,
}: {
  workspaceId: string
  provider: WorkspaceIntegrationProviderDTO
}) {
  const kind = provider.kind === 'GITLAB' ? 'GITLAB' : 'GITHUB'
  const { connectGithub, connectGitlab } =
    useWorkspaceIntegrationMutations(workspaceId)
  const [form, setForm] = useState<RepoForm>(EMPTY_FORM)
  const connection = provider.connection
  useEffect(() => {
    if (connection) setForm(EMPTY_FORM)
  }, [connection])

  const set = (key: keyof RepoForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))
  const pending = connectGithub.isPending || connectGitlab.isPending
  const prefix = kind === 'GITHUB' ? 'github' : 'gitlab'
  const onDone = {
    onSuccess: () => notify.success(`${PROVIDER_COPY[kind].title} conectado`),
    onError: (error: Error) => notify.error(error.message),
  }

  function connect() {
    const secret = form.secret.trim() || null
    if (kind === 'GITHUB') {
      connectGithub.mutate(
        {
          repo: form.project.trim(),
          token: form.token.trim(),
          webhookSecret: secret,
        },
        onDone,
      )
    } else {
      connectGitlab.mutate(
        {
          baseUrl: form.baseUrl.trim() || null,
          project: form.project.trim(),
          token: form.token.trim(),
          webhookSecret: secret,
        },
        onDone,
      )
    }
  }

  return (
    <ProviderCard workspaceId={workspaceId} provider={provider}>
      {provider.webhookUrl ? (
        <CopyField
          label={
            kind === 'GITHUB'
              ? 'URL do webhook (Settings › Webhooks do repositório)'
              : 'URL do webhook (Settings › Webhooks do projeto)'
          }
          value={provider.webhookUrl}
        />
      ) : null}
      {connection ? (
        <>
          {connection.hasWebhookSecret ? null : (
            <p className='text-destructive text-xs'>
              Sem segredo de webhook, as atualizações vindas do{' '}
              {PROVIDER_COPY[kind].title} são recusadas. Gere um (
              <code>openssl rand -hex 24</code>), cadastre no webhook e salve
              abaixo.
            </p>
          )}
          <SecretRotation workspaceId={workspaceId} kind={kind} />
        </>
      ) : (
        <form
          className='flex min-w-0 flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault()
            connect()
          }}
        >
          <div className='grid min-w-0 gap-3 md:grid-cols-2'>
            {kind === 'GITLAB' ? (
              <Field
                id='gitlab-base-url'
                label='Endereço do GitLab'
                hint='Vazio = gitlab.com. Para self-managed, a URL HTTPS da instância.'
                className='md:col-span-2'
              >
                <Input
                  id='gitlab-base-url'
                  placeholder='https://gitlab.com'
                  value={form.baseUrl}
                  onChange={(event) => set('baseUrl')(event.target.value)}
                />
              </Field>
            ) : null}
            <Field
              id={`${prefix}-project`}
              label={kind === 'GITHUB' ? 'Repositório' : 'Projeto'}
              hint={
                kind === 'GITHUB'
                  ? '`owner/repo` ou a URL do repositório'
                  : '`grupo/projeto` ou a URL do projeto'
              }
            >
              <Input
                id={`${prefix}-project`}
                placeholder={
                  kind === 'GITHUB' ? 'steel-so/steel' : 'stratus/steel'
                }
                value={form.project}
                onChange={(event) => set('project')(event.target.value)}
              />
            </Field>
            <Field
              id={`${prefix}-token`}
              label='Token de acesso'
              hint={
                kind === 'GITHUB'
                  ? 'PAT fine-grained com Issues e Pull requests: read & write'
                  : 'Token pessoal, de projeto ou de grupo com escopo api'
              }
            >
              <Input
                id={`${prefix}-token`}
                type='password'
                autoComplete='off'
                placeholder={kind === 'GITHUB' ? 'github_pat_…' : 'glpat-…'}
                value={form.token}
                onChange={(event) => set('token')(event.target.value)}
              />
            </Field>
            <Field
              id={`${prefix}-secret`}
              label='Segredo do webhook'
              hint='Pelo menos 16 caracteres (openssl rand -hex 24)'
              className='md:col-span-2'
            >
              <Input
                id={`${prefix}-secret`}
                type='password'
                autoComplete='off'
                value={form.secret}
                onChange={(event) => set('secret')(event.target.value)}
              />
            </Field>
          </div>
          <div>
            <Button
              type='submit'
              disabled={
                pending ||
                form.project.trim().length < 3 ||
                form.token.trim().length < 20
              }
            >
              <SteelIcon icon={PROVIDER_COPY[kind].icon} strokeWidth={2} />
              Conectar o {PROVIDER_COPY[kind].title}
            </Button>
          </div>
        </form>
      )}
    </ProviderCard>
  )
}

/* ---------------------------------- page ---------------------------------- */

export function IntegrationsManager({
  workspaceId,
  slackResult,
}: {
  workspaceId: string
  /** `?slack=connected|error` after the OAuth callback. */
  slackResult?: 'connected' | 'error' | null
}) {
  const { data, isLoading, error } = useWorkspaceIntegrations(workspaceId)

  useEffect(() => {
    if (slackResult === 'connected') notify.success('Slack conectado')
    if (slackResult === 'error') {
      notify.error('Não foi possível conectar o Slack. Tente de novo.')
    }
  }, [slackResult])

  if (isLoading) {
    return (
      <p className='text-muted-foreground text-sm'>Carregando integrações…</p>
    )
  }
  if (error || !data) {
    return (
      <p className='text-destructive text-sm'>
        {error?.message ?? 'Erro ao carregar as integrações'}
      </p>
    )
  }

  return (
    <div className='flex min-w-0 flex-col gap-6'>
      {data.providers.map((provider) =>
        provider.kind === 'SLACK' ? (
          <SlackCard
            key={provider.kind}
            workspaceId={workspaceId}
            provider={provider}
            enabledModules={data.enabledModules}
          />
        ) : provider.kind === 'APOLLO' ? (
          <ApolloCard
            key={provider.kind}
            workspaceId={workspaceId}
            provider={provider}
            crmEnabled={data.enabledModules.includes('CRM')}
          />
        ) : (
          <RepoCard
            key={provider.kind}
            workspaceId={workspaceId}
            provider={provider}
          />
        ),
      )}
    </div>
  )
}
