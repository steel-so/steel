'use client'

import { MailSend01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useId, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { useEmailEditorData } from '@/app/_components/crm/email-editor/editor-data'
import {
  ChecklistList,
  useEmailChecklist,
} from '@/app/_components/crm/email-editor/email-checklist'
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
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { useTestSendCrmNewsletterIssue } from '@/src/hooks/use-crm-newsletter-issues'
import { CrmNewsletterIssueTestSendSchema } from '@/src/schemas/crm-newsletter-issue.schema'
import { useIssueEditor } from './issue-editor-context'

/** "a@x.com, b@y.com\nc@z.com" → unique trimmed addresses. */
export function parseTestEmails(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim())
        .filter(Boolean),
    ),
  ]
}

/** Saves the pending subject and document; true when nothing is left. */
export async function saveEditorNow(
  flushMeta: () => Promise<boolean>,
  save: () => Promise<boolean>,
  isDirty: () => boolean,
): Promise<boolean> {
  if (!(await flushMeta())) return false
  if (await save()) return true
  if (!isDirty()) return true
  await new Promise((resolve) => setTimeout(resolve, 600))
  return (await save()) || !isDirty()
}

function TestSendBody({ onDone }: { onDone: () => void }) {
  const { flushMeta } = useEmailEditorData()
  const { save, store } = useCanvasEditor()
  const issue = useIssueEditor()
  const summary = useEmailChecklist({ withSize: true })
  const send = useTestSendCrmNewsletterIssue(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const [value, setValue] = useState('')
  const fieldId = useId()
  const emails = parseTestEmails(value)
  const parsed = CrmNewsletterIssueTestSendSchema.safeParse({ emails })
  const blocked = summary.errors.length > 0

  async function handleSend() {
    if (!parsed.success) return
    const saved = await saveEditorNow(flushMeta, save, () =>
      Boolean(store.getState().dirty),
    )
    if (!saved) {
      notify.error('Não foi possível salvar a edição antes do teste')
      return
    }
    try {
      const result = await send.mutateAsync(parsed.data.emails)
      notify.success(
        result.to.length === 1
          ? `Teste enviado para ${result.to[0]}`
          : `Teste enviado para ${result.to.length} endereços`,
      )
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
          Até 5 endereços, com dados de exemplo nas variáveis. Testes não contam
          no limite do mês (máximo de 10 por hora). A edição é salva antes do
          envio.
        </DialogDescription>
      </DialogHeader>
      <div className='grid gap-4'>
        <div className='grid gap-1.5'>
          <Label htmlFor={fieldId}>Enviar para</Label>
          <Textarea
            id={fieldId}
            rows={2}
            value={value}
            placeholder='voce@empresa.com.br, colega@empresa.com.br'
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={(value.trim() !== '' && !parsed.success) || undefined}
          />
          {value.trim() !== '' && !parsed.success ? (
            <p className='text-destructive text-xs' role='alert'>
              {parsed.error.issues[0]?.message ?? 'Confira os endereços'}
            </p>
          ) : null}
        </div>
        <div className='grid gap-1.5'>
          <p className='font-medium text-sm'>Checklist</p>
          <div className='max-h-56 overflow-y-auto rounded-lg border p-1'>
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
          onClick={() => void handleSend()}
          disabled={blocked || !parsed.success || send.isPending}
        >
          <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
          {send.isPending ? 'Enviando…' : 'Enviar teste'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Top-bar "Testar". */
export function IssueTestSendButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <SteelIcon icon={MailSend01Icon} strokeWidth={2} />
        <span className='hidden sm:inline'>Testar</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-md'>
          {open ? <TestSendBody onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
