'use client'

import { type ReactNode, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppTemplates } from '@/src/hooks/use-whatsapp-templates'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'

/**
 * Fields shared by every automation editor that sends a WhatsApp message on
 * its own (CRM workflow node, ServiceDesk automation action): number,
 * approved template and its variables, or free text. The rules the server
 * applies are explained right under the fields.
 */

export interface CrossEngineSendValue {
  connectionId: string
  templateId?: string
  variables: string[]
  text?: string
}

/** Highest `{{n}}` found in the BODY of a template. */
export function templateVariableCount(
  template: Pick<WhatsAppTemplateDTO, 'components'> | undefined,
): number {
  if (!template) return 0
  const body = template.components.find(
    (component) =>
      !!component &&
      typeof component === 'object' &&
      (component as { type?: string }).type === 'BODY',
  ) as { text?: string } | undefined
  let max = 0
  for (const match of body?.text?.matchAll(/\{\{(\d+)\}\}/g) ?? []) {
    max = Math.max(max, Number(match[1]))
  }
  return max
}

/** Copy of the variables padded to `count`, with `index` replaced. */
function setAt(
  variables: string[],
  index: number,
  count: number,
  next: string,
): string[] {
  const out = Array.from({ length: count }, (_, i) => variables[i] ?? '')
  out[index] = next
  return out
}

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm'

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className='space-y-1.5'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      {children}
      {hint && <p className='text-muted-foreground/70 text-xs'>{hint}</p>}
    </div>
  )
}

export function CrossEngineSendFields({
  workspaceId,
  value,
  onChange,
  variablePlaceholder = '{{trigger.record.name}}',
  variableChoices,
}: {
  workspaceId?: string
  value: CrossEngineSendValue
  onChange: (next: CrossEngineSendValue) => void
  /** Example of an expression the engine understands. */
  variablePlaceholder?: string
  /** Fixed choices instead of free expressions (ServiceDesk automation). */
  variableChoices?: { value: string; label: string }[]
}) {
  const connections = useWhatsAppConnections(workspaceId ?? '')
  const templates = useWhatsAppTemplates(workspaceId ?? '')

  const connection = connections.data?.find((c) => c.id === value.connectionId)
  const isMeta = connection?.provider === 'META'
  const available = useMemo(
    () =>
      (templates.data ?? []).filter(
        (t) => t.connectionId === value.connectionId && t.status === 'APPROVED',
      ),
    [templates.data, value.connectionId],
  )
  const template = available.find((t) => t.id === value.templateId)
  const count = templateVariableCount(template)

  if (!workspaceId) {
    return (
      <p className='text-muted-foreground text-sm'>
        Abra o workflow dentro de um workspace para escolher o número.
      </p>
    )
  }
  if (connections.isError) {
    return (
      <p className='text-destructive text-sm'>
        Não foi possível carregar os números de WhatsApp. Recarregue a página e
        tente de novo.
      </p>
    )
  }

  return (
    <div className='space-y-4'>
      <FieldBlock
        label='Número que envia'
        hint={
          connections.data?.length === 0
            ? 'Nenhum número conectado. Conecte um em Ajustes > WhatsApp.'
            : undefined
        }
      >
        <select
          className={SELECT_CLASS}
          value={value.connectionId}
          onChange={(e) =>
            onChange({
              connectionId: e.target.value,
              variables: [],
              templateId: undefined,
              text: value.text,
            })
          }
        >
          <option value=''>Escolha um número</option>
          {(connections.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.phoneNumber})
              {c.status === 'CONNECTED' ? '' : ' - desconectado'}
            </option>
          ))}
        </select>
      </FieldBlock>

      {isMeta && (
        <>
          <FieldBlock
            label='Modelo (template) aprovado'
            hint={
              available.length === 0 && value.connectionId
                ? 'Este número não tem modelo aprovado. Crie e envie um para a Meta em Ajustes > WhatsApp > Modelos.'
                : 'O modelo pode ser enviado a qualquer hora, mesmo depois das 24 horas.'
            }
          >
            <select
              className={SELECT_CLASS}
              value={value.templateId ?? ''}
              onChange={(e) =>
                onChange({
                  ...value,
                  templateId: e.target.value || undefined,
                  variables: [],
                })
              }
            >
              <option value=''>Sem modelo</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
          </FieldBlock>
          {Array.from({ length: count }, (_, index) => index).map((index) => (
            <FieldBlock key={index} label={`Variável {{${index + 1}}}`}>
              {variableChoices ? (
                <select
                  className={SELECT_CLASS}
                  value={value.variables[index] ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      variables: setAt(
                        value.variables,
                        index,
                        count,
                        e.target.value,
                      ),
                    })
                  }
                >
                  <option value=''>Escolha o valor</option>
                  {variableChoices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={value.variables[index] ?? ''}
                  placeholder={variablePlaceholder}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      variables: setAt(
                        value.variables,
                        index,
                        count,
                        e.target.value,
                      ),
                    })
                  }
                />
              )}
            </FieldBlock>
          ))}
        </>
      )}

      {value.connectionId && (
        <FieldBlock
          label={
            isMeta
              ? 'Texto livre (opcional, só dentro das 24 horas)'
              : 'Mensagem'
          }
          hint={
            isMeta
              ? 'Usado quando não há modelo aprovado e o contato escreveu nas últimas 24 horas. Fora da janela, a etapa é pulada.'
              : 'Este número não usa modelos: escreva a mensagem.'
          }
        >
          <textarea
            value={value.text ?? ''}
            onChange={(e) =>
              onChange({ ...value, text: e.target.value || undefined })
            }
            rows={4}
            className='w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm'
          />
        </FieldBlock>
      )}

      <p className='rounded-md bg-muted/40 p-2 text-muted-foreground text-xs'>
        Contatos que pediram para não receber mensagens (LGPD) são ignorados
        automaticamente: a etapa é pulada e o motivo fica registrado.
      </p>
    </div>
  )
}
