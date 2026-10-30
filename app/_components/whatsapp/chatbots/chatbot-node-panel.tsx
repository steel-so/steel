'use client'

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  NODE_TYPE_DESCRIPTION,
  NODE_TYPE_LABEL,
  OPERATOR_LABEL,
  OPERATORS_WITHOUT_VALUE,
  randomId,
  VALIDATION_LABEL,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import {
  CHATBOT_CONDITION_OPERATORS,
  CHATBOT_LIMITS,
  CHATBOT_QUESTION_VALIDATIONS,
  type ChatbotConditionOperator,
  type ChatbotNode,
  type ChatbotNodeOf,
  type ChatbotQuestionValidation,
} from '@/src/schemas/whatsapp-chatbot.schema'
import { SimpleSelect } from './chatbot-select'

export interface PanelAgent {
  id: string
  name: string
}
export interface PanelTeam {
  id: string
  name: string
}
/** A WhatsApp Flow (Z3) the "send form" block can pick. */
export interface PanelFlow {
  id: string
  name: string
  /** Published at Meta and not retired: the only ones that can be sent. */
  sendable: boolean
}

interface PanelProps {
  node: ChatbotNode
  variables: string[]
  teams: PanelTeam[]
  agents: PanelAgent[]
  /** Forms of the workspace; empty while loading or when there are none. */
  flows?: PanelFlow[]
  readOnly: boolean
  onChange: (data: ChatbotNode['data']) => void
  onDelete: () => void
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/** Textarea with chips that append `{{variable}}` to the text. */
function TextWithVariables({
  id,
  value,
  variables,
  onChange,
  disabled,
  rows = 4,
}: {
  id: string
  value: string
  variables: string[]
  onChange: (value: string) => void
  disabled: boolean
  rows?: number
}) {
  return (
    <div className='space-y-1.5'>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={CHATBOT_LIMITS.text}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className='flex flex-wrap items-center gap-1'>
        <span className='text-muted-foreground text-xs'>Variáveis:</span>
        {variables.map((name) => (
          <button
            key={name}
            type='button'
            disabled={disabled}
            onClick={() => onChange(`${value}{{${name}}}`)}
          >
            <Badge variant='outline'>{`{{${name}}}`}</Badge>
          </button>
        ))}
      </div>
    </div>
  )
}

const VARIABLE_HINT =
  'Letras minúsculas, números e _ (começa por letra). Use {{nome}} nas mensagens.'

function MenuForm({
  node,
  variables,
  readOnly,
  onChange,
}: PanelProps & { node: ChatbotNodeOf<'menu'> }) {
  const { data } = node
  const patch = (next: Partial<typeof data>) => onChange({ ...data, ...next })
  const move = (index: number, delta: number) => {
    const options = [...data.options]
    const [item] = options.splice(index, 1)
    options.splice(index + delta, 0, item)
    patch({ options })
  }
  const longLabels = data.options.some(
    (option) => option.label.length > CHATBOT_LIMITS.menuButtonLabelMax,
  )
  return (
    <>
      <Field label='Mensagem do menu' htmlFor='menu-text'>
        <TextWithVariables
          id='menu-text'
          value={data.text}
          variables={variables}
          disabled={readOnly}
          onChange={(text) => patch({ text })}
        />
      </Field>
      <div className='space-y-2'>
        <Label>
          Opções ({data.options.length}/{CHATBOT_LIMITS.menuOptions.max})
        </Label>
        {data.options.map((option, index) => (
          <div key={option.id} className='flex items-center gap-1'>
            <Input
              aria-label={`Opção ${index + 1}`}
              value={option.label}
              maxLength={60}
              disabled={readOnly}
              onChange={(event) =>
                patch({
                  options: data.options.map((item) =>
                    item.id === option.id
                      ? { ...item, label: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label='Subir opção'
              disabled={readOnly || index === 0}
              onClick={() => move(index, -1)}
            >
              <SteelIcon icon={ArrowUp01Icon} strokeWidth={2} />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label='Descer opção'
              disabled={readOnly || index === data.options.length - 1}
              onClick={() => move(index, 1)}
            >
              <SteelIcon icon={ArrowDown01Icon} strokeWidth={2} />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label='Remover opção'
              disabled={
                readOnly ||
                data.options.length <= CHATBOT_LIMITS.menuOptions.min
              }
              onClick={() =>
                patch({
                  options: data.options.filter((item) => item.id !== option.id),
                })
              }
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
        ))}
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={
            readOnly || data.options.length >= CHATBOT_LIMITS.menuOptions.max
          }
          onClick={() =>
            patch({
              options: [
                ...data.options,
                {
                  id: randomId('o'),
                  label: `Opção ${data.options.length + 1}`,
                },
              ],
            })
          }
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
          Adicionar opção
        </Button>
        <p className='text-muted-foreground text-xs'>
          {data.options.length <= CHATBOT_LIMITS.menuButtonsMax && !longLabels
            ? 'Vai como botões de resposta.'
            : `Vai como lista numerada (botões só com até ${CHATBOT_LIMITS.menuButtonsMax} opções de ${CHATBOT_LIMITS.menuButtonLabelMax} caracteres).`}
        </p>
      </div>
      <Field
        label='Guardar a escolha em (opcional)'
        htmlFor='menu-variable'
        hint={VARIABLE_HINT}
      >
        <Input
          id='menu-variable'
          value={data.variable ?? ''}
          maxLength={32}
          disabled={readOnly}
          onChange={(event) =>
            patch({ variable: event.target.value || undefined })
          }
        />
      </Field>
      <Field
        label='Tentativas antes da saída “inválida”'
        htmlFor='menu-attempts'
      >
        <Input
          id='menu-attempts'
          type='number'
          min={CHATBOT_LIMITS.attempts.min}
          max={CHATBOT_LIMITS.attempts.max}
          value={data.maxAttempts}
          disabled={readOnly}
          onChange={(event) =>
            patch({
              maxAttempts: clampAttempts(Number(event.target.value)),
            })
          }
        />
      </Field>
    </>
  )
}

function clampAttempts(value: number): number {
  return Math.min(
    CHATBOT_LIMITS.attempts.max,
    Math.max(CHATBOT_LIMITS.attempts.min, Math.round(value) || 1),
  )
}

function QuestionForm({
  node,
  variables,
  readOnly,
  onChange,
}: PanelProps & { node: ChatbotNodeOf<'question'> }) {
  const { data } = node
  const patch = (next: Partial<typeof data>) => onChange({ ...data, ...next })
  return (
    <>
      <Field label='Pergunta' htmlFor='question-text'>
        <TextWithVariables
          id='question-text'
          value={data.text}
          variables={variables}
          disabled={readOnly}
          onChange={(text) => patch({ text })}
        />
      </Field>
      <Field
        label='Guardar a resposta em'
        htmlFor='question-variable'
        hint={VARIABLE_HINT}
      >
        <Input
          id='question-variable'
          value={data.variable}
          maxLength={32}
          disabled={readOnly}
          onChange={(event) => patch({ variable: event.target.value })}
        />
      </Field>
      <Field label='Tipo de resposta'>
        <SimpleSelect
          ariaLabel='Tipo de resposta'
          value={data.validation}
          disabled={readOnly}
          options={CHATBOT_QUESTION_VALIDATIONS.map((value) => ({
            value,
            label: VALIDATION_LABEL[value],
          }))}
          onChange={(value) =>
            patch({ validation: value as ChatbotQuestionValidation })
          }
        />
      </Field>
      <Field
        label='Mensagem quando a resposta for inválida (opcional)'
        htmlFor='question-error'
      >
        <Textarea
          id='question-error'
          rows={2}
          maxLength={CHATBOT_LIMITS.text}
          value={data.errorText ?? ''}
          disabled={readOnly}
          onChange={(event) =>
            patch({ errorText: event.target.value || undefined })
          }
        />
      </Field>
      <Field label='Tentativas' htmlFor='question-attempts'>
        <Input
          id='question-attempts'
          type='number'
          min={CHATBOT_LIMITS.attempts.min}
          max={CHATBOT_LIMITS.attempts.max}
          value={data.maxAttempts}
          disabled={readOnly}
          onChange={(event) =>
            patch({ maxAttempts: clampAttempts(Number(event.target.value)) })
          }
        />
      </Field>
    </>
  )
}

function ConditionForm({
  node,
  variables,
  readOnly,
  onChange,
}: PanelProps & { node: ChatbotNodeOf<'condition'> }) {
  const { data } = node
  const update = (id: string, next: Partial<(typeof data.branches)[number]>) =>
    onChange({
      branches: data.branches.map((branch) =>
        branch.id === id ? { ...branch, ...next } : branch,
      ),
    })
  return (
    <div className='space-y-3'>
      <Label>
        Ramos ({data.branches.length}/{CHATBOT_LIMITS.conditionBranches.max})
      </Label>
      <p className='text-muted-foreground text-xs'>
        O primeiro ramo verdadeiro vence; se nenhum servir, segue pela saída
        “Senão”.
      </p>
      {data.branches.map((branch, index) => (
        <div key={branch.id} className='space-y-2 rounded-lg border p-3'>
          <div className='flex items-center justify-between'>
            <span className='font-medium text-sm'>Se {index + 1}</span>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label='Remover ramo'
              disabled={
                readOnly ||
                data.branches.length <= CHATBOT_LIMITS.conditionBranches.min
              }
              onClick={() =>
                onChange({
                  branches: data.branches.filter(
                    (item) => item.id !== branch.id,
                  ),
                })
              }
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
          <SimpleSelect
            ariaLabel='Variável'
            value={branch.variable}
            disabled={readOnly}
            options={Array.from(new Set([...variables, branch.variable])).map(
              (name) => ({ value: name, label: name }),
            )}
            onChange={(variable) => update(branch.id, { variable })}
          />
          <SimpleSelect
            ariaLabel='Operador'
            value={branch.operator}
            disabled={readOnly}
            options={CHATBOT_CONDITION_OPERATORS.map((value) => ({
              value,
              label: OPERATOR_LABEL[value],
            }))}
            onChange={(operator) =>
              update(branch.id, {
                operator: operator as ChatbotConditionOperator,
              })
            }
          />
          {OPERATORS_WITHOUT_VALUE.has(branch.operator) ? null : (
            <Input
              aria-label='Valor'
              value={branch.value}
              maxLength={256}
              placeholder='Valor'
              disabled={readOnly}
              onChange={(event) =>
                update(branch.id, { value: event.target.value })
              }
            />
          )}
        </div>
      ))}
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={
          readOnly ||
          data.branches.length >= CHATBOT_LIMITS.conditionBranches.max
        }
        onClick={() =>
          onChange({
            branches: [
              ...data.branches,
              {
                id: randomId('c'),
                variable: variables[0] ?? 'last_message',
                operator: 'equals',
                value: '',
              },
            ],
          })
        }
      >
        <SteelIcon icon={PlusSignIcon} strokeWidth={2} />
        Adicionar ramo
      </Button>
    </div>
  )
}

function WebhookForm({
  node,
  readOnly,
  onChange,
}: PanelProps & { node: ChatbotNodeOf<'webhook'> }) {
  const { data } = node
  const patch = (next: Partial<typeof data>) => onChange({ ...data, ...next })
  return (
    <>
      <p className='rounded-lg bg-muted p-3 text-muted-foreground text-xs'>
        Só endereços públicos com HTTPS. A chamada espera até 8 segundos e não
        segue redirecionamentos. Se falhar, o fluxo segue pela saída “Se der
        erro”.
      </p>
      <Field label='Endereço (URL)' htmlFor='webhook-url'>
        <Input
          id='webhook-url'
          type='url'
          value={data.url}
          maxLength={2048}
          disabled={readOnly}
          onChange={(event) => patch({ url: event.target.value })}
        />
      </Field>
      <Field label='Método'>
        <SimpleSelect
          ariaLabel='Método'
          value={data.method}
          disabled={readOnly}
          options={[
            { value: 'POST', label: 'POST (envia JSON)' },
            { value: 'GET', label: 'GET' },
          ]}
          onChange={(method) => patch({ method: method as 'GET' | 'POST' })}
        />
      </Field>
      {data.method === 'POST' ? (
        <Field
          label='Corpo (JSON)'
          htmlFor='webhook-body'
          hint='Use {{variavel}} dentro dos textos para enviar o que o contato respondeu.'
        >
          <Textarea
            id='webhook-body'
            rows={5}
            className='font-mono text-xs'
            maxLength={4096}
            value={data.body ?? ''}
            disabled={readOnly}
            onChange={(event) =>
              patch({ body: event.target.value || undefined })
            }
          />
        </Field>
      ) : null}
      <Field
        label='Caminho na resposta (opcional)'
        htmlFor='webhook-path'
        hint='Ex.: data.protocolo — lê esse campo da resposta JSON.'
      >
        <Input
          id='webhook-path'
          value={data.responsePath ?? ''}
          maxLength={128}
          disabled={readOnly}
          onChange={(event) =>
            patch({ responsePath: event.target.value || undefined })
          }
        />
      </Field>
      <Field
        label='Guardar o valor em (opcional)'
        htmlFor='webhook-variable'
        hint={VARIABLE_HINT}
      >
        <Input
          id='webhook-variable'
          value={data.responseVariable ?? ''}
          maxLength={32}
          disabled={readOnly}
          onChange={(event) =>
            patch({ responseVariable: event.target.value || undefined })
          }
        />
      </Field>
    </>
  )
}

function SendFormForm({
  node,
  variables,
  flows = [],
  readOnly,
  onChange,
}: PanelProps & { node: ChatbotNodeOf<'send-form'> }) {
  const { data } = node
  const patch = (next: Partial<typeof data>) => onChange({ ...data, ...next })
  const sendable = flows.filter((flow) => flow.sendable)
  const current = flows.find((flow) => flow.id === data.flowId)
  const options = [
    { value: '', label: 'Escolha o formulário' },
    ...sendable.map((flow) => ({ value: flow.id, label: flow.name })),
    // A form picked earlier that cannot be sent anymore stays visible.
    ...(current && !current.sendable
      ? [{ value: current.id, label: `${current.name} (indisponível)` }]
      : []),
  ]
  return (
    <>
      <p className='rounded-lg bg-muted p-3 text-muted-foreground text-xs'>
        Envia um formulário do WhatsApp (Flow) já preenchido com o nome e o
        telefone do contato. O bot segue para o próximo bloco sem esperar a
        resposta: ela chega ao contato, ao CRM e à aba Respostas do formulário.
        Funciona só em conexões da API oficial da Meta.
      </p>
      <Field label='Formulário'>
        <SimpleSelect
          ariaLabel='Formulário'
          value={data.flowId}
          disabled={readOnly}
          options={options}
          onChange={(flowId) => patch({ flowId })}
        />
        {sendable.length === 0 ? (
          <p className='text-muted-foreground text-xs'>
            Nenhum formulário publicado. Crie e publique um em Formulários.
          </p>
        ) : null}
      </Field>
      <Field
        label='Mensagem (opcional)'
        htmlFor='form-body'
        hint='Em branco, vale a mensagem do próprio formulário.'
      >
        <TextWithVariables
          id='form-body'
          value={data.bodyText ?? ''}
          variables={variables}
          disabled={readOnly}
          onChange={(bodyText) => patch({ bodyText: bodyText || undefined })}
        />
      </Field>
      <Field
        label='Texto do botão (opcional)'
        htmlFor='form-cta'
        hint='Até 30 caracteres. Em branco, vale o do formulário.'
      >
        <Input
          id='form-cta'
          value={data.ctaLabel ?? ''}
          maxLength={30}
          disabled={readOnly}
          onChange={(event) =>
            patch({ ctaLabel: event.target.value || undefined })
          }
        />
      </Field>
      <Field
        label='Se o formulário não puder ser enviado (opcional)'
        htmlFor='form-fallback'
        hint='Texto enviado no lugar, por exemplo com um link. Vale para linhas Z-API e formulários descontinuados.'
      >
        <TextWithVariables
          id='form-fallback'
          value={data.fallbackText ?? ''}
          variables={variables}
          disabled={readOnly}
          onChange={(fallbackText) =>
            patch({ fallbackText: fallbackText || undefined })
          }
        />
      </Field>
    </>
  )
}

function HandoffHumanForm({
  node,
  variables,
  teams,
  agents,
  readOnly,
  onChange,
}: PanelProps & { node: ChatbotNodeOf<'handoff-human'> }) {
  const { data } = node
  const patch = (next: Partial<typeof data>) => onChange({ ...data, ...next })
  return (
    <>
      <Field label='Mensagem ao contato (opcional)' htmlFor='handoff-text'>
        <TextWithVariables
          id='handoff-text'
          value={data.text ?? ''}
          variables={variables}
          disabled={readOnly}
          onChange={(text) => patch({ text: text || undefined })}
        />
      </Field>
      <Field label='Equipe'>
        <SimpleSelect
          ariaLabel='Equipe'
          value={data.teamId ?? ''}
          disabled={readOnly}
          options={[
            { value: '', label: 'Fila geral de atendimento' },
            ...teams.map((team) => ({ value: team.id, label: team.name })),
          ]}
          onChange={(teamId) => patch({ teamId: teamId || undefined })}
        />
      </Field>
      <Field
        label='Atendente específico (opcional)'
        hint='Se escolher um atendente, ele recebe a conversa direto e a equipe é ignorada.'
      >
        <SimpleSelect
          ariaLabel='Atendente'
          value={data.userId ?? ''}
          disabled={readOnly}
          options={[
            { value: '', label: 'Nenhum — usar a equipe ou a fila' },
            ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
          onChange={(userId) => patch({ userId: userId || undefined })}
        />
      </Field>
    </>
  )
}

function Body(props: PanelProps) {
  const { node, variables, readOnly, onChange } = props
  switch (node.type) {
    case 'start':
      return (
        <p className='text-muted-foreground text-sm'>
          Ligue a saída deste bloco ao primeiro passo do fluxo.
        </p>
      )
    case 'message':
      return (
        <Field label='Mensagem' htmlFor='message-text'>
          <TextWithVariables
            id='message-text'
            value={node.data.text}
            variables={variables}
            disabled={readOnly}
            onChange={(text) => onChange({ text })}
          />
        </Field>
      )
    case 'menu':
      return <MenuForm {...props} node={node} />
    case 'question':
      return <QuestionForm {...props} node={node} />
    case 'condition':
      return <ConditionForm {...props} node={node} />
    case 'set-variable':
      return (
        <>
          <Field label='Variável' htmlFor='setvar-name' hint={VARIABLE_HINT}>
            <Input
              id='setvar-name'
              value={node.data.variable}
              maxLength={32}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ ...node.data, variable: event.target.value })
              }
            />
          </Field>
          <Field label='Valor' htmlFor='setvar-value'>
            <Input
              id='setvar-value'
              value={node.data.value}
              maxLength={512}
              disabled={readOnly}
              onChange={(event) =>
                onChange({ ...node.data, value: event.target.value })
              }
            />
          </Field>
        </>
      )
    case 'webhook':
      return <WebhookForm {...props} node={node} />
    case 'send-form':
      return <SendFormForm {...props} node={node} />
    case 'handoff-human':
      return <HandoffHumanForm {...props} node={node} />
    case 'handoff-ai':
      return (
        <>
          <Field label='Mensagem ao contato (opcional)' htmlFor='ai-text'>
            <TextWithVariables
              id='ai-text'
              value={node.data.text ?? ''}
              variables={variables}
              disabled={readOnly}
              onChange={(text) =>
                onChange({ ...node.data, text: text || undefined })
              }
            />
          </Field>
          <Field
            label='Instrução para a IA (opcional)'
            htmlFor='ai-instruction'
            hint='Vale só para a primeira resposta. Se a IA do Comunicação estiver desligada, a conversa vai para a fila.'
          >
            <Textarea
              id='ai-instruction'
              rows={3}
              maxLength={1000}
              value={node.data.instruction ?? ''}
              disabled={readOnly}
              onChange={(event) =>
                onChange({
                  ...node.data,
                  instruction: event.target.value || undefined,
                })
              }
            />
          </Field>
        </>
      )
    case 'end':
      return (
        <>
          <Field label='Mensagem final (opcional)' htmlFor='end-text'>
            <TextWithVariables
              id='end-text'
              value={node.data.text ?? ''}
              variables={variables}
              disabled={readOnly}
              onChange={(text) =>
                onChange({ ...node.data, text: text || undefined })
              }
            />
          </Field>
          <div className='flex items-center justify-between gap-3'>
            <Label htmlFor='end-close'>Fechar a conversa ao encerrar</Label>
            <Switch
              id='end-close'
              checked={node.data.closeConversation}
              disabled={readOnly}
              onCheckedChange={(closeConversation) =>
                onChange({ ...node.data, closeConversation })
              }
            />
          </div>
        </>
      )
  }
}

/** Right-hand form of the selected block. */
export function ChatbotNodePanel(props: PanelProps) {
  const { node, readOnly, onDelete } = props
  return (
    <div className='flex h-full flex-col gap-4 overflow-y-auto p-4'>
      <div>
        <h2 className='font-semibold text-base'>
          {NODE_TYPE_LABEL[node.type]}
        </h2>
        <p className='text-muted-foreground text-xs'>
          {NODE_TYPE_DESCRIPTION[node.type]}
        </p>
      </div>
      <Body {...props} />
      {node.type !== 'start' && !readOnly ? (
        <Button
          type='button'
          variant='outline'
          className='mt-auto text-destructive'
          onClick={onDelete}
        >
          <SteelIcon icon={Delete02Icon} strokeWidth={2} />
          Excluir bloco
        </Button>
      ) : null}
    </div>
  )
}
