'use client'

import {
  Cancel01Icon,
  LinkSquare02Icon,
  Loading02Icon,
  MapsLocation01Icon,
  PencilEdit02Icon,
  PlusSignIcon,
  SidebarRightIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ColumnDef, Row, Table } from '@tanstack/react-table'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import * as React from 'react'
import {
  AddressPanel,
  type CrmCompanyAddress,
} from '@/app/_components/crm/table/address-panel'
import type { CrmTableFeatures } from '@/app/_components/crm/table/table-features'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { createCrmResource } from '@/src/hooks/use-crm-resource-list'
import type { Lookups, Option } from '@/src/hooks/use-crm-workspace-lookups'
import {
  CnpjNotFoundError,
  formatCnpj,
  isCompleteCnpj,
  isValidCnpj,
  lookupCnpj,
  normalizeCnpj,
} from '@/src/lib/crm-cnpj'

export type WithId = { id: string }

/** Tipos de relação que resolvem id → nome e linkam para a página da entidade. */
export type RelationKind =
  | 'companies'
  | 'people'
  | 'opportunities'
  | 'users'
  | 'pipelines'
  | 'stages'
  | 'products'

/** Descrição declarativa de uma coluna editável da grade. */
export type GridColumn = {
  /** Chave do campo (id da coluna + chave do payload de PATCH/POST). */
  key: string
  header: string
  kind:
    | 'text'
    | 'cnpj'
    | 'number'
    | 'money'
    | 'tags'
    | 'boolean'
    | 'date'
    | 'select'
    | 'relation'
    | 'richtext'
    | 'emailhtml'
    | 'link'
    | 'address'
    | 'readonly-date'
    | 'company-name-picker'
  /** Campo obrigatório (não pode ser limpo; usado para criar a linha vazia). */
  required?: boolean
  /** Coluna nome/título: dispara a criação do rascunho ao confirmar. */
  primary?: boolean
  placeholder?: string
  /** select: opções fixas (enum) e estilos opcionais por valor (pílula). */
  options?: Option[]
  optionStyles?: Record<string, string>
  /** select: valor padrão do rascunho (ex.: "NEW"). */
  defaultValue?: string
  /** relation: entidade relacionada (resolve nome e link). */
  relationKind?: RelationKind
  /** select/relation podem ser limpos (— nenhum —). */
  clearable?: boolean
  /** Apenas exibição (ex.: created by / updated by). */
  readonly?: boolean
  /** primary: adiciona um ícone que linka para `/{slug}/{resource}/{id}`. */
  linkView?: boolean
  /**
   * Quando definido, a coluna é um campo customizado (EAV): a escrita é roteada
   * para o objeto `customFields` no PATCH (`{ customFields: { [id]: value } }`),
   * em vez de uma coluna nativa. A leitura usa `key` (`cf_<id>`).
   */
  customFieldId?: string
}

/** Largura uniforme das colunas de dados (px). */
export const DATA_COL_WIDTH = 200

const NONE = '__none__'

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})
const moneyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

/** Constrói o href da página da entidade relacionada (lista da workspace). */
function relationHref(kind: RelationKind, slug: string): string | null {
  switch (kind) {
    case 'companies':
      return `/${slug}/crm/companies`
    case 'people':
      return `/${slug}/crm/people`
    case 'opportunities':
      return `/${slug}/crm/opportunities`
    case 'pipelines':
      return `/${slug}/crm/pipelines`
    default:
      // Usuários e etapas não têm página de listagem dedicada.
      return null
  }
}

function Empty() {
  return <span className='text-muted-foreground/40'>—</span>
}

function Pill({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs',
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Editores por tipo. Todos recebem `value` atual e `commit(next)`.
 * Em linhas existentes `commit` faz PATCH (auto-save); na linha de
 * rascunho apenas atualiza o estado local.
 * ------------------------------------------------------------------ */

function TextLikeEditor({
  col,
  value,
  commit,
  startEditing,
  onPrimaryEnter,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
  startEditing: boolean
  onPrimaryEnter?: () => void
}) {
  const toText = React.useCallback((): string => {
    if (col.kind === 'tags') {
      return Array.isArray(value) ? (value as string[]).join(', ') : ''
    }
    return value == null ? '' : String(value)
  }, [col.kind, value])

  const [editing, setEditing] = React.useState(startEditing)
  const [draft, setDraft] = React.useState(toText)

  React.useEffect(() => {
    if (!editing) setDraft(toText())
  }, [editing, toText])

  function parse(text: string): unknown {
    const trimmed = text.trim()
    if (col.kind === 'tags') {
      return trimmed
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }
    if (trimmed === '') return null
    if (col.kind === 'number' || col.kind === 'money') {
      const n = Number(trimmed.replace(/\s/g, '').replace(',', '.'))
      return Number.isFinite(n) ? n : null
    }
    return trimmed
  }

  function save() {
    setEditing(false)
    const next = parse(draft)
    // Campo obrigatório não pode ficar vazio: descarta a edição.
    if (col.required && (next == null || next === '')) {
      setDraft(toText())
      return
    }
    commit(next)
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        placeholder={col.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
            onPrimaryEnter?.()
          } else if (e.key === 'Escape') {
            setDraft(toText())
            setEditing(false)
          }
        }}
        className='h-7 border-transparent bg-transparent px-1.5 shadow-none focus-visible:border-ring focus-visible:bg-background'
      />
    )
  }

  // Display
  let display: React.ReactNode
  if (col.kind === 'tags') {
    const tags = Array.isArray(value) ? (value as string[]) : []
    display = tags.length ? (
      <div className='flex flex-wrap gap-1'>
        {tags.slice(0, 3).map((t) => (
          <Pill key={t} className='bg-muted text-muted-foreground'>
            {t}
          </Pill>
        ))}
        {tags.length > 3 ? (
          <span className='text-muted-foreground text-xs'>
            +{tags.length - 3}
          </span>
        ) : null}
      </div>
    ) : (
      <Empty />
    )
  } else if (value == null || value === '') {
    display = <Empty />
  } else if (col.kind === 'money') {
    display = (
      <span className='tabular-nums'>{moneyFmt.format(Number(value))}</span>
    )
  } else if (col.kind === 'number') {
    display = (
      <span className='tabular-nums'>
        {Number(value).toLocaleString('pt-BR')}
      </span>
    )
  } else {
    display = (
      <span className={cn('truncate', col.primary && 'font-medium')}>
        {String(value)}
      </span>
    )
  }

  return (
    <button
      type='button'
      onClick={() => setEditing(true)}
      className='flex h-7 w-full items-center rounded px-1.5 text-left hover:bg-muted/50'
    >
      {display}
    </button>
  )
}

function BoolToggle({
  value,
  commit,
}: {
  value: unknown
  commit: (next: unknown) => void
}) {
  return (
    <Switch
      checked={Boolean(value)}
      onCheckedChange={(checked) => commit(Boolean(checked))}
      aria-label='Alternar'
    />
  )
}

function DateEditor({
  col,
  value,
  commit,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
}) {
  const [open, setOpen] = React.useState(false)
  const date = typeof value === 'string' && value ? new Date(value) : undefined

  if (col.kind === 'readonly-date') {
    return (
      <span className='px-1.5 text-muted-foreground text-sm'>
        {date ? dateFmt.format(date) : <Empty />}
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type='button'
            className='flex h-7 w-full items-center rounded px-1.5 text-left hover:bg-muted/50'
          />
        }
      >
        {date ? (
          <span className='whitespace-nowrap'>{dateFmt.format(date)}</span>
        ) : (
          <span className='text-muted-foreground/60'>
            {col.placeholder ?? 'Selecionar data'}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align='start' className='w-auto gap-2 p-2'>
        <Calendar
          mode='single'
          selected={date}
          onSelect={(next) => {
            if (next) {
              const d = new Date(next)
              d.setHours(12, 0, 0, 0)
              commit(d.toISOString())
            }
            setOpen(false)
          }}
        />
        {date ? (
          <Button
            variant='ghost'
            size='sm'
            onClick={() => {
              commit(null)
              setOpen(false)
            }}
          >
            <SteelIcon icon={Cancel01Icon} strokeWidth={2} />
            Limpar data
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function SelectEditor({
  col,
  value,
  commit,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
}) {
  const current = value == null ? '' : String(value)
  const selected = col.options?.find((o) => o.value === current)
  const style = col.optionStyles?.[current]

  return (
    <Select value={current} onValueChange={(v) => commit(v)}>
      <SelectTrigger
        size='sm'
        className='w-full border-transparent bg-transparent px-1.5 shadow-none hover:bg-muted/50'
      >
        {selected ? (
          <Pill className={cn('bg-muted text-muted-foreground', style)}>
            {selected.label}
          </Pill>
        ) : (
          <span className='text-muted-foreground/60'>
            {col.placeholder ?? 'Selecionar'}
          </span>
        )}
      </SelectTrigger>
      <SelectContent>
        {(col.options ?? []).map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function RelationEditor({
  col,
  value,
  commit,
  slug,
  lookups,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
  slug: string
  lookups: Lookups
}) {
  const kind = col.relationKind
  if (!kind) return null

  const id = value == null ? '' : String(value)
  const name = id ? (lookups.maps[kind][id] ?? id) : ''
  const href = relationHref(kind, slug)
  const options = lookups.options[kind]

  if (col.readonly) {
    if (!id) return <Empty />
    return href ? (
      <Button
        size='sm'
        variant='secondary'
        nativeButton={false}
        className='max-w-[160px] truncate'
        render={<Link href={href} />}
      >
        <span className='truncate'>{name}</span>
      </Button>
    ) : (
      <Button
        size='sm'
        variant='secondary'
        type='button'
        className='max-w-[160px] truncate'
      >
        <span className='truncate'>{name}</span>
      </Button>
    )
  }

  return (
    <div className='flex w-full items-center gap-0.5'>
      <Select
        value={id || NONE}
        onValueChange={(v) => commit(v === NONE ? null : v)}
      >
        <SelectTrigger
          size='sm'
          className='w-full min-w-0 border-transparent bg-transparent px-1.5 shadow-none hover:bg-muted/50'
        >
          {id ? (
            <span className='truncate'>{name}</span>
          ) : (
            <span className='text-muted-foreground/60'>
              {col.placeholder ?? 'Selecionar'}
            </span>
          )}
        </SelectTrigger>
        <SelectContent className='max-h-72'>
          {col.clearable ? (
            <>
              <SelectItem value={NONE}>— nenhum —</SelectItem>
              <SelectSeparator />
            </>
          ) : null}
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {id && href ? (
        <Button
          render={<Link href={href} />}
          nativeButton={false}
          variant='ghost'
          size='icon-xs'
          className='shrink-0 text-muted-foreground hover:text-foreground'
          aria-label={`Abrir ${name}`}
        >
          <SteelIcon icon={LinkSquare02Icon} strokeWidth={2} />
        </Button>
      ) : null}
    </div>
  )
}

/** Link externo: exibido como tag clicável (abre em nova aba); edição por texto. */
function LinkEditor({
  col,
  value,
  commit,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
}) {
  const text = value == null ? '' : String(value)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(text)

  React.useEffect(() => {
    if (!editing) setDraft(text)
  }, [editing, text])

  function save() {
    setEditing(false)
    const t = draft.trim()
    commit(t === '' ? null : t)
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        placeholder={col.placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            setEditing(false)
          }
        }}
        className='h-7 border-transparent bg-transparent px-1.5 shadow-none focus-visible:border-ring focus-visible:bg-background'
      />
    )
  }

  if (!text) {
    return (
      <button
        type='button'
        onClick={() => setEditing(true)}
        className='flex h-7 w-full items-center rounded px-1.5 text-left hover:bg-muted/50'
      >
        <span className='text-muted-foreground/60'>
          {col.placeholder ?? 'Adicionar'}
        </span>
      </button>
    )
  }

  const href = /^https?:\/\//i.test(text) ? text : `https://${text}`
  const display = text.replace(/^https?:\/\//i, '').replace(/\/$/, '')

  return (
    <div className='flex w-full items-center gap-0.5'>
      <Button
        size='sm'
        variant='secondary'
        nativeButton={false}
        className='min-w-0 max-w-full'
        render={
          <Link
            href={href}
            target='_blank'
            rel='noreferrer'
            aria-label={display}
          />
        }
      >
        <SteelIcon
          icon={LinkSquare02Icon}
          strokeWidth={2}
          className='size-3.5 shrink-0 text-muted-foreground'
        />
        <span className='truncate'>{display}</span>
      </Button>
      <Button
        variant='ghost'
        size='icon-xs'
        className='shrink-0 text-muted-foreground hover:text-foreground'
        onClick={() => setEditing(true)}
        aria-label='Editar link'
      >
        <SteelIcon icon={PencilEdit02Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

/** Editor rich text carregado sob demanda. */
const RichTextPanel = dynamic(
  () =>
    import('@/app/_components/crm/table/rich-text-panel').then(
      (m) => m.RichTextPanel,
    ),
  { ssr: false },
)

/** Editor de email (@react-email/editor) carregado sob demanda. */
const EmailEditorPanel = dynamic(
  () =>
    import('@/app/_components/crm/email-editor-panel').then(
      (m) => m.EmailEditorPanel,
    ),
  { ssr: false },
)

function htmlPreview(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function HtmlPanelCell({
  col,
  value,
  commit,
  variant,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
  variant: 'richtext' | 'emailhtml'
}) {
  const [open, setOpen] = React.useState(false)
  const html = typeof value === 'string' ? value : ''
  const preview = htmlPreview(html)

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='flex h-7 w-full max-w-[200px] items-center rounded px-1.5 text-left hover:bg-muted/50'
      >
        {preview ? (
          <span className='min-w-0 truncate'>{preview}</span>
        ) : (
          <span className='text-muted-foreground/60'>
            {col.placeholder ?? 'Adicionar'}
          </span>
        )}
      </button>
      {open ? (
        variant === 'richtext' ? (
          <RichTextPanel
            open={open}
            onOpenChange={setOpen}
            value={html}
            title={col.header}
            onSave={(next) => {
              if (next !== html) commit(next)
            }}
          />
        ) : (
          <EmailEditorPanel
            open={open}
            onOpenChange={setOpen}
            value={html}
            title={col.header}
            onSave={(next) => {
              if (next !== html) commit(next)
            }}
          />
        )
      ) : null}
    </>
  )
}

/** Coerção segura do valor JSON da célula em `CrmCompanyAddress`. */
function asAddress(value: unknown): CrmCompanyAddress | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as CrmCompanyAddress
  }
  return null
}

/**
 * Célula de endereço: exibe apenas o CEP e um botão que abre o painel com os
 * campos completos (preenchidos via ViaCEP). O painel comita o objeto inteiro.
 */
function AddressCell({
  col,
  value,
  commit,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
}) {
  const [open, setOpen] = React.useState(false)
  const address = asAddress(value)
  const cep = address?.zipCode ?? ''

  return (
    <div className='flex w-full items-center gap-0.5'>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='flex h-7 min-w-0 flex-1 items-center rounded px-1.5 text-left hover:bg-muted/50'
      >
        {cep ? (
          <span className='truncate tabular-nums'>{cep}</span>
        ) : (
          <span className='text-muted-foreground/60'>
            {col.placeholder ?? 'Adicionar endereço'}
          </span>
        )}
      </button>
      <Button
        variant='ghost'
        size='icon-xs'
        className='shrink-0 text-muted-foreground hover:text-foreground'
        onClick={() => setOpen(true)}
        aria-label='Abrir endereço'
      >
        <SteelIcon icon={MapsLocation01Icon} strokeWidth={2} />
      </Button>
      {open ? (
        <AddressPanel
          open={open}
          onOpenChange={setOpen}
          value={address}
          onSave={(next) => commit(next)}
        />
      ) : null}
    </div>
  )
}

/**
 * Editor de CNPJ: formata enquanto digita e, ao confirmar um CNPJ válido,
 * consulta a BrasilAPI e preenche os demais campos da empresa (nome e
 * endereço) via `autofill`.
 */
function CnpjEditor({
  col,
  value,
  commit,
  autofill,
  startEditing,
  onPrimaryEnter,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
  /** Preenche campos irmãos (name, address) com o retorno da BrasilAPI. */
  autofill?: (fields: Record<string, unknown>) => void
  startEditing: boolean
  onPrimaryEnter?: () => void
}) {
  const stored = value == null ? '' : String(value)
  const [editing, setEditing] = React.useState(startEditing)
  const [draft, setDraft] = React.useState(() => formatCnpj(stored))
  const [loading, setLoading] = React.useState(false)
  /** Último CNPJ consultado, para não repetir a chamada à BrasilAPI. */
  const lastLookup = React.useRef(normalizeCnpj(stored))

  React.useEffect(() => {
    if (!editing) setDraft(formatCnpj(stored))
  }, [editing, stored])

  const runLookup = React.useCallback(
    async (cnpj: string) => {
      if (!autofill || cnpj === lastLookup.current) return
      lastLookup.current = cnpj
      setLoading(true)
      try {
        const result = await lookupCnpj(cnpj)
        const fields: Record<string, unknown> = {}
        if (result.name) fields.name = result.name
        if (result.address) fields.address = result.address
        if (Object.keys(fields).length > 0) {
          autofill(fields)
          notify.success('Empresa preenchida pelo CNPJ')
        } else {
          notify.success('CNPJ encontrado')
        }
      } catch (error) {
        lastLookup.current = ''
        notify.error(
          error instanceof CnpjNotFoundError
            ? 'CNPJ não encontrado na Receita'
            : 'Não foi possível consultar o CNPJ',
        )
      } finally {
        setLoading(false)
      }
    },
    [autofill],
  )

  function save() {
    setEditing(false)
    const digits = normalizeCnpj(draft)
    if (digits === '') {
      lastLookup.current = ''
      if (stored !== '') commit(null)
      return
    }
    if (!isValidCnpj(digits)) {
      // CNPJ inválido: descarta a edição e mantém o valor anterior.
      setDraft(formatCnpj(stored))
      notify.error('CNPJ inválido')
      return
    }
    if (digits !== stored) commit(digits)
    if (isCompleteCnpj(digits)) void runLookup(digits)
  }

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        placeholder={col.placeholder ?? '00.000.000/0000-00'}
        inputMode='numeric'
        onChange={(e) => setDraft(formatCnpj(e.target.value))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
            onPrimaryEnter?.()
          } else if (e.key === 'Escape') {
            setDraft(formatCnpj(stored))
            setEditing(false)
          }
        }}
        className='h-7 border-transparent bg-transparent px-1.5 shadow-none focus-visible:border-ring focus-visible:bg-background'
      />
    )
  }

  return (
    <button
      type='button'
      onClick={() => setEditing(true)}
      className='flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-muted/50'
    >
      {loading ? (
        <SteelIcon
          icon={Loading02Icon}
          strokeWidth={2}
          className='size-3.5 shrink-0 animate-spin text-muted-foreground'
        />
      ) : null}
      {stored ? (
        <span
          className={cn('truncate tabular-nums', col.primary && 'font-medium')}
        >
          {formatCnpj(stored)}
        </span>
      ) : (
        <span className='text-muted-foreground/60'>
          {col.placeholder ?? '00.000.000/0000-00'}
        </span>
      )}
    </button>
  )
}

/**
 * Empresa do Lead: `CrmLead.company` é texto livre (não uma relação), então
 * este editor só grava o nome — mas oferece um dropdown com as empresas já
 * cadastradas (igual ao RelationEditor de Pessoas/Oportunidades) e, além
 * disso, uma opção de criar a empresa na hora a partir do CNPJ. Usado
 * apenas na coluna "Empresa" do Lead — em nenhum outro lugar.
 */
function CompanyNamePickerEditor({
  value,
  commit,
  workspaceId,
  lookups,
  placeholder,
}: {
  value: unknown
  commit: (next: unknown) => void
  workspaceId: string
  lookups: Lookups
  placeholder?: string
}) {
  const name = value == null ? '' : String(value)
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [cnpjDraft, setCnpjDraft] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [localOptions, setLocalOptions] = React.useState<Option[]>([])

  const options = React.useMemo(() => {
    const seen = new Set(lookups.options.companies.map((o) => o.value))
    return [
      ...lookups.options.companies,
      ...localOptions.filter((o) => !seen.has(o.value)),
    ]
  }, [lookups.options.companies, localOptions])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, search])

  function reset() {
    setSearch('')
    setCreating(false)
    setCnpjDraft('')
  }

  function pick(companyName: string) {
    commit(companyName)
    setOpen(false)
    reset()
  }

  async function handleCreate() {
    const digits = normalizeCnpj(cnpjDraft)
    if (!isValidCnpj(digits)) {
      notify.error('CNPJ inválido')
      return
    }
    setLoading(true)
    try {
      const lookup = await lookupCnpj(digits).catch((error) => {
        if (!(error instanceof CnpjNotFoundError)) {
          notify.error('Não foi possível consultar o CNPJ')
        }
        return null
      })
      const companyName = lookup?.name ?? `Empresa ${formatCnpj(digits)}`
      const res = await createCrmResource<{ id: string; name: string }>(
        workspaceId,
        'companies',
        {
          name: companyName,
          cnpj: digits,
          ...(lookup?.address ? { address: lookup.address } : {}),
        },
      )
      if (!res.ok || !res.data) {
        notify.error(res.message ?? 'Não foi possível criar a empresa.')
        return
      }
      const createdCompany = res.data
      notify.success('Empresa criada')
      setLocalOptions((cur) => [
        ...cur,
        { value: createdCompany.id, label: createdCompany.name },
      ])
      pick(createdCompany.name)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <PopoverTrigger
        render={
          <button
            type='button'
            className='flex h-7 w-full items-center rounded px-1.5 text-left hover:bg-muted/50'
          />
        }
      >
        {name ? (
          <span className='truncate'>{name}</span>
        ) : (
          <span className='text-muted-foreground/60'>
            {placeholder ?? 'Selecionar empresa'}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className='w-72 p-2' align='start'>
        {!creating ? (
          <div className='flex flex-col gap-2'>
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder='Buscar empresa…'
              className='h-8'
            />
            <div className='max-h-56 overflow-auto rounded-md border border-border'>
              {filtered.length === 0 ? (
                <div className='p-3 text-muted-foreground text-xs'>
                  Nenhuma empresa encontrada.
                </div>
              ) : (
                <ul className='divide-y divide-border'>
                  {filtered.map((opt) => (
                    <li key={opt.value}>
                      <button
                        type='button'
                        onClick={() => pick(opt.label)}
                        className='block w-full truncate px-2.5 py-1.5 text-left text-sm hover:bg-muted/50'
                      >
                        {opt.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {name ? (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='justify-start text-muted-foreground'
                onClick={() => pick('')}
              >
                Limpar
              </Button>
            ) : null}
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setCreating(true)}
            >
              <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
              Criar empresa por CNPJ
            </Button>
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            <label
              htmlFor='lead-company-cnpj'
              className='text-muted-foreground text-xs'
            >
              CNPJ da nova empresa
            </label>
            <Input
              id='lead-company-cnpj'
              autoFocus
              value={cnpjDraft}
              onChange={(e) => setCnpjDraft(formatCnpj(e.target.value))}
              placeholder='00.000.000/0000-00'
              inputMode='numeric'
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleCreate()
                }
              }}
            />
            <p className='text-muted-foreground text-xs'>
              O nome e endereço são preenchidos automaticamente pela Receita.
            </p>
            <div className='flex justify-end gap-2'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => setCreating(false)}
                disabled={loading}
              >
                Voltar
              </Button>
              <Button
                type='button'
                size='sm'
                onClick={() => void handleCreate()}
                disabled={loading || normalizeCnpj(cnpjDraft).length === 0}
              >
                {loading ? 'Criando…' : 'Criar e usar'}
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Renderiza o editor correto para uma célula (linha existente ou rascunho). */
export function CellEditor({
  col,
  value,
  commit,
  autofill,
  slug,
  lookups,
  workspaceId,
  startEditing = false,
  onPrimaryEnter,
}: {
  col: GridColumn
  value: unknown
  commit: (next: unknown) => void
  /** Preenche campos irmãos a partir de uma consulta externa (ex.: CNPJ). */
  autofill?: (fields: Record<string, unknown>) => void
  slug: string
  lookups: Lookups
  workspaceId: string
  startEditing?: boolean
  onPrimaryEnter?: () => void
}) {
  switch (col.kind) {
    case 'boolean':
      return <BoolToggle value={value} commit={commit} />
    case 'date':
    case 'readonly-date':
      return <DateEditor col={col} value={value} commit={commit} />
    case 'select':
      return <SelectEditor col={col} value={value} commit={commit} />
    case 'richtext':
      return (
        <HtmlPanelCell
          col={col}
          value={value}
          commit={commit}
          variant='richtext'
        />
      )
    case 'emailhtml':
      return (
        <HtmlPanelCell
          col={col}
          value={value}
          commit={commit}
          variant='emailhtml'
        />
      )
    case 'link':
      return <LinkEditor col={col} value={value} commit={commit} />
    case 'address':
      return <AddressCell col={col} value={value} commit={commit} />
    case 'cnpj':
      return (
        <CnpjEditor
          col={col}
          value={value}
          commit={commit}
          autofill={autofill}
          startEditing={startEditing}
          onPrimaryEnter={onPrimaryEnter}
        />
      )
    case 'relation':
      return (
        <RelationEditor
          col={col}
          value={value}
          commit={commit}
          slug={slug}
          lookups={lookups}
        />
      )
    case 'company-name-picker':
      return (
        <CompanyNamePickerEditor
          value={value}
          commit={commit}
          workspaceId={workspaceId}
          lookups={lookups}
          placeholder={col.placeholder}
        />
      )
    default:
      return (
        <TextLikeEditor
          col={col}
          value={value}
          commit={commit}
          startEditing={startEditing}
          onPrimaryEnter={onPrimaryEnter}
        />
      )
  }
}

function EditableCell<T extends WithId>({
  col,
  row,
  table,
}: {
  col: GridColumn
  row: Row<CrmTableFeatures, T>
  table: Table<CrmTableFeatures, T>
}) {
  const grid = table.options.meta?.grid
  if (!grid) return null

  const value = (row.original as Record<string, unknown>)[col.key]
  const commit = (next: unknown) =>
    grid.patch(
      row.original.id,
      col.customFieldId
        ? { customFields: { [col.customFieldId]: next } }
        : { [col.key]: next },
    )
  const autofill = (fields: Record<string, unknown>) =>
    grid.patch(row.original.id, fields)

  const editor = (
    <CellEditor
      col={col}
      value={value}
      commit={commit}
      autofill={autofill}
      slug={grid.slug}
      lookups={grid.lookups}
      workspaceId={grid.workspaceId}
      startEditing={Boolean(col.primary) && grid.newRowId === row.original.id}
    />
  )

  // Coluna nome/título: botões à direita abrem o painel e (opcional) a view.
  if (col.primary) {
    return (
      <div className='group/primary flex items-center gap-1'>
        <div className='min-w-0 flex-1'>{editor}</div>
        {col.linkView ? (
          <Button
            variant='ghost'
            size='icon-xs'
            nativeButton={false}
            className='shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/primary:opacity-100'
            render={
              <Link
                href={`/${grid.slug}/crm/${grid.resource}/${row.original.id}`}
                aria-label='Abrir visualização'
              />
            }
          >
            <SteelIcon icon={LinkSquare02Icon} strokeWidth={2} />
          </Button>
        ) : null}
        <Button
          variant='ghost'
          size='icon-xs'
          className='shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/primary:opacity-100'
          onClick={() => grid.openRecord(row.original.id)}
          aria-label='Abrir detalhes'
        >
          <SteelIcon icon={SidebarRightIcon} strokeWidth={2} />
        </Button>
      </div>
    )
  }

  return editor
}

/** Converte as colunas declarativas em `ColumnDef` do TanStack Table. */
export function buildGridColumns<T extends WithId>(
  cols: GridColumn[],
  lookups: Lookups,
): ColumnDef<CrmTableFeatures, T>[] {
  return cols.map((col): ColumnDef<CrmTableFeatures, T> => {
    const shared = {
      id: col.key,
      header: col.header,
      size: DATA_COL_WIDTH,
      filterFn: 'includesString' as const,
      meta: { kind: col.kind },
      cell: ({
        row,
        table,
      }: {
        row: Row<CrmTableFeatures, T>
        table: Table<CrmTableFeatures, T>
      }) => <EditableCell col={col} row={row} table={table} />,
    }
    if (col.kind === 'relation') {
      return {
        ...shared,
        accessorFn: (r: T) => {
          const id = (r as Record<string, unknown>)[col.key] as string | null
          if (!id || !col.relationKind) return ''
          return lookups.maps[col.relationKind][id] ?? ''
        },
      }
    }
    if (col.kind === 'address') {
      // String pesquisável (CEP, cidade, UF, logradouro, bairro) para o filtro global.
      return {
        ...shared,
        accessorFn: (r: T) => {
          const addr = asAddress((r as Record<string, unknown>)[col.key])
          if (!addr) return ''
          return [
            addr.zipCode,
            addr.city,
            addr.state,
            addr.street,
            addr.neighborhood,
          ]
            .filter(Boolean)
            .join(' ')
        },
      }
    }
    return { ...shared, accessorKey: col.key as keyof T & string }
  })
}

/** Valores iniciais do rascunho (linha vazia de criação). */
export function draftInitialValues(
  cols: GridColumn[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const col of cols) {
    if (col.kind === 'boolean') values[col.key] = false
    else if (col.kind === 'select' && col.defaultValue)
      values[col.key] = col.defaultValue
  }
  return values
}

/** Monta o payload de criação a partir dos valores do rascunho. */
export function draftPayload(
  cols: GridColumn[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const col of cols) {
    if (col.kind === 'readonly-date') continue
    const raw = values[col.key]
    if (col.kind === 'boolean') {
      payload[col.key] = Boolean(raw)
      continue
    }
    if (col.kind === 'tags') {
      const tags = Array.isArray(raw) ? (raw as string[]) : []
      if (tags.length) payload[col.key] = tags
      continue
    }
    if (col.kind === 'address') {
      const addr = asAddress(raw)
      if (addr) payload[col.key] = addr
      continue
    }
    if (raw == null || raw === '') continue
    payload[col.key] = raw
  }
  return payload
}
