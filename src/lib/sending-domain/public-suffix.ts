/**
 * Just enough of the Public Suffix List for sending domains (ADR 0054): the
 * multi-label suffixes our customers actually use (Brazil first) so we can
 * (1) refuse a bare suffix like `com.br` and (2) find the registrable domain
 * whose `_dmarc` record applies. A suffix missing here only degrades the
 * DMARC hint (it looks one label too high); it never blocks a real domain.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // Brazil (registro.br)
  'adm.br',
  'adv.br',
  'agr.br',
  'am.br',
  'arq.br',
  'art.br',
  'ato.br',
  'b.br',
  'bio.br',
  'blog.br',
  'bmd.br',
  'cim.br',
  'cng.br',
  'cnt.br',
  'com.br',
  'coop.br',
  'ecn.br',
  'edu.br',
  'emp.br',
  'eng.br',
  'esp.br',
  'etc.br',
  'eti.br',
  'far.br',
  'flog.br',
  'fm.br',
  'fnd.br',
  'fot.br',
  'fst.br',
  'g12.br',
  'ggf.br',
  'gov.br',
  'imb.br',
  'ind.br',
  'inf.br',
  'jor.br',
  'jus.br',
  'leg.br',
  'lel.br',
  'mat.br',
  'med.br',
  'mil.br',
  'mp.br',
  'mus.br',
  'net.br',
  'nom.br',
  'not.br',
  'ntr.br',
  'odo.br',
  'org.br',
  'ppg.br',
  'pro.br',
  'psc.br',
  'psi.br',
  'qsl.br',
  'radio.br',
  'rec.br',
  'slg.br',
  'srv.br',
  'taxi.br',
  'teo.br',
  'tmp.br',
  'trd.br',
  'tur.br',
  'tv.br',
  'vet.br',
  'vlog.br',
  'wiki.br',
  'zlg.br',
  // Elsewhere, the common ones
  'co.uk',
  'org.uk',
  'me.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'com.ar',
  'com.mx',
  'com.co',
  'com.pe',
  'com.uy',
  'com.py',
  'com.bo',
  'com.ec',
  'com.ve',
  'com.pt',
  'co.jp',
  'co.za',
  'co.nz',
  'com.cn',
  'com.tr',
  'co.in',
  'com.sg',
  'com.es',
])

/** `true` when the name is a public suffix itself (nobody owns it). */
export function isPublicSuffix(name: string): boolean {
  const value = name.toLowerCase()
  return !value.includes('.') || MULTI_LABEL_SUFFIXES.has(value)
}

/**
 * The registrable ("organizational") domain: `news.acme.com.br` →
 * `acme.com.br`, `mail.acme.com` → `acme.com`.
 */
export function registrableDomain(name: string): string {
  const labels = name.toLowerCase().split('.')
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  const take = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2
  return labels.slice(-take).join('.')
}
