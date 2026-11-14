import type { TourDefinition } from '../../../types'

export const campaignFlowTour: TourDefinition = {
  key: 'crm.campaigns.flow',
  version: 1,
  module: 'crm',
  title: 'Montar e acompanhar uma campanha',
  description: 'Os quatro passos para enviar e onde ver os resultados.',
  route: '/crm/campaigns/:id',
  openFrom: '/crm/campaigns',
  docsHref: '/docs/crm/campanhas',
  steps: [
    {
      title: 'Rascunho ou resultados',
      body: 'Enquanto a campanha é um rascunho, esta tela é um assistente de quatro passos e nada é enviado. Depois do envio, ela mostra os resultados. Este tour cobre os dois.',
    },
    {
      target: 'campaign-steps',
      title: 'Os quatro passos, nesta ordem',
      body: '1. Conteúdo: o e-mail e, se quiser, o WhatsApp. 2. Público: quem recebe. 3. Link (opcional): para onde a mensagem leva. 4. Revisar e enviar. Clique num passo para voltar a ele.',
      placement: 'bottom',
    },
    {
      target: 'campaign-template',
      title: 'Passo 1: o e-mail',
      body: 'Escolha o remetente, o assunto e o visual. Para criar um template novo, abra o editor e volte para a campanha com ele já selecionado. A prévia aparece ao lado.',
      placement: 'right',
    },
    {
      target: 'campaign-whatsapp',
      title: 'Passo 1: WhatsApp, se quiser',
      body: 'Ligue para enviar também por WhatsApp. É preciso uma conexão com um template aprovado. Os contatos sem telefone ou sem autorização recebem só o e-mail.',
      placement: 'top',
    },
    {
      target: 'campaign-audience',
      title: 'Passo 2: o público',
      body: 'Marque listas de e-mail, todas as pessoas do CRM ou leads por etapa do funil. O total de contatos aparece ao lado. Quem pediu descadastro nunca recebe.',
      placement: 'right',
    },
    {
      target: 'campaign-schedule',
      title: 'Passo 4: enviar agora ou agendar',
      body: 'Faça um envio de teste para você antes de tudo. Depois escolha Enviar agora ou Agendar, defina a janela de horário e confirme a base legal (LGPD).',
      placement: 'left',
    },
    {
      target: 'campaign-next',
      title: 'Continuar sem enviar',
      body: 'Continuar só avança de passo. Use Salvar rascunho para parar e voltar outro dia. Somente o botão do último passo envia ou agenda a campanha.',
      placement: 'top',
    },
    {
      target: 'campaign-results',
      title: 'Resultados',
      body: 'Depois do envio: contatos, e-mails abertos, cliques e conversões, com o funil de cada canal e a lista de contatos abaixo. Dá para pausar ou cancelar enquanto envia.',
      placement: 'bottom',
    },
  ],
}
