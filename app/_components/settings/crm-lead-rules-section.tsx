'use client'

import { Delete02Icon, PlusSignIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Muted } from '@/components/typography/text/muted'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  createCrmResource,
  deleteCrmResource,
  useCrmResourceList,
} from '@/src/hooks/use-crm-resource-list'
import {
  type LookupKind,
  useCrmWorkspaceLookups,
} from '@/src/hooks/use-crm-workspace-lookups'
import type {
  CrmLeadRoutingRuleDTO,
  CrmLeadScoringRuleDTO,
} from '@/types/crm-lead'

const FIELD_OPTIONS = [
  'name',
  'email',
  'phone',
  'company',
  'jobTitle',
  'source',
  'city',
] as const

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome',
  email: 'E-mail',
  phone: 'Telefone',
  company: 'Empresa',
  jobTitle: 'Cargo',
  source: 'Origem',
  city: 'Cidade',
}

/** Engagement events (newsletter bridge): scoring only, never routing. */
const EVENT_FIELD_OPTIONS = [
  'newsletter_subscribed',
  'newsletter_opened',
  'newsletter_clicked',
] as const

const EVENT_FIELD_LABEL: Record<string, string> = {
  newsletter_subscribed: 'Assinou newsletter',
  newsletter_opened: 'Abriu newsletter',
  newsletter_clicked: 'Clicou em link da newsletter',
}

const isEventField = (field: string) => field in EVENT_FIELD_LABEL

const OPERATOR_OPTIONS = [
  'equals',
  'not_equals',
  'contains',
  'is_empty',
  'is_not_empty',
] as const

const OPERATOR_LABEL: Record<string, string> = {
  equals: 'é igual a',
  not_equals: 'é diferente de',
  contains: 'contém',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
}

const LOOKUP_KINDS: LookupKind[] = ['users']

function ConditionSummary({
  field,
  operator,
  value,
}: {
  field: string
  operator: string
  value: string | null
}) {
  if (isEventField(field)) {
    return (
      <span className='text-sm'>
        {EVENT_FIELD_LABEL[field]}
        {field === 'newsletter_clicked' && value
          ? ` (URL contém "${value}")`
          : ''}
        <span className='text-muted-foreground'> · uma vez por evento</span>
      </span>
    )
  }
  const needsValue = operator !== 'is_empty' && operator !== 'is_not_empty'
  return (
    <span className='text-sm'>
      {FIELD_LABEL[field] ?? field} {OPERATOR_LABEL[operator] ?? operator}
      {needsValue && value ? ` "${value}"` : ''}
    </span>
  )
}

function EventRuleHint({
  field,
  value,
  onValue,
}: {
  field: string
  value: string
  onValue: (value: string) => void
}) {
  return (
    <>
      {field === 'newsletter_clicked' ? (
        <Field>
          <FieldLabel>URL contém (opcional)</FieldLabel>
          <Input
            value={value}
            onChange={(e) => onValue(e.target.value)}
            placeholder='Ex.: /precos'
          />
        </Field>
      ) : null}
      <Muted>
        Pontua os leads ligados à pessoa ou ao e-mail do assinante, uma vez por{' '}
        {field === 'newsletter_subscribed' ? 'newsletter' : 'edição'}.
      </Muted>
    </>
  )
}

function NewScoringRuleDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<string>('source')
  const [operator, setOperator] = useState<string>('equals')
  const [value, setValue] = useState('')
  const [points, setPoints] = useState('10')
  const [saving, setSaving] = useState(false)
  const eventRule = isEventField(field)

  async function handleCreate() {
    setSaving(true)
    const result = await createCrmResource(workspaceId, 'lead-scoring-rules', {
      field,
      operator: eventRule ? 'contains' : operator,
      value:
        eventRule && field !== 'newsletter_clicked'
          ? undefined
          : value || undefined,
      points: Number(points) || 0,
      active: true,
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível criar a regra.')
      return
    }
    notify.success('Regra de pontuação criada')
    setOpen(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='sm' variant='outline'>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
            Nova regra
          </Button>
        }
      />
      <DialogContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Campo</FieldLabel>
            <Select value={field} onValueChange={(v) => setField(v ?? field)}>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {FIELD_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FIELD_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  {EVENT_FIELD_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {EVENT_FIELD_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {eventRule ? (
            <EventRuleHint field={field} value={value} onValue={setValue} />
          ) : null}
          <Field className={eventRule ? 'hidden' : undefined}>
            <FieldLabel>Operador</FieldLabel>
            <Select
              value={operator}
              onValueChange={(v) => setOperator(v ?? operator)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {OPERATOR_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {OPERATOR_LABEL[o]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {!eventRule &&
          operator !== 'is_empty' &&
          operator !== 'is_not_empty' ? (
            <Field>
              <FieldLabel>Valor</FieldLabel>
              <Input value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Pontos</FieldLabel>
            <Input
              type='number'
              value={points}
              onChange={(e) => setPoints(e.target.value)}
            />
          </Field>
        </FieldGroup>
        <div className='mt-4 flex justify-end gap-2'>
          <DialogClose render={<Button variant='ghost'>Cancelar</Button>} />
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? 'Criando...' : 'Criar regra'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewRoutingRuleDialog({
  workspaceId,
  onCreated,
}: {
  workspaceId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<string>('source')
  const [operator, setOperator] = useState<string>('equals')
  const [value, setValue] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [saving, setSaving] = useState(false)
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const users = lookups.options.users ?? []

  async function handleCreate() {
    if (!ownerId) return
    setSaving(true)
    const result = await createCrmResource(workspaceId, 'lead-routing-rules', {
      field,
      operator,
      value: value || undefined,
      ownerId,
      active: true,
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível criar a regra.')
      return
    }
    notify.success('Regra de roteamento criada')
    setOpen(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size='sm' variant='outline'>
            <SteelIcon icon={PlusSignIcon} strokeWidth={2} size={14} />
            Nova regra
          </Button>
        }
      />
      <DialogContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Campo</FieldLabel>
            <Select value={field} onValueChange={(v) => setField(v ?? field)}>
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {FIELD_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {FIELD_LABEL[f]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Operador</FieldLabel>
            <Select
              value={operator}
              onValueChange={(v) => setOperator(v ?? operator)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {OPERATOR_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {OPERATOR_LABEL[o]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {operator !== 'is_empty' && operator !== 'is_not_empty' ? (
            <Field>
              <FieldLabel>Valor</FieldLabel>
              <Input value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel>Responsável</FieldLabel>
            <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? '')}>
              <SelectTrigger className='w-full'>
                <SelectValue placeholder='Selecione' />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {users.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <div className='mt-4 flex justify-end gap-2'>
          <DialogClose render={<Button variant='ghost'>Cancelar</Button>} />
          <Button onClick={handleCreate} disabled={saving || !ownerId}>
            {saving ? 'Criando...' : 'Criar regra'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CrmLeadRulesSection({ workspaceId }: { workspaceId: string }) {
  const {
    items: scoringRules,
    isLoading: loadingScoring,
    refetch: refetchScoring,
  } = useCrmResourceList<CrmLeadScoringRuleDTO>(
    workspaceId,
    'lead-scoring-rules',
  )
  const {
    items: routingRules,
    isLoading: loadingRouting,
    refetch: refetchRouting,
  } = useCrmResourceList<CrmLeadRoutingRuleDTO>(
    workspaceId,
    'lead-routing-rules',
  )
  const { lookups } = useCrmWorkspaceLookups(workspaceId, LOOKUP_KINDS)
  const usersById = new Map(
    lookups.options.users.map((u) => [u.value, u.label]),
  )

  async function handleDeleteScoring(id: string) {
    const result = await deleteCrmResource(
      workspaceId,
      'lead-scoring-rules',
      id,
    )
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível excluir a regra.')
      return
    }
    refetchScoring()
  }

  async function handleDeleteRouting(id: string) {
    const result = await deleteCrmResource(
      workspaceId,
      'lead-routing-rules',
      id,
    )
    if (!result.ok) {
      notify.error(result.message ?? 'Não foi possível excluir a regra.')
      return
    }
    refetchRouting()
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>Pontuação de leads</CardTitle>
          <NewScoringRuleDialog
            workspaceId={workspaceId}
            onCreated={refetchScoring}
          />
        </CardHeader>
        <CardContent>
          {loadingScoring ? (
            <Muted>Carregando...</Muted>
          ) : scoringRules.length === 0 ? (
            <Muted>Nenhuma regra de pontuação ainda.</Muted>
          ) : (
            <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
              <Table containerClassName='overflow-x-visible'>
                <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
                  <TableRow>
                    <TableHead>Condição</TableHead>
                    <TableHead>Pontos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scoringRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <ConditionSummary
                          field={rule.field}
                          operator={rule.operator}
                          value={rule.value}
                        />
                      </TableCell>
                      <TableCell>{rule.points}</TableCell>
                      <TableCell>
                        <Badge variant={rule.active ? 'default' : 'secondary'}>
                          {rule.active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label='Excluir regra'
                          onClick={() => handleDeleteScoring(rule.id)}
                        >
                          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>Roteamento de leads</CardTitle>
          <NewRoutingRuleDialog
            workspaceId={workspaceId}
            onCreated={refetchRouting}
          />
        </CardHeader>
        <CardContent>
          {loadingRouting ? (
            <Muted>Carregando...</Muted>
          ) : routingRules.length === 0 ? (
            <Muted>Nenhuma regra de roteamento ainda.</Muted>
          ) : (
            <div className='max-h-[26rem] overflow-auto rounded-lg border border-border'>
              <Table containerClassName='overflow-x-visible'>
                <TableHeader className='sticky top-0 z-10 bg-card/85 backdrop-blur-md'>
                  <TableRow>
                    <TableHead>Condição</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className='text-right'>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routingRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <ConditionSummary
                          field={rule.field}
                          operator={rule.operator}
                          value={rule.value}
                        />
                      </TableCell>
                      <TableCell>
                        {usersById.get(rule.ownerId) ?? rule.ownerId}
                      </TableCell>
                      <TableCell>
                        <Badge variant={rule.active ? 'default' : 'secondary'}>
                          {rule.active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label='Excluir regra'
                          onClick={() => handleDeleteRouting(rule.id)}
                        >
                          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
