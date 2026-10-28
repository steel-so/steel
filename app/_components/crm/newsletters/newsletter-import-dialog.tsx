'use client'

import { Upload04Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRef, useState } from 'react'
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
import { useImportCrmNewsletterSubscribers } from '@/src/hooks/use-crm-newsletters'
import {
  type NewsletterCsvParse,
  parseNewsletterCsv,
} from '@/src/lib/newsletter/import-csv'
import {
  CRM_NEWSLETTER_IMPORT_MAX_ROWS,
  type CrmNewsletterImportResultDTO,
} from '@/src/schemas/crm-newsletter.schema'

/** Same cap as the server (crm-newsletter-subscriber.service). */
const CONFIRM_MAX_ROWS = 1_000
const PREVIEW_ROWS = 5
const REJECTED_SHOWN = 50

type Step =
  | { kind: 'pick' }
  | { kind: 'preview'; fileName: string; parsed: NewsletterCsvParse }
  | { kind: 'done'; result: CrmNewsletterImportResultDTO }

/** Import wizard: file → preview + consent → summary. */
export function NewsletterImportDialog({
  workspaceId,
  newsletterId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  newsletterId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const importer = useImportCrmNewsletterSubscribers(workspaceId, newsletterId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'pick' })
  const [consent, setConsent] = useState(false)
  const [sendConfirmation, setSendConfirmation] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  function reset() {
    setStep({ kind: 'pick' })
    setConsent(false)
    setSendConfirmation(false)
    setFileError(null)
  }

  function close(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    const parsed = parseNewsletterCsv(await file.text())
    if (parsed.error) {
      setFileError(parsed.error)
      return
    }
    if (parsed.rows.length === 0) {
      setFileError('O arquivo não tem linhas com e-mail.')
      return
    }
    if (parsed.rows.length > CRM_NEWSLETTER_IMPORT_MAX_ROWS) {
      setFileError(
        `Importe até ${CRM_NEWSLETTER_IMPORT_MAX_ROWS.toLocaleString('pt-BR')} linhas por arquivo.`,
      )
      return
    }
    setStep({ kind: 'preview', fileName: file.name, parsed })
  }

  function submit() {
    if (step.kind !== 'preview' || !consent) return
    importer.mutate(
      {
        rows: step.parsed.rows,
        consentConfirmed: true,
        sendConfirmation,
      },
      {
        onSuccess: (result) => setStep({ kind: 'done', result }),
        onError: (error) => notify.error(error, 'Erro ao importar'),
      },
    )
  }

  const tooManyToConfirm =
    step.kind === 'preview' &&
    sendConfirmation &&
    step.parsed.rows.length > CONFIRM_MAX_ROWS

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Importar assinantes</DialogTitle>
          <DialogDescription>
            CSV com a coluna <strong>email</strong> e, se quiser,{' '}
            <strong>nome</strong>. Vírgula ou ponto e vírgula.
          </DialogDescription>
        </DialogHeader>

        {step.kind === 'pick' ? (
          <div className='flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center'>
            <SteelIcon icon={Upload04Icon} size={28} className='text-primary' />
            <p className='text-muted-foreground text-sm'>
              Até {CRM_NEWSLETTER_IMPORT_MAX_ROWS.toLocaleString('pt-BR')}{' '}
              linhas. Quem pediu para não receber e-mails do workspace fica de
              fora.
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
            <Button variant='outline' onClick={() => inputRef.current?.click()}>
              Escolher arquivo
            </Button>
            {fileError ? (
              <p className='text-destructive text-sm'>{fileError}</p>
            ) : null}
          </div>
        ) : null}

        {step.kind === 'preview' ? (
          <div className='flex min-w-0 flex-col gap-4'>
            <p className='text-sm'>
              <strong>{step.fileName}</strong>:{' '}
              {step.parsed.rows.length.toLocaleString('pt-BR')} linhas
              {step.parsed.emailColumn
                ? ` (e-mail na coluna "${step.parsed.emailColumn}")`
                : ' (arquivo sem cabeçalho)'}
              .
            </p>
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Nome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {step.parsed.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <TableRow key={`${row.email}-${i}`}>
                      <TableCell className='max-w-64 truncate'>
                        {row.email}
                      </TableCell>
                      <TableCell className='max-w-48 truncate'>
                        {row.name ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className='flex items-start gap-2'>
              <Checkbox
                id='import-consent'
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              <Label
                htmlFor='import-consent'
                className='font-normal leading-snug'
              >
                Confirmo que essas pessoas autorizaram receber esta newsletter
                (LGPD). A declaração fica registrada em cada assinante.
              </Label>
            </div>
            <div className='flex items-start gap-2'>
              <Checkbox
                id='import-confirmation'
                checked={sendConfirmation}
                onCheckedChange={(checked) =>
                  setSendConfirmation(checked === true)
                }
              />
              <Label
                htmlFor='import-confirmation'
                className='font-normal leading-snug'
              >
                Pedir confirmação por e-mail antes de ativar (até{' '}
                {CONFIRM_MAX_ROWS.toLocaleString('pt-BR')} linhas). Quem tinha
                saído da newsletter sempre recebe a confirmação.
              </Label>
            </div>
            {tooManyToConfirm ? (
              <p className='text-destructive text-sm'>
                Com a confirmação por e-mail, importe até{' '}
                {CONFIRM_MAX_ROWS.toLocaleString('pt-BR')} linhas por vez.
              </p>
            ) : null}
          </div>
        ) : null}

        {step.kind === 'done' ? (
          <div className='flex min-w-0 flex-col gap-3'>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              {[
                ['Novos', step.result.created],
                ['Reativados', step.result.reactivated],
                ['Já estavam', step.result.unchanged],
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
            {step.result.reactivated > 0 ? (
              <p className='text-muted-foreground text-sm'>
                Quem tinha saído da newsletter recebe um e-mail para confirmar
                de novo e só volta depois de confirmar.
              </p>
            ) : null}
            {step.result.rejected.length > 0 ? (
              <div className='max-h-56 overflow-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Linha</TableHead>
                      <TableHead>E-mail</TableHead>
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
                            {row.email}
                          </TableCell>
                          <TableCell>{row.reason}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
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
                disabled={!consent || tooManyToConfirm || importer.isPending}
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
