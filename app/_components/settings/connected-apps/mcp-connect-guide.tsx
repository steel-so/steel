'use client'

import {
  Copy01Icon,
  LinkSquare02Icon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { H4 } from '@/components/typography/heading/h4'
import { Muted } from '@/components/typography/text/muted'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { notify } from '@/lib/notify'
import { useIntegrationGrants } from '@/src/hooks/use-integration-grants'
import {
  isGuideConnected,
  MCP_CONNECT_GUIDES,
  type McpConnectGuide as McpGuide,
} from '@/src/lib/mcp/connect-guides'

/**
 * Ajustes › Apps conectados › “Conectar sua IA” (C10): the server address with
 * a copy button and, per app (Claude, ChatGPT, Gemini), a link to its
 * connector settings, the command when it has one, the steps and whether the
 * signed-in user is already connected to this workspace.
 */

function CopyButton({
  value,
  label,
  copiedMessage,
}: {
  value: string
  label: string
  copiedMessage: string
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true)
        notify.success(copiedMessage)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => notify.error('Não foi possível copiar'))
  }

  return (
    <Button type='button' variant='outline' size='sm' onClick={copy}>
      <SteelIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
      {label}
    </Button>
  )
}

function GuideCard({
  guide,
  mcpUrl,
  connected,
}: {
  guide: McpGuide
  mcpUrl: string
  connected: boolean
}) {
  const command = guide.command?.(mcpUrl) ?? null

  return (
    <Card>
      <CardContent className='flex flex-col gap-3'>
        <div className='flex items-center justify-between gap-2'>
          <H4>{guide.name}</H4>
          {connected ? <Badge variant='secondary'>Conectado</Badge> : null}
        </div>
        <ol className='list-decimal space-y-1 pl-5 text-sm'>
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className='flex flex-wrap gap-2'>
          {guide.openUrl ? (
            <Button
              variant='default'
              size='sm'
              render={
                <a href={guide.openUrl} target='_blank' rel='noreferrer' />
              }
            >
              <SteelIcon icon={LinkSquare02Icon} strokeWidth={2} />
              {guide.openLabel}
            </Button>
          ) : null}
          {command ? (
            <CopyButton
              value={command}
              label={`Copiar comando (${guide.commandLabel})`}
              copiedMessage='Comando copiado'
            />
          ) : null}
        </div>
        {command ? (
          <code className='block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs'>
            {command}
          </code>
        ) : null}
        {guide.note ? <Muted className='text-xs'>{guide.note}</Muted> : null}
      </CardContent>
    </Card>
  )
}

export function McpConnectGuide({
  workspaceId,
  mcpUrl,
}: {
  workspaceId: string
  mcpUrl: string
}) {
  const grants = useIntegrationGrants()

  return (
    <section className='flex flex-col gap-3'>
      <div>
        <H4>Conectar sua IA</H4>
        <Muted className='text-xs'>
          Use o Steel de dentro do Claude, do ChatGPT ou do Gemini. A IA age com
          o seu usuário e as suas permissões, só nos módulos que você liberar.
          Não há chave nem senha para copiar: o login acontece no Steel.
        </Muted>
      </div>
      <div className='flex flex-wrap items-center gap-2 rounded-md border p-3'>
        <div className='min-w-0 flex-1'>
          <p className='text-muted-foreground text-xs'>
            Endereço do servidor MCP
          </p>
          <code className='block truncate text-sm' data-testid='mcp-url'>
            {mcpUrl}
          </code>
        </div>
        <CopyButton
          value={mcpUrl}
          label='Copiar endereço'
          copiedMessage='Endereço copiado'
        />
      </div>
      <div className='grid gap-3 lg:grid-cols-3'>
        {MCP_CONNECT_GUIDES.map((guide) => (
          <GuideCard
            key={guide.id}
            guide={guide}
            mcpUrl={mcpUrl}
            connected={isGuideConnected(guide, grants.data ?? [], workspaceId)}
          />
        ))}
      </div>
    </section>
  )
}
