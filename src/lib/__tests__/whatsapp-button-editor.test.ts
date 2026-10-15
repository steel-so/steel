import { describe, expect, it } from 'vitest'
import {
  BUTTON_ACTION_OPTIONS,
  buttonActionLabel,
  changeButtonType,
  emptyButtonAction,
  headerMediaProblem,
  moveItem,
  newButton,
  nextButtonId,
  normalizeButtons,
  quickReplyProviderNotes,
  TEMPLATE_HEADER_OPTIONS,
  TEMPLATE_QUALITY,
  TEMPLATE_STATUS_LABEL,
  validateButtons,
} from '@/src/lib/whatsapp/button-editor'
import {
  WHATSAPP_BUTTON_ACTION_KINDS,
  type WhatsAppButtonAction,
} from '@/src/schemas/whatsapp-button.schema'
import type { WhatsAppButtonDTO } from '@/types/whatsapp-button'

const reply = (
  label: string,
  actions: WhatsAppButtonAction[] = [],
  id = 'b1',
): WhatsAppButtonDTO => ({ id, type: 'REPLY', label, actions })
const link = (label: string, url: string, id = 'b2'): WhatsAppButtonDTO => ({
  id,
  type: 'URL',
  label,
  url,
})

describe('button actions catalog', () => {
  it('offers every action kind of the contract, with pt-BR labels', () => {
    expect(BUTTON_ACTION_OPTIONS.map((o) => o.kind)).toEqual([
      ...WHATSAPP_BUTTON_ACTION_KINDS,
    ])
    expect(buttonActionLabel('ASSIGN_TEAM')).toBe('Mover para uma equipe')
    expect(buttonActionLabel('NOPE' as never)).toBe('NOPE')
  })

  it.each(WHATSAPP_BUTTON_ACTION_KINDS.map((kind) => [kind]))(
    'creates an empty %s action',
    (kind) => {
      expect(emptyButtonAction(kind).kind).toBe(kind)
    },
  )

  it('defaults a status action to closing', () => {
    expect(emptyButtonAction('SET_STATUS')).toEqual({
      kind: 'SET_STATUS',
      status: 'CLOSED',
    })
  })
})

describe('buttons', () => {
  it('picks the first free positional id', () => {
    expect(nextButtonId([])).toBe('b1')
    expect(nextButtonId([reply('a', [], 'b1'), link('b', 'x', 'b3')])).toBe(
      'b2',
    )
  })

  it('creates reply and link buttons', () => {
    expect(newButton('REPLY', [])).toEqual(reply(''))
    expect(newButton('URL', [reply('a')])).toEqual(link('', '', 'b2'))
  })

  it('switches type keeping id and label', () => {
    const button = reply('Ok', [{ kind: 'REPLY', text: 'x' }])
    expect(changeButtonType(button, 'REPLY')).toBe(button)
    expect(changeButtonType(button, 'URL')).toEqual(link('Ok', '', 'b1'))
    expect(changeButtonType(link('Site', 'https://x'), 'REPLY')).toEqual(
      reply('Site', [], 'b2'),
    )
  })

  it('moves items, clamping the target', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 7, 0)).toEqual(['a', 'b'])
  })
})

describe('validateButtons', () => {
  it('accepts valid buttons and no buttons', () => {
    expect(validateButtons([])).toBeNull()
    expect(
      validateButtons([
        reply('Sim', [
          { kind: 'REPLY', text: 'ok' },
          { kind: 'ASSIGN_USER', userId: 'u' },
          { kind: 'ASSIGN_TEAM', teamId: 't' },
          { kind: 'SET_STATUS', status: 'CLOSED' },
          { kind: 'CRM_WORKFLOW', workflowId: 'w' },
        ]),
        link('Site', 'https://x.test'),
      ]),
    ).toBeNull()
  })

  it('caps buttons, labels and actions', () => {
    expect(validateButtons([reply('a'), reply('b'), reply('c')])).toBe(
      'Use no máximo 2 botões',
    )
    expect(validateButtons([reply('  ')])).toBe(
      'Botão 1: informe o texto do botão',
    )
    expect(validateButtons([reply('x'.repeat(21))])).toBe(
      'Botão 1: o texto pode ter até 20 caracteres',
    )
    const six = Array.from({ length: 6 }, () => ({
      kind: 'REPLY' as const,
      text: 'a',
    }))
    expect(validateButtons([reply('a', six)])).toBe(
      'Botão 1: use no máximo 5 ações',
    )
  })

  it('checks links and duplicated labels', () => {
    expect(validateButtons([link('Site', 'nope')])).toBe(
      'Botão 1: informe um link válido (https://…)',
    )
    expect(validateButtons([link('Site', 'ftp://x.test')])).toBe(
      'Botão 1: informe um link válido (https://…)',
    )
    expect(validateButtons([reply('Sim'), reply(' sim ', [], 'b2')])).toBe(
      'Os botões precisam ter textos diferentes',
    )
  })

  it.each([
    [{ kind: 'REPLY', text: ' ' }, 'escreva a resposta'],
    [{ kind: 'ASSIGN_USER', userId: '' }, 'escolha o atendente'],
    [{ kind: 'ASSIGN_TEAM', teamId: '' }, 'escolha a equipe'],
    [{ kind: 'CRM_WORKFLOW', workflowId: '' }, 'escolha o workflow'],
    [
      { kind: 'HTTP_WEBHOOK', url: 'http://x.test' },
      'informe uma URL https válida',
    ],
    [{ kind: 'HTTP_WEBHOOK', url: 'https://' }, 'informe uma URL https válida'],
    [{ kind: 'AI_INSTRUCTION', instruction: '' }, 'escreva a instrução'],
  ] as Array<[WhatsAppButtonAction, string]>)(
    'explains an incomplete %o',
    (action, problem) => {
      expect(validateButtons([reply('Sim', [action])])).toBe(
        `Botão 1, ação 1: ${problem}`,
      )
    },
  )
})

describe('normalizeButtons', () => {
  it('trims and drops empty optional fields', () => {
    expect(
      normalizeButtons([
        reply(' Sim ', [
          { kind: 'HTTP_WEBHOOK', url: ' https://x.test/h ', secret: ' ' },
          { kind: 'HTTP_WEBHOOK', url: 'https://x.test/h', secret: ' k ' },
          { kind: 'SET_STATUS', status: 'CLOSED', reason: '  ' },
          { kind: 'SET_STATUS', status: 'CLOSED', reason: ' fim ' },
          { kind: 'REPLY', text: ' oi ' },
        ]),
        link(' Site ', ' https://x.test '),
      ]),
    ).toEqual([
      reply('Sim', [
        { kind: 'HTTP_WEBHOOK', url: 'https://x.test/h' },
        { kind: 'HTTP_WEBHOOK', url: 'https://x.test/h', secret: 'k' },
        { kind: 'SET_STATUS', status: 'CLOSED' },
        { kind: 'SET_STATUS', status: 'CLOSED', reason: 'fim' },
        { kind: 'REPLY', text: 'oi' },
      ]),
      link('Site', 'https://x.test'),
    ])
  })
})

describe('quickReplyProviderNotes', () => {
  it('is empty without buttons', () => {
    expect(quickReplyProviderNotes([])).toEqual([])
  })

  it('warns about Z-API and the Meta window, plus the reply + link mix', () => {
    expect(quickReplyProviderNotes([reply('a')])).toHaveLength(2)
    const mixed = quickReplyProviderNotes([reply('a'), link('b', 'https://x')])
    expect(mixed).toHaveLength(3)
    expect(mixed[2]).toContain('não dá para misturar')
  })
})

describe('template header media', () => {
  it('lists the header choices', () => {
    expect(TEMPLATE_HEADER_OPTIONS.map((o) => o.value)).toEqual([
      'NONE',
      'TEXT',
      'IMAGE',
      'VIDEO',
      'DOCUMENT',
    ])
  })

  it('accepts files of the right type and size only', () => {
    expect(headerMediaProblem('IMAGE', { type: 'image/png', size: 10 })).toBe(
      null,
    )
    expect(headerMediaProblem('VIDEO', { type: 'image/png', size: 10 })).toBe(
      'Formato não aceito: MP4, até 16 MB',
    )
    expect(
      headerMediaProblem('DOCUMENT', {
        type: 'application/pdf',
        size: 17 * 1024 * 1024,
      }),
    ).toBe('Arquivo grande demais: PDF, até 16 MB')
  })
})

describe('template quality and status', () => {
  it('describes every level and status in pt-BR', () => {
    expect(TEMPLATE_QUALITY.YELLOW.label).toBe('Qualidade média')
    expect(TEMPLATE_QUALITY.RED.description).toContain('Evite enviar')
    expect(TEMPLATE_STATUS_LABEL.PAUSED).toBe('Pausado')
  })
})
