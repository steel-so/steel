import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { GithubClient } from '@/src/lib/servicedesk/github-client'

const fetchMock = vi.fn()
const REF = { owner: 'steel-so', repo: 'steel' }
const TOKEN = 'github_pat_segredo'

function reply(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GithubClient.checkRepo', () => {
  it('confere o acesso e devolve o nome canônico', async () => {
    fetchMock.mockResolvedValue(
      reply({ full_name: 'steel-so/steel', private: true }),
    )
    expect(expectOk(await GithubClient.checkRepo(TOKEN, REF))).toEqual({
      fullName: 'steel-so/steel',
      private: true,
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/steel-so/steel')
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(init.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
  })

  it('completa o nome e o `private` quando faltam', async () => {
    fetchMock.mockResolvedValue(reply({}))
    expect(expectOk(await GithubClient.checkRepo(TOKEN, REF))).toEqual({
      fullName: 'steel-so/steel',
      private: false,
    })
  })

  it('404 explica o token sem acesso, sem vazar o token', async () => {
    fetchMock.mockResolvedValue(reply({}, 404))
    const error = expectErr(
      await GithubClient.checkRepo(TOKEN, REF),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
    expect(error.message).toContain('não encontrado')
    expect(JSON.stringify(vi.mocked(logger).warn.mock.calls)).not.toContain(
      TOKEN,
    )
  })

  it('outros status viram o código e rede caída vira Result', async () => {
    fetchMock.mockResolvedValue(reply({}, 401))
    expect(
      expectErr(
        await GithubClient.checkRepo(TOKEN, REF),
        'SD_INTEGRATION_REQUEST_FAILED',
      ).message,
    ).toContain('401')

    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    expect(
      expectErr(
        await GithubClient.checkRepo(TOKEN, REF),
        'SD_INTEGRATION_REQUEST_FAILED',
      ).message,
    ).toContain('não respondeu')
  })
})

describe('GithubClient.getItem', () => {
  it('lê a issue pelo número', async () => {
    fetchMock.mockResolvedValue(
      reply({
        number: 42,
        title: 'Fila travando',
        state: 'open',
        html_url: 'https://github.com/steel-so/steel/issues/42',
      }),
    )
    expect(expectOk(await GithubClient.getItem(TOKEN, REF, 42))).toEqual({
      number: 42,
      title: 'Fila travando',
      kind: 'GITHUB_ISSUE',
      state: 'open',
      htmlUrl: 'https://github.com/steel-so/steel/issues/42',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('completa título e URL quando o GitHub não manda', async () => {
    fetchMock.mockResolvedValue(reply({ state: 'open' }))
    expect(expectOk(await GithubClient.getItem(TOKEN, REF, 7))).toEqual({
      number: 7,
      title: '#7',
      kind: 'GITHUB_ISSUE',
      state: 'open',
      htmlUrl: 'https://github.com/steel-so/steel/issues/7',
    })
  })

  it('consulta o endpoint de PR para saber se foi mesclado', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          number: 9,
          title: 'Corrige a fila',
          state: 'closed',
          html_url: 'https://github.com/steel-so/steel/pull/9',
          pull_request: { merged_at: null },
        }),
      )
      .mockResolvedValueOnce(
        reply({ number: 9, state: 'closed', merged: true }),
      )
    const item = expectOk(await GithubClient.getItem(TOKEN, REF, 9))
    expect(item.kind).toBe('GITHUB_PULL_REQUEST')
    expect(item.state).toBe('merged')
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.github.com/repos/steel-so/steel/pulls/9',
    )
  })

  it('mantém o estado da issue quando o endpoint de PR falha', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          number: 9,
          state: 'closed',
          pull_request: { merged_at: null },
        }),
      )
      .mockResolvedValueOnce(reply({}, 500))
    expect(expectOk(await GithubClient.getItem(TOKEN, REF, 9)).state).toBe(
      'closed',
    )
  })

  it('propaga a falha da consulta da issue', async () => {
    fetchMock.mockResolvedValue(reply({}, 404))
    expectErr(
      await GithubClient.getItem(TOKEN, REF, 42),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })
})

describe('GithubClient.createIssue', () => {
  it('abre a issue e devolve o item', async () => {
    fetchMock.mockResolvedValue(
      reply({
        number: 43,
        title: '[PRB-7] Fila travando',
        state: 'open',
        html_url: 'https://github.com/steel-so/steel/issues/43',
      }),
    )
    const item = expectOk(
      await GithubClient.createIssue(TOKEN, REF, {
        title: '[PRB-7] Fila travando',
        body: 'contexto',
      }),
    )
    expect(item.number).toBe(43)
    expect(item.kind).toBe('GITHUB_ISSUE')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/steel-so/steel/issues')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      title: '[PRB-7] Fila travando',
      body: 'contexto',
    })
  })

  it('propaga a recusa do GitHub', async () => {
    fetchMock.mockResolvedValue(reply({}, 403))
    expectErr(
      await GithubClient.createIssue(TOKEN, REF, { title: 't', body: 'b' }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })
})
