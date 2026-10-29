'use client'

import { Copy01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import {
  buildDestinationUrl,
  CAMPAIGN_FIRST_NAME_MERGE_TAG,
  CAMPAIGN_LINK_MERGE_TAG,
  withCampaignParams,
} from '@/src/lib/crm-campaign/campaign-url'
import type {
  CrmCampaignChecklistItemDTO,
  CrmCampaignEmailPreviewDTO,
  CrmCampaignOptionsDTO,
} from '@/types/crm-campaign'
import { EmailSenderPicker } from '../email-sender-picker'
import type { CampaignDraft, DraftChange } from './campaign-draft'
import { EmailTemplatePicker } from './campaign-email-template-picker'
import { EmailPreview } from './campaign-previews'
import { CampaignWhatsAppPanel } from './campaign-whatsapp-panel'

/** Public URL of the draft's destination, from the picker options. */
export function destinationUrlOf(
  draft: CampaignDraft,
  options: CrmCampaignOptionsDTO,
): string | null {
  if (draft.destinationType === 'SITE_PAGE') {
    return (
      options.sites
        .find((site) => site.id === draft.siteId)
        ?.pages.find((page) => page.id === draft.sitePageId)?.url ?? null
    )
  }
  const token =
    draft.destinationType === 'FORM'
      ? options.forms.find((f) => f.id === draft.formId)?.publicToken
      : options.landingPages.find((p) => p.id === draft.landingPageId)
          ?.shareToken
  if (!draft.destinationType || !token) return null
  return buildDestinationUrl(options.baseUrl, {
    type: draft.destinationType,
    token,
  })
}

/** Public links per channel, computed from the draft (no save needed). */
export function campaignLinks(
  draft: CampaignDraft,
  slug: string,
  options: CrmCampaignOptionsDTO,
): { email: string; whatsapp: string } | null {
  const destination = destinationUrlOf(draft, options)
  if (!destination) return null
  const params = { medium: draft.utmMedium || 'campanha', campaign: slug }
  return {
    email: withCampaignParams(destination, { ...params, source: 'email' }),
    whatsapp: withCampaignParams(destination, {
      ...params,
      source: 'whatsapp',
    }),
  }
}

export function CopyLinkRow({ label, url }: { label: string; url: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      notify.success('Link copiado')
    } catch {
      notify.error('Não foi possível copiar o link')
    }
  }
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <div className='flex min-w-0 items-center gap-2'>
        <code className='min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs'>
          {url}
        </code>
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={copy}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          <SteelIcon icon={Copy01Icon} /> Copiar
        </Button>
      </div>
    </div>
  )
}

/** The e-mail checklist of the chosen template (errors block the launch). */
export function EmailChecklistList({
  items,
}: {
  items: CrmCampaignChecklistItemDTO[]
}) {
  if (items.length === 0) return null
  return (
    <ul
      aria-label='Checklist do e-mail'
      className='flex flex-col gap-1 text-sm'
    >
      {items.map((item) => (
        <li
          key={`${item.level}-${item.message}`}
          className='flex items-start gap-2'
        >
          <span
            aria-hidden='true'
            className={
              item.level === 'error'
                ? 'mt-1.5 size-2 shrink-0 rounded-full bg-destructive'
                : 'mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/60'
            }
          />
          <span>
            <span className='sr-only'>
              {item.level === 'error' ? 'Erro: ' : 'Aviso: '}
            </span>
            {item.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Step 2 — "Conteúdo": envelope, the e-mail template (cards with
 * thumbnails, "Criar novo template" in the full-screen editor) with its
 * preview and checklist, and the optional WhatsApp message.
 */
export function ContentStep({
  draft,
  onChange,
  options,
  workspaceId,
  workspaceSlug,
  preview,
  previewLoading,
  checklist,
  onCreateTemplate,
  onOpenTemplate,
  sampleLink,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  workspaceId: string
  workspaceSlug: string
  preview: CrmCampaignEmailPreviewDTO | undefined
  previewLoading: boolean
  /** Checklist of the saved template choice. */
  checklist: CrmCampaignChecklistItemDTO[]
  onCreateTemplate: () => void
  onOpenTemplate: (templateId: string) => void
  /** Campaign WhatsApp link for the message preview. */
  sampleLink?: string | null
}) {
  return (
    <div className='flex flex-col gap-6'>
      <div className='grid gap-6 lg:grid-cols-2'>
        <div className='flex min-w-0 flex-col gap-4'>
          <EmailSenderPicker
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            value={draft.emailFrom ?? ''}
            onChange={(email) => onChange({ emailFrom: email })}
          />
          <div className='flex flex-col gap-2'>
            <Label htmlFor='email-subject'>Assunto</Label>
            <Input
              id='email-subject'
              value={draft.emailSubject ?? ''}
              maxLength={200}
              onChange={(e) => onChange({ emailSubject: e.target.value })}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='email-preheader'>Pré-cabeçalho</Label>
            <Input
              id='email-preheader'
              value={draft.emailPreheader ?? ''}
              maxLength={200}
              onChange={(e) => onChange({ emailPreheader: e.target.value })}
              placeholder='Aparece ao lado do assunto na caixa de entrada'
            />
          </div>
          <div className='flex flex-col gap-2'>
            <span className='font-medium text-sm'>Visual do e-mail</span>
            <EmailTemplatePicker
              workspaceId={workspaceId}
              templates={options.emailTemplates}
              value={draft.emailTemplateId}
              onChange={(id) => onChange({ emailTemplateId: id })}
              onCreate={onCreateTemplate}
              onOpen={onOpenTemplate}
            />
            <p className='text-muted-foreground text-xs'>
              No editor, use <strong>Link da campanha</strong> (
              <code>{CAMPAIGN_LINK_MERGE_TAG}</code>) no botão para levar ao
              destino, e <code>{CAMPAIGN_FIRST_NAME_MERGE_TAG}</code> para
              personalizar. Blocos com &ldquo;Mostrar se&rdquo; são avaliados
              para cada contato no envio.
            </p>
          </div>
        </div>
        <div className='flex min-w-0 flex-col gap-3'>
          <span className='font-medium text-sm'>Prévia</span>
          {draft.emailTemplateId ? (
            <EmailPreview preview={preview} loading={previewLoading} />
          ) : (
            <p className='rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm'>
              Escolha o visual para ver a prévia.
            </p>
          )}
          <EmailChecklistList items={checklist} />
        </div>
      </div>

      <CampaignWhatsAppPanel
        draft={draft}
        onChange={onChange}
        options={options}
        sampleLink={sampleLink}
      />
    </div>
  )
}
