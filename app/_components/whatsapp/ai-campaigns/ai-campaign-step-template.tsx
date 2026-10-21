'use client'

import { Upload04Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
import { notify } from '@/lib/notify'
import {
  useUpdateWhatsAppAiCampaign,
  useWhatsAppAiCampaignRecipients,
} from '@/src/hooks/use-whatsapp-ai-campaigns'
import { useUploadWhatsAppMedia } from '@/src/hooks/use-whatsapp-media-upload'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import {
  type AiCampaignVariableSlot,
  missingVariableSlots,
  previewTemplateValues,
  templateFields,
  templateVariableSlots,
} from '@/src/lib/whatsapp/ai-campaign'
import type {
  AiCampaignVariableSource,
  AiCampaignVariables,
} from '@/src/schemas/whatsapp-ai-campaign.schema'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'
import { TemplatePreview } from '../template-preview'

const SOURCE_ITEMS = [
  { value: 'CONTACT', label: 'Campo do contato' },
  { value: 'FIXED', label: 'Texto fixo' },
  { value: 'COLUMN', label: 'Coluna da planilha' },
]

const CONTACT_FIELD_ITEMS = [
  { value: 'FIRST_NAME', label: 'Primeiro nome' },
  { value: 'NAME', label: 'Nome completo' },
  { value: 'PHONE', label: 'Telefone' },
  { value: 'DESCRIPTION', label: 'Descrição' },
]

const TEMPLATE_STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Aprovado',
  PENDING: 'Em análise',
  REJECTED: 'Rejeitado',
  PAUSED: 'Pausado',
  DISABLED: 'Desativado',
}

function SimpleSelect({
  id,
  value,
  items,
  placeholder,
  onChange,
  className = 'w-full',
  ariaLabel,
}: {
  id?: string
  value: string | null
  items: { value: string; label: string }[]
  placeholder?: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as string)
      }}
    >
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function VariableRow({
  slot,
  source,
  columns,
  onChange,
}: {
  slot: AiCampaignVariableSlot
  source: AiCampaignVariableSource | undefined
  columns: string[]
  onChange: (source: AiCampaignVariableSource) => void
}) {
  const id = `var-${slot.group}-${slot.key}`
  const kind = source?.source ?? null

  function changeKind(next: string) {
    if (next === 'FIXED') onChange({ source: 'FIXED', value: '' })
    if (next === 'CONTACT') onChange({ source: 'CONTACT', field: 'FIRST_NAME' })
    if (next === 'COLUMN')
      onChange({ source: 'COLUMN', column: columns[0] ?? '' })
  }

  return (
    <div className='grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_11rem_1fr] sm:items-end'>
      <div>
        <p className='font-medium text-sm'>{slot.label}</p>
        {!source ? (
          <p className='text-destructive text-xs'>Escolha de onde vem</p>
        ) : null}
      </div>
      <SimpleSelect
        id={id}
        ariaLabel={`Origem de ${slot.label}`}
        value={kind}
        items={SOURCE_ITEMS}
        placeholder='De onde vem?'
        onChange={changeKind}
      />
      {source?.source === 'FIXED' ? (
        <Input
          aria-label={`Texto de ${slot.label}`}
          placeholder='Ex.: amanhã às 10h'
          value={source.value}
          onChange={(event) =>
            onChange({ ...source, value: event.target.value })
          }
        />
      ) : source?.source === 'CONTACT' ? (
        <div className='grid grid-cols-2 gap-2'>
          <SimpleSelect
            ariaLabel={`Campo de ${slot.label}`}
            value={source.field}
            items={CONTACT_FIELD_ITEMS}
            onChange={(field) =>
              onChange({ ...source, field: field as typeof source.field })
            }
          />
          <Input
            aria-label={`Se vazio, usar (${slot.label})`}
            placeholder='Se vazio: cliente'
            value={source.fallback ?? ''}
            onChange={(event) =>
              onChange({ ...source, fallback: event.target.value || undefined })
            }
          />
        </div>
      ) : source?.source === 'COLUMN' ? (
        <div className='grid grid-cols-2 gap-2'>
          {columns.length > 0 ? (
            <SimpleSelect
              ariaLabel={`Coluna de ${slot.label}`}
              value={source.column || null}
              items={columns.map((column) => ({
                value: column,
                label: column,
              }))}
              placeholder='Coluna'
              onChange={(column) => onChange({ ...source, column })}
            />
          ) : (
            <Input
              aria-label={`Coluna de ${slot.label}`}
              placeholder='Nome da coluna'
              value={source.column}
              onChange={(event) =>
                onChange({ ...source, column: event.target.value })
              }
            />
          )}
          <Input
            aria-label={`Se vazio, usar (${slot.label})`}
            placeholder='Se vazio (opcional)'
            value={source.fallback ?? ''}
            onChange={(event) =>
              onChange({ ...source, fallback: event.target.value || undefined })
            }
          />
        </div>
      ) : (
        <span />
      )}
    </div>
  )
}

/** Passo "Mensagem": template, variáveis e prévia com um contato real. */
export function AiCampaignStepTemplate({
  workspaceId,
  campaign,
  onDone,
}: {
  workspaceId: string
  campaign: WhatsAppAiCampaignDTO
  onDone: () => void
}) {
  const templates = useWhatsAppTemplates(workspaceId)
  const update = useUpdateWhatsAppAiCampaign(workspaceId, campaign.id)
  const upload = useUploadWhatsAppMedia(workspaceId)
  const recipients = useWhatsAppAiCampaignRecipients(
    workspaceId,
    campaign.id,
    {},
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const locked = campaign.status === 'RUNNING'

  const [templateId, setTemplateId] = useState(campaign.templateId)
  const [variables, setVariables] = useState<AiCampaignVariables>(
    campaign.variables,
  )
  const [headerMediaUrl, setHeaderMediaUrl] = useState(
    campaign.headerMediaUrl ?? '',
  )

  useEffect(() => {
    setTemplateId(campaign.templateId)
    setVariables(campaign.variables)
    setHeaderMediaUrl(campaign.headerMediaUrl ?? '')
  }, [campaign.templateId, campaign.variables, campaign.headerMediaUrl])

  const options = (templates.data ?? []).filter(
    (template) => template.connectionId === campaign.connectionId,
  )
  const template = options.find((option) => option.id === templateId) ?? null
  const fields = useMemo(
    () => (template ? templateFields(template.components) : null),
    [template],
  )
  const slots = fields ? templateVariableSlots(fields) : []
  const missing = fields ? missingVariableSlots(fields, variables) : []

  const sampleRecipient = recipients.data?.pages[0]?.items[0] ?? null
  const columns = useMemo(() => {
    const set = new Set<string>()
    for (const page of recipients.data?.pages ?? []) {
      for (const item of page.items) {
        for (const key of Object.keys(item.values)) set.add(key)
      }
    }
    return [...set]
  }, [recipients.data])

  const preview = useMemo(
    () =>
      fields
        ? previewTemplateValues(fields, variables, {
            contactName: sampleRecipient?.contactName ?? 'Maria Souza',
            waId: sampleRecipient?.waId ?? '5511999990000',
            description: null,
            values: sampleRecipient?.values ?? {},
          })
        : null,
    [fields, variables, sampleRecipient],
  )

  const isMediaHeader =
    template?.headerFormat === 'IMAGE' ||
    template?.headerFormat === 'VIDEO' ||
    template?.headerFormat === 'DOCUMENT'

  function setSource(
    slot: AiCampaignVariableSlot,
    source: AiCampaignVariableSource,
  ) {
    setVariables((current) => ({
      ...current,
      [slot.group]: { ...current[slot.group], [slot.key]: source },
    }))
  }

  function handleSave() {
    update.mutate(
      {
        templateId: templateId ?? null,
        variables,
        headerMediaUrl: headerMediaUrl.trim() || null,
      },
      {
        onSuccess: () => {
          notify.success('Mensagem salva')
          onDone()
        },
        onError: (error) => notify.error(error, 'Não foi possível salvar'),
      },
    )
  }

  if (!campaign.connectionId) {
    return (
      <p className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Escolha a conexão no primeiro passo para ver os templates.
      </p>
    )
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[1fr_22rem]'>
      <div className='space-y-5'>
        {locked ? (
          <p className='rounded-md bg-muted px-3 py-2 text-muted-foreground text-sm'>
            Pause a campanha para trocar o template ou as variáveis.
          </p>
        ) : null}

        <div className='space-y-1.5'>
          <Label htmlFor='campaignTemplate'>Template</Label>
          <SimpleSelect
            id='campaignTemplate'
            value={templateId}
            placeholder='Escolha o template'
            items={options.map((option) => ({
              value: option.id,
              label: `${option.name} · ${option.language} · ${
                TEMPLATE_STATUS_LABEL[option.status] ?? option.status
              }`,
            }))}
            onChange={(next) => {
              if (locked) return
              setTemplateId(next)
              setVariables({ header: {}, body: {}, buttons: {} })
            }}
          />
          {template && template.status !== 'APPROVED' ? (
            <p className='text-destructive text-xs'>
              Este template ainda não está aprovado pela Meta — dá para preparar
              a campanha, mas ela só envia depois da aprovação.
            </p>
          ) : null}
          {options.length === 0 && !templates.isLoading ? (
            <p className='text-muted-foreground text-xs'>
              Nenhum template nesta conexão. Crie ou sincronize em WhatsApp ›
              Templates.
            </p>
          ) : null}
        </div>

        {template ? (
          slots.length === 0 ? (
            <p className='rounded-md bg-muted px-3 py-2 text-sm'>
              Este template não tem variáveis — a mesma mensagem vai para todos.
            </p>
          ) : (
            <section className='space-y-2'>
              <div className='flex items-center justify-between'>
                <h3 className='font-medium text-sm'>Variáveis do template</h3>
                <Badge variant={missing.length ? 'destructive' : 'secondary'}>
                  {slots.length - missing.length}/{slots.length} preenchidas
                </Badge>
              </div>
              <p className='text-muted-foreground text-xs'>
                Para cada variável, diga de onde vem o valor. Contatos sem valor
                (e sem o "se vazio") são pulados, para ninguém receber mensagem
                quebrada.
              </p>
              {slots.map((slot) => (
                <VariableRow
                  key={`${slot.group}-${slot.key}`}
                  slot={slot}
                  source={variables[slot.group]?.[slot.key]}
                  columns={columns}
                  onChange={(source) => setSource(slot, source)}
                />
              ))}
            </section>
          )
        ) : null}

        {isMediaHeader ? (
          <section className='space-y-1.5'>
            <Label htmlFor='campaignHeaderMedia'>
              Mídia do cabeçalho (opcional — vazio usa a do template)
            </Label>
            <div className='flex gap-2'>
              <Input
                id='campaignHeaderMedia'
                placeholder='https://...'
                value={headerMediaUrl}
                onChange={(event) => setHeaderMediaUrl(event.target.value)}
              />
              <input
                ref={fileRef}
                type='file'
                className='hidden'
                aria-label='Arquivo da mídia do cabeçalho'
                accept='image/*,video/*,application/pdf'
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  upload.mutate(file, {
                    onSuccess: (result) => setHeaderMediaUrl(result.url),
                    onError: (error) =>
                      notify.error(error, 'Não foi possível enviar o arquivo'),
                  })
                }}
              />
              <Button
                type='button'
                variant='outline'
                disabled={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <SteelIcon icon={Upload04Icon} size={14} />
                {upload.isPending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </section>
        ) : null}

        <div className='flex justify-end'>
          <Button
            disabled={locked || !templateId || update.isPending}
            onClick={handleSave}
          >
            {update.isPending ? 'Salvando...' : 'Salvar e continuar'}
          </Button>
        </div>
      </div>

      <aside className='space-y-2'>
        <p className='font-medium text-sm'>Prévia</p>
        <p className='text-muted-foreground text-xs'>
          {sampleRecipient
            ? `Como ${sampleRecipient.contactName ?? sampleRecipient.waId} vai receber.`
            : 'Com um contato de exemplo — adicione contatos para ver um real.'}
        </p>
        {fields && preview ? (
          <TemplatePreview
            fields={fields}
            values={preview}
            headerMediaUrl={headerMediaUrl.trim() || template?.headerMediaUrl}
          />
        ) : (
          <div className='rounded-lg border border-dashed p-6 text-center text-muted-foreground text-xs'>
            Escolha um template para ver a prévia.
          </div>
        )}
      </aside>
    </div>
  )
}
