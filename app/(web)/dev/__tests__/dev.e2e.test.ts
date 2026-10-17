import { describe, expect, it } from 'vitest'
import { BASE_URL } from '@/src/__tests__/setup.e2e'

async function page(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' })
  return { res, html: await res.text() }
}

const canonical = (html: string) =>
  /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]

describe('developer site (/dev)', () => {
  it('serves the landing as an indexable collection of the guides', async () => {
    const { res, html } = await page('/dev')
    expect(res.status).toBe(200)
    expect(html).toContain('<title>Desenvolvedores | Steel</title>')
    expect(canonical(html)).toMatch(/\/dev$/)
    expect(html).not.toMatch(/<meta name="robots" content="noindex/)
    expect(html).toContain('"@type":"CollectionPage"')
    expect(html).toContain('href="/dev/comecando"')
    expect(html).toContain('href="/dev/api"')
    expect(html).toContain('suporte@stratustelecom.com.br')
  })

  it.each([
    ['/dev/comecando', 'Começando'],
    ['/dev/respostas-e-erros', 'Formato de resposta e erros'],
    ['/dev/limites', 'Limites de requisição'],
    ['/dev/guias/criar-lead', 'Criar lead a partir do seu site'],
    ['/dev/guias/abrir-chamado', 'Abrir chamado a partir do seu sistema'],
    ['/dev/mcp', 'Servidor MCP'],
  ])('serves %s as a TechArticle', async (path, title) => {
    const { res, html } = await page(path)
    expect(res.status).toBe(200)
    expect(html).toContain(`<title>${title} | Desenvolvedores Steel</title>`)
    expect(canonical(html)).toMatch(new RegExp(`${path}$`))
    expect(html).toContain('"@type":"TechArticle"')
    expect(html).toContain('Nesta página')
    expect(html).toContain('rel="next"')
  })

  it('renders the generated error table', async () => {
    const { html } = await page('/dev/respostas-e-erros')
    expect(html).toContain('data-error-catalog')
    expect(html).toContain('CRM_INTEGRATION_KEY_INVALID')
  })

  it('renders the MCP guide with the server url and the tool table from the registry', async () => {
    const { html } = await page('/dev/mcp')
    expect(html).toMatch(/<code[^>]*>https?:\/\/[^<]+\/api\/mcp<\/code>/)
    expect(html).toContain('data-mcp-tools')
    expect(html).toContain('sd_')
    expect(html).toContain('mcp:read')
  })

  it('renders the not-found page, out of the index, for an unknown guide', async () => {
    const { html } = await page('/dev/guias/nao-existe')
    expect(html).toContain('<title>Página não encontrada | Steel</title>')
    expect(html).toMatch(/<meta name="robots" content="noindex/)
  })

  it('keeps the API reference at /dev/api', async () => {
    const { res, html } = await page('/dev/api')
    expect(res.status).toBe(200)
    expect(html).toContain('<title>Referência da API | Steel</title>')
    expect(html).toMatch(/<link rel="canonical" href="[^"]+\/dev\/api"/)
  })

  it('lists the guides in sitemap.xml, llms.txt and llms-full.txt', async () => {
    const sitemap = await (await fetch(`${BASE_URL}/sitemap.xml`)).text()
    expect(sitemap).toContain('/dev/guias/criar-lead</loc>')
    expect(sitemap).toContain('/dev/limites</loc>')

    const llms = await (await fetch(`${BASE_URL}/llms.txt`)).text()
    expect(llms).toContain('## Desenvolvedores (guias da API)')
    expect(llms).toContain('/dev/guias/disparar-workflow')

    const full = await (await fetch(`${BASE_URL}/llms-full.txt`)).text()
    expect(full).toContain('# Desenvolvedores')
    expect(full).toContain('| `RATE_LIMITED` |')
    expect(full).toContain('| Ferramenta | O que faz | Tipo | Escopo |')
    expect(full).not.toContain('<McpToolTable')
  })
})
