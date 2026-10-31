import { buildLinkedinContact, nameFromLinkedinTitle } from '../lib/extract'
import { watchContact } from './watch'

watchContact(() => {
  if (!location.pathname.startsWith('/in/')) return null
  const name =
    document.querySelector('main h1')?.textContent ?? nameFromLinkedinTitle(document.title)
  const headline = document.querySelector('main div.text-body-medium')?.textContent
  return buildLinkedinContact({ href: location.href, name, headline })
})
