import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  constantTimeEqual,
  escapeSlackText,
  parseSdGithubConfig,
  parseSdGithubItemRef,
  parseSdGithubRepo,
  parseSdSlackConfig,
  parseSdSlackThreadKey,
  SD_GITHUB_STATE_LABEL,
  SD_SLACK_CONFIG_DEFAULTS,
  sdGithubIssueFromTicket,
  sdGithubItemUrl,
  sdGithubLinkKey,
  sdGithubRepoKey,
  sdGithubState,
  sdGithubStateChangeBody,
  sdSlackChannelFor,
  sdSlackEventText,
  sdSlackReplyBody,
  sdSlackThreadKey,
  sdSlackTicketBody,
  sdSlackTicketOpenedText,
  sdSlackTicketTitle,
  verifyGithubSignature,
  verifySlackSignature,
} from '@/src/lib/servicedesk/integrations'

const SLACK_SECRET = 'signing-secret-de-teste'
const GITHUB_SECRET = 'webhook-secret-de-teste'

function slackSignature(timestamp: string, body: string): string {
  return `v0=${createHmac('sha256', SLACK_SECRET)
    .update(`v0:${timestamp}:${body}`, 'utf8')
    .digest('hex')}`
}

function githubSignature(body: string): string {
  return `sha256=${createHmac('sha256', GITHUB_SECRET)
    .update(body, 'utf8')
    .digest('hex')}`
}

describe('constantTimeEqual', () => {
  it('compara iguais e recusa tamanhos diferentes sem lançar', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})

describe('verifySlackSignature', () => {
  const now = 1_790_000_000_000
  const timestamp = String(Math.floor(now / 1000))
  const body = 'payload=%7B%22type%22%3A%22message_action%22%7D'

  it('aceita a assinatura correta dentro da janela', () => {
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp,
        signature: slackSignature(timestamp, body),
        rawBody: body,
        now,
      }),
    ).toBe('valid')
  })

  it('recusa assinatura errada, corpo alterado e segredo trocado', () => {
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp,
        signature: 'v0=deadbeef',
        rawBody: body,
        now,
      }),
    ).toBe('invalid')
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp,
        signature: slackSignature(timestamp, body),
        rawBody: `${body}&tampered=1`,
        now,
      }),
    ).toBe('invalid')
    expect(
      verifySlackSignature({
        signingSecret: 'outro-segredo-qualquer',
        timestamp,
        signature: slackSignature(timestamp, body),
        rawBody: body,
        now,
      }),
    ).toBe('invalid')
  })

  it('recusa timestamp velho ou no futuro (replay)', () => {
    const stale = String(Math.floor(now / 1000) - 600)
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp: stale,
        signature: slackSignature(stale, body),
        rawBody: body,
        now,
      }),
    ).toBe('stale')

    const future = String(Math.floor(now / 1000) + 600)
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp: future,
        signature: slackSignature(future, body),
        rawBody: body,
        now,
      }),
    ).toBe('stale')
  })

  it('recusa quando falta segredo, timestamp, assinatura ou o timestamp não é número', () => {
    const base = {
      signingSecret: SLACK_SECRET,
      timestamp,
      signature: slackSignature(timestamp, body),
      rawBody: body,
      now,
    }
    expect(verifySlackSignature({ ...base, signingSecret: '' })).toBe('invalid')
    expect(verifySlackSignature({ ...base, timestamp: null })).toBe('invalid')
    expect(verifySlackSignature({ ...base, signature: null })).toBe('invalid')
    expect(verifySlackSignature({ ...base, timestamp: 'agora' })).toBe(
      'invalid',
    )
  })

  it('usa o relógio real quando `now` não é informado', () => {
    const live = String(Math.floor(Date.now() / 1000))
    expect(
      verifySlackSignature({
        signingSecret: SLACK_SECRET,
        timestamp: live,
        signature: slackSignature(live, body),
        rawBody: body,
      }),
    ).toBe('valid')
  })
})

describe('verifyGithubSignature', () => {
  const body = '{"action":"closed"}'

  it('aceita a assinatura correta', () => {
    expect(
      verifyGithubSignature({
        secret: GITHUB_SECRET,
        signature: githubSignature(body),
        rawBody: body,
      }),
    ).toBe(true)
  })

  it('recusa assinatura errada, prefixo errado, corpo alterado e falta de segredo', () => {
    expect(
      verifyGithubSignature({
        secret: GITHUB_SECRET,
        signature: 'sha256=deadbeef',
        rawBody: body,
      }),
    ).toBe(false)
    expect(
      verifyGithubSignature({
        secret: GITHUB_SECRET,
        signature: githubSignature(body).replace('sha256=', 'sha1='),
        rawBody: body,
      }),
    ).toBe(false)
    expect(
      verifyGithubSignature({
        secret: GITHUB_SECRET,
        signature: githubSignature(body),
        rawBody: '{"action":"reopened"}',
      }),
    ).toBe(false)
    expect(
      verifyGithubSignature({
        secret: '',
        signature: githubSignature(body),
        rawBody: body,
      }),
    ).toBe(false)
    expect(
      verifyGithubSignature({
        secret: GITHUB_SECRET,
        signature: null,
        rawBody: body,
      }),
    ).toBe(false)
  })
})

describe('parseSdSlackConfig', () => {
  it('completa com os padrões o que não veio', () => {
    expect(parseSdSlackConfig(null)).toEqual(SD_SLACK_CONFIG_DEFAULTS)
    expect(parseSdSlackConfig('texto')).toEqual(SD_SLACK_CONFIG_DEFAULTS)
    expect(parseSdSlackConfig([1, 2])).toEqual(SD_SLACK_CONFIG_DEFAULTS)
  })

  it('lê canais, descarta os inválidos e o segundo canal do mesmo time', () => {
    const config = parseSdSlackConfig({
      channels: [
        { departmentId: 'dep-1', channelId: 'C1', channelName: 'n1' },
        { departmentId: 'dep-1', channelId: 'C2' },
        { departmentId: null, channelId: 'C3' },
        { departmentId: null, channelId: 'C4' },
        { channelId: '   ' },
        'lixo',
      ],
      events: ['sla.breached', 'sla.breached', 42],
      allowTicketFromMessage: false,
      mirrorThreadReplies: false,
      ticketType: 'PROBLEM',
      departmentId: ' dep-9 ',
    })
    expect(config.channels).toEqual([
      { departmentId: 'dep-1', channelId: 'C1', channelName: 'n1' },
      { departmentId: null, channelId: 'C3', channelName: null },
    ])
    expect(config.events).toEqual(['sla.breached'])
    expect(config.allowTicketFromMessage).toBe(false)
    expect(config.mirrorThreadReplies).toBe(false)
    expect(config.ticketType).toBe('PROBLEM')
    expect(config.departmentId).toBe('dep-9')
  })

  it('recusa um tipo de chamado desconhecido e volta ao padrão', () => {
    expect(parseSdSlackConfig({ ticketType: 'ALGO' }).ticketType).toBe(
      'INCIDENT',
    )
  })
})

describe('parseSdGithubConfig', () => {
  it('liga a sugestão de fase e a abertura de issue por padrão', () => {
    expect(parseSdGithubConfig(undefined)).toEqual({
      suggestPhaseOnClose: true,
      allowIssueFromTicket: true,
    })
    expect(
      parseSdGithubConfig({
        suggestPhaseOnClose: false,
        allowIssueFromTicket: false,
      }),
    ).toEqual({ suggestPhaseOnClose: false, allowIssueFromTicket: false })
  })
})

describe('sdSlackChannelFor', () => {
  const config = parseSdSlackConfig({
    channels: [
      { departmentId: 'dep-1', channelId: 'C-time' },
      { departmentId: null, channelId: 'C-padrao' },
    ],
  })

  it('prefere o canal do time e cai no padrão', () => {
    expect(sdSlackChannelFor(config, 'dep-1')).toBe('C-time')
    expect(sdSlackChannelFor(config, 'dep-2')).toBe('C-padrao')
    expect(sdSlackChannelFor(config, null)).toBe('C-padrao')
  })

  it('devolve null sem canal padrão', () => {
    const only = parseSdSlackConfig({
      channels: [{ departmentId: 'dep-1', channelId: 'C-time' }],
    })
    expect(sdSlackChannelFor(only, 'dep-9')).toBeNull()
    expect(sdSlackChannelFor(only, null)).toBeNull()
  })
})

describe('parseSdGithubRepo', () => {
  it.each([
    ['steel-so/steel'],
    ['https://github.com/steel-so/steel'],
    ['https://www.github.com/steel-so/steel/'],
    ['git@github.com:steel-so/steel.git'],
  ])('reconhece %s', (input) => {
    expect(parseSdGithubRepo(input)).toEqual({
      owner: 'steel-so',
      repo: 'steel',
    })
  })

  it.each([[''], ['   '], ['steel'], ['a/b/c'], ['own er/repo'], ['owner/']])(
    'recusa %s',
    (input) => {
      expect(parseSdGithubRepo(input)).toBeNull()
    },
  )
})

describe('parseSdGithubItemRef', () => {
  it('reconhece URL de issue e de pull request', () => {
    expect(
      parseSdGithubItemRef('https://github.com/owner/repo/issues/42'),
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      number: 42,
      kind: 'GITHUB_ISSUE',
    })
    expect(
      parseSdGithubItemRef('https://github.com/owner/repo/pull/7#issuecomment'),
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      number: 7,
      kind: 'GITHUB_PULL_REQUEST',
    })
  })

  it('reconhece `owner/repo#n` e o número solto (tipo vem da API)', () => {
    expect(parseSdGithubItemRef('owner/repo#9')).toEqual({
      owner: 'owner',
      repo: 'repo',
      number: 9,
      kind: null,
    })
    expect(parseSdGithubItemRef('#12')).toEqual({
      owner: null,
      repo: null,
      number: 12,
      kind: null,
    })
    expect(parseSdGithubItemRef(' 12 ')).toEqual({
      owner: null,
      repo: null,
      number: 12,
      kind: null,
    })
  })

  it.each([[''], ['#0'], ['abc'], ['owner/repo'], ['owner/repo#']])(
    'recusa %s',
    (input) => {
      expect(parseSdGithubItemRef(input)).toBeNull()
    },
  )
})

describe('chaves externas', () => {
  const ref = { owner: 'owner', repo: 'repo' }

  it('monta e lê as chaves do GitHub e do Slack', () => {
    expect(sdGithubRepoKey(ref)).toBe('owner/repo')
    expect(sdGithubLinkKey(ref, 42)).toBe('owner/repo#42')
    expect(sdGithubItemUrl(ref, 42, 'GITHUB_ISSUE')).toBe(
      'https://github.com/owner/repo/issues/42',
    )
    expect(sdGithubItemUrl(ref, 42, 'GITHUB_PULL_REQUEST')).toBe(
      'https://github.com/owner/repo/pull/42',
    )
    expect(sdSlackThreadKey('C1', '1700000000.000100')).toBe(
      'C1:1700000000.000100',
    )
    expect(parseSdSlackThreadKey('C1:1700000000.000100')).toEqual({
      channel: 'C1',
      ts: '1700000000.000100',
    })
  })

  it('recusa chave de thread malformada', () => {
    expect(parseSdSlackThreadKey('semdoispontos')).toBeNull()
    expect(parseSdSlackThreadKey(':ts')).toBeNull()
    expect(parseSdSlackThreadKey('C1:')).toBeNull()
  })
})

describe('sdGithubState', () => {
  it('reconhece aberta, fechada e mesclada', () => {
    expect(sdGithubState({ state: 'open' })).toBe('open')
    expect(sdGithubState({ state: 'closed' })).toBe('closed')
    expect(sdGithubState({ state: 'closed', merged: true })).toBe('merged')
    expect(sdGithubState({ state: 'closed', merged_at: '2026-01-01' })).toBe(
      'merged',
    )
    expect(
      sdGithubState({
        state: 'closed',
        pull_request: { merged_at: '2026-01-01' },
      }),
    ).toBe('merged')
    expect(sdGithubState({})).toBe('open')
  })

  it('tem rótulo em pt-BR para cada estado', () => {
    expect(SD_GITHUB_STATE_LABEL).toEqual({
      open: 'Aberta',
      closed: 'Fechada',
      merged: 'Mesclada',
    })
  })
})

describe('textos enviados', () => {
  it('escapa o que o Slack interpreta', () => {
    expect(escapeSlackText('<b> & "x"')).toBe('&lt;b&gt; &amp; "x"')
  })

  it('monta o aviso do canal com o link do chamado', () => {
    const text = sdSlackEventText({
      ticketCode: 'INC-000042',
      ticketTitle: 'E-mail <fora> do ar',
      title: 'SLA violado',
      body: 'Prazo de resolução estourou',
      url: 'https://steel.test/acme/servicedesk/tickets/42',
    })
    expect(text).toContain('*SLA violado*')
    expect(text).toContain(
      '<https://steel.test/acme/servicedesk/tickets/42|INC-000042>',
    )
    expect(text).toContain('E-mail &lt;fora&gt; do ar')
    expect(text).toContain('Prazo de resolução estourou')
  })

  it('omite o corpo vazio do aviso', () => {
    const text = sdSlackEventText({
      ticketCode: 'INC-1',
      ticketTitle: 'T',
      title: 'Abriu',
      body: '   ',
      url: 'https://steel.test/x',
    })
    expect(text.split('\n')).toHaveLength(2)
  })

  it('confirma na thread com o código e o link', () => {
    expect(
      sdSlackTicketOpenedText({
        ticketCode: 'INC-000042',
        url: 'https://steel.test/x',
      }),
    ).toContain('<https://steel.test/x|INC-000042>')
  })

  it('monta o corpo do chamado com autor, canal e permalink escapados', () => {
    const body = sdSlackTicketBody({
      text: 'Servidor <fora> do ar',
      authorName: 'Ana & Cia',
      channelName: 'suporte',
      permalink: 'https://slack.test/p/1?a=1&b=2',
    })
    expect(body).toContain('Servidor &lt;fora&gt; do ar')
    expect(body).toContain('Ana &amp; Cia')
    expect(body).toContain('#suporte')
    expect(body).toContain('https://slack.test/p/1?a=1&amp;b=2')
  })

  it('tolera mensagem sem texto, sem canal e sem permalink', () => {
    const body = sdSlackTicketBody({
      text: '   ',
      authorName: 'Ana',
      channelName: null,
      permalink: null,
    })
    expect(body).toContain('(mensagem sem texto)')
    expect(body).toContain('em Slack')
    expect(body).not.toContain('<a href')
  })

  it('tira o título da primeira linha e corta o que é longo', () => {
    expect(sdSlackTicketTitle('Primeira linha\nsegunda')).toBe('Primeira linha')
    expect(sdSlackTicketTitle('   ')).toBe('Chamado aberto pelo Slack')
    const long = sdSlackTicketTitle('a'.repeat(200))
    expect(long).toHaveLength(120)
    expect(long.endsWith('...')).toBe(true)
  })

  it('distingue a resposta de autor identificado da de externo', () => {
    const known = sdSlackReplyBody({
      text: 'Resolvido',
      authorName: 'Ana',
      identified: true,
    })
    expect(known).toContain('Resposta pelo Slack.')
    expect(known).not.toContain('Ana')

    const external = sdSlackReplyBody({
      text: '  ',
      authorName: 'Ana & Cia',
      identified: false,
    })
    expect(external).toContain('Ana &amp; Cia')
    expect(external).toContain('usuário externo')
    expect(external).toContain('(mensagem sem texto)')
  })

  it('monta a issue a partir do chamado com e sem descrição', () => {
    const full = sdGithubIssueFromTicket({
      ticketCode: 'PRB-000007',
      ticketTitle: 'Fila travando',
      ticketUrl: 'https://steel.test/t/7',
      description: 'Acontece ao reiniciar',
      ticketType: 'PROBLEM',
      priority: 'Alta',
    })
    expect(full.title).toBe('[PRB-000007] Fila travando')
    expect(full.body).toContain('- Tipo: PROBLEM')
    expect(full.body).toContain('- Prioridade: Alta')
    expect(full.body).toContain('https://steel.test/t/7')
    expect(full.body).toContain('Acontece ao reiniciar')

    const bare = sdGithubIssueFromTicket({
      ticketCode: 'CHG-1',
      ticketTitle: 'Troca',
      ticketUrl: 'https://steel.test/t/1',
      description: '   ',
      ticketType: 'CHANGE',
      priority: null,
    })
    expect(bare.body).not.toContain('Prioridade')
    expect(bare.body).not.toContain('---')
  })

  it('monta a mensagem de estado, com e sem sugestão de fase', () => {
    const suggested = sdGithubStateChangeBody({
      kind: 'GITHUB_PULL_REQUEST',
      key: 'owner/repo#9',
      url: 'https://github.com/owner/repo/pull/9',
      state: 'merged',
      suggestPhase: true,
    })
    expect(suggested).toContain('O pull request')
    expect(suggested).toContain('mesclada')
    expect(suggested).toContain('Sugestão')

    const plain = sdGithubStateChangeBody({
      kind: 'GITHUB_ISSUE',
      key: 'owner/repo#9',
      url: null,
      state: 'open',
      suggestPhase: true,
    })
    expect(plain).toContain('A issue')
    expect(plain).not.toContain('Sugestão')
    expect(plain).not.toContain('<a href')

    const off = sdGithubStateChangeBody({
      kind: 'GITHUB_ISSUE',
      key: 'owner/repo#9',
      url: null,
      state: 'closed',
      suggestPhase: false,
    })
    expect(off).not.toContain('Sugestão')
  })
})
