'use client'

import {
  FileImportIcon,
  UserMultipleIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import {
  type QueueWhatsAppAiCampaignInput,
  useClearWhatsAppAiCampaign,
  useQueueWhatsAppAiCampaign,
} from '@/src/hooks/use-whatsapp-ai-campaigns'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import {
  AI_CAMPAIGN_IMPORT_MAX_CHARS,
  guessAiCampaignSheetColumns,
  type ParsedAiCampaignSheet,
  parseAiCampaignSheet,
  toAiCampaignImportRows,
} from '@/src/lib/whatsapp/ai-campaign-import'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'

const NO_NAME = '__none__'

function queuedMessage(result: {
  added: number
  rejected: number
  optedOut: number
}): string {
  const parts = [`${result.added} contato(s) adicionados`]
  if (result.optedOut)
    parts.push(`${result.optedOut} descadastrado(s) ficaram de fora`)
  if (result.rejected) parts.push(`${result.rejected} telefone(s) inválido(s)`)
  return parts.join(' · ')
}

function SelectContacts({
  workspaceId,
  onQueue,
  pending,
}: {
  workspaceId: string
  onQueue: (input: QueueWhatsAppAiCampaignInput) => void
  pending: boolean
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const contacts = useWhatsAppContacts(workspaceId, search || undefined)
  const list = contacts.data ?? []
  const allVisible = list.length > 0 && list.every((c) => selected.has(c.id))

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          placeholder='Buscar por nome ou telefone'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className='max-w-xs'
        />
        <Button
          size='sm'
          variant='outline'
          disabled={list.length === 0}
          onClick={() =>
            setSelected((current) => {
              const next = new Set(current)
              for (const contact of list) {
                if (allVisible) next.delete(contact.id)
                else next.add(contact.id)
              }
              return next
            })
          }
        >
          {allVisible ? 'Desmarcar visíveis' : 'Marcar visíveis'}
        </Button>
      </div>
      <ul className='max-h-72 divide-y overflow-y-auto rounded-lg border'>
        {list.length === 0 ? (
          <li className='p-4 text-center text-muted-foreground text-sm'>
            {contacts.isLoading
              ? 'Carregando...'
              : 'Nenhum contato encontrado.'}
          </li>
        ) : (
          list.map((contact) => (
            <li key={contact.id}>
              <label
                htmlFor={`pick-${contact.id}`}
                className='flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50'
              >
                <Checkbox
                  id={`pick-${contact.id}`}
                  checked={selected.has(contact.id)}
                  disabled={Boolean(contact.broadcastOptedOutAt)}
                  onCheckedChange={() => toggle(contact.id)}
                />
                <span className='min-w-0 flex-1 truncate'>
                  {contact.name ?? 'Sem nome'}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {contact.waId}
                </span>
                {contact.broadcastOptedOutAt ? (
                  <span className='text-destructive text-xs'>
                    descadastrado
                  </span>
                ) : null}
              </label>
            </li>
          ))
        )}
      </ul>
      <div className='flex justify-end'>
        <Button
          disabled={selected.size === 0 || pending}
          onClick={() => {
            onQueue({ contactIds: [...selected] })
            setSelected(new Set())
          }}
        >
          Adicionar {selected.size} selecionado(s)
        </Button>
      </div>
    </div>
  )
}

function ImportSheet({
  onQueue,
  pending,
}: {
  onQueue: (input: QueueWhatsAppAiCampaignInput) => void
  pending: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheet, setSheet] = useState<ParsedAiCampaignSheet | null>(null)
  const [fileName, setFileName] = useState('')
  const [phoneColumn, setPhoneColumn] = useState<string | null>(null)
  const [nameColumn, setNameColumn] = useState<string>(NO_NAME)

  const rows = useMemo(
    () =>
      sheet && phoneColumn
        ? toAiCampaignImportRows(sheet, {
            phone: phoneColumn,
            name: nameColumn === NO_NAME ? null : nameColumn,
          })
        : [],
    [sheet, phoneColumn, nameColumn],
  )
  const extraColumns = sheet
    ? sheet.columns.filter((c) => c !== phoneColumn && c !== nameColumn)
    : []
  const columnItems = (sheet?.columns ?? []).map((c) => ({
    value: c,
    label: c,
  }))

  async function handleFile(file: File) {
    const text = await file.text()
    if (text.length > AI_CAMPAIGN_IMPORT_MAX_CHARS) {
      notify.error('Planilha grande demais — divida em arquivos de até 5 MB')
      return
    }
    const parsed = parseAiCampaignSheet(text)
    if (parsed.columns.length === 0 || parsed.rows.length === 0) {
      notify.error('A planilha está vazia ou sem cabeçalho')
      return
    }
    const guess = guessAiCampaignSheetColumns(parsed.columns)
    setSheet(parsed)
    setFileName(file.name)
    setPhoneColumn(guess.phone)
    setNameColumn(guess.name ?? NO_NAME)
  }

  return (
    <div className='space-y-4'>
      <div className='rounded-lg border border-dashed p-5 text-center'>
        <SteelIcon
          icon={FileImportIcon}
          size={24}
          className='mx-auto text-muted-foreground'
        />
        <p className='mt-2 text-sm'>
          Envie um CSV (exportado do Excel ou Google Sheets) com uma coluna de
          telefone. As outras colunas viram valores para as variáveis do
          template.
        </p>
        <input
          ref={fileRef}
          type='file'
          accept='.csv,text/csv'
          className='hidden'
          aria-label='Planilha de contatos'
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
            event.target.value = ''
          }}
        />
        <Button
          className='mt-3'
          variant='outline'
          onClick={() => fileRef.current?.click()}
        >
          {fileName ? 'Trocar arquivo' : 'Escolher arquivo'}
        </Button>
        {fileName ? (
          <p className='mt-1 text-muted-foreground text-xs'>
            {fileName} · {sheet?.rows.length ?? 0} linha(s)
          </p>
        ) : null}
      </div>

      {sheet ? (
        <div className='space-y-3'>
          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='space-y-1.5'>
              <Label htmlFor='sheetPhone'>Coluna do telefone</Label>
              <Select
                items={columnItems}
                value={phoneColumn}
                onValueChange={(value) =>
                  setPhoneColumn((value as string) ?? null)
                }
              >
                <SelectTrigger id='sheetPhone' className='w-full'>
                  <SelectValue placeholder='Escolha a coluna' />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {columnItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='sheetName'>Coluna do nome</Label>
              <Select
                items={[{ value: NO_NAME, label: 'Sem nome' }, ...columnItems]}
                value={nameColumn}
                onValueChange={(value) =>
                  setNameColumn((value as string) ?? NO_NAME)
                }
              >
                <SelectTrigger id='sheetName' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem value={NO_NAME}>Sem nome</SelectItem>
                    {columnItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
          {extraColumns.length > 0 ? (
            <p className='text-muted-foreground text-xs'>
              Colunas para as variáveis: {extraColumns.join(', ')}
            </p>
          ) : null}
          <div className='overflow-x-auto rounded-lg border'>
            <table className='w-full text-xs'>
              <thead className='bg-muted/50'>
                <tr>
                  {sheet.columns.map((column) => (
                    <th
                      key={column}
                      className='px-2 py-1.5 text-left font-medium'
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 3).map((row, index) => (
                  <tr key={`row-${index}`} className='border-t'>
                    {sheet.columns.map((column) => (
                      <td key={column} className='px-2 py-1.5'>
                        {row[column]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='flex justify-end'>
            <Button
              disabled={!phoneColumn || rows.length === 0 || pending}
              onClick={() => onQueue({ rows })}
            >
              Importar {rows.length} contato(s)
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Passo "Contatos": quem recebe a campanha. */
export function AiCampaignStepContacts({
  workspaceId,
  campaign,
  onDone,
}: {
  workspaceId: string
  campaign: WhatsAppAiCampaignDTO
  onDone: () => void
}) {
  const queue = useQueueWhatsAppAiCampaign(workspaceId, campaign.id)
  const clear = useClearWhatsAppAiCampaign(workspaceId, campaign.id)
  const { stats } = campaign
  const running = campaign.status === 'RUNNING'

  function handleQueue(input: QueueWhatsAppAiCampaignInput) {
    queue.mutate(input, {
      onSuccess: (result) => notify.success(queuedMessage(result)),
      onError: (error) => notify.error(error, 'Não foi possível adicionar'),
    })
  }

  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 p-4'>
        <div className='flex items-center gap-3'>
          <SteelIcon
            icon={UserMultipleIcon}
            size={20}
            className='text-primary'
          />
          <div>
            <p className='font-medium text-sm'>
              {stats.total} contato(s) na campanha
            </p>
            <p className='text-muted-foreground text-xs'>
              {stats.pending} aguardando envio · {stats.sent} enviados ·{' '}
              {stats.skipped + stats.failed} pulados/falhas
            </p>
          </div>
        </div>
        <div className='flex gap-1.5'>
          <Button
            size='xs'
            variant='ghost'
            disabled={running || stats.pending === 0 || clear.isPending}
            onClick={() =>
              clear.mutate(false, {
                onSuccess: () => notify.success('Pendentes removidos'),
                onError: (error) =>
                  notify.error(error, 'Não foi possível limpar'),
              })
            }
          >
            Limpar pendentes
          </Button>
        </div>
      </div>

      <Tabs defaultValue='select'>
        <TabsList>
          <TabsTrigger value='select'>Selecionar contatos</TabsTrigger>
          <TabsTrigger value='all'>Todos os contatos</TabsTrigger>
          <TabsTrigger value='import'>Importar planilha</TabsTrigger>
        </TabsList>
        <TabsContent value='select' className='pt-4'>
          <SelectContacts
            workspaceId={workspaceId}
            onQueue={handleQueue}
            pending={queue.isPending}
          />
        </TabsContent>
        <TabsContent value='all' className='pt-4'>
          <div className='space-y-3 rounded-lg border p-5'>
            <p className='text-sm'>
              Adiciona todos os contatos do WhatsApp do workspace (até 10.000),
              menos os descadastrados. Quem já está na campanha não entra de
              novo.
            </p>
            <Button
              disabled={queue.isPending}
              onClick={() => handleQueue({ all: true })}
            >
              Adicionar todos os contatos
            </Button>
          </div>
        </TabsContent>
        <TabsContent value='import' className='pt-4'>
          <ImportSheet onQueue={handleQueue} pending={queue.isPending} />
        </TabsContent>
      </Tabs>

      <div className='flex justify-end'>
        <Button variant={stats.total ? 'default' : 'outline'} onClick={onDone}>
          Continuar
        </Button>
      </div>
    </div>
  )
}
