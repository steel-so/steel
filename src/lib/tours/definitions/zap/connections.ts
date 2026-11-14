import type { TourDefinition } from '../../types'

export const connectionsTour: TourDefinition = {
  key: 'zap.connections',
  version: 1,
  module: 'zap',
  title: 'Conexões do WhatsApp',
  description: 'Como conectar um número pela Meta ou pela Z-API.',
  route: '/settings/whatsapp',
  audience: 'admin',
  docsHref: '/docs/comunicacao/conexoes',
  steps: [
    {
      title: 'Seus números de WhatsApp',
      body: 'Antes de atender, é preciso conectar pelo menos um número. Aqui você liga, confere e remove os números do workspace.',
    },
    {
      target: 'zap-connections-intro',
      title: 'Meta ou Z-API',
      body: 'A API oficial da Meta é a opção recomendada e permite modelos e transmissões. A Z-API liga um número pelo QR Code e envia texto livre a qualquer hora.',
      placement: 'bottom',
    },
    {
      target: 'zap-connections-actions',
      title: 'Conectar um número',
      body: '"Conectar com a Meta" abre o login da sua conta e o Steel configura tudo sozinho. Para a Z-API, use "Adicionar conexão" e informe os dados da instância.',
      placement: 'bottom',
    },
    {
      target: 'zap-connections-list',
      title: 'Estado de cada número',
      body: 'Cada cartão mostra o status do número. Use "Atualizar status" ou "Testar conexão" para conferir, e "QR Code" para parear uma conexão Z-API.',
      placement: 'top',
    },
    {
      title: 'Limite de gasto',
      body: 'Em números da Meta, o botão "Limite de gasto" define quanto o número pode gastar por mês. Você escolhe se, ao atingir o limite, os envios pagos são bloqueados.',
    },
  ],
}
