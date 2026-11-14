import type { TourDefinition } from '../../types'

export const flowEditorTour: TourDefinition = {
  key: 'zap.flows.editor',
  version: 1,
  module: 'zap',
  title: 'Editor de formulário',
  description: 'Crie o formulário que o cliente preenche no WhatsApp.',
  route: '/zap/flows/:id',
  openFrom: '/zap/flows',
  docsHref: '/docs/comunicacao/formularios-flows',
  steps: [
    {
      title: 'Formulário dentro da conversa',
      body: 'O cliente preenche este formulário sem sair do WhatsApp. Aqui você monta as telas, os campos e o destino das respostas.',
    },
    {
      target: 'zap-flow-tabs',
      title: 'Telas, envio e respostas',
      body: '"Telas" é onde você desenha os campos. "Envio e CRM" define a mensagem que leva o formulário e o que fazer com a resposta. "Respostas" lista o que chegou.',
      placement: 'bottom',
    },
    {
      target: 'zap-flow-add-screen',
      title: 'Adicionar tela',
      body: 'Um formulário pode ter várias telas. Em cada uma você coloca título, texto e os campos que o cliente vai preencher.',
      placement: 'top',
    },
    {
      target: 'zap-flow-save',
      title: 'Salvar',
      body: 'Salve as alterações antes de enviar. O botão só fica ativo quando há algo novo.',
      placement: 'bottom',
    },
    {
      target: 'zap-flow-send-draft',
      title: 'Enviar rascunho à Meta',
      body: 'Manda o formulário para a Meta como rascunho, sem liberar para os clientes. É um jeito de conferir a aparência antes de publicar.',
      placement: 'bottom',
    },
    {
      target: 'zap-flow-publish',
      title: 'Publicar',
      body: 'Ao publicar, o formulário fica disponível para envio nas conversas. Depois de publicado, você pode criar um template que leva o formulário.',
      placement: 'bottom',
    },
  ],
}
