import type { TourDefinition } from '../../../types'

export const crmSocialTour: TourDefinition = {
  key: 'crm.social',
  version: 1,
  module: 'crm',
  title: 'Agendar posts',
  description: 'Escreva uma vez e publique em várias redes, agora ou depois.',
  route: '/crm/social',
  docsHref: '/docs/crm/redes-sociais',
  steps: [
    {
      title: 'Publique em várias redes',
      body: 'Componha o post uma vez e publique em Instagram, Facebook, TikTok e YouTube, agora ou na data marcada.',
    },
    {
      target: 'crm-social-platforms',
      title: 'Escolha as redes',
      body: 'Só dá para marcar redes com conta conectada. Para conectar, abra a rede desejada no grupo Social do menu. Para acompanhar rivais, use Concorrentes no mesmo grupo.',
      placement: 'bottom',
    },
    {
      target: 'crm-social-content',
      title: 'Escreva o texto',
      body: 'Digite a legenda do post. O contador abaixo do campo mostra quantos caracteres você usou e o limite permitido.',
      placement: 'right',
    },
    {
      target: 'crm-social-media',
      title: 'Anexe imagem ou vídeo',
      body: 'TikTok e YouTube exigem vídeo, e o feed do Instagram exige imagem. Confira o que a rede escolhida pede antes de publicar.',
      placement: 'right',
    },
    {
      target: 'crm-social-when',
      title: 'Agora ou agendado',
      body: 'Escolha "Agora" para publicar já, ou "Agendar" para marcar dia e hora. O Steel publica sozinho no horário.',
      placement: 'right',
    },
    {
      target: 'crm-social-submit',
      title: 'Publicar ou agendar',
      body: 'O botão muda conforme a escolha: "Publicar agora" ou "Agendar". Confirme para enviar o post.',
      placement: 'top',
    },
    {
      target: 'crm-social-queue',
      title: 'Fila de agendamentos',
      body: 'Aqui aparecem os posts agendados. Você pode remarcar, publicar na hora ou cancelar cada um enquanto não foram ao ar.',
      placement: 'left',
    },
  ],
}
