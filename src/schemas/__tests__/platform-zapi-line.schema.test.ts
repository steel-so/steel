import { describe, expect, it } from 'vitest'
import {
  PlatformZapiLineActionSchema,
  SavePlatformZapiLineSchema,
} from '../platform-zapi-line.schema'

describe('SavePlatformZapiLineSchema', () => {
  it('accepts the credentials and trims them', () => {
    const parsed = SavePlatformZapiLineSchema.parse({
      instanceId: '  3C4A5B6C  ',
      token: ' tok_en-1 ',
      clientToken: ' F123 ',
      label: ' Linha ',
    })
    expect(parsed).toMatchObject({
      instanceId: '3C4A5B6C',
      token: 'tok_en-1',
      clientToken: 'F123',
      label: 'Linha',
    })
  })

  it('treats a blank client token and label as absent', () => {
    const parsed = SavePlatformZapiLineSchema.parse({
      instanceId: 'abc',
      token: 'def',
      clientToken: '   ',
      label: '',
    })
    expect(parsed.clientToken).toBeUndefined()
    expect(parsed.label).toBeUndefined()
  })

  it('requires the instance id and the token in pt-BR', () => {
    const result = SavePlatformZapiLineSchema.safeParse({
      instanceId: '',
      token: '',
    })
    expect(result.success).toBe(false)
    const messages = result.error?.issues.map((issue) => issue.message)
    expect(messages).toContain('Informe o ID da instância')
    expect(messages).toContain('Informe o token da instância')
  })

  it('rejects characters that could alter the Z-API URL', () => {
    expect(
      SavePlatformZapiLineSchema.safeParse({
        instanceId: 'abc/../x',
        token: 'ok',
      }).success,
    ).toBe(false)
    expect(
      SavePlatformZapiLineSchema.safeParse({
        instanceId: 'abc',
        token: 'to ken?x=1',
      }).success,
    ).toBe(false)
  })
})

describe('PlatformZapiLineActionSchema', () => {
  it('requires a reason of at least 5 characters', () => {
    expect(PlatformZapiLineActionSchema.safeParse({}).success).toBe(false)
    expect(
      PlatformZapiLineActionSchema.safeParse({ reason: 'abc' }).success,
    ).toBe(false)
    expect(
      PlatformZapiLineActionSchema.parse({ reason: '  trocar o número ' }),
    ).toEqual({ reason: 'trocar o número' })
  })
})
