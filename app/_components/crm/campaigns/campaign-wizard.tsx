'use client'

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  FloppyDiskIcon,
  SentIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmCampaignEmailPreview,
  useLaunchCrmCampaign,
  useUpdateCrmCampaign,
} from '@/src/hooks/use-crm-campaigns'
import type {
  CrmCampaignDetailDTO,
  CrmCampaignOptionsDTO,
} from '@/types/crm-campaign'
import { CampaignAudienceStep } from './campaign-audience-step'
import { DestinationStep } from './campaign-destination-step'
import {
  type CampaignDraft,
  draftFromCampaign,
  draftToPatch,
} from './campaign-draft'
import { WIZARD_STEPS } from './campaign-labels'
import { ReviewStep } from './campaign-review-step'
import { ContentStep, campaignLinks } from './campaign-steps'

export function CrmCampaignWizard({
  workspaceId,
  workspaceSlug,
  campaign,
  options,
  onRefreshOptions,
  initialStep = 0,
  initialEmailTemplateId = null,
}: {
  workspaceId: string
  workspaceSlug: string
  campaign: CrmCampaignDetailDTO
  options: CrmCampaignOptionsDTO
  onRefreshOptions: () => void
  /** Opens on this step (0–3), e.g. from a `?passo=` deep link. */
  initialStep?: number
  /** Template created/edited in the e-mail editor (`?emailTemplate=`),
   * selected and saved on arrival. */
  initialEmailTemplateId?: string | null
}) {
  const router = useRouter()
  const [step, setStep] = useState(
    Math.min(Math.max(initialStep, 0), WIZARD_STEPS.length - 1),
  )
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    draftFromCampaign(campaign),
  )
  const [dirty, setDirty] = useState(false)
  const [consent, setConsent] = useState(false)
  const update = useUpdateCrmCampaign(workspaceId, campaign.id)
  const launch = useLaunchCrmCampaign(workspaceId, campaign.id)
  const preview = useCrmCampaignEmailPreview(workspaceId, campaign)

  function change(patch: Partial<CampaignDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
  }

  async function save(): Promise<boolean> {
    if (!dirty) return true
    try {
      const saved = await update.mutateAsync(draftToPatch(draft))
      setDraft(draftFromCampaign(saved))
      setDirty(false)
      return true
    } catch (error) {
      notify.error(error, 'Erro ao salvar a campanha')
      return false
    }
  }

  async function goTo(next: number) {
    if (await save()) setStep(next)
  }

  /** Back from the e-mail editor with a template: select and save it. */
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || !initialEmailTemplateId) return
    applied.current = true
    router.replace(
      `/${workspaceSlug}/crm/campaigns/${campaign.id}?passo=${step + 1}`,
      { scroll: false },
    )
    if (initialEmailTemplateId === campaign.emailTemplateId) return
    update
      .mutateAsync({ emailTemplateId: initialEmailTemplateId })
      .then((saved) => {
        setDraft((current) => ({
          ...current,
          emailTemplateId: saved.emailTemplateId,
        }))
        onRefreshOptions()
        notify.success('Template selecionado para a campanha')
      })
      .catch((error) => notify.error(error, 'Erro ao escolher o template'))
  }, [
    initialEmailTemplateId,
    campaign.emailTemplateId,
    campaign.id,
    router,
    step,
    update,
    workspaceSlug,
    onRefreshOptions,
  ])

  /** Leaves for the e-mail editor (saving first); it comes back to the
   * Conteúdo step with the template selected. */
  async function openEmailEditor(templateId: string | null) {
    if (!(await save())) return
    const returnTo = encodeURIComponent(
      `/${workspaceSlug}/crm/campaigns/${campaign.id}?passo=2`,
    )
    router.push(
      templateId
        ? `/${workspaceSlug}/crm/email-templates/${templateId}?returnTo=${returnTo}`
        : `/${workspaceSlug}/crm/email-templates/new?returnTo=${returnTo}`,
    )
  }

  async function handleSaveDraft() {
    if (await save()) notify.success('Rascunho salvo')
  }

  function handleLaunch() {
    launch.mutate(undefined, {
      onSuccess: (launched) =>
        notify.success(
          launched.status === 'SCHEDULED'
            ? 'Campanha agendada'
            : 'Campanha enviada para a fila de envio',
        ),
      onError: (error) => notify.error(error, 'Erro ao enviar a campanha'),
    })
  }

  const stepIssues = (key: string) =>
    campaign.issues.some((issue) => issue.step === key)
  const last = step === WIZARD_STEPS.length - 1
  const canLaunch = !dirty && campaign.issues.length === 0 && consent

  return (
    <div className='flex min-w-0 flex-col gap-6 p-4 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1'>
          <Button
            variant='ghost'
            size='icon'
            nativeButton={false}
            aria-label='Voltar para campanhas'
            render={
              <Link href={`/${workspaceSlug}/crm/campaigns`}>
                <SteelIcon icon={ArrowLeft01Icon} />
              </Link>
            }
          />
          <Input
            aria-label='Nome da campanha'
            value={draft.name}
            maxLength={120}
            onChange={(e) => change({ name: e.target.value })}
            className='min-w-0 flex-1 border-transparent font-semibold text-lg shadow-none sm:max-w-md'
          />
        </div>
        <Button
          variant='outline'
          onClick={handleSaveDraft}
          disabled={!dirty || update.isPending}
        >
          <SteelIcon icon={FloppyDiskIcon} /> Salvar rascunho
        </Button>
      </div>

      <nav aria-label='Passos da campanha' className='flex flex-col gap-3'>
        <div
          className='h-1.5 w-full overflow-hidden rounded-full bg-muted'
          role='progressbar'
          aria-valuemin={1}
          aria-valuemax={WIZARD_STEPS.length}
          aria-valuenow={step + 1}
          aria-label={`Passo ${step + 1} de ${WIZARD_STEPS.length}`}
        >
          <div
            className='h-full rounded-full bg-primary transition-all'
            style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }}
          />
        </div>
        <ol className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
          {WIZARD_STEPS.map((item, index) => {
            const done = index !== step && !stepIssues(item.key)
            return (
              <li key={item.key}>
                <button
                  type='button'
                  onClick={() => goTo(index)}
                  aria-current={index === step ? 'step' : undefined}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                    index === step && 'bg-muted font-medium',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                      index === step && 'border-primary text-primary',
                    )}
                  >
                    {done && item.key !== 'review' ? (
                      <SteelIcon icon={CheckmarkCircle02Icon} size={14} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className='truncate'>{item.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className='min-w-0'>
        {step === 0 ? (
          <DestinationStep
            draft={draft}
            onChange={change}
            options={options}
            campaign={campaign}
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            onRefreshOptions={onRefreshOptions}
          />
        ) : step === 1 ? (
          <ContentStep
            draft={draft}
            onChange={change}
            options={options}
            workspaceId={workspaceId}
            preview={preview.data}
            previewLoading={preview.isLoading}
            checklist={dirty ? [] : campaign.emailChecklist}
            onCreateTemplate={() => void openEmailEditor(null)}
            onOpenTemplate={(id) => void openEmailEditor(id)}
            sampleLink={campaignLinks(draft, campaign.slug, options)?.whatsapp}
          />
        ) : step === 2 ? (
          <CampaignAudienceStep
            workspaceId={workspaceId}
            draft={draft}
            onChange={change}
            options={options}
          />
        ) : (
          <ReviewStep
            campaign={campaign}
            draft={draft}
            onChange={change}
            options={options}
            workspaceId={workspaceId}
            dirty={dirty}
            preview={preview.data}
            previewLoading={preview.isLoading}
          />
        )}
      </div>

      <div className='flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between'>
        <Button
          variant='ghost'
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
        >
          <SteelIcon icon={ArrowLeft01Icon} /> Voltar
        </Button>
        {last ? (
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center'>
            <Label className='flex items-start gap-2 font-normal text-sm'>
              <Checkbox
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              Confirmo a base legal (LGPD) para enviar a este público.
            </Label>
            <Button
              onClick={handleLaunch}
              disabled={!canLaunch || launch.isPending}
            >
              <SteelIcon icon={SentIcon} />
              {draft.scheduledAt ? 'Agendar campanha' : 'Enviar campanha'}
            </Button>
          </div>
        ) : (
          <Button onClick={() => goTo(step + 1)} disabled={update.isPending}>
            Continuar <SteelIcon icon={ArrowRight01Icon} />
          </Button>
        )}
      </div>
    </div>
  )
}
