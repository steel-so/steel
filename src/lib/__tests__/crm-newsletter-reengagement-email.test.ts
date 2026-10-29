import { describe, expect, it } from 'vitest'
import {
  paragraphsHtml,
  readableTextOn,
  renderReengagementEmail,
} from '../crm-newsletter/reengagement-email'

const brand = {
  companyName: 'Acme <Ltda>',
  logoUrl: '',
  primaryColor: '#ffcc00',
  address: 'Rua A, 1',
  website: '',
}
const copy = {
  subject: 'Ainda quer receber?',
  heading: 'Sentimos sua falta',
  body: 'Linha 1\nlinha 2\n\n<b>Parágrafo</b> 2\n\n  ',
  buttonLabel: 'Quero continuar recebendo',
}

describe('re-engagement e-mail', () => {
  it('picks a readable text color', () => {
    expect(readableTextOn('#ffffff')).toBe('#111827')
    expect(readableTextOn('#fff')).toBe('#111827')
    expect(readableTextOn('#000000')).toBe('#ffffff')
    expect(readableTextOn('#2893CC')).toBe('#ffffff')
  })

  it('splits paragraphs, keeps line breaks and escapes', () => {
    const html = paragraphsHtml(copy.body)
    expect(html.match(/<p /g)).toHaveLength(2)
    expect(html).toContain('Linha 1<br>linha 2')
    expect(html).toContain('&lt;b&gt;Parágrafo&lt;/b&gt;')
  })

  it('renders the copy, the button, the footer and the text twin', () => {
    const email = renderReengagementEmail({
      copy,
      brand,
      newsletterName: 'Novidades',
      buttonUrl: 'https://app.test/newsletter/continuar/t?a=1&b=2',
      unsubscribeUrl: 'https://app.test/newsletter/sair/u',
      preferencesUrl: 'https://app.test/newsletter/preferencias/p',
    })
    expect(email.subject).toBe(copy.subject)
    expect(email.html).toContain('Sentimos sua falta')
    expect(email.html).toContain(
      'href="https://app.test/newsletter/continuar/t?a=1&amp;b=2"',
    )
    expect(email.html).toContain('background:#ffcc00;color:#111827')
    expect(email.html).toContain('Acme &lt;Ltda&gt;')
    expect(email.html).toContain('Cancelar inscrição')
    expect(email.html).toContain('Rua A, 1')
    expect(email.html.indexOf('Cancelar inscrição')).toBeLessThan(
      email.html.indexOf('</body>'),
    )
    expect(email.text).toContain(
      'Quero continuar recebendo: https://app.test/newsletter/continuar/t?a=1&b=2',
    )
    expect(email.text).toContain(
      'Cancelar inscrição: https://app.test/newsletter/sair/u',
    )
  })

  it('shows the logo and falls back to the default color', () => {
    const email = renderReengagementEmail({
      copy,
      brand: {
        ...brand,
        logoUrl: 'https://cdn.test/logo.png',
        primaryColor: 'red',
      },
      newsletterName: 'Novidades',
      buttonUrl: 'https://app.test/x',
    })
    expect(email.html).toContain('<img src="https://cdn.test/logo.png"')
    expect(email.html).toContain('background:#2893CC;color:#ffffff')
    expect(email.html).not.toContain('Cancelar inscrição')
  })
})
