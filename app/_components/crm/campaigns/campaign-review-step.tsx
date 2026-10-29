'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import {
  useCrmCampaignAudiencePreview,
  useTestSendCrmCampaign,
} from '@/src/hooks/use-crm-campaigns'
import type {
  CrmCampaignDetailDTO,
  CrmCampaignEmailPreviewDTO,
  CrmCampaignOptionsDTO,
} from '@/types/crm-campaign'
import { emailDomainsHref } from '../newsletters/newsletter-sender-badge'
import type { CampaignDraft } from './campaign-draft'
import { EDITOR_LABEL } from './campaign-email-template-picker'
import {
  DESTINATION_TYPE_LABEL,
  fromLocalInput,
  LEGAL_BASIS_LABEL,
  toLocalInput,
} from './campaign-labels'
import { EmailPreview } from './campaign-previews'
import {
  campaignLinks,
  destinationUrlOf,
  EmailChecklistList,
} from './campaign-steps'
import { CampaignWhatsAppPreview } from './campaign-whatsapp-panel'

/** Destination as one line: "Página do site · Site › Página". */
export function destinationLabel(
  draft: CampaignDraft,
  options: CrmCampaignOptionsDTO,
  campaign: CrmCampaignDetailDTO,
): string {
  if (!draft.destinationType) return '—'
  let name: string | undefined
  if (draft.destinationType === 'SITE_PAGE') {
    const site = options.sites.find((item) => item.id === draft.siteId)
    const page = site?.pages.find((item) => item.id === draft.sitePageId)
    name = site ? `${site.name}${page ? ` › ${page.title}` : ''}` : undefined
  } else if (draft.destinationType === 'FORM') {
    name = options.forms.find((item) => item.id === draft.formId)?.name
  } else {
    name = options.landingPages.find(
      (item) => item.id === draft.landingPageId,
    )?.title
  }
  name ??= campaign.destination
    ? `${campaign.destination.name}${
        campaign.destination.pageTitle
          ? ` › ${campaign.destination.pageTitle}`
          : ''
      }`
    : '—'
  return `${DESTINATION_TYPE_LABEL[draft.destinationType]} · ${name}`
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <div className='flex min-w-0 flex-col rounded-lg bg-muted/40 p-3'>
      <span className='font-semibold text-lg tabular-nums'>{value}</span>
      <span className='text-muted-foreground text-xs'>{label}</span>
    </div>
  )
}

function AudienceCounts({
  workspaceId,
  draft,
}: {
  workspaceId: string
  draft: CampaignDraft
}) {
  const preview = useCrmCampaignAudiencePreview(
    workspaceId,
    draft.audience,
    draft.whatsappEnabled,
  )
  const data = preview.data
  return (
    <section aria-label='Público' className='flex flex-col gap-2'>
      <span className='font-medium text-sm'>Público</span>
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-3'>
        <Count label='Contatos' value={data ? data.total : '…'} />
        <Count
          label='Recebem e-mail'
          value={data ? data.email.reachable : '…'}
        />
        {draft.whatsappEnabled ? (
          <Count
            label='Recebem WhatsApp'
            value={data ? data.whatsapp.reachable : '…'}
          />
        ) : null}
      </div>
      {data && data.email.optedOut + data.whatsapp.optedOut > 0 ? (
        <p className='text-muted-foreground text-xs'>
          {data.email.optedOut + data.whatsapp.optedOut} descadastro(s) ficam de
          fora (LGPD).
        </p>
      ) : null}
    </section>
  )
}

/**
 * Step 4 — "Revisar e enviar": what goes out (destination, e-mail and
 * WhatsApp previews, audience counts), the checklist (blocking issues and
 * e-mail warnings), test send, schedule and send window.
 */
export function ReviewStep({
  campaign,
  draft,
  onChange,
  options,
  workspaceId,
  workspaceSlug,
  dirty,
  preview,
  previewLoading,
}: {
  campaign: CrmCampaignDetailDTO
  draft: CampaignDraft
  onChange: (patch: Partial<CampaignDraft>) => void
  options: CrmCampaignOptionsDTO
  workspaceId: string
  /** Links an issue to where it is fixed (Ajustes › Domínios de e-mail). */
  workspaceSlug?: string
  dirty: boolean
  preview: CrmCampaignEmailPreviewDTO | undefined
  previewLoading: boolean
}) {
  const [testEmail, setTestEmail] = useState('')
  const [testPhone, setTestPhone] = useState('')
  const test = useTestSendCrmCampaign(workspaceId, campaign.id)
  const scheduled = draft.scheduledAt !== null
  const windowOn = draft.sendWindowStartHour !== null

  const template = options.emailTemplates.find(
    (t) => t.id === draft.emailTemplateId,
  )
  const connection = options.whatsapp.connections.find(
    (c) => c.id === draft.whatsappConnectionId,
  )
  const destinationUrl = destinationUrlOf(draft, options)
  const links = campaignLinks(draft, campaign.slug, options)
  const warnings = campaign.emailChecklist.filter(
    (item) => item.level === 'warning',
  )

  function sendTest() {
    test.mutate(
      {
        email: testEmail.trim() || undefined,
        phone: testPhone.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          if (result.errors.length > 0) notify.error(result.errors.join(' · '))
          else notify.success('Teste enviado')
        },
        onError: (error) => notify.error(error, 'Erro ao enviar o teste'),
      },
    )
  }

  const summary = [
    { label: 'Destino', value: destinationLabel(draft, options, campaign) },
    {
      label: 'E-mail',
      value: draft.emailSubject
        ? `“${draft.emailSubject}” · ${template?.name ?? 'sem visual'}`
        : '—',
      badge: template ? EDITOR_LABEL[template.editor] : null,
    },
    {
      label: 'WhatsApp',
      value: draft.whatsappEnabled
        ? `${connection?.label ?? 'sem conexão'} · ${
            draft.whatsappDelayHours > 0
              ? `${draft.whatsappDelayHours} h depois do e-mail`
              : 'junto com o e-mail'
          }`
        : 'Desligado',
    },
    {
      label: 'Base legal',
      value:
        [
          draft.emailLegalBasis
            ? `E-mail: ${LEGAL_BASIS_LABEL[draft.emailLegalBasis]}`
            : null,
          draft.whatsappEnabled && draft.whatsappLegalBasis
            ? `WhatsApp: ${LEGAL_BASIS_LABEL[draft.whatsappLegalBasis]}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || '—',
    },
  ]

  return (
    <div className='flex flex-col gap-6'>
      <div className='grid gap-6 lg:grid-cols-2'>
        <div className='flex min-w-0 flex-col gap-6'>
          <dl className='flex flex-col gap-3 rounded-xl border p-4'>
            {summary.map((row) => (
              <div key={row.label} className='flex min-w-0 flex-col'>
                <dt className='text-muted-foreground text-xs'>{row.label}</dt>
                <dd className='flex min-w-0 flex-wrap items-center gap-2 break-words text-sm'>
                  {row.value}
                  {row.badge ? (
                    <Badge variant='outline'>{row.badge}</Badge>
                  ) : null}
                </dd>
                {row.label === 'Destino' && destinationUrl ? (
                  <a
                    href={destinationUrl}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='truncate text-primary text-xs underline-offset-4 hover:underline'
                  >
                    {destinationUrl.replace(/^https?:\/\//, '')}
                  </a>
                ) : null}
              </div>
            ))}
          </dl>

          <AudienceCounts workspaceId={workspaceId} draft={draft} />

          {campaign.issues.length > 0 || dirty ? (
            <div
              role='alert'
              className='flex flex-col gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4'
            >
              <p className='font-medium text-sm'>Antes de enviar</p>
              {dirty ? (
                <p className='text-sm'>Há alterações não salvas.</p>
              ) : null}
              <ul className='list-disc pl-5 text-sm'>
                {campaign.issues.map((issue) => (
                  <li key={issue.message}>
                    {issue.message}
                    {issue.fix === 'SENDING_DOMAINS' && workspaceSlug ? (
                      <>
                        {' '}
                        <Link
                          href={emailDomainsHref(workspaceSlug)}
                          className='font-medium underline underline-offset-2'
                        >
                          Abrir Domínios de e-mail
                        </Link>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className='rounded-xl border bg-muted/30 p-4 text-sm'>
              Tudo pronto: nenhum problema impede o envio.
            </p>
          )}

          {warnings.length > 0 ? (
            <section className='flex flex-col gap-2 rounded-xl border p-4'>
              <p className='font-medium text-sm'>Avisos do e-mail</p>
              <EmailChecklistList items={warnings} />
            </section>
          ) : null}
        </div>

        <div className='flex min-w-0 flex-col gap-4'>
          <span className='font-medium text-sm'>Prévia do e-mail</span>
          {draft.emailTemplateId ? (
            <EmailPreview preview={preview} loading={previewLoading} />
          ) : (
            <p className='rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm'>
              Escolha o visual do e-mail no passo Conteúdo.
            </p>
          )}
          {draft.whatsappEnabled ? (
            <div className='flex flex-col gap-2'>
              <span className='font-medium text-sm'>Prévia do WhatsApp</span>
              <CampaignWhatsAppPreview
                draft={draft}
                options={options}
                sampleLink={links?.whatsapp}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className='grid gap-6 lg:grid-cols-2'>
        <div className='flex flex-col gap-3 rounded-xl border p-4'>
          <p className='font-medium text-sm'>Envio de teste</p>
          <div className='grid gap-2 sm:grid-cols-2'>
            <Input
              aria-label='E-mail de teste'
              type='email'
              placeholder='voce@empresa.com.br'
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            {draft.whatsappEnabled ? (
              <Input
                aria-label='WhatsApp de teste'
                placeholder='(11) 99999-0000'
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
              />
            ) : null}
          </div>
          <Button
            type='button'
            variant='outline'
            className='self-start'
            disabled={dirty || test.isPending || (!testEmail && !testPhone)}
            onClick={sendTest}
          >
            Enviar teste
          </Button>
        </div>

        <div className='flex min-w-0 flex-col gap-6'>
          <RadioGroup
            value={scheduled ? 'schedule' : 'now'}
            onValueChange={(value) =>
              onChange({
                scheduledAt:
                  value === 'schedule'
                    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
                    : null,
              })
            }
            className='flex flex-col gap-3'
          >
            <Label className='flex items-center gap-2 font-normal'>
              <RadioGroupItem value='now' /> Enviar agora
            </Label>
            <Label className='flex items-center gap-2 font-normal'>
              <RadioGroupItem value='schedule' /> Agendar
            </Label>
          </RadioGroup>
          {scheduled ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='scheduled-at'>Data e hora (Brasília)</Label>
              <Input
                id='scheduled-at'
                type='datetime-local'
                className='sm:w-64'
                value={toLocalInput(draft.scheduledAt)}
                onChange={(e) =>
                  onChange({ scheduledAt: fromLocalInput(e.target.value) })
                }
              />
            </div>
          ) : null}

          <div className='flex flex-col gap-3 rounded-xl border p-4'>
            <Label className='flex items-center justify-between gap-4 font-normal'>
              <span>
                <span className='block font-medium'>Janela de envio</span>
                <span className='text-muted-foreground text-xs'>
                  Fora dela os envios esperam o próximo horário (Brasília).
                </span>
              </span>
              <Switch
                checked={windowOn}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? {
                          sendWindowStartHour: 8,
                          sendWindowEndHour: 18,
                          sendWeekdaysOnly: true,
                        }
                      : {
                          sendWindowStartHour: null,
                          sendWindowEndHour: null,
                          sendWeekdaysOnly: false,
                        },
                  )
                }
              />
            </Label>
            {windowOn ? (
              <div className='flex flex-wrap items-end gap-3'>
                <div className='flex flex-col gap-1'>
                  <Label htmlFor='window-start'>Das</Label>
                  <Input
                    id='window-start'
                    type='number'
                    min={0}
                    max={23}
                    className='w-20'
                    value={draft.sendWindowStartHour ?? 8}
                    onChange={(e) =>
                      onChange({
                        sendWindowStartHour: Math.min(
                          23,
                          Math.max(0, Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </div>
                <div className='flex flex-col gap-1'>
                  <Label htmlFor='window-end'>às</Label>
                  <Input
                    id='window-end'
                    type='number'
                    min={1}
                    max={24}
                    className='w-20'
                    value={draft.sendWindowEndHour ?? 18}
                    onChange={(e) =>
                      onChange({
                        sendWindowEndHour: Math.min(
                          24,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                </div>
                <Label className='flex items-center gap-2 pb-2 font-normal'>
                  <Checkbox
                    checked={draft.sendWeekdaysOnly}
                    onCheckedChange={(checked) =>
                      onChange({ sendWeekdaysOnly: checked === true })
                    }
                  />
                  Só dias úteis
                </Label>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
