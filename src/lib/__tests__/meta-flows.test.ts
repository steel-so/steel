import { describe, expect, it } from 'vitest'
import {
  jsonResponse,
  mockFetch,
  textResponse,
} from '@/src/__tests__/helpers/fetch.helpers'
import {
  createMetaFlow,
  deleteMetaFlow,
  deprecateMetaFlow,
  formatFlowValidationErrors,
  getMetaFlow,
  MetaFlowError,
  publishMetaFlow,
  uploadMetaFlowJson,
} from '../whatsapp/meta-flows'

const auth = { accessToken: 'tok' }
const json = { version: '7.2', screens: [] }

describe('formatFlowValidationErrors', () => {
  it('prints one line per error with the pointer path', () => {
    expect(
      formatFlowValidationErrors([
        { message: 'Campo inválido', pointers: [{ path: 'screens[0]' }] },
        { error: 'INVALID' },
        {},
      ]),
    ).toBe('Campo inválido (screens[0])\nINVALID\nErro de validação')
  })

  it('shows at most eight errors', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ message: `e${i}` }))
    expect(formatFlowValidationErrors(many).split('\n')).toHaveLength(8)
  })
})

describe('createMetaFlow', () => {
  it('posts the flow json as a draft and returns the id', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ id: 'flow-1' }))
    const created = await createMetaFlow(auth, {
      wabaId: 'waba',
      name: 'Cadastro',
      categories: ['SIGN_UP'],
      flowJson: json,
    })
    expect(created).toEqual({ id: 'flow-1' })
    const [call] = fetchMock.calls()
    expect(call.url).toContain('/waba/flows')
    expect(call.init?.method).toBe('POST')
    const body = JSON.parse(call.init?.body as string)
    expect(body).toMatchObject({
      name: 'Cadastro',
      categories: ['SIGN_UP'],
      publish: false,
    })
    expect(JSON.parse(body.flow_json)).toEqual(json)
    const headers = call.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('throws the validation errors Meta returns', async () => {
    mockFetch(() =>
      jsonResponse({
        id: 'flow-1',
        validation_errors: [{ message: 'Tela sem título' }],
      }),
    )
    const error = await createMetaFlow(auth, {
      wabaId: 'waba',
      name: 'x',
      categories: [],
      flowJson: json,
    }).catch((e) => e)
    expect(error).toBeInstanceOf(MetaFlowError)
    expect(error.message).toBe('Tela sem título')
    expect(error.validationErrors).toHaveLength(1)
  })

  it('throws when Meta sends no id', async () => {
    mockFetch(() => jsonResponse({}))
    await expect(
      createMetaFlow(auth, {
        wabaId: 'waba',
        name: 'x',
        categories: [],
        flowJson: json,
      }),
    ).rejects.toThrow('não devolveu o id')
  })

  it('surfaces the user message of an HTTP error', async () => {
    mockFetch(() =>
      jsonResponse(
        { error: { message: 'bad', error_user_msg: 'Nome já usado' } },
        { status: 400 },
      ),
    )
    await expect(
      createMetaFlow(auth, {
        wabaId: 'waba',
        name: 'x',
        categories: [],
        flowJson: json,
      }),
    ).rejects.toThrow('Nome já usado')
  })

  it('falls back to the plain message, then to the status', async () => {
    mockFetch(() =>
      jsonResponse({ error: { message: 'Token expirado' } }, { status: 401 }),
    )
    await expect(
      createMetaFlow(auth, {
        wabaId: 'w',
        name: 'x',
        categories: [],
        flowJson: json,
      }),
    ).rejects.toThrow('Token expirado')
    mockFetch(() => textResponse('boom', { status: 500 }))
    await expect(
      createMetaFlow(auth, {
        wabaId: 'w',
        name: 'x',
        categories: [],
        flowJson: json,
      }),
    ).rejects.toThrow('Falha ao criar o Flow na Meta (500)')
  })
})

describe('uploadMetaFlowJson', () => {
  it('uploads flow.json as multipart form data', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ success: true }))
    await uploadMetaFlowJson(auth, { flowId: 'f1', flowJson: json })
    const [call] = fetchMock.calls()
    expect(call.url).toContain('/f1/assets')
    expect(call.init?.body).toBeInstanceOf(FormData)
    const form = call.init?.body as FormData
    expect(form.get('asset_type')).toBe('FLOW_JSON')
    expect(form.get('name')).toBe('flow.json')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('throws on validation errors', async () => {
    mockFetch(() =>
      jsonResponse({ validation_errors: [{ error: 'INVALID_PROPERTY' }] }),
    )
    await expect(
      uploadMetaFlowJson(auth, { flowId: 'f1', flowJson: json }),
    ).rejects.toThrow('INVALID_PROPERTY')
  })
})

describe('publish, deprecate, delete', () => {
  it('publishes', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ success: true }))
    await publishMetaFlow(auth, 'f1')
    expect(fetchMock.calls()[0].url).toContain('/f1/publish')
  })

  it('deprecates', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ success: true }))
    await deprecateMetaFlow(auth, 'f1')
    expect(fetchMock.calls()[0].url).toContain('/f1/deprecate')
  })

  it('deletes', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ success: true }))
    await deleteMetaFlow(auth, 'f1')
    expect(fetchMock.calls()[0].init?.method).toBe('DELETE')
  })

  it('reports a refusal with the call-specific fallback', async () => {
    mockFetch(() => textResponse('', { status: 400 }))
    await expect(publishMetaFlow(auth, 'f1')).rejects.toThrow(
      'Falha ao publicar o Flow na Meta (400)',
    )
    await expect(deprecateMetaFlow(auth, 'f1')).rejects.toThrow(
      'Falha ao descontinuar o Flow na Meta (400)',
    )
    await expect(deleteMetaFlow(auth, 'f1')).rejects.toThrow(
      'Falha ao apagar o Flow na Meta (400)',
    )
  })
})

describe('getMetaFlow', () => {
  it('returns the status and the preview link', async () => {
    mockFetch(() =>
      jsonResponse({
        id: 'f1',
        status: 'DRAFT',
        preview: { preview_url: 'https://business.facebook.com/p/1' },
      }),
    )
    expect(await getMetaFlow(auth, 'f1')).toEqual({
      id: 'f1',
      status: 'DRAFT',
      previewUrl: 'https://business.facebook.com/p/1',
    })
  })

  it('defaults the missing fields', async () => {
    mockFetch(() => jsonResponse({}))
    expect(await getMetaFlow(auth, 'f1')).toEqual({
      id: 'f1',
      status: 'UNKNOWN',
      previewUrl: null,
    })
  })

  it('tolerates an unreadable body on success', async () => {
    mockFetch(() => textResponse('not json'))
    expect((await getMetaFlow(auth, 'f1')).status).toBe('UNKNOWN')
  })
})
