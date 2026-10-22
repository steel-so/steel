'use client'

import {
  CheckmarkCircle02Icon,
  Download01Icon,
  FileImportIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { notify } from '@/lib/notify'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useImportWhatsAppContacts } from '@/src/hooks/use-whatsapp-contacts'
import {
  CONTACT_IMPORT_MAX_CSV_CHARS,
  CONTACT_IMPORT_MAX_ROWS,
  CONTACT_IMPORT_TEMPLATE_CSV,
  CONTACT_IMPORT_TEMPLATE_FILENAME,
} from '@/src/lib/whatsapp/contact-import'
import type { WhatsAppContactImportResultDTO } from '@/types/whatsapp-contact-import'
import { WhatsappNumberValidationProgress } from './number-validation/whatsapp-number-validation-dialog'

function downloadTemplate() {
  const blob = new Blob([CONTACT_IMPORT_TEMPLATE_CSV], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = CONTACT_IMPORT_TEMPLATE_FILENAME
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Importação de contatos por planilha CSV (`,` ou `;`): lê o arquivo no
 * navegador, envia o texto para a API e mostra criados/atualizados/ignorados
 * com o motivo de cada linha recusada.
 */
export function WhatsAppContactImportDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const importContacts = useImportWhatsAppContacts(workspaceId)
  const connections = useWhatsAppConnections(workspaceId)
  const hasZapi = (connections.data ?? []).some(
    (connection) => connection.provider === 'ZAPI',
  )
  const [validateWhatsapp, setValidateWhatsapp] = useState(false)
  const [csv, setCsv] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<WhatsAppContactImportResultDTO | null>(
    null,
  )

  function reset() {
    setCsv(null)
    setFileName('')
    setResult(null)
    setValidateWhatsapp(false)
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setResult(null)
    setFileName(file.name)
    const text = await file.text()
    if (text.length > CONTACT_IMPORT_MAX_CSV_CHARS) {
      notify.error('A planilha é grande demais (máximo de 1 MB).')
      setCsv(null)
      return
    }
    setCsv(text)
  }

  function submit() {
    if (!csv) return
    importContacts.mutate(
      { csv, ...(validateWhatsapp ? { validateWhatsapp: true } : {}) },
      {
        onSuccess: (outcome) => {
          setResult(outcome)
          notify.success(
            `${outcome.created} criado(s) e ${outcome.updated} atualizado(s).`,
          )
        },
        onError: (error) => notify.error(error, 'Não foi possível importar.'),
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
          <DialogDescription>
            Envie um arquivo CSV (separado por vírgula ou ponto e vírgula) com
            as colunas Nome, Telefone e Descrição. O telefone é obrigatório e
            deve ter DDI + DDD (ex.: 5511999998888). Contatos que já existem são
            atualizados, sem duplicar.
          </DialogDescription>
        </DialogHeader>

        <Button
          type='button'
          variant='outline'
          size='sm'
          className='w-fit'
          onClick={downloadTemplate}
        >
          <SteelIcon icon={Download01Icon} strokeWidth={2} />
          Baixar modelo
        </Button>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: o input de arquivo é o controle envolvido */}
        <label className='flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center text-sm hover:bg-muted/40'>
          <SteelIcon
            icon={FileImportIcon}
            strokeWidth={1.8}
            className='size-6 text-muted-foreground'
          />
          <span className='font-medium'>
            {fileName || 'Escolher arquivo .csv'}
          </span>
          <span className='text-muted-foreground text-xs'>
            Até {CONTACT_IMPORT_MAX_ROWS} linhas por importação
          </span>
          <Input
            type='file'
            accept='.csv,text/csv'
            className='sr-only'
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>

        {result ? null : (
          <label
            htmlFor='contact-import-validate'
            className='flex items-start gap-2 text-sm'
          >
            <Checkbox
              id='contact-import-validate'
              checked={validateWhatsapp}
              disabled={connections.data !== undefined && !hasZapi}
              onCheckedChange={(checked) =>
                setValidateWhatsapp(checked === true)
              }
            />
            <span>
              Validar se tem WhatsApp depois de importar
              <span className='block text-muted-foreground text-xs'>
                {connections.data !== undefined && !hasZapi
                  ? 'Disponível só com uma conexão Z-API (a API oficial da Meta não oferece essa checagem).'
                  : 'Usa a sua conexão Z-API e não consome o limite do plano.'}
              </span>
            </span>
          </label>
        )}

        {result ? (
          <div className='flex flex-col gap-2 text-sm'>
            <p className='flex items-center gap-2 font-medium'>
              <SteelIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                className='size-4'
              />
              {result.created} criado(s) · {result.updated} atualizado(s) ·{' '}
              {result.skipped} ignorado(s)
            </p>
            {result.rejected.length > 0 ? (
              <ul className='max-h-48 divide-y overflow-y-auto rounded-lg border text-xs'>
                {result.rejected.map((r) => (
                  <li key={r.line} className='flex gap-2 px-2 py-1.5'>
                    <span className='w-16 shrink-0 text-muted-foreground'>
                      Linha {r.line}
                    </span>
                    <span>{r.message}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {result.validation ? (
              <WhatsappNumberValidationProgress
                workspaceId={workspaceId}
                initial={result.validation}
              />
            ) : null}
            {result.validationUnavailable ? (
              <p className='rounded-lg border p-3 text-muted-foreground text-xs'>
                Os contatos foram importados, mas a checagem de WhatsApp não
                rodou: {result.validationUnavailable}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {result ? 'Fechar' : 'Cancelar'}
          </Button>
          {result ? null : (
            <Button
              onClick={submit}
              disabled={!csv || importContacts.isPending}
            >
              {importContacts.isPending ? 'Importando…' : 'Importar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
