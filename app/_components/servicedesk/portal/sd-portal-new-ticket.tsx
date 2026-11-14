'use client'

import {
  ArrowLeft01Icon,
  BookOpen01Icon,
  SentIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useSdConfig } from '@/src/hooks/use-sd-config'
import { useSdKbSearch } from '@/src/hooks/use-sd-knowledge'
import {
  type CreateSdTicketInput,
  useCreateSdTicket,
} from '@/src/hooks/use-sd-tickets'
import type { SdTicketTypeDTO } from '@/types/sd-ticket'
import { SdCustomFieldsForm } from '../custom-fields/sd-custom-fields-form'
import {
  sdApplicableCustomFields,
  sdCustomFieldDefaults,
  sdCustomFieldPayload,
  sdCustomFieldRequiredErrors,
} from '../custom-fields/sd-custom-fields-utils'
import { SdOptionSelect } from '../ticket/sd-option-select'
import { SdRichTextEditor } from '../ticket/sd-rich-text-editor'
import { SD_TICKET_TYPE_LABEL } from '../ticket/sd-ticket-meta'
import {
  sdPortalCategoryOptions,
  sdPortalChildOptions,
  sdPortalDefaultUrgency,
  sdPortalTemplates,
  sdPortalTypes,
  sdPortalUrgencyOptions,
} from './sd-portal-options'
import { sdPortalTicketHref } from './sd-portal-ticket-row'

/** Texto de ajuda de cada tipo, em linguagem de quem não é de TI. */
const TYPE_HINT: Record<SdTicketTypeDTO, string> = {
  INCIDENT: 'Algo parou de funcionar ou está com problema.',
  SERVICE_REQUEST: 'Preciso de algo novo: acesso, equipamento, instalação…',
  CHANGE: 'Peço uma mudança planejada em algum sistema.',
  PROBLEM: 'Um problema que se repete e precisa de análise.',
}

/** Espera o usuário parar de digitar antes de buscar na base. */
const DEFLECTION_DEBOUNCE_MS = 450
const DEFLECTION_MIN_CHARS = 4

function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className='text-sm'>
        {label}
        {required ? (
          <span className='text-destructive' aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint && !error ? (
        <p className='text-muted-foreground text-xs'>{hint}</p>
      ) : null}
      {error ? (
        <p className='text-destructive text-xs' role='alert'>
          {error}
        </p>
      ) : null}
    </div>
  )
}

/**
 * Abertura de chamado pelo portal: formulário curto e amigável, limitado ao
 * que o solicitante pode escolher (tipos liberados em `portalTicketTypes`,
 * catálogo e modelos `portalVisible`, campos customizados
 * `visibleInPortal`). Enquanto o título é digitado, sugere artigos da base
 * de conhecimento que podem resolver sem abrir chamado.
 */
export function SdPortalNewTicket({
  workspaceId,
  slug,
  portalTicketTypes,
}: {
  workspaceId: string
  slug: string
  portalTicketTypes: SdTicketTypeDTO[]
}) {
  const router = useRouter()
  const config = useSdConfig(workspaceId)
  const create = useCreateSdTicket(workspaceId)

  const types = useMemo(
    () => sdPortalTypes(portalTicketTypes),
    [portalTicketTypes],
  )
  const [type, setType] = useState<SdTicketTypeDTO>(
    () => types[0] ?? 'INCIDENT',
  )
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null)
  const [serviceId, setServiceId] = useState<string | null>(null)
  const [urgencyId, setUrgencyId] = useState<string | null>(null)
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const cfg = config.data

  // Urgência sugerida assim que a configuração chega.
  useEffect(() => {
    if (!cfg || urgencyId !== null) return
    setUrgencyId(sdPortalDefaultUrgency(cfg.urgencies))
  }, [cfg, urgencyId])

  const [deflectionQuery, setDeflectionQuery] = useState('')
  useEffect(() => {
    const trimmed = title.trim()
    const timer = setTimeout(
      () => setDeflectionQuery(trimmed),
      DEFLECTION_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [title])

  const deflection = useSdKbSearch(
    workspaceId,
    {
      q: deflectionQuery,
      limit: 4,
      status: 'PUBLISHED',
      visibility: 'PORTAL',
    },
    deflectionQuery.length >= DEFLECTION_MIN_CHARS,
  )
  const suggestions =
    deflectionQuery.length >= DEFLECTION_MIN_CHARS
      ? (deflection.data ?? [])
      : []

  const templates = useMemo(
    () => (cfg ? sdPortalTemplates(cfg.templates, type) : []),
    [cfg, type],
  )
  const categoryOptions = useMemo(
    () => (cfg ? sdPortalCategoryOptions(cfg.categories, type) : []),
    [cfg, type],
  )
  const subcategoryOptions = useMemo(
    () => (cfg ? sdPortalChildOptions(cfg.categories, categoryId, type) : []),
    [cfg, categoryId, type],
  )
  const serviceOptions = useMemo(
    () =>
      cfg ? sdPortalChildOptions(cfg.categories, subcategoryId, type) : [],
    [cfg, subcategoryId, type],
  )
  const urgencyOptions = useMemo(
    () => (cfg ? sdPortalUrgencyOptions(cfg.urgencies) : []),
    [cfg],
  )

  const definitions = useMemo(
    () =>
      cfg
        ? sdApplicableCustomFields(
            cfg.customFields,
            'TICKET',
            {
              ticketType: type,
              categoryIds: [categoryId, subcategoryId, serviceId],
            },
            { portalOnly: true },
          )
        : [],
    [cfg, type, categoryId, subcategoryId, serviceId],
  )
  const customValues = useMemo(
    () => sdCustomFieldDefaults(definitions, customFields),
    [definitions, customFields],
  )

  function applyTemplate(id: string | null) {
    setTemplateId(id)
    const template = templates.find((t) => t.id === id)
    if (!template) return
    const defaults = template.defaults
    if (defaults.title && !title.trim()) setTitle(defaults.title)
    if (defaults.description && !description)
      setDescription(defaults.description)
    if (defaults.categoryId) setCategoryId(defaults.categoryId)
    if (defaults.subcategoryId) setSubcategoryId(defaults.subcategoryId)
    if (defaults.serviceId) setServiceId(defaults.serviceId)
    if (defaults.urgencyId) setUrgencyId(defaults.urgencyId)
    if (defaults.customFields) {
      setCustomFields((current) => ({ ...current, ...defaults.customFields }))
    }
  }

  function changeType(next: SdTicketTypeDTO) {
    setType(next)
    setTemplateId(null)
    setCategoryId(null)
    setSubcategoryId(null)
    setServiceId(null)
  }

  async function submit() {
    const next: Record<string, string> = {}
    if (!title.trim())
      next.title = 'Conte em poucas palavras o que você precisa'
    Object.assign(next, sdCustomFieldRequiredErrors(definitions, customValues))
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const payload: CreateSdTicketInput = {
      type,
      title: title.trim(),
      ...(description ? { description } : {}),
      ...(templateId ? { templateId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(subcategoryId ? { subcategoryId } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(urgencyId ? { urgencyId } : {}),
      customFields: sdCustomFieldPayload(definitions, customValues),
    }

    setBusy(true)
    try {
      const ticket = await create.mutateAsync(payload)
      notify.success(`Chamado ${ticket.code} aberto. Já avisamos a equipe!`)
      router.push(sdPortalTicketHref(slug, ticket.number))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erro ao abrir o chamado'
      const field = definitions.find((d) => message.startsWith(d.label))
      if (field) setErrors({ [field.key]: message })
      else notify.error(message)
    } finally {
      setBusy(false)
    }
  }

  if (types.length === 0) {
    return (
      <div className='mx-auto flex w-full max-w-3xl flex-col items-center gap-3 p-10 text-center'>
        <p className='font-medium text-sm'>
          Nenhum tipo de chamado liberado no portal
        </p>
        <p className='max-w-md text-muted-foreground text-xs'>
          Peça a um administrador do ServiceDesk para liberar ao menos um tipo
          de chamado para o portal.
        </p>
        <Link
          href={`/${slug}/servicedesk/portal`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          Voltar ao portal
        </Link>
      </div>
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 p-6'>
      <header className='flex items-center gap-3'>
        <Link
          href={`/${slug}/servicedesk/portal`}
          aria-label='Voltar ao portal'
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
        </Link>
        <div>
          <h1 className='font-semibold text-xl'>Abrir chamado</h1>
          <p className='text-muted-foreground text-sm'>
            Conte o que está acontecendo. Quanto mais detalhes, mais rápido a
            equipe resolve.
          </p>
        </div>
      </header>

      <form
        className='flex flex-col gap-6'
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <fieldset
          data-tour='sd-portal-new-type'
          className='flex flex-col gap-2'
        >
          <legend className='mb-2 font-medium text-sm'>
            Do que você precisa?
          </legend>
          <div className='grid gap-2 sm:grid-cols-2'>
            {types.map((option) => (
              <button
                key={option}
                type='button'
                aria-pressed={type === option}
                onClick={() => changeType(option)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                  type === option
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:border-primary/40',
                )}
              >
                <span className='font-medium text-sm'>
                  {SD_TICKET_TYPE_LABEL[option]}
                </span>
                <span className='text-muted-foreground text-xs'>
                  {TYPE_HINT[option]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {templates.length > 0 ? (
          <Field
            label='Pedido pronto (opcional)'
            htmlFor='sd-portal-template'
            hint='Escolha um pedido pronto e já preenchemos o resto para você.'
          >
            <SdOptionSelect
              id='sd-portal-template'
              aria-label='Pedido pronto'
              size='default'
              value={templateId}
              noneLabel='Prefiro escrever do meu jeito'
              placeholder='Prefiro escrever do meu jeito'
              options={templates.map((t) => ({ value: t.id, label: t.name }))}
              onChange={applyTemplate}
            />
          </Field>
        ) : null}

        <Field
          label='Resumo'
          htmlFor='sd-portal-title'
          required
          error={errors.title}
          hint='Ex.: "Não consigo entrar no e-mail no notebook".'
        >
          <Input
            id='sd-portal-title'
            data-tour='sd-portal-new-title'
            autoFocus
            maxLength={200}
            value={title}
            aria-invalid={Boolean(errors.title) || undefined}
            onChange={(event) => setTitle(event.target.value)}
            placeholder='O que está acontecendo?'
          />
        </Field>

        {suggestions.length > 0 ? (
          <aside className='flex flex-col gap-2 rounded-xl border border-border bg-muted p-4'>
            <p className='flex items-center gap-2 font-medium text-sm'>
              <SteelIcon icon={BookOpen01Icon} strokeWidth={2} />
              Talvez isto já resolva
            </p>
            <ul className='flex flex-col gap-1'>
              {suggestions.map((article) => (
                <li key={article.id}>
                  <Link
                    href={`/${slug}/servicedesk/knowledge/${article.id}`}
                    className='text-sm underline-offset-2 hover:underline'
                  >
                    {article.title || 'Sem título'}
                  </Link>
                </li>
              ))}
            </ul>
            <p className='text-xs opacity-80'>
              Se nenhum deles ajudar, é só continuar e abrir o chamado.
            </p>
          </aside>
        ) : null}

        <Field
          label='Detalhes'
          hint='Quando começou, o que você já tentou, mensagens de erro…'
        >
          <SdRichTextEditor
            value={description}
            onChange={setDescription}
            placeholder='Conte com suas palavras o que aconteceu.'
          />
        </Field>

        <div className='grid gap-4 sm:grid-cols-2'>
          {categoryOptions.length > 0 ? (
            <Field label='Assunto' htmlFor='sd-portal-category'>
              <SdOptionSelect
                id='sd-portal-category'
                aria-label='Assunto'
                size='default'
                value={categoryId}
                noneLabel='Não sei dizer'
                placeholder='Escolha o assunto'
                options={categoryOptions}
                onChange={(value) => {
                  setCategoryId(value)
                  setSubcategoryId(null)
                  setServiceId(null)
                }}
              />
            </Field>
          ) : null}

          {subcategoryOptions.length > 0 ? (
            <Field label='Detalhe do assunto' htmlFor='sd-portal-subcategory'>
              <SdOptionSelect
                id='sd-portal-subcategory'
                aria-label='Detalhe do assunto'
                size='default'
                value={subcategoryId}
                noneLabel='Não sei dizer'
                placeholder='Escolha'
                options={subcategoryOptions}
                onChange={(value) => {
                  setSubcategoryId(value)
                  setServiceId(null)
                }}
              />
            </Field>
          ) : null}

          {serviceOptions.length > 0 ? (
            <Field label='Serviço' htmlFor='sd-portal-service'>
              <SdOptionSelect
                id='sd-portal-service'
                aria-label='Serviço'
                size='default'
                value={serviceId}
                noneLabel='Não sei dizer'
                placeholder='Escolha o serviço'
                options={serviceOptions}
                onChange={setServiceId}
              />
            </Field>
          ) : null}

          {urgencyOptions.length > 0 ? (
            <Field
              label='Qual a urgência?'
              htmlFor='sd-portal-urgency'
              hint='Isso ajuda a equipe a organizar a fila.'
            >
              <SdOptionSelect
                id='sd-portal-urgency'
                aria-label='Urgência'
                size='default'
                value={urgencyId}
                allowClear={false}
                placeholder='Escolha a urgência'
                options={urgencyOptions}
                onChange={setUrgencyId}
              />
            </Field>
          ) : null}
        </div>

        {definitions.length > 0 ? (
          <section className='flex flex-col gap-3'>
            <h2 className='font-medium text-sm'>Mais algumas informações</h2>
            <SdCustomFieldsForm
              workspaceId={workspaceId}
              definitions={definitions}
              values={customValues}
              errors={errors}
              idPrefix='sd-portal-cf'
              onChange={setCustomFields}
            />
          </section>
        ) : null}

        <div className='flex flex-wrap items-center justify-end gap-2 border-t pt-4'>
          <Link
            href={`/${slug}/servicedesk/portal`}
            className={buttonVariants({ variant: 'outline' })}
          >
            Cancelar
          </Link>
          <Button
            type='submit'
            size='lg'
            data-tour='sd-portal-new-submit'
            disabled={busy || !cfg}
          >
            <SteelIcon icon={SentIcon} strokeWidth={2} />
            {busy ? 'Enviando…' : 'Enviar chamado'}
          </Button>
        </div>
      </form>
    </div>
  )
}
