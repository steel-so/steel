import { siteStylesheet } from '../../_components/site-catalog-adapter'

export default function SiteNotFound() {
  return (
    <div className='ss landing-page-light-scope'>
      <style>{siteStylesheet()}</style>
      <main className='ss-404'>
        <h1 className='ss-heading'>Página não encontrada</h1>
        <p className='ss-text' data-variant='lead'>
          O endereço pode ter mudado ou o site não está mais publicado.
        </p>
      </main>
    </div>
  )
}
