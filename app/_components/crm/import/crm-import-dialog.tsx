'use client'

import {
  Download04Icon,
  Upload04Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRef, useState } from 'react'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
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
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import { useImportCrmRecords } from '@/src/hooks/use-crm-import'
import {
  CRM_IMPORT_ENTITY_LABELS,
  type CrmImportCsvParse,
  crmImportTemplate,
  parseCrmImportCsv,
} from '@/src/lib/crm-import/csv'
import {
  CRM_IMPORT_MAX_ROWS,
  type CrmImportEntity,
  type CrmImportResultDTO,
} from '@/src/schemas/crm-import.schema'

const PREVIEW_ROWS = 5
const REJECTED_SHOWN = 50

const PREVIEW_COLUMNS: Record<
  CrmImportEntity,
  { key: keyof CrmImportCsvParse['rows'][number]; label: string }[]
> = {
  leads: [
    { key: 'name', label: 'Nome' },
    { key: 'email', label: 'E-mail' },
    { key: 'phone', label: 'Telefone' },
    { key: 'company', label: 'Empresa' },
  ],
  people: [
    { key: 'name', label: 'Nome' },
    { key: 'email', label: 'E-mail' },
    { key: 'phone', label: 'Telefone' },
    { key: 'company', label: 'Empresa' },
  ],
  companies: [
    { key: 'name', label: 'Nome' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'domain', label: 'Site' },
    { key: 'city', label: 'Cidade' },
  ],
}

const RESOURCE = {
  leads: 'leads',
  people: 'people',
  companies: 'companies',
} as const

type Step =
  | { kind: 'pick' }
  | { kind: 'preview'; fileName: string; parsed: CrmImportCsvParse }
  | { kind: 'done'; result: CrmImportResultDTO }

function downloadTemplate(entity: CrmImportEntity) {
  const blob = new Blob(['﻿', crmImportTemplate(entity)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `modelo-importacao-${CRM_IMPORT_ENTITY_LABELS[entity].plural}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/** Import wizard: file → preview + consent → summary with rejected rows. */
export function CrmImportDialog({
  workspaceId,
  entity,
  open,
  onOpenChange,
  onImported,
}: {
  workspaceId: string
  entity: CrmImportEntity
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after an import that created records (refresh the list). */
  onImported?: () => void
}) {
  const importer = useImportCrmRecords(workspaceId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [consent, setConsent] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const labels = CRM_IMPORT_ENTITY_LABELS[entity]

  function reset() {
    setStep({ kind: 'pick' })
    setConsent(false)
    setFileError(null)
  }

  function close(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    const parsed = parseCrmImportCsv(await file.text(), entity)
    if (parsed.error) {
      setFileError(parsed.error)
      return
    }
    if (parsed.rows.length === 0) {
      setFileError('O arquivo não tem linhas para importar.')
      return
    }
    if (parsed.rows.length > CRM_IMPORT_MAX_ROWS) {
      setFileError(
        `Importe até ${CRM_IMPORT_MAX_ROWS.toLocaleString('pt-BR')} linhas por arquivo. Divida o arquivo e importe em partes.`,
      )
      return
    }
    setStep({ kind: 'preview', fileName: file.name, parsed })
  }

  function submit() {
    if (step.kind !== 'preview' || !consent) return
    importer.mutate(
      { entity, rows: step.parsed.rows, consentConfirmed: true },
      {
        onSuccess: (result) => {
          setStep({ kind: 'done', result })
          if (result.created > 0) onImported?.()
        },
        onError: (error) => notify.error(error, 'Erro ao importar o arquivo'),
      },
    )
  }

  const foundColumns =
    step.kind === 'preview' ? Object.values(step.parsed.columns) : []

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Importar {labels.plural}</DialogTitle>
          <DialogDescription>
            Envie um arquivo CSV (vírgula ou ponto e vírgula) com uma linha por
            registro. Colunas aceitas: {labels.columns}.
          </DialogDescription>
        </DialogHeader>

        {step.kind === 'pick' ? (
          <div className='flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center'>
            <SteelIcon icon={Upload04Icon} size={28} className='text-primary' />
            <p className='text-muted-foreground text-sm'>
              Até {CRM_IMPORT_MAX_ROWS.toLocaleString('pt-BR')} linhas por
              arquivo.{' '}
              {entity === 'companies'
                ? 'Empresas com o mesmo CNPJ ou site já cadastrados são recusadas.'
                : 'Quem já está cadastrado com o mesmo e-mail ou telefone é recusado.'}
            </p>
            <input
              ref={inputRef}
              type='file'
              accept='.csv,text/csv'
              className='hidden'
              onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <div className='flex flex-wrap items-center justify-center gap-2'>
              <Button
                variant='outline'
                onClick={() => inputRef.current?.click()}
              >
                Escolher arquivo
              </Button>
              <Button variant='ghost' onClick={() => downloadTemplate(entity)}>
                <SteelIcon icon={Download04Icon} />
                Baixar modelo
              </Button>
            </div>
            {fileError ? (
              <p className='text-destructive text-sm'>{fileError}</p>
            ) : null}
          </div>
        ) : null}

        {step.kind === 'preview' ? (
          <div className='flex min-w-0 flex-col gap-4'>
            <p className='text-sm'>
              <strong>{step.fileName}</strong>:{' '}
              {step.parsed.rows.length.toLocaleString('pt-BR')} linhas. Colunas
              reconhecidas: {foundColumns.join(', ')}.
            </p>
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    {PREVIEW_COLUMNS[entity].map((col) => (
                      <TableHead key={col.key}>{col.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {step.parsed.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <TableRow key={`${row.name ?? row.email ?? ''}-${i}`}>
                      {PREVIEW_COLUMNS[entity].map((col) => (
                        <TableCell key={col.key} className='max-w-48 truncate'>
                          {row[col.key] ?? '—'}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className='flex items-start gap-2'>
              <Checkbox
                id='crm-import-consent'
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              <Label
                htmlFor='crm-import-consent'
                className='font-normal leading-snug'
              >
                Confirmo que posso guardar e usar esses dados (LGPD). A
                importação fica registrada no histórico de auditoria.
              </Label>
            </div>
            {!consent ? (
              <p className='text-muted-foreground text-xs'>
                Marque a confirmação acima para liberar o botão Importar.
              </p>
            ) : null}
          </div>
        ) : null}

        {step.kind === 'done' ? (
          <div className='flex min-w-0 flex-col gap-3'>
            <div className='grid grid-cols-2 gap-3'>
              {[
                ['Criados', step.result.created],
                ['Recusados', step.result.rejected.length],
              ].map(([label, value]) => (
                <div key={label} className='rounded-lg border p-3'>
                  <p className='text-muted-foreground text-xs'>{label}</p>
                  <p className='font-semibold tabular-nums'>
                    {Number(value).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))}
            </div>
            {step.result.rejected.length > 0 ? (
              <>
                <p className='text-muted-foreground text-sm'>
                  Corrija as linhas recusadas no arquivo e importe só elas de
                  novo. As demais já foram criadas.
                </p>
                <div className='max-h-56 overflow-auto rounded-lg border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Linha</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>Motivo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {step.result.rejected
                        .slice(0, REJECTED_SHOWN)
                        .map((row) => (
                          <TableRow key={row.row}>
                            <TableCell className='tabular-nums'>
                              {row.row}
                            </TableCell>
                            <TableCell className='max-w-56 truncate'>
                              {row.name || '—'}
                            </TableCell>
                            <TableCell>{row.reason}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}
            {step.result.rejected.length > REJECTED_SHOWN ? (
              <p className='text-muted-foreground text-xs'>
                Mostrando as primeiras {REJECTED_SHOWN} linhas recusadas.
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          {step.kind === 'preview' ? (
            <>
              <Button variant='outline' onClick={reset}>
                Trocar arquivo
              </Button>
              <Button
                onClick={submit}
                disabled={!consent || importer.isPending}
              >
                {importer.isPending ? 'Importando…' : 'Importar'}
              </Button>
            </>
          ) : (
            <Button variant='outline' onClick={() => close(false)}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Toolbar button + dialog; hidden for roles that cannot create records. */
export function CrmImportButton({
  workspaceId,
  entity,
  onImported,
}: {
  workspaceId: string
  entity: CrmImportEntity
  onImported?: () => void
}) {
  const [open, setOpen] = useState(false)
  const canCreate = useCan(RESOURCE[entity], 'CREATE')
  if (!canCreate) return null

  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <SteelIcon icon={Upload04Icon} strokeWidth={2} />
        Importar CSV
      </Button>
      <CrmImportDialog
        workspaceId={workspaceId}
        entity={entity}
        open={open}
        onOpenChange={setOpen}
        onImported={onImported}
      />
    </>
  )
}
