'use client'

import { type ChangeEvent, type FormEvent, useEffect, useState } from 'react'
import { WhatsappNumberValidationDialog } from '@/app/_components/whatsapp/number-validation/whatsapp-number-validation-dialog'
import { contactRecordTitle } from '@/app/_components/whatsapp/whatsapp-contact-label'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCancelWhatsAppBroadcast,
  useCreateWhatsAppBroadcast,
  useImportWhatsAppBroadcast,
  useRetryFailedWhatsAppBroadcast,
  useStartWhatsAppBroadcast,
  useWhatsAppBroadcast,
  useWhatsAppBroadcasts,
} from '@/src/hooks/use-whatsapp-broadcasts'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import { useUploadWhatsAppMedia } from '@/src/hooks/use-whatsapp-media-upload'
import { useWhatsAppSpendCaps } from '@/src/hooks/use-whatsapp-spend-caps'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import {
  BROADCAST_MEDIA_ACCEPT,
  BROADCAST_MEDIA_KIND_LABEL,
  type BroadcastMediaKind,
  mediaKindFromMime,
  validateBroadcastMedia,
} from '@/src/lib/whatsapp/broadcast-media'
import { REFERENCE_PRICES } from '@/src/lib/whatsapp/cost'
import { findTemplateFlowButton } from '@/src/lib/whatsapp/flows/template-button'
import {
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
} from '@/src/lib/whatsapp/template-variables'
import type { WhatsAppBroadcastListDTO } from '@/types/whatsapp-broadcast'
import type { WhatsAppBroadcastImportResultDTO } from '@/types/whatsapp-broadcast-import'
import { formatBrl } from '../costs/whatsapp-costs-format'
import { WhatsappNumberValidationProgress } from '../number-validation/whatsapp-number-validation-dialog'
import { TemplateNameWithQuality } from '../template-quality-badge'
import { BroadcastMediaPreview } from './broadcast-media-preview'
import { WhatsappBroadcastMarketingMetrics } from './whatsapp-broadcast-marketing-metrics'
import { WhatsappSettingsMarketingLite } from './whatsapp-settings-marketing-lite'

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Agendada',
  RUNNING: 'Enviando',
  DONE: 'Concluída',
  FAILED: 'Falhou',
}

const BR_DATETIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})

/** Spreadsheet model: header for the template's variables plus one example. */
export function buildImportModelCsv(variableCount: number): string {
  const vars = Array.from({ length: variableCount }, (_, i) => i + 1)
  const header = ['telefone', 'nome', 'data_referencia', ...vars.map((n) => `var_${n}`)]
  const example = [
    '11999998888',
    'Maria',
    '15/12/2099 09:30',
    ...vars.map((n) => `Exemplo ${n}`),
  ]
  return `${header.join(',')}\n${example.join(',')}\n`
}

function downloadModelCsv(variableCount: number) {
  const blob = new Blob([`\uFEFF${buildImportModelCsv(variableCount)}`], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'modelo-transmissao.csv'
  link.click()
  URL.revokeObjectURL(url)
}

/** Interruptor "Pular números sem WhatsApp" (só faz sentido com Z-API). */
function SkipNoWhatsappSwitch({
  id,
  checked,
  onCheckedChange,
  hasZapi,
}: {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  hasZapi: boolean
}) {
  return (
    <div className='flex items-start justify-between gap-3 rounded-md border p-3'>
      <div>
        <Label htmlFor={id}>Pular números sem WhatsApp</Label>
        <p className='text-muted-foreground text-xs'>
          {hasZapi
            ? 'Quem a checagem "Validar base" marcou sem WhatsApp não recebe e aparece nos contadores. Quem ainda não foi verificado recebe normalmente.'
            : 'Disponível só com uma conexão Z-API (a API oficial da Meta não oferece a checagem "tem WhatsApp?").'}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={!hasZapi}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

interface StagedMedia {
  file: File
  kind: BroadcastMediaKind
  previewUrl: string
}

function CreateBroadcastDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [media, setMedia] = useState<StagedMedia | null>(null)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [messageBody, setMessageBody] = useState('')
  const [skipNoWhatsapp, setSkipNoWhatsapp] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(
    new Set(),
  )
  const [contactQuery, setContactQuery] = useState('')

  const connections = useWhatsAppConnections(workspaceId)
  const selectedConnection = (connections.data ?? []).find(
    (connection) => connection.id === connectionId,
  )
  const hasZapi = (connections.data ?? []).some(
    (connection) => connection.provider === 'ZAPI',
  )
  const contacts = useWhatsAppContacts(workspaceId)
  const createBroadcast = useCreateWhatsAppBroadcast(workspaceId)
  const uploadMedia = useUploadWhatsAppMedia(workspaceId)

  // Libera o blob da prévia ao trocar/remover o arquivo.
  useEffect(
    () => () => {
      if (media) URL.revokeObjectURL(media.previewUrl)
    },
    [media],
  )

  function handleMediaSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = validateBroadcastMedia({
      mimeType: file.type,
      sizeBytes: file.size,
    })
    const kind = mediaKindFromMime(file.type)
    if (problem || !kind) {
      notify.error(problem ?? 'Tipo de arquivo não suportado')
      return
    }
    setMedia({ file, kind, previewUrl: URL.createObjectURL(file) })
  }

  // Opt-out LGPD: o servidor já exclui descadastrados ao criar a lista; aqui
  // eles aparecem desabilitados e fora da contagem.
  const optedOutIds = new Set(
    (contacts.data ?? [])
      .filter((contact) => contact.broadcastOptedOutAt)
      .map((contact) => contact.id),
  )
  const selectedEligibleCount = Array.from(selectedContactIds).filter(
    (id) => !optedOutIds.has(id),
  ).length

  const normalizedQuery = contactQuery.trim().toLowerCase()
  const visibleContacts = (contacts.data ?? []).filter(
    (contact) =>
      normalizedQuery === '' ||
      contactRecordTitle(contact).toLowerCase().includes(normalizedQuery) ||
      contact.waId.includes(normalizedQuery.replace(/\D/g, '') || '\0'),
  )
  const visibleEligibleIds = visibleContacts
    .filter((contact) => !optedOutIds.has(contact.id))
    .map((contact) => contact.id)
  const allVisibleSelected =
    visibleEligibleIds.length > 0 &&
    visibleEligibleIds.every((id) => selectedContactIds.has(id))

  function toggleAllVisible() {
    setSelectedContactIds((prev) => {
      const next = new Set(prev)
      for (const id of visibleEligibleIds) {
        if (allVisibleSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function toggleContact(contactId: string) {
    if (optedOutIds.has(contactId)) return
    setSelectedContactIds((prev) => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!connectionId || selectedEligibleCount === 0) {
      notify.error('Selecione a conexão e ao menos um contato')
      return
    }

    let uploaded: { url: string } | null = null
    if (media) {
      try {
        uploaded = await uploadMedia.mutateAsync(media.file)
      } catch (error) {
        notify.error(error, 'Não foi possível enviar a mídia')
        return
      }
    }

    createBroadcast.mutate(
      {
        name,
        connectionId,
        messageBody,
        ...(uploaded && media
          ? {
              mediaUrl: uploaded.url,
              mediaMimeType: media.file.type,
              mediaFileName: media.file.name,
              mediaSizeBytes: media.file.size,
            }
          : {}),
        ...(skipNoWhatsapp ? { skipNoWhatsapp: true } : {}),
        contactIds: Array.from(selectedContactIds).filter(
          (id) => !optedOutIds.has(id),
        ),
      },
      {
        onSuccess: () => {
          notify.success('Lista de transmissão criada')
          setName('')
          setMessageBody('')
          setSkipNoWhatsapp(false)
          setMedia(null)
          setSelectedContactIds(new Set())
          setContactQuery('')
          setOpen(false)
        },
        onError: (error) => notify.error(error, 'Não foi possível criar'),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size='sm'>Nova lista</Button>} />
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Nova lista de transmissão</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='broadcastName'>Nome</Label>
            <Input
              id='broadcastName'
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='broadcastConnection'>Conexão</Label>
            <Select
              value={connectionId}
              onValueChange={(value) => setConnectionId(value ?? undefined)}
            >
              <SelectTrigger id='broadcastConnection' className='w-full'>
                <SelectValue placeholder='Selecione a conexão' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {(connections.data ?? []).map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {selectedConnection?.provider === 'META' ? (
            <p className='rounded-md border bg-muted/40 p-2.5 text-muted-foreground text-xs'>
              Pela API oficial da Meta, texto livre só chega a quem falou com
              você nas últimas 24 horas. Para os demais, o envio falha. Para
              avisar quem está fora desse prazo, use{' '}
              <strong>Importar planilha</strong> com um modelo (template)
              aprovado.
            </p>
          ) : null}

          <div className='space-y-1.5'>
            <Label htmlFor='broadcastMessage'>Mensagem</Label>
            <Textarea
              id='broadcastMessage'
              required
              rows={4}
              value={messageBody}
              onChange={(event) => setMessageBody(event.target.value)}
            />
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='broadcastMedia'>Mídia (opcional)</Label>
            {media ? (
              <div className='space-y-2'>
                <BroadcastMediaPreview
                  kind={media.kind}
                  src={media.previewUrl}
                  fileName={media.file.name}
                />
                <Button
                  type='button'
                  size='xs'
                  variant='outline'
                  onClick={() => setMedia(null)}
                >
                  Remover {BROADCAST_MEDIA_KIND_LABEL[media.kind].toLowerCase()}
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id='broadcastMedia'
                  type='file'
                  accept={BROADCAST_MEDIA_ACCEPT}
                  onChange={handleMediaSelected}
                />
                <p className='text-muted-foreground text-xs'>
                  Imagem JPG/PNG até 5 MB; vídeo MP4/3GP, áudio ou documento
                  (PDF, Word, Excel, PowerPoint, TXT) até 16 MB. A mensagem vai
                  como legenda.
                </p>
              </>
            )}
          </div>

          <SkipNoWhatsappSwitch
            id='broadcastSkipNoWhatsapp'
            checked={skipNoWhatsapp}
            onCheckedChange={setSkipNoWhatsapp}
            hasZapi={hasZapi}
          />

          <div className='space-y-1.5'>
            <Label>Contatos ({selectedEligibleCount} selecionados)</Label>
            <div className='flex items-center gap-2'>
              <Input
                aria-label='Buscar contato'
                placeholder='Buscar por nome ou número'
                value={contactQuery}
                onChange={(event) => setContactQuery(event.target.value)}
              />
              <Button
                type='button'
                size='sm'
                variant='outline'
                className='shrink-0'
                disabled={visibleEligibleIds.length === 0}
                onClick={toggleAllVisible}
              >
                {allVisibleSelected ? 'Limpar seleção' : 'Selecionar todos'}
              </Button>
            </div>
            <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-2'>
              {visibleContacts.map((contact) => {
                const optedOut = optedOutIds.has(contact.id)
                return (
                  <label
                    key={contact.id}
                    htmlFor={`broadcast-contact-${contact.id}`}
                    className={
                      optedOut
                        ? 'flex cursor-not-allowed items-center gap-2 py-1 text-sm opacity-60'
                        : 'flex items-center gap-2 py-1 text-sm'
                    }
                    title={
                      optedOut
                        ? 'Contato descadastrado das transmissões (LGPD) — não receberá'
                        : undefined
                    }
                  >
                    <Checkbox
                      id={`broadcast-contact-${contact.id}`}
                      checked={!optedOut && selectedContactIds.has(contact.id)}
                      disabled={optedOut}
                      onCheckedChange={() => toggleContact(contact.id)}
                    />
                    <span className='min-w-0 flex-1 truncate'>
                      {contactRecordTitle(contact)}
                    </span>
                    {optedOut ? (
                      <Badge variant='outline'>Descadastrado</Badge>
                    ) : contact.hasWhatsapp === false ? (
                      <Badge variant='destructive'>Sem WhatsApp</Badge>
                    ) : null}
                  </label>
                )
              })}
              {contacts.data?.length === 0 && (
                <p className='text-muted-foreground text-xs'>
                  Cadastre contatos antes de criar uma lista
                </p>
              )}
              {(contacts.data?.length ?? 0) > 0 &&
                visibleContacts.length === 0 && (
                  <p className='text-muted-foreground text-xs'>
                    Nenhum contato encontrado para essa busca.
                  </p>
                )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type='submit'
              disabled={createBroadcast.isPending || uploadMedia.isPending}
            >
              {uploadMedia.isPending
                ? 'Enviando mídia...'
                : createBroadcast.isPending
                  ? 'Criando...'
                  : 'Criar lista'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportBroadcastDialog({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [connectionId, setConnectionId] = useState<string>()
  const [templateId, setTemplateId] = useState<string>()
  const [sendOffsetHours, setSendOffsetHours] = useState(24)
  const [validateWhatsapp, setValidateWhatsapp] = useState(false)
  const [skipNoWhatsapp, setSkipNoWhatsapp] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  // Step 2: what the spreadsheet would schedule, before anything is created.
  const [preview, setPreview] = useState<WhatsAppBroadcastImportResultDTO | null>(
    null,
  )
  const [csvText, setCsvText] = useState('')
  const [result, setResult] = useState<WhatsAppBroadcastImportResultDTO | null>(
    null,
  )

  const connections = useWhatsAppConnections(workspaceId)
  const templates = useWhatsAppTemplates(workspaceId)
  const approvedTemplates = (templates.data ?? []).filter(
    (t) => t.status === 'APPROVED',
  )
  const selectedTemplate = approvedTemplates.find((t) => t.id === templateId)
  const opensForm = Boolean(
    selectedTemplate && findTemplateFlowButton(selectedTemplate.components),
  )
  const importBroadcast = useImportWhatsAppBroadcast(workspaceId)
  const importHasZapi = (connections.data ?? []).some(
    (connection) => connection.provider === 'ZAPI',
  )
  const variableCount = selectedTemplate
    ? extractTemplateFillableFields(
        parseMetaTemplateComponents(selectedTemplate.components),
      ).body.variableCount
    : 1

  function resetAndClose() {
    setValidateWhatsapp(false)
    setSkipNoWhatsapp(false)
    setName('')
    setConnectionId(undefined)
    setTemplateId(undefined)
    setSendOffsetHours(24)
    setFile(null)
    setPreview(null)
    setCsvText('')
    setResult(null)
    setOpen(false)
  }

  function payload(csv: string, dryRun: boolean) {
    return {
      name,
      connectionId: connectionId as string,
      templateId: templateId as string,
      sendOffsetHours,
      csv,
      ...(dryRun ? { dryRun: true } : {}),
      ...(validateWhatsapp ? { validateWhatsapp: true } : {}),
      ...(skipNoWhatsapp ? { skipNoWhatsapp: true } : {}),
    }
  }

  async function handleCheck(event: FormEvent) {
    event.preventDefault()
    if (!connectionId || !templateId || !file) {
      notify.error('Selecione a conexão, o template e o arquivo CSV')
      return
    }

    const csv = await file.text()
    setCsvText(csv)
    importBroadcast.mutate(payload(csv, true), {
      onSuccess: (data) => setPreview(data),
      onError: (error) => notify.error(error, 'Não foi possível ler a planilha'),
    })
  }

  function handleConfirm() {
    importBroadcast.mutate(payload(csvText, false), {
      onSuccess: (data) => {
        setPreview(null)
        setResult(data)
      },
      onError: (error) => notify.error(error, 'Não foi possível importar'),
    })
  }

  function rejectedList(rows: WhatsAppBroadcastImportResultDTO['rejectedRows']) {
    return rows.length > 0 ? (
      <div className='max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs'>
        {rows.map((row) => (
          <p key={row.rowNumber} className='text-destructive'>
            Linha {row.rowNumber}: {row.reason}
          </p>
        ))}
      </div>
    ) : null
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : resetAndClose())}
    >
      <DialogTrigger
        render={
          <Button size='sm' variant='outline'>
            Importar planilha
          </Button>
        }
      />
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Importar planilha (CSV)</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <p className='text-sm'>
              {result.createdCount} destinatário(s) agendado(s) com sucesso.
            </p>
            {rejectedList(result.rejectedRows)}
            {result.validation ? (
              <WhatsappNumberValidationProgress
                workspaceId={workspaceId}
                initial={result.validation}
              />
            ) : null}
            {result.validationUnavailable ? (
              <p className='rounded-lg border p-3 text-muted-foreground text-xs'>
                A planilha foi importada, mas a checagem de WhatsApp não rodou:{' '}
                {result.validationUnavailable}
              </p>
            ) : null}
            <DialogFooter>
              <Button onClick={resetAndClose}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : preview ? (
          <div className='space-y-3'>
            <p className='text-sm'>
              {preview.validCount ?? 0} envio(s) serão agendados.
              {(preview.rejectedRows.length ?? 0) > 0
                ? ` ${preview.rejectedRows.length} linha(s) com problema ficam de fora.`
                : ''}
            </p>
            {(preview.preview?.length ?? 0) > 0 ? (
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>Consulta/evento</TableHead>
                      <TableHead>Envio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.preview?.map((row) => (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>
                          {row.contactName ?? row.phone}
                          {row.contactName ? (
                            <span className='block text-muted-foreground text-xs'>
                              {row.phone}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-xs'>
                          {BR_DATETIME.format(new Date(row.appointmentAt))}
                        </TableCell>
                        <TableCell className='whitespace-nowrap text-xs'>
                          {BR_DATETIME.format(new Date(row.scheduledAt))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
            <p className='text-muted-foreground text-xs'>
              Mostrando as primeiras linhas. Horários no fuso de Brasília.
            </p>
            {rejectedList(preview.rejectedRows)}
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                disabled={importBroadcast.isPending}
                onClick={() => setPreview(null)}
              >
                Voltar
              </Button>
              <Button
                type='button'
                disabled={
                  importBroadcast.isPending || (preview.validCount ?? 0) === 0
                }
                onClick={handleConfirm}
              >
                {importBroadcast.isPending
                  ? 'Agendando...'
                  : `Confirmar e agendar ${preview.validCount ?? 0} envio(s)`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleCheck} className='space-y-3'>
            <p className='text-muted-foreground text-xs'>
              Colunas obrigatórias: <code>telefone</code>,{' '}
              <code>data_referencia</code> e uma coluna <code>var_1</code>,{' '}
              <code>var_2</code>... para cada variável do BODY do template.
              Coluna <code>nome</code> é opcional. Escreva a data como{' '}
              <code>15/12/2026 09:30</code> (horário de Brasília).
            </p>
            <Button
              type='button'
              size='xs'
              variant='outline'
              onClick={() => downloadModelCsv(variableCount)}
            >
              Baixar planilha modelo
            </Button>

            <div className='space-y-1.5'>
              <Label htmlFor='importName'>Nome</Label>
              <Input
                id='importName'
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importConnection'>Conexão</Label>
              <Select
                value={connectionId}
                onValueChange={(value) => setConnectionId(value ?? undefined)}
              >
                <SelectTrigger id='importConnection' className='w-full'>
                  <SelectValue placeholder='Selecione a conexão' />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {(connections.data ?? []).map((connection) => (
                      <SelectItem key={connection.id} value={connection.id}>
                        {connection.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importTemplate'>Template (aprovado)</Label>
              <Select
                value={templateId ?? null}
                onValueChange={(value) => setTemplateId(value ?? undefined)}
              >
                <SelectTrigger id='importTemplate' className='w-full'>
                  <SelectValue>
                    {(value: string | null) => {
                      const selected = approvedTemplates.find(
                        (t) => t.id === value,
                      )
                      return selected ? (
                        <TemplateNameWithQuality
                          name={selected.name}
                          quality={selected.quality}
                        />
                      ) : (
                        <span className='text-muted-foreground'>
                          Selecione o template
                        </span>
                      )
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {approvedTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <TemplateNameWithQuality
                          name={template.name}
                          quality={template.quality}
                        />
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {approvedTemplates.length === 0 && (
                <p className='text-muted-foreground text-xs'>
                  Nenhum template aprovado neste workspace ainda.
                </p>
              )}
              {opensForm && (
                <p className='text-muted-foreground text-xs'>
                  Este template abre um formulário: cada destinatário o recebe
                  já preenchido com o nome e o telefone dele, e as respostas
                  aparecem no formulário. Vale só para conexões da API oficial
                  da Meta.
                </p>
              )}
            </div>

            <div className='space-y-1.5'>
              <Label htmlFor='importOffset'>
                Enviar quantas horas antes da data de referência
              </Label>
              <Input
                id='importOffset'
                type='number'
                min={0}
                required
                value={sendOffsetHours}
                onChange={(event) =>
                  setSendOffsetHours(Number(event.target.value))
                }
              />
            </div>

            <label
              htmlFor='importValidate'
              className='flex items-start gap-2 text-sm'
            >
              <Checkbox
                id='importValidate'
                checked={validateWhatsapp}
                disabled={!importHasZapi}
                onCheckedChange={(checked) =>
                  setValidateWhatsapp(checked === true)
                }
              />
              <span>
                Validar se tem WhatsApp depois de importar
                <span className='block text-muted-foreground text-xs'>
                  Usa a sua conexão Z-API e não consome o limite do plano.
                </span>
              </span>
            </label>
            <SkipNoWhatsappSwitch
              id='importSkipNoWhatsapp'
              checked={skipNoWhatsapp}
              onCheckedChange={setSkipNoWhatsapp}
              hasZapi={importHasZapi}
            />

            <div className='space-y-1.5'>
              <Label htmlFor='importFile'>Arquivo CSV</Label>
              <Input
                id='importFile'
                type='file'
                accept='.csv,text/csv'
                required
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>

            <DialogFooter>
              <Button type='submit' disabled={importBroadcast.isPending}>
                {importBroadcast.isPending ? 'Lendo...' : 'Conferir planilha'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Start with a confirmation: recipients, estimated cost and cap balance. */
function StartBroadcastButton({
  workspaceId,
  broadcast,
}: {
  workspaceId: string
  broadcast: WhatsAppBroadcastListDTO
}) {
  const startBroadcast = useStartWhatsAppBroadcast(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const connection = (connections.data ?? []).find(
    (item) => item.id === broadcast.connectionId,
  )
  const isMeta = connection?.provider === 'META'
  const spendCaps = useWhatsAppSpendCaps(workspaceId, isMeta)
  const cap = (spendCaps.data ?? []).find(
    (row) => row.connectionId === broadcast.connectionId,
  )

  const recipients = broadcast.recipientCount
  const parts = [
    `A mensagem vai para ${recipients} contato(s)${connection ? ` pelo número "${connection.label}"` : ''}, com um intervalo de poucos segundos entre cada envio. Quem se descadastrou é ignorado.`,
  ]
  if (isMeta) {
    const estimate = recipients * REFERENCE_PRICES.MARKETING
    parts.push(
      `Custo estimado: até ${formatBrl(estimate)} (tabela de referência da Meta; o valor real depende do tipo de mensagem e da janela de 24 horas).`,
    )
    if (cap?.monthlyCapAmount != null) {
      const left = Math.max(cap.monthlyCapAmount - cap.spent, 0)
      parts.push(
        `Limite de gasto do número: restam ${formatBrl(left)} de ${formatBrl(cap.monthlyCapAmount)} neste mês.${cap.capMode === 'BLOCK' ? ' Se o limite acabar, os envios restantes são bloqueados.' : ''}`,
      )
    }
  }
  parts.push('Depois de iniciar, você ainda pode cancelar o que não foi enviado.')

  return (
    <ConfirmAction
      trigger={
        <Button size='xs' disabled={startBroadcast.isPending}>
          Iniciar
        </Button>
      }
      title={`Iniciar o envio de "${broadcast.name}"?`}
      description={parts.join(' ')}
      confirmLabel='Iniciar envio'
      destructive={false}
      pending={startBroadcast.isPending}
      onConfirm={() =>
        startBroadcast.mutateAsync(broadcast.id).then(
          () => notify.success('Envio iniciado'),
          (error) => notify.error(error, 'Não foi possível iniciar'),
        )
      }
    />
  )
}

function BroadcastFailuresDialog({
  workspaceId,
  broadcastId,
  onClose,
}: {
  workspaceId: string
  broadcastId: string
  onClose: () => void
}) {
  const detail = useWhatsAppBroadcast(workspaceId, broadcastId)
  const failed = (detail.data?.recipients ?? []).filter(
    (recipient) => recipient.status === 'FAILED',
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Envios que falharam</DialogTitle>
        </DialogHeader>
        {detail.isError ? (
          <p className='text-destructive text-sm'>
            Não foi possível carregar os destinatários. Feche e tente de novo.
          </p>
        ) : detail.isLoading ? (
          <p className='text-muted-foreground text-sm'>Carregando...</p>
        ) : failed.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            Nenhum envio falhou nesta lista.
          </p>
        ) : (
          <ul className='max-h-80 space-y-2 overflow-y-auto text-sm'>
            {failed.map((recipient) => (
              <li key={recipient.id} className='rounded-md border p-2'>
                <span className='font-medium'>
                  {recipient.contactName ?? recipient.contactWaId}
                </span>
                {recipient.contactName ? (
                  <span className='ml-2 text-muted-foreground text-xs'>
                    {recipient.contactWaId}
                  </span>
                ) : null}
                <p className='text-destructive text-xs'>
                  {recipient.errorMessage ?? 'A Meta ou a Z-API recusou o envio.'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function WhatsappSettingsBroadcasts({
  workspaceId,
}: {
  workspaceId: string
}) {
  const broadcasts = useWhatsAppBroadcasts(workspaceId)
  const cancelBroadcast = useCancelWhatsAppBroadcast(workspaceId)
  const retryFailed = useRetryFailedWhatsAppBroadcast(workspaceId)
  // Criar, importar e disparar transmissões é restrito a admins.
  const canManage = useCan('broadcasts', 'CREATE')
  const canValidate = useCan('contacts', 'EDIT')
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [metricsId, setMetricsId] = useState<string | null>(null)
  const [failuresId, setFailuresId] = useState<string | null>(null)

  return (
    <div className='space-y-4'>
      <WhatsappSettingsMarketingLite workspaceId={workspaceId} />
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='font-medium text-sm'>Listas de transmissão</h3>
          <p className='text-muted-foreground text-xs'>
            Envie a mesma mensagem para vários contatos, com espaçamento
            automático entre os envios
          </p>
        </div>
        <div className='flex items-center gap-2'>
          {canManage ? (
            <>
              <ImportBroadcastDialog workspaceId={workspaceId} />
              <CreateBroadcastDialog workspaceId={workspaceId} />
            </>
          ) : null}
        </div>
      </div>

      <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
        <Table containerClassName='overflow-x-visible'>
          <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progresso</TableHead>
              <TableHead className='w-72' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(broadcasts.data ?? []).map((broadcast) => (
              <TableRow key={broadcast.id}>
                <TableCell>
                  {broadcast.name}
                  {broadcast.mediaType ? (
                    <Badge variant='secondary' className='ml-2'>
                      {BROADCAST_MEDIA_KIND_LABEL[broadcast.mediaType]}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant='outline'>
                    {STATUS_LABEL[broadcast.status] ?? broadcast.status}
                  </Badge>
                </TableCell>
                <TableCell className='text-muted-foreground text-xs'>
                  {broadcast.sentCount}/{broadcast.recipientCount} enviados
                  {broadcast.failedCount > 0
                    ? ` · ${broadcast.failedCount} falhas`
                    : ''}
                  {broadcast.skippedCount > 0
                    ? ` · ${broadcast.skippedCount} ignorados`
                    : ''}
                  {broadcast.noWhatsappCount > 0
                    ? ` · ${broadcast.noWhatsappCount} sem WhatsApp`
                    : ''}
                  {broadcast.skipNoWhatsapp ? (
                    <span className='block'>Pula números sem WhatsApp</span>
                  ) : null}
                  {broadcast.failedCount > 0 && broadcast.failureReason ? (
                    <span className='block text-destructive'>
                      Motivo: {broadcast.failureReason}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className='space-x-1.5'>
                  {canValidate &&
                  (broadcast.status === 'DRAFT' ||
                    broadcast.status === 'QUEUED') ? (
                    <Button
                      size='xs'
                      variant='outline'
                      onClick={() => setValidatingId(broadcast.id)}
                    >
                      Validar base
                    </Button>
                  ) : null}
                  {broadcast.status !== 'DRAFT' ? (
                    <Button
                      size='xs'
                      variant='outline'
                      onClick={() => setMetricsId(broadcast.id)}
                    >
                      Métricas
                    </Button>
                  ) : null}
                  {broadcast.failedCount > 0 ? (
                    <Button
                      size='xs'
                      variant='outline'
                      onClick={() => setFailuresId(broadcast.id)}
                    >
                      Ver falhas
                    </Button>
                  ) : null}
                  {canManage &&
                  broadcast.failedCount > 0 &&
                  (broadcast.status === 'DONE' ||
                    broadcast.status === 'FAILED') ? (
                    <ConfirmAction
                      trigger={
                        <Button
                          size='xs'
                          variant='outline'
                          disabled={retryFailed.isPending}
                        >
                          Reenviar falhos
                        </Button>
                      }
                      title='Reenviar para quem falhou?'
                      description={`${broadcast.failedCount} contato(s) vão receber a mensagem de novo. Confira o motivo em "Ver falhas" antes: se o problema continuar (ex.: janela de 24 horas ou limite de gasto), eles vão falhar outra vez.`}
                      confirmLabel='Reenviar'
                      destructive={false}
                      pending={retryFailed.isPending}
                      onConfirm={() =>
                        retryFailed.mutateAsync(broadcast.id).then(
                          () => notify.success('Reenvio iniciado'),
                          (error) =>
                            notify.error(error, 'Não foi possível reenviar'),
                        )
                      }
                    />
                  ) : null}
                  {canManage &&
                  (broadcast.status === 'QUEUED' ||
                    broadcast.status === 'RUNNING') ? (
                    <ConfirmAction
                      trigger={
                        <Button
                          size='xs'
                          variant='outline'
                          disabled={cancelBroadcast.isPending}
                        >
                          Cancelar envio
                        </Button>
                      }
                      title={`Cancelar o envio de "${broadcast.name}"?`}
                      description='O que ainda não foi enviado será descartado. As mensagens que já saíram não podem ser desfeitas.'
                      confirmLabel='Cancelar envio'
                      pending={cancelBroadcast.isPending}
                      onConfirm={() =>
                        cancelBroadcast.mutateAsync(broadcast.id).then(
                          () => notify.success('Envio cancelado'),
                          (error) =>
                            notify.error(error, 'Não foi possível cancelar'),
                        )
                      }
                    />
                  ) : null}
                  {canManage && broadcast.status === 'DRAFT' && (
                    <StartBroadcastButton
                      workspaceId={workspaceId}
                      broadcast={broadcast}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
            {broadcasts.data?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-muted-foreground text-sm'
                >
                  Nenhuma lista de transmissão criada ainda.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {failuresId ? (
        <BroadcastFailuresDialog
          workspaceId={workspaceId}
          broadcastId={failuresId}
          onClose={() => setFailuresId(null)}
        />
      ) : null}

      {metricsId ? (
        <WhatsappBroadcastMarketingMetrics
          workspaceId={workspaceId}
          broadcastId={metricsId}
          onClose={() => setMetricsId(null)}
        />
      ) : null}

      {validatingId ? (
        <WhatsappNumberValidationDialog
          workspaceId={workspaceId}
          open
          onOpenChange={(open) => {
            if (!open) setValidatingId(null)
          }}
          source={{ scope: 'BROADCAST', broadcastId: validatingId }}
          title='Validar base da lista'
          subject='esta lista'
        />
      ) : null}
    </div>
  )
}
