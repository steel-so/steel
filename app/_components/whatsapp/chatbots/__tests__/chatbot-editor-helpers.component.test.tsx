import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { chatbotSaveLabel } from '../chatbot-editor'
import { ChatbotCanvasContext, describeTraffic } from '../chatbot-nodes'

const base = {
  dirty: false,
  autosave: 'idle' as const,
  autoSaved: false,
  invalid: false,
  hasUnpublishedChanges: false,
  publishedAt: null,
  publishedVersion: 0,
  formatDate: (value: string) => `em ${value}`,
}

describe('chatbotSaveLabel()', () => {
  it('tells the draft is being saved', () => {
    expect(chatbotSaveLabel({ ...base, dirty: true, autosave: 'saving' })).toBe(
      'Salvando o rascunho…',
    )
  })

  it('tells unsaved changes are about to be saved', () => {
    expect(chatbotSaveLabel({ ...base, dirty: true })).toBe(
      'Alterações não salvas — salvando em instantes',
    )
  })

  it('explains a draft the schema rejects', () => {
    expect(chatbotSaveLabel({ ...base, dirty: true, invalid: true })).toContain(
      'corrija o bloco com erro',
    )
  })

  it('points to the manual save after a failed autosave', () => {
    expect(
      chatbotSaveLabel({ ...base, dirty: true, autosave: 'failed' }),
    ).toContain('Salvar rascunho')
  })

  it('confirms an automatic save, then falls back to the publish state', () => {
    expect(chatbotSaveLabel({ ...base, autoSaved: true })).toBe(
      'Rascunho salvo automaticamente',
    )
    expect(chatbotSaveLabel({ ...base, hasUnpublishedChanges: true })).toBe(
      'Rascunho com alterações não publicadas',
    )
    expect(
      chatbotSaveLabel({
        ...base,
        publishedAt: '2026-11-03',
        publishedVersion: 3,
      }),
    ).toBe('Publicado em em 2026-11-03 · versão 3')
    expect(chatbotSaveLabel(base)).toBe('Ainda não publicado')
  })
})

describe('describeTraffic()', () => {
  it('is empty without traffic', () => {
    expect(describeTraffic(undefined)).toBeNull()
    expect(describeTraffic({ entries: 0, exits: 0 })).toBeNull()
  })

  it('pluralizes and formats the numbers', () => {
    expect(describeTraffic({ entries: 1, exits: 1 })).toEqual({
      entries: '1 entrada',
      exits: '1 saída',
    })
    expect(describeTraffic({ entries: 1200, exits: 0 })).toEqual({
      entries: '1.200 entradas',
      exits: '0 saídas',
    })
  })
})

describe('block traffic on the canvas context', () => {
  it('keeps the defaults when no editor provides it', () => {
    function Probe() {
      return (
        <ChatbotCanvasContext.Consumer>
          {(value) => (
            <span data-testid='probe'>
              {value.traffic.size}/{value.trafficDays}
            </span>
          )}
        </ChatbotCanvasContext.Consumer>
      )
    }
    render(
      <ReactFlowProvider>
        <Probe />
      </ReactFlowProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toBe('0/30')
  })
})
