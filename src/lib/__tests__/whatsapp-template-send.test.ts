import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import {
  applyTemplateSendExtras,
  templateButtons,
  templateHeaderMedia,
} from '../whatsapp/template-send'

const buttonsBlock = {
  type: 'BUTTONS',
  buttons: [
    { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511' },
    { type: 'QUICK_REPLY', text: 'Sim' },
    { type: 'URL', text: 'Site', url: 'https://steel.app' },
  ],
}

describe('templateButtons', () => {
  it('prefers the stored buttons', () => {
    const template = createFakeWhatsAppTemplate({
      components: [buttonsBlock],
      buttons: [{ id: 'yes', type: 'REPLY', label: 'Sim', actions: [] }],
    })
    expect(templateButtons(template)).toEqual([
      { id: 'yes', type: 'REPLY', label: 'Sim', actions: [] },
    ])
  })

  it('derives them from Meta components otherwise', () => {
    const template = createFakeWhatsAppTemplate({ components: [buttonsBlock] })
    expect(templateButtons(template).map((b) => b.id)).toEqual(['b2', 'b3'])
  })
})

describe('templateHeaderMedia', () => {
  it('is null without a media header', () => {
    expect(templateHeaderMedia(createFakeWhatsAppTemplate())).toBeNull()
    expect(
      templateHeaderMedia(
        createFakeWhatsAppTemplate({
          components: [{ type: 'HEADER', format: 'TEXT', text: 'Oi' }],
        }),
      ),
    ).toBeNull()
  })

  it('uses our stored copy first', () => {
    const template = createFakeWhatsAppTemplate({
      headerFormat: 'IMAGE',
      headerMediaUrl: 'https://media/x.png',
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: ['https://meta/sample.png'] },
        },
      ],
    })
    expect(templateHeaderMedia(template)).toEqual({
      format: 'IMAGE',
      url: 'https://media/x.png',
    })
  })

  it('falls back to the sample Meta hosts for synced templates', () => {
    const template = createFakeWhatsAppTemplate({
      components: [
        {
          type: 'HEADER',
          format: 'VIDEO',
          example: { header_handle: ['https://meta/sample.mp4'] },
        },
      ],
    })
    expect(templateHeaderMedia(template)).toEqual({
      format: 'VIDEO',
      url: 'https://meta/sample.mp4',
    })
  })

  it('is null when there is no usable URL', () => {
    const template = createFakeWhatsAppTemplate({
      components: [
        {
          type: 'HEADER',
          format: 'DOCUMENT',
          example: { header_handle: ['4::handle'] },
        },
      ],
    })
    expect(templateHeaderMedia(template)).toBeNull()
  })

  it('tolerates non-array components', () => {
    expect(
      templateHeaderMedia(
        createFakeWhatsAppTemplate({
          components: {} as never,
          headerFormat: 'IMAGE',
          headerMediaUrl: 'https://media/x.png',
        }),
      ),
    ).toEqual({ format: 'IMAGE', url: 'https://media/x.png' })
  })
})

describe('applyTemplateSendExtras', () => {
  it('adds the header media and reply payloads at Meta indexes', () => {
    const template = createFakeWhatsAppTemplate({
      id: 'tpl1',
      headerFormat: 'DOCUMENT',
      headerMediaUrl: 'https://media/x.pdf',
      components: [buttonsBlock],
    })
    const body = { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }

    const result = applyTemplateSendExtras(template, [body])

    expect(result.components).toEqual([
      {
        type: 'header',
        parameters: [
          { type: 'document', document: { link: 'https://media/x.pdf' } },
        ],
      },
      body,
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '1',
        parameters: [{ type: 'payload', payload: 'stl:t:tpl1:b2' }],
      },
    ])
    expect(result.buttons).toEqual([
      { id: 'b2', type: 'REPLY', label: 'Sim' },
      { id: 'b3', type: 'URL', label: 'Site', url: 'https://steel.app' },
    ])
  })

  it('keeps components the caller already built', () => {
    const template = createFakeWhatsAppTemplate({
      id: 'tpl1',
      headerFormat: 'IMAGE',
      headerMediaUrl: 'https://media/x.png',
      buttons: [{ id: 'ok', type: 'REPLY', label: 'Ok', actions: [] }],
    })
    const header = { type: 'header', parameters: [] }
    const button = { type: 'button', sub_type: 'quick_reply', index: '0' }

    const result = applyTemplateSendExtras(template, [header, button])

    expect(result.components).toEqual([header, button])
  })

  it('uses the stored position when Meta has no matching button', () => {
    const template = createFakeWhatsAppTemplate({
      id: 'tpl1',
      buttons: [{ id: 'ok', type: 'REPLY', label: 'Ok', actions: [] }],
    })
    const result = applyTemplateSendExtras(template, undefined)
    expect(result.components).toEqual([
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'stl:t:tpl1:ok' }],
      },
    ])
  })

  it('returns nothing extra for a plain template', () => {
    expect(applyTemplateSendExtras(createFakeWhatsAppTemplate(), [])).toEqual({
      components: [],
      buttons: [],
    })
  })
})
