import { SITE_CHROME_CSS } from '../../_components/site-chrome-css'

export default function SiteNotFound() {
  return (
    <>
      <style>{SITE_CHROME_CSS}</style>
      <main className='ss-404'>
        <h1>Página não encontrada</h1>
        <p>O endereço pode ter mudado ou o site não está mais publicado.</p>
      </main>
    </>
  )
}
