import { describe, expect, it } from 'vitest'
import {
  cspNonce,
  isExecutable,
  parseScripts,
  REACT_SHELL_TIME_SCRIPT,
  scriptSources,
  scriptsBlockedByCsp,
} from '@/src/__tests__/helpers/csp-scripts'

// The CSP proxy.ts sends (production, no GA / Embedded Signup).
const NONCE = 'MzQ1Njc4OTAxMjM0NTY3OA=='
const CSP = `default-src 'self'; script-src 'self' 'nonce-${NONCE}'; style-src 'self' 'unsafe-inline'; object-src 'none'; upgrade-insecure-requests;`
const PAGE = 'http://localhost:3001/sign-in'

const blocked = (html: string, csp = CSP, page = PAGE) =>
  scriptsBlockedByCsp(html, csp, page)

describe('scriptsBlockedByCsp', () => {
  it('flags the Next 16.4 shared-runtime bootstrap emitted without the nonce', () => {
    // Shape of the inline script Next 16.4 put in the prerendered shell.
    const html = `<html><head><script src="/_next/static/chunks/runtime.js" async=""></script></head><body><script id="_R_">(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["/sign-in/page",{}]);</script></body></html>`
    expect(blocked(html)).toEqual([
      {
        tag: '<script id="_R_">',
        reason: 'inline script without the CSP nonce',
      },
    ])
  })

  it('accepts a page whose inline scripts carry the nonce and whose chunks are same-origin', () => {
    const html = `
      <script src="/theme-init.js"></script>
      <script src="http://localhost:3001/_next/static/chunks/a.js" async></script>
      <script nonce="${NONCE}">self.__next_f=self.__next_f||[]</script>
      <script nonce='${NONCE}'>self.__next_f.push([1,"x"])</script>`
    expect(blocked(html)).toEqual([])
  })

  it("lets callers allow React's shell-time marker by its exact text only", () => {
    const marker = `<script id="_R_">${REACT_SHELL_TIME_SCRIPT}</script>`
    const options = { allowInline: [REACT_SHELL_TIME_SCRIPT] }
    expect(blocked(marker)).toHaveLength(1)
    expect(scriptsBlockedByCsp(marker, CSP, PAGE, options)).toEqual([])
    expect(
      scriptsBlockedByCsp(
        `<script>${REACT_SHELL_TIME_SCRIPT}alert(1)</script>`,
        CSP,
        PAGE,
        options,
      ),
    ).toHaveLength(1)
  })

  it('flags an inline script with a nonce from another response', () => {
    expect(blocked('<script nonce="stale">alert(1)</script>')).toEqual([
      {
        tag: '<script nonce="stale">',
        reason: 'inline script with a nonce that is not the CSP nonce',
      },
    ])
  })

  it('ignores data blocks the browser never executes', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Organization"}</script>
      <script type="application/json">{}</script>
      <script type="text/template"><div></div></script>`
    expect(blocked(html)).toEqual([])
  })

  it('treats modules, import maps and speculation rules as scripts', () => {
    const html = `
      <script type="module">import "/a.js"</script>
      <script type="importmap">{"imports":{}}</script>
      <script type="speculationrules">{}</script>
      <script type="text/javascript">1</script>`
    expect(blocked(html)).toHaveLength(4)
  })

  it('flags external scripts from origins script-src does not list', () => {
    const html = '<script src="https://evil.example/x.js"></script>'
    expect(blocked(html)).toEqual([
      {
        tag: '<script src="https://evil.example/x.js">',
        reason:
          'external script from https://evil.example not allowed by script-src',
      },
    ])
  })

  it('accepts external scripts from listed host sources', () => {
    const csp = `script-src 'self' 'nonce-${NONCE}' https://www.googletagmanager.com *.cdn.example https://port.example:8443 https://path.example/lib/ https:`
    const html = `
      <script src="https://www.googletagmanager.com/gtag/js"></script>
      <script src="https://a.cdn.example/x.js"></script>
      <script src="https://port.example:8443/x.js"></script>
      <script src="https://path.example/lib/x.js"></script>`
    expect(blocked(html, csp)).toEqual([])
    expect(
      blocked(
        `<script src="http://other.example/x.js"></script>
         <script src="https://port.example/x.js"></script>
         <script src="https://path.example/other/x.js"></script>
         <script src="http://www.googletagmanager.com/gtag/js"></script>`,
        'script-src https://www.googletagmanager.com https://port.example:8443 https://path.example/lib/ *.cdn.example',
      ),
    ).toHaveLength(4)
  })

  it("requires the nonce on external scripts under 'strict-dynamic'", () => {
    const csp = `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`
    expect(blocked('<script src="/a.js"></script>', csp)).toEqual([
      {
        tag: '<script src="/a.js">',
        reason: "external script without the nonce under 'strict-dynamic'",
      },
    ])
    expect(
      blocked(`<script src="/a.js" nonce="${NONCE}"></script>`, csp),
    ).toEqual([])
  })

  it("honours 'unsafe-inline' only when no nonce is present", () => {
    expect(
      blocked('<script>1</script>', "script-src 'self' 'unsafe-inline'"),
    ).toEqual([])
    expect(
      blocked(
        '<script>1</script>',
        `script-src 'unsafe-inline' 'nonce-${NONCE}'`,
      ),
    ).toHaveLength(1)
  })

  it('falls back to default-src and allows everything without a policy', () => {
    expect(blocked('<script>1</script>', "default-src 'self'")).toHaveLength(1)
    expect(blocked('<script>1</script>', "img-src 'self'")).toEqual([])
  })

  it('blocks same-origin scripts when script-src has no self', () => {
    expect(
      blocked('<script src="/a.js"></script>', `script-src 'nonce-${NONCE}'`),
    ).toHaveLength(1)
  })
})

describe('csp parsing', () => {
  it('reads the nonce from script-src', () => {
    expect(cspNonce(CSP)).toBe(NONCE)
    expect(cspNonce("script-src 'self'")).toBeNull()
    expect(cspNonce('')).toBeNull()
  })

  it('prefers script-src-elem, then script-src, and keeps the first repeated directive', () => {
    expect(
      scriptSources(
        "default-src 'none'; script-src 'self'; script-src-elem https://a.example",
      ),
    ).toEqual(['https://a.example'])
    expect(
      scriptSources("script-src 'self'; script-src 'unsafe-inline'"),
    ).toEqual(["'self'"])
    expect(scriptSources("style-src 'self'")).toBeNull()
  })

  it('parses attributes in every quoting style and decodes entities', () => {
    const [script] = parseScripts(
      `<script async src=/a.js data-x='1' data-y="&quot;q&amp;" SRC="/ignored.js">x</script>`,
    )
    expect(script.attrs).toEqual({
      async: '',
      src: '/a.js',
      'data-x': '1',
      'data-y': '"q&',
    })
    expect(script.body).toBe('x')
    expect(isExecutable(script)).toBe(true)
    expect(isExecutable({ tag: '', attrs: { type: '' }, body: '' })).toBe(true)
  })
})
