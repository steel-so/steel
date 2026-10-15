'use client'

import { MailSend01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useId, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { useSendCrmEmailTest } from '@/src/hooks/use-crm-email-builder'
import { SAMPLE_CONTACT } from '@/src/lib/crm-email-builder/variables'
import { ContactSelect } from './contact-select'
import { useEmailEditorData } from './editor-data'
import { ChecklistList, useEmailChecklist } from './email-checklist'
import {
  personIdOf,
  SAMPLE_KEY,
  usePreviewContacts,
} from './use-preview-contacts'

/** Retries once when a save was already running (the shell queues it). */
async function saveNow(
  save: () => Promise<boolean>,
  isDirty: () => boolean,
): Promise<boolean> {
  if (await save()) return true
  if (!isDirty()) return true
  await new Promise((resolve) => setTimeout(resolve, 600))
  return (await save()) || !isDirty()
}

function SendTestBody({ onDone }: { onDone: () => void }) {
  const { workspaceId, templateId, flushMeta } = useEmailEditorData()
  const { save, store } = useCanvasEditor()
  const summary = useEmailChecklist({ withSize: true })
  const contacts = usePreviewContacts(workspaceId)
  const [contactKey, setContactKey] = useState(SAMPLE_KEY)
  const sendTest = useSendCrmEmailTest(workspaceId, templateId)
  const selectId = useId()
  const blocked = summary.errors.length > 0

  async function handleSend() {
    const saved =
      (await flushMeta()) && (await saveNow(save, () => store.getState().dirty))
    if (!saved) {
      notify.error('Não foi possível salvar o template antes do teste')
      return
    }
    try {
      const personId = personIdOf(contactKey)
      const result = await sendTest.mutateAsync(
        personId ? { personId } : { sample: SAMPLE_CONTACT },
      )
      notify.success(`Teste enviado para ${result.to}`)
      onDone()
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enviar teste</DialogTitle>
        <DialogDescription>
          O e-mail vai para o seu endereço, com as variáveis do contato
          escolhido. O template é salvo antes do envio.
        </DialogDescription>
      </DialogHeader>
      <div className='grid gap-4'>
        <div className='grid gap-1.5'>
          <Label htmlFor={selectId}>Usar os dados de</Label>
          <ContactSelect
            id={selectId}
            value={contactKey}
            onChange={setContactKey}
            options={contacts.options}
            className='w-full'
          />
        </div>
        <div className='grid gap-1.5'>
          <p className='font-medium text-sm'>Checklist</p>
          <div className='max-h-64 overflow-y-auto rounded-lg border p-1'>
            <ChecklistList summary={summary} onPick={onDone} />
          </div>
          {blocked ? (
            <p className='text-destructive text-xs' role='alert'>
              Corrija os erros para enviar o teste.
            </p>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant='ghost' onClick={onDone}>
          Cancelar
        </Button>
        <Button
          onClick={handleSend}
          disabled={blocked || sendTest.isPending}
          data-testid='send-test-confirm'
        >
          <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
          {sendTest.isPending
            ? 'Enviando…'
            : summary.warnings.length > 0
              ? 'Enviar mesmo assim'
              : 'Enviar teste'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Top-bar "Enviar teste": checklist first (errors block), then the send. */
export function SendTestButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size='sm'
        onClick={() => setOpen(true)}
        data-testid='email-send-test-trigger'
      >
        <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
        Enviar teste
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-md'>
          {open ? <SendTestBody onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
