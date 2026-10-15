'use client'

import { WhatsappIcon } from '@hugeicons-pro/core-stroke-rounded'
import {
  TemplateQualityBadge,
  TemplateStatusBadge,
} from '@/app/_components/whatsapp/template-quality-badge'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TEMPLATE_QUALITY } from '@/src/lib/whatsapp/button-editor'
import type {
  CrmCampaignOptionsDTO,
  CrmCampaignQuickReplyOptionDTO,
  CrmCampaignVariableSourceDTO,
  CrmCampaignVariableSourceKind,
  CrmCampaignWhatsAppTemplateOptionDTO,
  CrmCampaignWhatsAppVariablesDTO,
} from '@/types/crm-campaign'
import type { CampaignDraft, DraftChange } from './campaign-draft'
import { VARIABLE_SOURCE_LABEL } from './campaign-labels'
import {
  fillTemplateText,
  fillZapiText,
  SAMPLE_NAME,
  WhatsAppBubble,
} from './campaign-previews'

const EMPTY_VARIABLES: CrmCampaignWhatsAppVariablesDTO = {
  header: {},
  body: {},
  buttons: {},
}

type VariableGroup = keyof CrmCampaignWhatsAppVariablesDTO

function variableSlots(template: CrmCampaignWhatsAppTemplateOptionDTO) {
  const slots: { group: VariableGroup; key: string; label: string }[] = []
  for (let i = 1; i <= template.fields.headerVariables; i += 1) {
    slots.push({ group: 'header', key: String(i), label: `Cabeçalho {{${i}}}` })
  }
  for (let i = 1; i <= template.fields.bodyVariables; i += 1) {
    slots.push({ group: 'body', key: String(i), label: `Mensagem {{${i}}}` })
  }
  for (const index of template.fields.urlButtons) {
    const button = template.buttons[index]
    slots.push({
      group: 'buttons',
      key: String(index),
      label: `Botão “${button?.label ?? index + 1}” (fim da URL)`,
    })
  }
  return slots
}

/**
 * Starting mapping of a template: every dynamic URL button takes the
 * campaign link code — the button's base URL points to the click redirect
 * (`…/api/crm/campaigns/c/{{1}}`), so each contact opens their tracked link.
 */
export function defaultTemplateVariables(
  template: CrmCampaignWhatsAppTemplateOptionDTO,
): CrmCampaignWhatsAppVariablesDTO {
  const buttons: Record<string, CrmCampaignVariableSourceDTO> = {}
  for (const index of template.fields.urlButtons) {
    buttons[String(index)] = { source: 'link_code' }
  }
  return { header: {}, body: {}, buttons }
}

const SOURCE_ITEMS = (
  Object.keys(VARIABLE_SOURCE_LABEL) as CrmCampaignVariableSourceKind[]
).map((value) => ({ value, label: VARIABLE_SOURCE_LABEL[value] }))

const HEADER_LABEL: Record<string, string> = {
  IMAGE: 'Imagem',
  VIDEO: 'Vídeo',
  DOCUMENT: 'Documento',
}

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: CrmCampaignWhatsAppTemplateOptionDTO
  selected: boolean
  onSelect: () => void
}) {
  const blocked = template.blockedReason !== null
  const quality = TEMPLATE_QUALITY[template.quality] ?? TEMPLATE_QUALITY.UNKNOWN
  return (
    <li
      data-testid={`campaign-wa-template-${template.id}`}
      className={cn(
        'flex min-w-0 flex-col gap-2 rounded-xl border p-3',
        selected && 'border-primary ring-1 ring-primary',
        blocked && 'bg-muted/30',
      )}
    >
      <button
        type='button'
        disabled={blocked}
        aria-pressed={selected}
        onClick={onSelect}
        className='flex min-w-0 flex-col gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed'
      >
        <span className='flex min-w-0 flex-wrap items-center gap-2'>
          <TemplateQualityBadge quality={template.quality} />
          <span className='min-w-0 truncate font-medium text-sm'>
            {template.name}
          </span>
          <span className='text-muted-foreground text-xs'>
            {template.language}
          </span>
        </span>
        <span className='flex flex-wrap items-center gap-1.5 text-xs'>
          <span className='text-muted-foreground'>{quality.label}</span>
          {template.status !== 'APPROVED' ? (
            <TemplateStatusBadge status={template.status} />
          ) : null}
          {template.headerFormat && HEADER_LABEL[template.headerFormat] ? (
            <Badge variant='outline'>
              {HEADER_LABEL[template.headerFormat]} no cabeçalho
            </Badge>
          ) : null}
          {template.buttons.length > 0 ? (
            <Badge variant='outline'>
              {template.buttons.length === 1
                ? '1 botão'
                : `${template.buttons.length} botões`}
            </Badge>
          ) : null}
        </span>
      </button>
      {blocked ? (
        <p role='note' className='text-destructive text-xs'>
          {template.blockedReason}
        </p>
      ) : null}
    </li>
  )
}

function ButtonsSummary({
  template,
}: {
  template: CrmCampaignWhatsAppTemplateOptionDTO
}) {
  if (template.buttons.length === 0) return null
  return (
    <ul className='flex flex-col gap-1 text-muted-foreground text-xs'>
      {template.buttons.map((button, index) => (
        <li key={`${button.type}-${button.label}`}>
          <span className='font-medium text-foreground'>{button.label}</span>
          {' — '}
          {button.type === 'REPLY'
            ? button.actionCount > 0
              ? `resposta rápida com ${button.actionCount} ação(ões) configurada(s) na Comunicação`
              : 'resposta rápida (sem ações configuradas)'
            : template.fields.urlButtons.includes(index)
              ? 'link: leva ao destino da campanha'
              : `link fixo: ${button.url ?? ''}`}
        </li>
      ))}
    </ul>
  )
}

function MetaContent({
  draft,
  onChange,
  connection,
  baseUrl,
  sampleLink,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  connection: CrmCampaignOptionsDTO['whatsapp']['connections'][number]
  baseUrl: string
  sampleLink: string
}) {
  const template = connection.templates.find(
    (t) => t.id === draft.whatsappTemplateId,
  )
  const variables = draft.whatsappVariables ?? EMPTY_VARIABLES
  const sample = { name: SAMPLE_NAME, link: sampleLink }

  function setVariable(
    group: VariableGroup,
    key: string,
    value: CrmCampaignVariableSourceDTO,
  ) {
    onChange({
      whatsappVariables: {
        ...variables,
        [group]: { ...variables[group], [key]: value },
      },
    })
  }

  return (
    <div className='flex flex-col gap-4'>
      <p className='text-muted-foreground text-xs'>
        Pela API oficial, a primeira mensagem para o contato precisa ser um
        template aprovado pela Meta. Templates pausados, desativados ou com
        qualidade baixa ficam bloqueados.
      </p>
      {connection.templates.length === 0 ? (
        <p className='rounded-xl border border-dashed p-4 text-center text-muted-foreground text-sm'>
          Nenhum template aprovado nesta conexão. Crie ou sincronize em
          Comunicação › Templates.
        </p>
      ) : (
        <ul
          aria-label='Templates da Meta'
          className='grid gap-2 sm:grid-cols-2'
        >
          {connection.templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={t.id === draft.whatsappTemplateId}
              onSelect={() =>
                onChange({
                  whatsappTemplateId: t.id,
                  whatsappVariables: defaultTemplateVariables(t),
                })
              }
            />
          ))}
        </ul>
      )}
      {template ? (
        <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]'>
          <div className='flex min-w-0 flex-col gap-3'>
            {variableSlots(template).map((slot) => {
              const current = variables[slot.group][slot.key]
              return (
                <div
                  key={`${slot.group}-${slot.key}`}
                  className='grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center'
                >
                  <span className='text-sm'>{slot.label}</span>
                  <div className='flex min-w-0 flex-col gap-2 sm:flex-row'>
                    <Select
                      items={SOURCE_ITEMS}
                      value={current?.source ?? null}
                      onValueChange={(value) =>
                        setVariable(slot.group, slot.key, {
                          source: value as CrmCampaignVariableSourceKind,
                        })
                      }
                    >
                      <SelectTrigger
                        aria-label={`Valor de ${slot.label}`}
                        className='w-full sm:w-56'
                      >
                        <SelectValue placeholder='Preencher com…' />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {current?.source === 'static' ? (
                      <Input
                        aria-label={`Texto de ${slot.label}`}
                        value={current.value ?? ''}
                        onChange={(e) =>
                          setVariable(slot.group, slot.key, {
                            source: 'static',
                            value: e.target.value,
                          })
                        }
                      />
                    ) : null}
                  </div>
                </div>
              )
            })}
            {template.fields.urlButtons.length > 0 ? (
              <p className='text-muted-foreground text-xs'>
                Para o botão de link levar ao destino, a URL base dele na Meta
                deve ser <code>{`${baseUrl}/api/crm/campaigns/c/{{1}}`}</code> —
                use “Código do link”.
              </p>
            ) : null}
            <ButtonsSummary template={template} />
          </div>
          <WhatsAppBubble
            mediaUrl={template.headerMediaUrl}
            body={fillTemplateText(
              template.fields.bodyText,
              variables.body,
              sample,
            )}
            buttons={template.buttons}
          />
        </div>
      ) : null}
    </div>
  )
}

function ZapiContent({
  draft,
  onChange,
  quickReplies,
  sampleLink,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  quickReplies: CrmCampaignQuickReplyOptionDTO[]
  sampleLink: string
}) {
  const reply = quickReplies.find((r) => r.id === draft.whatsappQuickReplyId)
  const mode = draft.whatsappQuickReplyId ? 'quick' : 'text'
  const items = quickReplies.map((r) => ({
    value: r.id,
    label: `/${r.shortcut} · ${r.title}`,
  }))

  function chooseReply(id: string) {
    const chosen = quickReplies.find((r) => r.id === id)
    if (!chosen) return
    const hasLink =
      chosen.body.includes('{link}') ||
      chosen.buttons.some((b) => b.url?.includes('{link}'))
    onChange({
      whatsappQuickReplyId: id,
      // The quick reply's text, with the campaign link when it has none.
      whatsappText: hasLink ? chosen.body : `${chosen.body}\n\n{link}`,
    })
  }

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]'>
      <div className='flex min-w-0 flex-col gap-4'>
        <fieldset className='flex flex-wrap gap-1 self-start rounded-lg border p-1'>
          <legend className='sr-only'>Conteúdo da mensagem</legend>
          {(
            [
              { id: 'text', label: 'Texto livre' },
              { id: 'quick', label: 'Resposta rápida com botões' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type='button'
              aria-pressed={mode === item.id}
              disabled={item.id === 'quick' && quickReplies.length === 0}
              onClick={() =>
                item.id === 'text'
                  ? onChange({ whatsappQuickReplyId: null })
                  : quickReplies[0] && chooseReply(quickReplies[0].id)
              }
              className={cn(
                'rounded-md px-2.5 py-1 text-sm transition-colors disabled:opacity-50',
                mode === item.id
                  ? 'bg-muted font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        {mode === 'quick' ? (
          <div className='flex flex-col gap-2'>
            <Label htmlFor='wa-quick-reply'>Resposta rápida</Label>
            <Select
              items={items}
              value={draft.whatsappQuickReplyId}
              onValueChange={(value) => chooseReply(value as string)}
            >
              <SelectTrigger id='wa-quick-reply' className='w-full'>
                <SelectValue placeholder='Escolha a resposta rápida' />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              Os botões de resposta mantêm as ações configuradas na Comunicação;
              em botões de link, {'{link}'} vira o link da campanha.
            </p>
          </div>
        ) : null}
        <div className='flex flex-col gap-2'>
          <Label htmlFor='wa-text'>Mensagem</Label>
          <Textarea
            id='wa-text'
            rows={5}
            value={draft.whatsappText ?? ''}
            onChange={(e) => onChange({ whatsappText: e.target.value })}
            placeholder={
              'Oi {primeiro_nome}! Preparamos algo para você: {link}'
            }
          />
          <p className='text-muted-foreground text-xs'>
            Use {'{nome}'}, {'{primeiro_nome}'} e {'{link}'} (o link rastreado
            da campanha — obrigatório, no texto ou num botão).
          </p>
        </div>
        <div className='flex flex-col gap-2'>
          <Label htmlFor='wa-media'>Imagem, vídeo ou PDF (opcional)</Label>
          <Input
            id='wa-media'
            type='url'
            value={draft.whatsappMediaUrl ?? ''}
            onChange={(e) => onChange({ whatsappMediaUrl: e.target.value })}
            placeholder={reply?.mediaUrl ?? 'https://…'}
          />
        </div>
      </div>
      <WhatsAppBubble
        mediaUrl={draft.whatsappMediaUrl || reply?.mediaUrl}
        body={fillZapiText(draft.whatsappText ?? '', {
          name: SAMPLE_NAME,
          link: sampleLink,
        })}
        buttons={reply?.buttons ?? []}
      />
    </div>
  )
}

/**
 * WhatsApp add-on of a campaign (off by default). Meta Cloud API → an
 * approved template (quality shown; red/paused/disabled blocked) with its
 * variables mapped, media header and buttons; Z-API → free text with
 * {nome}/{link}, or a quick reply with its buttons, and optional media.
 */
export function CampaignWhatsAppPanel({
  draft,
  onChange,
  options,
  sampleLink,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  /** Link shown in the previews (the campaign's WhatsApp link). */
  sampleLink?: string | null
}) {
  const { whatsapp } = options
  const connection = whatsapp.connections.find(
    (c) => c.id === draft.whatsappConnectionId,
  )
  const link = sampleLink || `${options.baseUrl}/…`

  return (
    <section className='flex flex-col gap-4 rounded-xl border p-4'>
      <Label className='flex items-center justify-between gap-4 font-normal'>
        <span className='flex min-w-0 items-start gap-2'>
          <SteelIcon icon={WhatsappIcon} size={18} className='mt-0.5' />
          <span className='min-w-0'>
            <span className='block font-medium'>
              Também enviar pelo WhatsApp
            </span>
            <span className='text-muted-foreground text-xs'>
              {whatsapp.available
                ? 'Mesmo público, só quem tem WhatsApp e não pediu para sair.'
                : whatsapp.reason}
            </span>
          </span>
        </span>
        <Switch
          aria-label='Também enviar pelo WhatsApp'
          checked={draft.whatsappEnabled}
          disabled={!whatsapp.available && !draft.whatsappEnabled}
          onCheckedChange={(checked) => onChange({ whatsappEnabled: checked })}
        />
      </Label>

      {draft.whatsappEnabled ? (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='wa-connection'>Conexão</Label>
            <Select
              items={whatsapp.connections.map((c) => ({
                value: c.id,
                label: `${c.label} · ${c.provider === 'META' ? 'Meta (API oficial)' : 'Z-API'}`,
              }))}
              value={draft.whatsappConnectionId}
              onValueChange={(value) =>
                onChange({
                  whatsappConnectionId: value as string,
                  whatsappTemplateId: null,
                  whatsappVariables: null,
                  whatsappQuickReplyId: null,
                })
              }
            >
              <SelectTrigger id='wa-connection' className='w-full'>
                <SelectValue placeholder='Escolha a conexão' />
              </SelectTrigger>
              <SelectContent>
                {whatsapp.connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} ·{' '}
                    {c.provider === 'META' ? 'Meta (API oficial)' : 'Z-API'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {connection?.provider === 'META' ? (
            <MetaContent
              draft={draft}
              onChange={onChange}
              connection={connection}
              baseUrl={options.baseUrl}
              sampleLink={link}
            />
          ) : connection?.provider === 'ZAPI' ? (
            <ZapiContent
              draft={draft}
              onChange={onChange}
              quickReplies={whatsapp.quickReplies}
              sampleLink={link}
            />
          ) : null}

          <div className='flex flex-col gap-2'>
            <Label htmlFor='wa-delay'>
              Enviar quantas horas depois do e-mail?
            </Label>
            <Input
              id='wa-delay'
              type='number'
              min={0}
              max={720}
              className='w-32'
              value={draft.whatsappDelayHours}
              onChange={(e) =>
                onChange({
                  whatsappDelayHours: Math.max(
                    0,
                    Math.min(720, Number(e.target.value) || 0),
                  ),
                })
              }
            />
            <p className='text-muted-foreground text-xs'>
              0 = junto com o e-mail. Respostas viram conversas na Comunicação,
              ligadas ao contato.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** The draft's WhatsApp message as the contact sees it (review step). */
export function CampaignWhatsAppPreview({
  draft,
  options,
  sampleLink,
}: {
  draft: CampaignDraft
  options: CrmCampaignOptionsDTO
  sampleLink?: string | null
}) {
  const connection = options.whatsapp.connections.find(
    (c) => c.id === draft.whatsappConnectionId,
  )
  const sample = {
    name: SAMPLE_NAME,
    link: sampleLink || `${options.baseUrl}/…`,
  }
  if (connection?.provider === 'META') {
    const template = connection.templates.find(
      (t) => t.id === draft.whatsappTemplateId,
    )
    if (!template) return null
    return (
      <WhatsAppBubble
        mediaUrl={template.headerMediaUrl}
        body={fillTemplateText(
          template.fields.bodyText,
          draft.whatsappVariables?.body,
          sample,
        )}
        buttons={template.buttons}
      />
    )
  }
  if (connection?.provider === 'ZAPI' && draft.whatsappText) {
    const reply = options.whatsapp.quickReplies.find(
      (r) => r.id === draft.whatsappQuickReplyId,
    )
    return (
      <WhatsAppBubble
        mediaUrl={draft.whatsappMediaUrl || reply?.mediaUrl}
        body={fillZapiText(draft.whatsappText, sample)}
        buttons={reply?.buttons ?? []}
      />
    )
  }
  return null
}
