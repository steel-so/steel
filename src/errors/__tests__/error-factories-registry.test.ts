import { describe, expect, it } from 'vitest'
import * as factories from '@/src/errors/app-error'
import {
  type AppError,
  aiQuotaExceeded,
  backupNotRestorable,
  crmScheduledPostInvalid,
  crmSocialOauthFailed,
  crmWorkflowExecutionFailed,
  crmWorkflowInvalidDefinition,
  whatsappConversationLimitReached,
  whatsappMessageLimitReached,
  workspaceStatusConflict,
} from '@/src/errors/app-error'
import { ERROR_CODES } from '@/src/errors/codes'

type Factory = (...args: unknown[]) => AppError

// Todas as factories exportadas, exceto o construtor genérico `appError`.
const entries = Object.entries(factories).filter(
  (entry): entry is [string, Factory] =>
    typeof entry[1] === 'function' && entry[0] !== 'appError',
)

// Factories cujo primeiro parâmetro é uma mensagem com valor padrão.
const withDefaultMessage = entries.filter(([, fn]) =>
  /^\(?\s*message\s*=/.test(fn.toString()),
)
// Factories sem parâmetros (mensagem fixa).
const fixedMessage = entries.filter(
  ([, fn]) => fn.length === 0 && !withDefaultMessage.some(([, f]) => f === fn),
)

describe('AppError factories — registry contract', () => {
  it('exposes a large set of factories to check', () => {
    expect(entries.length).toBeGreaterThan(100)
    expect(withDefaultMessage.length).toBeGreaterThan(10)
    expect(fixedMessage.length).toBeGreaterThan(50)
  })

  // Factories cujo primeiro argumento não é texto.
  const numericArgs: Record<string, unknown[]> = {
    rateLimited: [30, 'Mensagem de teste'],
    aiQuotaExceeded: [1, 2],
    whatsappConversationLimitReached: [1, 2],
    whatsappMessageLimitReached: [1, 2],
    workspaceExportLimitReached: [
      'Mensagem de teste',
      new Date('2026-10-09T03:00:00.000Z'),
    ],
    whiteboardLocked: [
      { name: 'Ana', until: new Date('2026-10-09T03:00:00.000Z') },
    ],
  }

  it.each(entries)(
    '%s() maps to a code registered with an HTTP status',
    (name, fn) => {
      const error = fn(...(numericArgs[name] ?? ['Mensagem de teste']))

      expect(ERROR_CODES).toHaveProperty(error.code)
      expect(ERROR_CODES[error.code].code).toBe(error.code)
      expect(ERROR_CODES[error.code].status).toBeGreaterThanOrEqual(400)
      expect(typeof error.message).toBe('string')
      expect(error.message.length).toBeGreaterThan(0)
    },
  )

  it.each(fixedMessage)(
    '%s() carries a non-empty pt-BR default message',
    (_name, fn) => {
      const error = fn()

      expect(ERROR_CODES).toHaveProperty(error.code)
      expect(error.message.trim().length).toBeGreaterThan(0)
      expect(error).not.toHaveProperty('details')
    },
  )

  it.each(withDefaultMessage)(
    '%s() uses its default message and accepts an override',
    (_name, fn) => {
      const byDefault = fn()
      const overridden = fn('Mensagem customizada')

      expect(byDefault.message.trim().length).toBeGreaterThan(0)
      expect(byDefault.message).not.toBe('Mensagem customizada')
      expect(overridden.message).toBe('Mensagem customizada')
      expect(overridden.code).toBe(byDefault.code)
    },
  )
})

describe('AppError factories — parametrized messages', () => {
  it('formats the AI quota in USD and keeps the raw numbers as details', () => {
    const error = aiQuotaExceeded(12.5, 50)

    expect(error.code).toBe('AI_QUOTA_EXCEEDED')
    expect(error.message).toContain('US$')
    expect(error.message).toContain('12,50')
    expect(error.message).toContain('50,00')
    expect(error.details).toEqual({ usedUsd: 12.5, quotaUsd: 50 })
  })

  it('formats the WhatsApp limits in pt-BR and keeps the raw numbers as details', () => {
    const conversations = whatsappConversationLimitReached(1500, 1500)
    expect(conversations.code).toBe('WHATSAPP_CONVERSATION_LIMIT_REACHED')
    expect(conversations.message).toContain('1.500 de 1.500')
    expect(conversations.details).toEqual({ used: 1500, limit: 1500 })

    const messages = whatsappMessageLimitReached(20000, 20000)
    expect(messages.code).toBe('WHATSAPP_MESSAGE_LIMIT_REACHED')
    expect(messages.message).toContain('20.000 de 20.000')
    expect(messages.details).toEqual({ used: 20000, limit: 20000 })
  })

  it('passes required messages through unchanged', () => {
    expect(workspaceStatusConflict('Já está suspenso')).toEqual({
      code: 'WORKSPACE_STATUS_CONFLICT',
      message: 'Já está suspenso',
    })
    expect(backupNotRestorable('Backup expirado')).toEqual({
      code: 'BACKUP_NOT_RESTORABLE',
      message: 'Backup expirado',
    })
  })

  it('falls back to a generic OAuth failure message', () => {
    expect(crmSocialOauthFailed().message).toBe(
      'Falha ao conectar com a plataforma',
    )
    expect(crmSocialOauthFailed('access_denied').message).toBe('access_denied')
  })

  it('attaches validation details only when provided', () => {
    const issues = [{ path: ['nodes', 0], message: 'inválido' }]

    expect(crmWorkflowInvalidDefinition('Inválido', issues).details).toBe(
      issues,
    )
    expect(crmWorkflowInvalidDefinition()).not.toHaveProperty('details')
    expect(crmWorkflowExecutionFailed('Falhou', { node: 'n1' })).toEqual({
      code: 'CRM_WORKFLOW_EXECUTION_FAILED',
      message: 'Falhou',
      details: { node: 'n1' },
    })
    expect(crmScheduledPostInvalid('Sem alvo', { targets: [] })).toEqual({
      code: 'CRM_SCHEDULED_POST_INVALID',
      message: 'Sem alvo',
      details: { targets: [] },
    })
  })
})
