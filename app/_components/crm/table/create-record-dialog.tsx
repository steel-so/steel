'use client'

import * as React from 'react'
import {
  CellEditor,
  draftInitialValues,
  draftPayload,
  type GridColumn,
} from '@/app/_components/crm/table/grid'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Lookups } from '@/src/hooks/use-crm-workspace-lookups'

function isBlank(value: unknown): boolean {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

/**
 * Columns asked for when creating a record: the primary one and every
 * required one. Everything else is filled in the record panel afterwards.
 */
export function createFormColumns(columns: GridColumn[]): GridColumn[] {
  const editable = columns.filter(
    (c) => !c.readonly && c.kind !== 'readonly-date',
  )
  const essential = editable.filter((c) => c.primary || c.required)
  return essential.length > 0 ? essential : editable.slice(0, 3)
}

/**
 * Names of the required fields still empty. The create button stays disabled
 * (with this list shown as the reason) until it is empty.
 */
export function missingRequired(
  fields: GridColumn[],
  values: Record<string, unknown>,
): string[] {
  return fields
    .filter((c) => c.required && isBlank(values[c.key]))
    .map((c) => c.header)
}

const PLAIN_INPUT_KINDS = new Set<GridColumn['kind']>([
  'text',
  'link',
  'number',
  'money',
])

/** Parses a pt-BR typed number ("1.250,5" is not supported; "1250,5" is). */
function parseNumberInput(text: string): number | null {
  const trimmed = text.trim().replace(/\s/g, '').replace(',', '.')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

/**
 * Creates a record only after the user filled the required fields, so the
 * list never gets placeholder ("Sem título") records.
 */
export function CreateRecordDialog({
  open,
  onOpenChange,
  title,
  columns,
  lookups,
  workspaceId,
  slug,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Lower-case singular label, e.g. "pessoa". */
  title: string
  columns: GridColumn[]
  lookups: Lookups
  workspaceId: string
  slug: string
  /** Resolves true when the record was created (the dialog then closes). */
  onCreate: (payload: Record<string, unknown>) => Promise<boolean>
}) {
  const fields = React.useMemo(() => createFormColumns(columns), [columns])
  const [values, setValues] = React.useState<Record<string, unknown>>(() =>
    draftInitialValues(columns),
  )
  const [texts, setTexts] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setValues(draftInitialValues(columns))
    setTexts({})
  }, [open, columns])

  function setValue(key: string, next: unknown) {
    setValues((cur) => ({ ...cur, [key]: next }))
  }

  const missing = missingRequired(fields, values)

  async function submit() {
    if (missing.length > 0 || saving) return
    setSaving(true)
    const created = await onCreate(draftPayload(columns, values))
    setSaving(false)
    if (created) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='w-full sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Criar {title}</DialogTitle>
          <DialogDescription>
            Preencha o essencial agora. Os demais campos você completa depois,
            abrindo o registro.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          {fields.map((col, index) => (
            <div key={col.key} className='grid gap-1.5'>
              <span className='text-muted-foreground text-xs'>
                {col.header}
                {col.required ? (
                  <span className='text-destructive'> *</span>
                ) : null}
              </span>
              <div className='min-w-0 rounded-md border'>
                {PLAIN_INPUT_KINDS.has(col.kind) ? (
                  <Input
                    aria-label={col.header}
                    autoFocus={index === 0}
                    value={texts[col.key] ?? ''}
                    placeholder={col.placeholder}
                    inputMode={
                      col.kind === 'number' || col.kind === 'money'
                        ? 'decimal'
                        : undefined
                    }
                    onChange={(e) => {
                      const text = e.target.value
                      setTexts((cur) => ({ ...cur, [col.key]: text }))
                      setValue(
                        col.key,
                        col.kind === 'number' || col.kind === 'money'
                          ? parseNumberInput(text)
                          : text.trim() === ''
                            ? null
                            : text.trim(),
                      )
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void submit()
                      }
                    }}
                    className='h-9 border-0 shadow-none'
                  />
                ) : (
                  <CellEditor
                    col={col}
                    value={values[col.key]}
                    commit={(next) => setValue(col.key, next)}
                    autofill={(extra) =>
                      setValues((cur) => ({ ...cur, ...extra }))
                    }
                    slug={slug}
                    lookups={lookups}
                    workspaceId={workspaceId}
                    startEditing={index === 0 && col.kind === 'cnpj'}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className='items-center sm:justify-between'>
          <p className='text-muted-foreground text-xs'>
            {missing.length > 0
              ? `Preencha para continuar: ${missing.join(', ')}.`
              : ''}
          </p>
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type='button'
              onClick={() => void submit()}
              disabled={missing.length > 0 || saving}
            >
              {saving ? 'Criando…' : 'Criar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
