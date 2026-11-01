import {
  Analytics01Icon,
  Briefcase01Icon,
  Calendar03Icon,
  Globe02Icon,
  Key01Icon,
  SlidersHorizontalIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ProductPage } from '@/src/schemas/web-product-page.schema'

export const crmPage: ProductPage = {
  slug: 'crm',
  kind: 'product',
  template: 'object',
  label: 'CRM',
  meta: {
    title: 'CRM com leads, funis e propostas | Steel',
    description:
      'Leads com pontuação e roteamento, funis e oportunidades, propostas com aceite online, previsão de vendas, metas, campanhas e workflows num só CRM.',
  },
  hero: {
    eyebrow: 'CRM',
    title: 'Do primeiro contato à proposta aceita, sem trocar de ferramenta',
    subtitle:
      'Leads que chegam pontuados e com dono, funis com probabilidade por etapa e propostas que o cliente aceita por link. A venda inteira num registro só.',
    window: {
      title: 'CRM',
      nav: [
        'Leads',
        'Oportunidades',
        'Pessoas',
        'Empresas',
        'Propostas',
        'Previsão',
      ],
      active: 1,
      body: {
        kind: 'kanban',
        columns: [
          {
            title: 'Qualificação · 10%',
            tone: 'info',
            cards: [
              { title: 'Clínica Horizonte', meta: 'R$ 18.400 · Marina' },
              { title: 'Grupo Atlas', meta: 'R$ 42.000 · Pedro' },
            ],
          },
          {
            title: 'Proposta · 50%',
            tone: 'warning',
            cards: [
              { title: 'Rede Sol Farmácias', meta: 'R$ 67.900 · Marina' },
              { title: 'Transportes Lima', meta: 'R$ 12.300 · Júlia' },
            ],
          },
          {
            title: 'Negociação · 80%',
            tone: 'brand',
            cards: [{ title: 'Colégio Vértice', meta: 'R$ 31.500 · Pedro' }],
          },
          {
            title: 'Ganho',
            tone: 'success',
            cards: [{ title: 'Hotel Mirante', meta: 'R$ 24.000 · Júlia' }],
          },
        ],
      },
      aside: {
        kind: 'fields',
        title: 'Rede Sol Farmácias',
        chips: [
          { label: 'Proposta', tone: 'warning' },
          { label: 'Vista pelo cliente', tone: 'success' },
        ],
        rows: [
          { label: 'Valor', value: 'R$ 67.900' },
          { label: 'Probabilidade', value: '50%' },
          { label: 'Fechamento previsto', value: '28/10' },
          { label: 'Responsável', value: 'Marina Alves' },
        ],
      },
    },
  },
  highlights: {
    eyebrow: 'Dentro de cada oportunidade',
    title: 'Não é só um card no funil. É a negociação inteira.',
    subtitle:
      'Pessoa, empresa, atividades, notas, e-mails e a proposta enviada ficam no registro, para qualquer pessoa do time retomar a conversa.',
    items: [
      {
        title: 'Leads que chegam com dono',
        description:
          'Regras de pontuação somam pontos por cargo, origem ou cidade, e regras de roteamento entregam o lead ao vendedor certo.',
        visual: {
          kind: 'fields',
          title: 'Novo lead · Formulário do site',
          chips: [{ label: '72 pontos', tone: 'brand' }],
          rows: [
            { label: 'Cargo', value: 'Diretor de TI · +30' },
            { label: 'Origem', value: 'Landing page · +25' },
            { label: 'Cidade', value: 'Campinas · +17' },
            { label: 'Roteado para', value: 'Marina Alves' },
          ],
        },
      },
      {
        title: 'Histórico que conta a venda',
        description:
          'Cada atividade, troca de etapa, nota e tarefa entra na linha do tempo do registro, com autor e data.',
        visual: {
          kind: 'timeline',
          items: [
            {
              actor: 'Marina',
              action: 'registrou ligação de 18 min',
              time: 'seg',
            },
            { actor: 'Marina', action: 'enviou a proposta', time: 'ter' },
            {
              actor: 'Cliente',
              action: 'abriu a proposta 3 vezes',
              time: 'qua',
            },
            { actor: 'Marina', action: 'moveu para Negociação', time: 'hoje' },
          ],
        },
      },
      {
        title: 'Propostas com aceite online',
        description:
          'Monte a proposta a partir de um modelo, com produtos do catálogo. O cliente abre por link, e a visualização e o aceite voltam para o CRM.',
        visual: {
          kind: 'list',
          title: 'Propostas',
          items: [
            { label: 'Rede Sol Farmácias', meta: 'Vista', tone: 'info' },
            { label: 'Hotel Mirante', meta: 'Aceita', tone: 'success' },
            { label: 'Grupo Atlas', meta: 'Enviada', tone: 'neutral' },
            { label: 'Padaria Real', meta: 'Expirada', tone: 'danger' },
          ],
        },
      },
    ],
  },
  ai: {
    eyebrow: 'IA nas vendas',
    title: 'Uma IA que conhece o seu funil, e pede licença antes de mexer nele',
    items: [
      {
        title: 'Pergunte sobre o pipeline',
        description:
          'A skill /pipeline resume o funil, aponta oportunidades paradas e o que vence esta semana, com os dados reais do CRM.',
        visual: {
          kind: 'chat',
          messages: [
            { from: 'user', text: '/pipeline do time comercial' },
            {
              from: 'ai',
              text: 'R$ 174 mil em aberto. 3 oportunidades estão paradas há mais de 14 dias, todas em Proposta. A Rede Sol abriu a proposta ontem.',
            },
          ],
        },
      },
      {
        title: 'Ações com confirmação',
        description:
          'No modo Build, a Steel AI propõe criar a tarefa ou mover a etapa, mostra a prévia e só executa quando você confirma.',
        visual: {
          kind: 'chat',
          messages: [
            {
              from: 'ai',
              text: 'Posso criar a tarefa de follow-up para amanhã?',
            },
          ],
          action: {
            title: 'Criar tarefa',
            preview: 'Ligar para Rede Sol Farmácias · amanhã, 10:00 · Marina',
            confirm: 'Confirmar',
          },
        },
      },
      {
        title: 'Oportunidades paradas',
        description:
          'Um agente pronto revisa o funil toda segunda às 8h e sugere uma tarefa para cada negociação sem movimento.',
        visual: {
          kind: 'list',
          title: 'Paradas há mais de 14 dias',
          items: [
            { label: 'Grupo Atlas', meta: '21 dias', tone: 'warning' },
            { label: 'Transportes Lima', meta: '16 dias', tone: 'warning' },
          ],
        },
      },
      {
        title: 'Propostas vencendo',
        description:
          'Outro agente olha a validade das propostas em dias úteis e sugere uma tarefa para quem precisa agir antes do prazo.',
        visual: {
          kind: 'stats',
          items: [
            { label: 'Vencem em 3 dias', value: '4', tone: 'warning' },
            { label: 'Em aberto', value: 'R$ 98 mil', tone: 'neutral' },
          ],
        },
      },
      {
        title: 'Perguntar ao Steel AI',
        description:
          'No painel do lead, da pessoa, da empresa ou da oportunidade, um clique abre a conversa já com o registro como contexto.',
        visual: {
          kind: 'form',
          title: 'Perguntar ao Steel AI',
          fields: [
            {
              label: 'Sobre a oportunidade Rede Sol',
              value: 'Qual o próximo passo?',
            },
          ],
          button: 'Perguntar',
        },
      },
    ],
  },
  details: {
    eyebrow: 'Por baixo do capô',
    title: 'O que um CRM de verdade precisa ter',
    subtitle:
      'Os recursos que aparecem quando o time cresce e a gestão começa a cobrar número.',
    items: [
      {
        title: 'Previsão e metas',
        description:
          'Forecast pela probabilidade de cada etapa e metas por vendedor e período, lado a lado.',
        icon: Analytics01Icon,
      },
      {
        title: 'Campos personalizados',
        description:
          'Campos próprios em empresas, pessoas, leads e oportunidades, nos formulários e nos relatórios.',
        icon: SlidersHorizontalIcon,
      },
      {
        title: 'E-mail e agenda conectados',
        description:
          'Conecte Gmail ou Outlook para trazer o histórico de e-mails e os eventos de calendário ao CRM.',
        icon: Calendar03Icon,
      },
      {
        title: 'Catálogo de produtos',
        description:
          'Produtos e serviços com preço, usados nas oportunidades e nas propostas.',
        icon: Briefcase01Icon,
      },
      {
        title: 'Redes sociais e concorrentes',
        description:
          'Contas de Facebook, Instagram, TikTok, YouTube, Google Ads e Analytics, e o acompanhamento de concorrentes.',
        icon: Globe02Icon,
      },
      {
        title: 'Chaves de integração',
        description:
          'Chaves por workspace para o seu site ou outro sistema criar leads direto no CRM pela API.',
        icon: Key01Icon,
      },
    ],
  },
  connected: {
    eyebrow: 'Recursos conectados',
    title: 'A venda puxa o resto do workspace',
    subtitle:
      'Captação, automação, conversa e números chegam ao CRM sem cópia e cola.',
    items: [
      {
        title: 'Campanhas e landing pages',
        description:
          'Páginas de captura e formulários criam leads direto no funil, e as campanhas de e-mail nutrem quem ainda não comprou.',
        href: '/features/campanhas',
        visual: {
          kind: 'stats',
          items: [
            { label: 'Visitas na página', value: '2.481', tone: 'neutral' },
            {
              label: 'Leads gerados',
              value: '186',
              delta: '7,5%',
              tone: 'success',
            },
          ],
        },
      },
      {
        title: 'Workflows',
        description:
          'Quando um lead é ganho, crie a empresa, a tarefa de onboarding e mande o e-mail de boas-vindas sozinho.',
        href: '/features/workflows',
        visual: {
          kind: 'flow',
          steps: [
            { label: 'Lead ganho', tone: 'success' },
            { label: 'Criar empresa', tone: 'info' },
            { label: 'Enviar e-mail de boas-vindas', tone: 'brand' },
          ],
        },
      },
      {
        title: 'Comunicação no WhatsApp',
        description:
          'A conversa com o cliente acontece no WhatsApp Business do mesmo workspace, com o contato ligado ao CRM.',
        href: '/product/comunicacao',
        visual: {
          kind: 'chat',
          messages: [
            {
              from: 'contact',
              text: 'Recebi a proposta. Dá para parcelar em 6x?',
            },
            { from: 'agent', text: 'Dá sim! Atualizo e te mando agora.' },
          ],
        },
      },
      {
        title: 'Dashboards',
        description:
          'Painéis com receita, conversão por etapa e ranking do time, sobre os mesmos dados do funil.',
        href: '/features/dashboards',
        visual: {
          kind: 'chart',
          title: 'Receita ganha por mês',
          variant: 'bars',
          points: [32, 45, 38, 52, 61, 58, 74, 80],
          caption: 'R$ mil',
        },
      },
    ],
  },
  cta: {
    title: 'Venda com o funil inteiro na mesma tela',
    subtitle:
      'Importe seus contatos, desenhe as etapas e coloque o time para vender. A gente ajuda na migração.',
  },
}
