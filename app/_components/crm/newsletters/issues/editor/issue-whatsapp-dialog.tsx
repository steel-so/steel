'use client'

import { WhatsappIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useId, useState } from 'react'
import { LEGAL_BASIS_LABEL } from '@/app/_components/crm/campaigns/campaign-labels'
import { OptionSelect } from '@/app/_components/crm/email-editor/option-select'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useCrmCampaignOptions } from '@/src/hooks/use-crm-campaigns'
import {
  useCrmNewsletterIssueWhatsApp,
  useSaveCrmNewsletterIssueWhatsApp,
} from '@/src/hooks/use-crm-newsletter-engage'
import { CRM_CAMPAIGN_LEGAL_BASES } from '@/src/schemas/crm-campaign.schema'
import {
  CRM_NEWSLETTER_WA_TEXT_MAX,
  type CrmNewsletterIssueWhatsAppDTO,
  type CrmNewsletterWhatsAppVariableSourceKind,
  type CrmNewsletterWhatsAppVariables,
  DEFAULT_NEWSLETTER_WA_TEXT,
  type UpdateCrmNewsletterIssueWhatsAppDTO,
} from '@/src/schemas/crm-newsletter-engage.schema'
import type { CrmCampaignWhatsAppTemplateOptionDTO } from '@/types/crm-campaign'
import { useIssueEditor } from './issue-editor-context'

export const WA_SOURCE_LABEL: Record<
  CrmNewsletterWhatsAppVariableSourceKind,
  string
> = {
  name: 'Nome do contato',
  first_name: 'Primeiro nome',
  link: 'Link da versão web',
  link_code: 'Fim do link (botão com URL)',
  summary: 'Resumo da edição',
  subject: 'Assunto da edição',
  static: 'Texto fixo',
}

const SOURCE_OPTIONS = (
  Object.keys(WA_SOURCE_LABEL) as CrmNewsletterWhatsAppVariableSourceKind[]
).map((value) => ({ value, label: WA_SOURCE_LABEL[value] }))

const LEGAL_BASIS_OPTIONS = CRM_CAMPAIGN_LEGAL_BASES.map((value) => ({
  value,
  label: LEGAL_BASIS_LABEL[value],
}))

const EMPTY_VARIABLES: CrmNewsletterWhatsAppVariables = {
  header: {},
  body: {},
  buttons: {},
}

type Group = keyof CrmNewsletterWhatsAppVariables

/** Variable slots of a Meta template (header, body, dynamic URL buttons). */
export function templateSlots(template: CrmCampaignWhatsAppTemplateOptionDTO) {
  const slots: { group: Group; key: string; label: string }[] = []
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

/** Starting mapping: body {{1}} = first name, {{2}} = subject, {{3}} =
 * summary, {{4}} = link; URL buttons take the end of the link. */
export function defaultVariables(
  template: CrmCampaignWhatsAppTemplateOptionDTO,
): CrmNewsletterWhatsAppVariables {
  const order: CrmNewsletterWhatsAppVariableSourceKind[] = [
    'first_name',
    'subject',
    'summary',
    'link',
  ]
  const body: CrmNewsletterWhatsAppVariables['body'] = {}
  for (let i = 1; i <= template.fields.bodyVariables; i += 1) {
    body[String(i)] = { source: order[i - 1] ?? 'link' }
  }
  const buttons: CrmNewsletterWhatsAppVariables['buttons'] = {}
  for (const index of template.fields.urlButtons) {
    buttons[String(index)] = { source: 'link_code' }
  }
  return { header: {}, body, buttons }
}

type Draft = {
  enabled: boolean
  connectionId: string | null
  templateId: string | null
  variables: CrmNewsletterWhatsAppVariables
  text: string
  legalBasis: (typeof CRM_CAMPAIGN_LEGAL_BASES)[number] | null
  confirmed: boolean
}

function draftOf(dto: CrmNewsletterIssueWhatsAppDTO): Draft {
  return {
    enabled: dto.enabled,
    connectionId: dto.connectionId,
    templateId: dto.templateId,
    variables: dto.variables ?? EMPTY_VARIABLES,
    text: dto.text ?? DEFAULT_NEWSLETTER_WA_TEXT,
    legalBasis: dto.legalBasis,
    confirmed: Boolean(dto.consentConfirmedAt),
  }
}

function ReachSummary({ dto }: { dto: CrmNewsletterIssueWhatsAppDTO }) {
  if (!dto.reach) return null
  const { reach } = dto
  return (
    <div className='rounded-lg border bg-muted/30 p-3 text-sm'>
      <p>
        <strong className='tabular-nums'>{reach.reachable}</strong>{' '}
        {reach.reachable === 1
          ? 'assinante recebe no WhatsApp'
          : 'assinantes recebem no WhatsApp'}{' '}
        hoje.
      </p>
      <p className='mt-1 text-muted-foreground text-xs'>
        Só entram assinantes ativos ligados a uma pessoa do CRM com telefone de
        WhatsApp. {reach.missingPhone} sem telefone válido · {reach.optedOut}{' '}
        pediram para não receber transmissões.
      </p>
    </div>
  )
}

function WhatsAppBody({
  dto,
  onDone,
}: {
  dto: CrmNewsletterIssueWhatsAppDTO
  onDone: () => void
}) {
  const issue = useIssueEditor()
  const options = useCrmCampaignOptions(issue.workspaceId)
  const save = useSaveCrmNewsletterIssueWhatsApp(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const [draft, setDraft] = useState<Draft>(() => draftOf(dto))
  const ids = { switch: useId(), text: useId(), consent: useId() }
  const change = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }))

  const whatsapp = options.data?.whatsapp
  const connections = whatsapp?.connections ?? []
  const connection = connections.find((item) => item.id === draft.connectionId)
  const template = connection?.templates.find(
    (item) => item.id === draft.templateId,
  )
  const locked = issue.status !== 'DRAFT' && issue.status !== 'SCHEDULED'

  async function handleSave() {
    const input: UpdateCrmNewsletterIssueWhatsAppDTO = {
      enabled: draft.enabled,
      connectionId: draft.connectionId,
      templateId: connection?.provider === 'META' ? draft.templateId : null,
      variables: connection?.provider === 'META' ? draft.variables : null,
      text: connection?.provider === 'ZAPI' ? draft.text : null,
      legalBasis: draft.legalBasis,
      confirmLegalBasis: draft.confirmed,
    }
    try {
      const saved = await save.mutateAsync(input)
      notify.success(
        saved.enabled
          ? 'Envio no WhatsApp salvo'
          : 'Envio no WhatsApp desligado',
      )
      if (saved.problems.length === 0) onDone()
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar também no WhatsApp</DialogTitle>
        <DialogDescription>
          Quando o envio por e-mail terminar, os assinantes com WhatsApp no CRM
          recebem o link da versão web e um resumo da edição. Usa a conexão e os
          limites do módulo Comunicação.
        </DialogDescription>
      </DialogHeader>
      <div className='grid max-h-[65vh] min-w-0 gap-4 overflow-y-auto pr-1'>
        {!dto.available ? (
          <p className='rounded-lg border p-3 text-muted-foreground text-sm'>
            {dto.unavailableReason}
          </p>
        ) : (
          <>
            <div className='flex items-center justify-between gap-3'>
              <Label htmlFor={ids.switch}>Enviar também no WhatsApp</Label>
              <Switch
                id={ids.switch}
                checked={draft.enabled}
                disabled={locked}
                onCheckedChange={(checked) => change({ enabled: checked })}
              />
            </div>
            {draft.enabled ? (
              <>
                <ReachSummary dto={dto} />
                {options.isLoading ? (
                  <Skeleton className='h-9 w-full' />
                ) : connections.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>
                    {whatsapp?.reason ??
                      'Nenhuma conexão de WhatsApp ativa na Comunicação.'}
                  </p>
                ) : (
                  <div className='grid gap-1.5'>
                    <Label>Conexão</Label>
                    <OptionSelect
                      label='Conexão de WhatsApp'
                      value={draft.connectionId}
                      options={connections.map((item) => ({
                        value: item.id,
                        label: `${item.label} · ${item.phoneNumber} (${item.provider === 'META' ? 'Meta' : 'Z-API'})`,
                      }))}
                      onChange={(value) =>
                        change({ connectionId: value, templateId: null })
                      }
                    />
                  </div>
                )}
                {connection?.provider === 'META' ? (
                  <div className='grid gap-3'>
                    <div className='grid gap-1.5'>
                      <Label>Template aprovado</Label>
                      <OptionSelect
                        label='Template da Meta'
                        value={draft.templateId}
                        options={connection.templates
                          .filter((item) => item.blockedReason === null)
                          .map((item) => ({
                            value: item.id,
                            label: `${item.name} (${item.language})`,
                          }))}
                        onChange={(value) => {
                          const picked = connection.templates.find(
                            (item) => item.id === value,
                          )
                          change({
                            templateId: value,
                            variables: picked
                              ? defaultVariables(picked)
                              : EMPTY_VARIABLES,
                          })
                        }}
                      />
                      <p className='text-muted-foreground text-xs'>
                        Fora da janela de 24 h a Meta só aceita templates
                        aprovados.
                      </p>
                    </div>
                    {template ? (
                      <div className='grid gap-2'>
                        {template.fields.bodyText ? (
                          <p className='whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-xs'>
                            {template.fields.bodyText}
                          </p>
                        ) : null}
                        {templateSlots(template).map((slot) => {
                          const value = draft.variables[slot.group][slot.key]
                          return (
                            <div
                              key={`${slot.group}-${slot.key}`}
                              className='grid min-w-0 gap-1.5 sm:grid-cols-2 sm:items-center'
                            >
                              <span className='text-sm'>{slot.label}</span>
                              <div className='grid min-w-0 gap-1.5'>
                                <OptionSelect
                                  label={slot.label}
                                  value={value?.source ?? null}
                                  options={SOURCE_OPTIONS}
                                  onChange={(source) =>
                                    change({
                                      variables: {
                                        ...draft.variables,
                                        [slot.group]: {
                                          ...draft.variables[slot.group],
                                          [slot.key]: {
                                            source:
                                              source as CrmNewsletterWhatsAppVariableSourceKind,
                                          },
                                        },
                                      },
                                    })
                                  }
                                />
                                {value?.source === 'static' ? (
                                  <Input
                                    aria-label={`${slot.label}: texto fixo`}
                                    value={value.value ?? ''}
                                    maxLength={500}
                                    onChange={(event) =>
                                      change({
                                        variables: {
                                          ...draft.variables,
                                          [slot.group]: {
                                            ...draft.variables[slot.group],
                                            [slot.key]: {
                                              source: 'static',
                                              value: event.target.value,
                                            },
                                          },
                                        },
                                      })
                                    }
                                  />
                                ) : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {connection?.provider === 'ZAPI' ? (
                  <div className='grid gap-1.5'>
                    <Label htmlFor={ids.text}>Mensagem</Label>
                    <Textarea
                      id={ids.text}
                      rows={6}
                      value={draft.text}
                      maxLength={CRM_NEWSLETTER_WA_TEXT_MAX}
                      onChange={(event) => change({ text: event.target.value })}
                    />
                    <p className='text-muted-foreground text-xs'>
                      Use {'{primeiro_nome}'}, {'{nome}'}, {'{assunto}'},{' '}
                      {'{resumo}'} e {'{link}'} (obrigatório: o link da versão
                      web).
                    </p>
                  </div>
                ) : null}
                <div className='grid gap-2 rounded-lg border p-3'>
                  <Label>Base legal (LGPD)</Label>
                  <OptionSelect
                    label='Base legal do envio no WhatsApp'
                    value={draft.legalBasis}
                    options={LEGAL_BASIS_OPTIONS}
                    onChange={(value) =>
                      change({
                        legalBasis: value as Draft['legalBasis'],
                        confirmed: false,
                      })
                    }
                  />
                  <div className='flex items-start gap-2'>
                    <Checkbox
                      id={ids.consent}
                      checked={draft.confirmed}
                      disabled={!draft.legalBasis}
                      onCheckedChange={(checked) =>
                        change({ confirmed: checked === true })
                      }
                    />
                    <Label
                      htmlFor={ids.consent}
                      className='font-normal text-muted-foreground text-xs leading-snug'
                    >
                      Confirmo que tenho base legal para enviar esta mensagem
                      aos assinantes no WhatsApp. Quem pediu para sair das
                      transmissões (SAIR/PARAR) nunca recebe.
                    </Label>
                  </div>
                </div>
                {dto.problems.length > 0 ? (
                  <ul
                    className='grid gap-1 text-destructive text-xs'
                    role='alert'
                  >
                    {dto.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant='ghost' onClick={onDone}>
          Fechar
        </Button>
        {dto.available ? (
          <Button
            onClick={() => void handleSave()}
            disabled={locked || save.isPending}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

/** Top-bar "WhatsApp" of the issue editor (nl2-engage). */
export function IssueWhatsAppButton() {
  const issue = useIssueEditor()
  const [open, setOpen] = useState(false)
  const query = useCrmNewsletterIssueWhatsApp(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const enabled = query.data?.enabled ?? false
  const problems = query.data?.problems.length ?? 0
  return (
    <>
      <Button
        size='sm'
        variant='outline'
        onClick={() => setOpen(true)}
        aria-label='Enviar também no WhatsApp'
      >
        <SteelIcon icon={WhatsappIcon} strokeWidth={2} />
        <span className='hidden sm:inline'>WhatsApp</span>
        {enabled ? (
          <Badge
            variant={problems > 0 ? 'destructive' : 'secondary'}
            className='ml-0.5 px-1.5'
          >
            {problems > 0 ? '!' : 'ligado'}
          </Badge>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          {open && query.data ? (
            // Mounted per opening: the draft starts from the saved state.
            <WhatsAppBody dto={query.data} onDone={() => setOpen(false)} />
          ) : open ? (
            <div className='grid gap-3' aria-busy='true'>
              <Skeleton className='h-6 w-1/2' />
              <Skeleton className='h-24 w-full' />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
