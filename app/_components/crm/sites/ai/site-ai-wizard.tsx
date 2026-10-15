'use client'

import {
  AiMagicIcon,
  ArrowLeft01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
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
import { cn } from '@/lib/utils'
import {
  type SiteAiGenerationState,
  useSiteAiContext,
  useSiteAiGeneration,
} from '@/src/hooks/use-site-ai'
import { estimateSiteGeneration } from '@/src/lib/site-ai/estimate'
import {
  type GenerateSiteInput,
  SITE_AI_GOAL_LABELS,
  SITE_AI_GOALS,
  SITE_AI_MAX_PRODUCTS,
  SITE_AI_PAGE_KINDS,
  SITE_AI_PAGE_LABELS,
  SITE_AI_STYLE_LABELS,
  SITE_AI_STYLES,
  SITE_AI_TONE_LABELS,
  SITE_AI_TONES,
  type SiteAiGoal,
  type SiteAiPageKind,
  type SiteAiStyle,
  type SiteAiTone,
} from '@/src/schemas/site-ai.schema'
import type { SiteAiContextDTO, SiteAiStep } from '@/types/site-ai'
import { AiCostLine, ChoiceSelect } from './site-ai-shared'

const NEW_FORM = 'new'
const NO_FORM = 'none'
const HEX = /^#[0-9a-fA-F]{6}$/

const DEFAULT_PAGES: SiteAiPageKind[] = ['about', 'services', 'contact']

interface Brief {
  name: string
  business: string
  audience: string
  goal: SiteAiGoal
  tone: SiteAiTone
  pages: SiteAiPageKind[]
  style: SiteAiStyle
  primaryColor: string
  useLogo: boolean
  productIds: string[]
  useTestimonials: boolean
  form: string
  eventDate: string
  extra: string
}

function initialForm(context: SiteAiContextDTO): string {
  const contact = context.forms.find((form) =>
    form.name.toLowerCase().includes('contato'),
  )
  const first = contact ?? context.forms[0]
  if (first) return first.id
  return context.canCreateForm ? NEW_FORM : NO_FORM
}

function initialBrief(context: SiteAiContextDTO): Brief {
  return {
    name: context.brand.companyName,
    business: '',
    audience: '',
    goal: 'leads',
    tone: 'professional',
    pages: DEFAULT_PAGES,
    style: 'auto',
    primaryColor: HEX.test(context.brand.primaryColor)
      ? context.brand.primaryColor
      : '',
    useLogo: /^(https:\/\/|\/(?!\/))/.test(context.brand.logoUrl),
    productIds: context.products
      .slice(0, SITE_AI_MAX_PRODUCTS)
      .map((product) => product.id),
    useTestimonials: context.testimonials > 0,
    form: initialForm(context),
    eventDate: '',
    extra: '',
  }
}

/** The brief as the API body. */
export function toGenerateInput(
  brief: Brief,
  context: SiteAiContextDTO,
): GenerateSiteInput {
  return {
    name: brief.name.trim(),
    business: brief.business.trim(),
    audience: brief.audience.trim(),
    goal: brief.goal,
    tone: brief.tone,
    pages: brief.pages,
    style: brief.style,
    ...(HEX.test(brief.primaryColor)
      ? { primaryColor: brief.primaryColor }
      : {}),
    ...(brief.useLogo && context.brand.logoUrl
      ? { logoUrl: context.brand.logoUrl }
      : {}),
    productIds: brief.productIds,
    useTestimonials: brief.useTestimonials,
    ...(brief.form === NEW_FORM
      ? { createContactForm: true }
      : brief.form === NO_FORM
        ? {}
        : { contactFormId: brief.form }),
    ...(brief.goal === 'event' && brief.eventDate
      ? { eventDate: brief.eventDate }
      : {}),
    extra: brief.extra.trim(),
  }
}

function StepIcon({ status }: { status: SiteAiStep['status'] }) {
  if (status === 'running') {
    return (
      <SteelIcon
        icon={Loading03Icon}
        className='size-4 animate-spin text-primary'
      />
    )
  }
  if (status === 'done') {
    return (
      <SteelIcon icon={CheckmarkCircle02Icon} className='size-4 text-primary' />
    )
  }
  if (status === 'failed') {
    return <SteelIcon icon={Cancel01Icon} className='size-4 text-destructive' />
  }
  return (
    <span className='block size-4 rounded-full border border-muted-foreground/40' />
  )
}

/** Live checklist of the generation ("Criando tema…", "Montando a página
 * Início…"), then the result. */
export function SiteAiProgress({
  state,
  onOpen,
  onRetry,
}: {
  state: Exclude<SiteAiGenerationState, { status: 'idle' }>
  onOpen: (siteId: string) => void
  onRetry: () => void
}) {
  const steps = state.steps
  return (
    <div className='grid gap-4' data-testid='site-ai-progress'>
      <DialogHeader>
        <DialogTitle>
          {state.status === 'done'
            ? 'Site pronto!'
            : state.status === 'error'
              ? 'Não deu para gerar o site'
              : 'Gerando o seu site…'}
        </DialogTitle>
        <DialogDescription>
          {state.status === 'done'
            ? 'Revise os textos e as imagens no editor antes de publicar.'
            : state.status === 'error'
              ? state.message
              : 'Leva de um a dois minutos. Pode continuar aqui — nada é publicado sem você.'}
        </DialogDescription>
      </DialogHeader>
      {steps.length === 0 && state.status === 'running' ? (
        <p
          role='status'
          className='flex items-center gap-2 text-muted-foreground text-sm'
        >
          <SteelIcon icon={Loading03Icon} className='size-4 animate-spin' />
          Preparando…
        </p>
      ) : (
        <ol className='grid gap-2' aria-live='polite'>
          {steps.map((step) => (
            <li
              key={step.id}
              className={cn(
                'flex items-center gap-2.5 text-sm',
                step.status === 'pending' && 'text-muted-foreground',
              )}
              data-status={step.status}
            >
              <StepIcon status={step.status} />
              <span className='min-w-0 truncate'>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
      {state.status === 'done' && state.warnings.length > 0 ? (
        <ul className='grid gap-1 rounded-lg border bg-muted/40 p-3 text-muted-foreground text-xs'>
          {state.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {state.status === 'done' ? (
        <DialogFooter>
          <Button type='button' onClick={() => onOpen(state.site.id)}>
            Abrir o editor
          </Button>
        </DialogFooter>
      ) : null}
      {state.status === 'error' ? (
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onRetry}>
            <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
            Voltar ao briefing
          </Button>
        </DialogFooter>
      ) : null}
    </div>
  )
}

function BriefForm({
  context,
  onBack,
  onSubmit,
}: {
  context: SiteAiContextDTO
  onBack: () => void
  onSubmit: (input: GenerateSiteInput) => void
}) {
  const ids = {
    name: useId(),
    business: useId(),
    audience: useId(),
    goal: useId(),
    tone: useId(),
    style: useId(),
    color: useId(),
    form: useId(),
    date: useId(),
    extra: useId(),
  }
  const [brief, setBrief] = useState<Brief>(() => initialBrief(context))
  const set = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setBrief((current) => ({ ...current, [key]: value }))

  const togglePage = (kind: SiteAiPageKind) =>
    set(
      'pages',
      brief.pages.includes(kind)
        ? brief.pages.filter((page) => page !== kind)
        : SITE_AI_PAGE_KINDS.filter(
            (page) => page === kind || brief.pages.includes(page),
          ),
    )
  const toggleProduct = (id: string) =>
    set(
      'productIds',
      brief.productIds.includes(id)
        ? brief.productIds.filter((item) => item !== id)
        : [...brief.productIds, id].slice(0, SITE_AI_MAX_PRODUCTS),
    )

  const estimate = context.estimate
    ? estimateSiteGeneration(context.estimate, brief.pages.length + 1)
    : null
  const businessOk = brief.business.trim().length >= 10
  const canSubmit =
    context.available &&
    !context.quota.exceeded &&
    brief.name.trim().length > 0 &&
    businessOk

  const formOptions = [
    ...context.forms.map((form) => ({ value: form.id, label: form.name })),
    ...(context.canCreateForm
      ? [{ value: NEW_FORM, label: 'Criar formulário "Contato pelo site"' }]
      : []),
    { value: NO_FORM, label: 'Nenhum por enquanto' },
  ]

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (canSubmit) onSubmit(toGenerateInput(brief, context))
  }

  return (
    <form onSubmit={submit} className='grid gap-5' data-testid='site-ai-form'>
      <DialogHeader>
        <DialogTitle>Gerar site com IA</DialogTitle>
        <DialogDescription>
          Conte sobre o negócio e a IA monta o tema, as páginas e os textos com
          as seções prontas. Tudo fica em rascunho para você revisar.
        </DialogDescription>
      </DialogHeader>

      {!context.available ? (
        <p
          role='alert'
          className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive text-sm'
        >
          {context.unavailableReason}
        </p>
      ) : null}

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.name}>Nome da empresa</Label>
          <Input
            id={ids.name}
            value={brief.name}
            maxLength={120}
            onChange={(event) => set('name', event.target.value)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.audience}>Público (opcional)</Label>
          <Input
            id={ids.audience}
            value={brief.audience}
            maxLength={500}
            placeholder='Ex.: pequenas empresas da região'
            onChange={(event) => set('audience', event.target.value)}
          />
        </div>
      </div>

      <div className='grid gap-1.5'>
        <Label htmlFor={ids.business}>O que a empresa faz?</Label>
        <Textarea
          id={ids.business}
          value={brief.business}
          rows={3}
          maxLength={1500}
          placeholder='Ex.: padaria artesanal com fermentação natural, entrega no bairro e encomendas para festas.'
          onChange={(event) => set('business', event.target.value)}
          aria-invalid={brief.business.length > 0 && !businessOk}
        />
        <p className='text-muted-foreground text-xs'>
          Quanto mais específico, melhores os textos: serviços, diferenciais,
          região, como atende.
        </p>
      </div>

      <div className='grid gap-4 sm:grid-cols-3'>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.goal}>Objetivo</Label>
          <ChoiceSelect
            id={ids.goal}
            label='Objetivo do site'
            value={brief.goal}
            options={SITE_AI_GOALS.map((goal) => ({
              value: goal,
              label: SITE_AI_GOAL_LABELS[goal],
            }))}
            onChange={(value) => set('goal', value as SiteAiGoal)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.tone}>Tom de voz</Label>
          <ChoiceSelect
            id={ids.tone}
            label='Tom de voz'
            value={brief.tone}
            options={SITE_AI_TONES.map((tone) => ({
              value: tone,
              label: SITE_AI_TONE_LABELS[tone],
            }))}
            onChange={(value) => set('tone', value as SiteAiTone)}
          />
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.style}>Estilo</Label>
          <ChoiceSelect
            id={ids.style}
            label='Estilo visual'
            value={brief.style}
            options={SITE_AI_STYLES.map((style) => ({
              value: style,
              label: SITE_AI_STYLE_LABELS[style],
            }))}
            onChange={(value) => set('style', value as SiteAiStyle)}
          />
        </div>
      </div>

      {brief.goal === 'event' ? (
        <div className='grid gap-1.5 sm:max-w-56'>
          <Label htmlFor={ids.date}>Data do evento</Label>
          <Input
            id={ids.date}
            type='date'
            value={brief.eventDate}
            onChange={(event) => set('eventDate', event.target.value)}
          />
        </div>
      ) : null}

      <fieldset className='grid gap-2'>
        <legend className='mb-2 font-medium text-sm'>Páginas</legend>
        <div className='flex flex-wrap gap-2'>
          <span className='inline-flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-muted-foreground text-sm'>
            <Checkbox checked disabled aria-label='Início (sempre)' />
            {SITE_AI_PAGE_LABELS.home}
          </span>
          {SITE_AI_PAGE_KINDS.map((kind) => (
            <Label
              key={kind}
              className='inline-flex cursor-pointer rounded-md border px-2.5 py-1.5 font-normal hover:bg-accent'
            >
              <Checkbox
                checked={brief.pages.includes(kind)}
                onCheckedChange={() => togglePage(kind)}
              />
              {SITE_AI_PAGE_LABELS[kind]}
            </Label>
          ))}
        </div>
      </fieldset>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.color}>Cor da marca</Label>
          <div className='flex items-center gap-2'>
            <input
              type='color'
              aria-label='Escolher a cor da marca'
              value={
                HEX.test(brief.primaryColor) ? brief.primaryColor : '#473bf0'
              }
              onChange={(event) => set('primaryColor', event.target.value)}
              className='h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-1'
            />
            <Input
              id={ids.color}
              value={brief.primaryColor}
              placeholder='A IA sugere'
              maxLength={7}
              onChange={(event) => set('primaryColor', event.target.value)}
              aria-invalid={
                brief.primaryColor.length > 0 && !HEX.test(brief.primaryColor)
              }
            />
          </div>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={ids.form}>Formulário de contato</Label>
          <ChoiceSelect
            id={ids.form}
            label='Formulário do CRM'
            value={brief.form}
            options={formOptions}
            onChange={(value) => set('form', value)}
          />
        </div>
      </div>

      {context.brand.logoUrl ? (
        <Label className='gap-3 font-normal leading-normal'>
          <Switch
            checked={brief.useLogo}
            onCheckedChange={(checked) => set('useLogo', checked)}
          />
          Usar o logo da marca do e-mail no cabeçalho
        </Label>
      ) : null}

      {context.products.length > 0 ? (
        <fieldset className='grid gap-2'>
          <legend className='mb-2 font-medium text-sm'>
            Produtos do CRM no site{' '}
            <span className='font-normal text-muted-foreground'>
              (até {SITE_AI_MAX_PRODUCTS}, com nome e preço reais)
            </span>
          </legend>
          <div className='grid gap-1 sm:grid-cols-2'>
            {context.products.map((product) => (
              <Label
                key={product.id}
                className='min-w-0 cursor-pointer rounded-md px-1 py-1 font-normal leading-normal hover:bg-accent'
              >
                <Checkbox
                  checked={brief.productIds.includes(product.id)}
                  onCheckedChange={() => toggleProduct(product.id)}
                />
                <span className='min-w-0 truncate'>{product.name}</span>
                <span className='ml-auto shrink-0 text-muted-foreground text-xs'>
                  {product.price}
                </span>
              </Label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {context.testimonials > 0 ? (
        <Label className='gap-3 font-normal leading-normal'>
          <Switch
            checked={brief.useTestimonials}
            onCheckedChange={(checked) => set('useTestimonials', checked)}
          />
          Usar os {context.testimonials} depoimentos das landing pages
        </Label>
      ) : null}

      <div className='grid gap-1.5'>
        <Label htmlFor={ids.extra}>Algo mais? (opcional)</Label>
        <Textarea
          id={ids.extra}
          value={brief.extra}
          rows={2}
          maxLength={1000}
          placeholder='Ex.: abrimos aos domingos; destaque o delivery.'
          onChange={(event) => set('extra', event.target.value)}
        />
      </div>

      <AiCostLine estimateUsd={estimate} quota={context.quota} />

      <DialogFooter>
        <Button type='button' variant='outline' onClick={onBack}>
          <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
          Modelos
        </Button>
        <Button
          type='submit'
          disabled={!canSubmit}
          data-testid='site-ai-submit'
        >
          <SteelIcon icon={AiMagicIcon} data-icon='inline-start' />
          Gerar site
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * "Novo site → Gerar com IA": the guided brief (prefilled from the
 * workspace), then the live progress of the generation and a shortcut to
 * the editor. Opens the editor by itself when nothing needs attention.
 */
export function SiteAiWizard({
  workspaceId,
  slug,
  onBack,
}: {
  workspaceId: string
  slug: string
  onBack: () => void
}) {
  const router = useRouter()
  const context = useSiteAiContext(workspaceId)
  const { state, start, reset } = useSiteAiGeneration(workspaceId)
  const open = useMemo(
    () => (siteId: string) => router.push(`/${slug}/crm/sites/${siteId}`),
    [router, slug],
  )

  useEffect(() => {
    if (state.status === 'done' && state.warnings.length === 0) {
      open(state.site.id)
    }
  }, [state, open])

  if (state.status !== 'idle') {
    return <SiteAiProgress state={state} onOpen={open} onRetry={reset} />
  }
  if (context.error) {
    return (
      <div className='grid gap-4'>
        <DialogHeader>
          <DialogTitle>Gerar site com IA</DialogTitle>
          <DialogDescription>
            Não foi possível carregar os dados do workspace. Tente de novo em
            instantes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={onBack}>
            <SteelIcon icon={ArrowLeft01Icon} data-icon='inline-start' />
            Modelos
          </Button>
        </DialogFooter>
      </div>
    )
  }
  if (!context.data) {
    return (
      <div className='grid gap-3' aria-busy='true'>
        <Skeleton className='h-6 w-48' />
        <Skeleton className='h-4 w-full' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-24 w-full' />
      </div>
    )
  }
  return (
    <BriefForm
      context={context.data}
      onBack={onBack}
      onSubmit={(input) => void start(input)}
    />
  )
}
