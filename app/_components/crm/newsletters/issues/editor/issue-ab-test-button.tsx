'use client'

import { TestTube01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useId, useState } from 'react'
import { useEmailEditorData } from '@/app/_components/crm/email-editor/editor-data'
import { useTemplateMeta } from '@/app/_components/crm/email-editor/template-meta'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  useCrmNewsletterAbTest,
  useSaveCrmNewsletterAbTest,
} from '@/src/hooks/use-crm-newsletter-digest-ai'
import {
  CRM_NEWSLETTER_AB_MIN_AUDIENCE,
  type CrmNewsletterAbMetricValue,
  SetCrmNewsletterAbTestSchema,
} from '@/src/schemas/crm-newsletter-ab.schema'
import { useIssueEditor } from './issue-editor-context'

const PERCENTS = ['10', '20', '30', '40', '50']
const WAITS = ['1', '2', '4', '6', '12', '24', '48', '72']
const METRIC_LABEL: Record<CrmNewsletterAbMetricValue, string> = {
  OPENS: 'Taxa de abertura',
  CLICKS: 'Taxa de clique',
}

function hours(value: string) {
  return Number(value) === 1 ? '1 hora' : `${value} horas`
}

function AbTestBody({ onDone }: { onDone: () => void }) {
  const issue = useIssueEditor()
  const { meta } = useEmailEditorData()
  const subjectA = useTemplateMeta(meta, (m) => m.subject)
  const report = useCrmNewsletterAbTest(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const { save, clear } = useSaveCrmNewsletterAbTest(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const current = report.data?.abTest ?? null
  const [subjectB, setSubjectB] = useState('')
  const [percent, setPercent] = useState('20')
  const [metric, setMetric] = useState<CrmNewsletterAbMetricValue>('OPENS')
  const [wait, setWait] = useState('4')
  const [loaded, setLoaded] = useState(false)
  const subjectId = useId()
  const percentId = useId()
  const metricId = useId()
  const waitId = useId()

  useEffect(() => {
    if (loaded || !report.data) return
    if (current) {
      setSubjectB(current.subjectB)
      setPercent(String(current.testPercent))
      setMetric(current.metric)
      setWait(String(current.waitHours))
    }
    setLoaded(true)
  }, [loaded, report.data, current])

  const parsed = SetCrmNewsletterAbTestSchema.safeParse({
    subjectB,
    testPercent: Number(percent),
    metric,
    waitHours: Number(wait),
  })
  const sameAsA = subjectB.trim() !== '' && subjectB.trim() === subjectA.trim()
  const half = Number(percent) / 2

  async function handleSave() {
    if (!parsed.success || sameAsA) return
    try {
      await save.mutateAsync(parsed.data)
      notify.success('Teste A/B ligado')
      onDone()
    } catch (error) {
      notify.error(error)
    }
  }

  async function handleClear() {
    try {
      await clear.mutateAsync()
      notify.success('Teste A/B desligado')
      onDone()
    } catch (error) {
      notify.error(error)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Teste A/B de assunto</DialogTitle>
        <DialogDescription>
          Parte da audiência recebe o assunto atual (A) e parte recebe outro
          (B). Depois da espera, quem tiver a melhor taxa vai para o resto dos
          assinantes. Precisa de pelo menos {CRM_NEWSLETTER_AB_MIN_AUDIENCE}{' '}
          assinantes ativos.
        </DialogDescription>
      </DialogHeader>
      <div className='grid min-w-0 gap-4'>
        <div className='grid gap-1.5'>
          <Label>Assunto A (atual)</Label>
          <p className='break-words rounded-md border bg-muted/40 px-3 py-2 text-sm'>
            {subjectA || '—'}
          </p>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor={subjectId}>Assunto B</Label>
          <Input
            id={subjectId}
            value={subjectB}
            maxLength={200}
            placeholder='Outro jeito de chamar para a mesma edição'
            aria-invalid={sameAsA || undefined}
            onChange={(event) => setSubjectB(event.target.value)}
          />
          {sameAsA ? (
            <p className='text-destructive text-xs' role='alert'>
              O assunto B precisa ser diferente do A.
            </p>
          ) : null}
        </div>
        <div className='grid gap-4 sm:grid-cols-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor={percentId}>Parcela de teste</Label>
            <Select
              value={percent}
              onValueChange={(v) => setPercent(String(v))}
            >
              <SelectTrigger id={percentId} className='w-full'>
                <SelectValue>{(value: string) => `${value}%`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERCENTS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor={metricId}>Vencedor por</Label>
            <Select
              value={metric}
              onValueChange={(v) =>
                setMetric(v === 'CLICKS' ? 'CLICKS' : 'OPENS')
              }
            >
              <SelectTrigger id={metricId} className='w-full'>
                <SelectValue>
                  {(value: CrmNewsletterAbMetricValue) => METRIC_LABEL[value]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='OPENS'>{METRIC_LABEL.OPENS}</SelectItem>
                <SelectItem value='CLICKS'>{METRIC_LABEL.CLICKS}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor={waitId}>Esperar</Label>
            <Select value={wait} onValueChange={(v) => setWait(String(v))}>
              <SelectTrigger id={waitId} className='w-full'>
                <SelectValue>{(value: string) => hours(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WAITS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {hours(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className='text-muted-foreground text-xs'>
          {half}% recebem A, {half}% recebem B. {hours(wait)} depois do início
          do envio, o vencedor ({METRIC_LABEL[metric].toLowerCase()}) vai para
          os outros {100 - Number(percent)}%. Empate fica com o A. A abertura é
          inflada pelo Apple Mail; para decidir com mais segurança, prefira
          cliques.
        </p>
      </div>
      <DialogFooter className='gap-2'>
        {current ? (
          <Button
            variant='ghost'
            className='text-destructive sm:mr-auto'
            onClick={() => void handleClear()}
            disabled={clear.isPending}
          >
            Desligar teste
          </Button>
        ) : null}
        <Button variant='ghost' onClick={onDone}>
          Cancelar
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={!parsed.success || sameAsA || save.isPending}
        >
          {save.isPending
            ? 'Salvando…'
            : current
              ? 'Salvar teste'
              : 'Ligar teste'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Top-bar "A/B" of the issue editor (nl2-digest-ai). */
export function IssueAbTestButton() {
  const issue = useIssueEditor()
  const report = useCrmNewsletterAbTest(
    issue.workspaceId,
    issue.newsletterId,
    issue.issueId,
  )
  const [open, setOpen] = useState(false)
  if (issue.status !== 'DRAFT' && issue.status !== 'SCHEDULED') return null
  const on = Boolean(report.data?.abTest)
  return (
    <>
      <Button
        size='sm'
        variant='outline'
        onClick={() => setOpen(true)}
        aria-label='Teste A/B de assunto'
        title='Teste A/B de assunto'
      >
        <SteelIcon icon={TestTube01Icon} strokeWidth={2} />
        <span className='hidden lg:inline'>A/B</span>
        {on ? (
          <Badge variant='secondary' className='h-4 px-1 text-[10px]'>
            ligado
          </Badge>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          {open ? <AbTestBody onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
