/**
 * Tags da documentação, agrupadas (`x-tagGroups`, suportado pelo Scalar).
 * A ordem aqui é a ordem da navegação em /reference. Só entram no
 * documento as tags com ao menos uma operação registrada.
 */

interface TagGroupDefinition {
  readonly name: string
  readonly tags: readonly {
    readonly name: string
    readonly description: string
  }[]
}

export const TAG_GROUPS = [
  {
    name: 'Conta',
    tags: [
      {
        name: 'Autenticação',
        description:
          'Cadastro, login, sessão, OTP por e-mail e dois fatores. Servido pelo [Better Auth](https://www.better-auth.com/docs) em `/api/auth/*` — respostas fora do envelope padrão.',
      },
      {
        name: 'Usuário',
        description: 'Perfil, mídia e preferências do usuário autenticado.',
      },
      {
        name: 'Privacidade (LGPD)',
        description:
          'Consentimento de cookies, exportação e exclusão de dados (LGPD, art. 18).',
      },
      {
        name: 'Apps conectados (OAuth)',
        description:
          'Provedor OAuth 2.1 do Steel para integrações (servidor MCP): autorização com PKCE, registro dinâmico de cliente, tokens, consentimento por workspace e módulos, e a lista de apps conectados do usuário, com revogação (ADR 0033).',
      },
      {
        name: 'Tokens de API',
        description:
          'Tokens pessoais (`stl_pat_...`) da API pública v1: criação em Configurações › Segurança, login do CLI pelo fluxo de dispositivo (`steel login` + `/device`), lista e revogação pelo dono do token e pelos administradores do workspace (ADR 0035).',
      },
    ],
  },
  {
    name: 'Workspaces',
    tags: [
      {
        name: 'Workspaces',
        description:
          'Criação, edição e exclusão de workspaces (tenant). Tudo no Steel é escopado por workspace.',
      },
      {
        name: 'Membros e convites',
        description:
          'Membros do workspace, convites por e-mail e aceite de convite.',
      },
      {
        name: 'Perfis de acesso',
        description:
          'Perfis de permissão (RBAC) do workspace: mapa `recurso → ações`.',
      },
      {
        name: 'Configurações do workspace',
        description:
          'Conexões com Postgres externo por módulo, ajustes de IA, feature flags e notificações in-app.',
      },
      {
        name: 'Busca global',
        description:
          'Busca única (Ctrl+K) em chamados, base de conhecimento, diretório do ServiceDesk, CRM, WhatsApp e membros, com relevância por código exato, prefixo, texto completo e tolerância a erros de digitação. Só retorna o que o usuário pode abrir.',
      },
      {
        name: 'Projetos',
        description:
          'Projetos do workspace — criação, edição, arquivamento, favoritos, membros e convites.',
      },
      {
        name: 'Wiki',
        description:
          'Páginas colaborativas do workspace (árvore, editor Plate com edição em tempo real via Hocuspocus em `/realtime`), comentários, mídia e etiquetas. Desligada por padrão: um OWNER/ADMIN ativa em Ajustes › Wiki; enquanto isso as rotas de página/comentário/mídia respondem `403 WIKI_DISABLED`.',
      },
      {
        name: 'Quadro-branco',
        description:
          'Quadros Excalidraw do workspace: lista, criação, renomear, duplicar, arquivar, autosave da cena com bloqueio otimista (`baseRevision`) e trava de edição (um editor por vez), histórico de versões com restauração, imagens e miniaturas no bucket privado `whiteboards`. Ligado por padrão; OWNER/ADMIN desliga em Ajustes › Quadro-branco (rotas respondem `403 WHITEBOARD_DISABLED`).',
      },
      {
        name: 'Integrações',
        description:
          'Slack, GitHub e GitLab conectados uma vez por workspace (Ajustes › Integrações, OWNER/ADMIN) e usados por todos os módulos: regras de notificação no Slack, vínculo de chamados com issues/PRs/MRs e os webhooks públicos dos repositórios (ADR 0024).',
      },
      {
        name: 'Webhooks de saída',
        description:
          'Endpoints HTTPS do workspace que recebem os eventos do Steel assinados com HMAC-SHA256 (Ajustes › Webhooks, OWNER/ADMIN): cadastro com escolha de eventos, segredo (revelar e trocar), envio de teste e log de entregas com reenvio (ADR 0036).',
      },
      {
        name: 'API v1 · Webhooks',
        description:
          'Os mesmos webhooks de saída pela API pública v1, com token pessoal (`stl_pat_`): catálogo de eventos, endpoints, log de entregas, reenvio, `steel listen` (SSE) e `steel trigger` (evento de teste). Escrita exige `api:write`; só dono e administradores (ADR 0035 e 0036).',
      },
    ],
  },
  {
    name: 'Cobrança',
    tags: [
      {
        name: 'Assinaturas',
        description:
          'Planos pagos via AbacatePay, cupons e o webhook de cobrança.',
      },
    ],
  },
  {
    name: 'CRM',
    tags: [
      {
        name: 'CRM · Leads',
        description:
          'Leads, qualificação, contatos, reuniões e roteamento/score.',
      },
      {
        name: 'CRM · Pessoas e empresas',
        description: 'Pessoas, empresas e campos personalizados.',
      },
      {
        name: 'CRM · Oportunidades',
        description: 'Oportunidades, itens de linha, pipelines e etapas.',
      },
      {
        name: 'CRM · Propostas',
        description:
          'Propostas comerciais, templates e métricas de visualização.',
      },
      { name: 'CRM · Produtos', description: 'Catálogo de produtos.' },
      {
        name: 'CRM · Atividades e tarefas',
        description: 'Atividades, tarefas, notas e eventos de calendário.',
      },
      {
        name: 'CRM · Forecast e cotas',
        description: 'Previsão de vendas e cotas por vendedor.',
      },
      {
        name: 'CRM · Relatórios e dashboards',
        description: 'Relatórios e dashboards configuráveis.',
      },
      {
        name: 'CRM · E-mail marketing',
        description:
          'Campanhas, templates, listas, descadastros e contas de e-mail sincronizadas.',
      },
      {
        name: 'CRM · Campanhas',
        description:
          'Campanhas multicanal: destino (landing page ou formulário) com links rastreados, e-mail, WhatsApp opcional, público e resultados.',
      },
      {
        name: 'CRM · Formulários e landing pages',
        description: 'Formulários e landing pages (gestão interna).',
      },
      {
        name: 'CRM · Workflows',
        description: 'Automação de workflows: definição, versões e execuções.',
      },
      {
        name: 'CRM · Redes sociais',
        description:
          'Conexões sociais, posts agendados, tendências e concorrentes.',
      },
      {
        name: 'CRM · IA',
        description:
          'Hook Vault, análise de concorrentes e o mini chat de IA dos campos de texto.',
      },
      {
        name: 'CRM · Integrações',
        description: 'Chaves de API de integração (gestão interna).',
      },
      {
        name: 'CRM · Configurações',
        description: 'Configurações e membros do módulo CRM.',
      },
      {
        name: 'CRM · Sites',
        description:
          'Construtor de sites: sites, páginas, cabeçalho/rodapé/símbolos, publicação em versões, restauração e migração das landing pages.',
      },
      {
        name: 'CRM · Newsletters',
        description:
          'Newsletters do CRM (ADR 0054): publicações com remetente no domínio do cliente, assinantes com prova de consentimento, importação e exportação em CSV.',
      },
      {
        name: 'CRM · Newsletter · Edições',
        description:
          'Edições da newsletter: editor, teste, envio e agendamento, relatório (funil, cliques por link, destinatários) e o limite mensal de e-mails.',
      },
      {
        name: 'CRM · Newsletter · Segmentos',
        description:
          'Público das edições: segmentos salvos por newsletter (condições de assinante, engajamento e pessoa do CRM), público da edição e prévia ao vivo da audiência.',
      },
      {
        name: 'CRM · Newsletter · Engajamento',
        description:
          'Enquetes das edições (resultado, votantes, CSV) e a versão da edição no WhatsApp (configuração e entrega por número).',
      },
      {
        name: 'CRM · Newsletter · Automação',
        description:
          'Série de boas-vindas (e-mails depois da confirmação, com estatística por etapa) e reengajamento de assinantes inativos.',
      },
    ],
  },
  {
    name: 'Comunicação',
    tags: [
      {
        name: 'Comunicação · Conversas',
        description:
          'Conversas e mensagens do WhatsApp, atribuição e fechamento.',
      },
      { name: 'Comunicação · Contatos', description: 'Contatos do WhatsApp.' },
      { name: 'Comunicação · Grupos', description: 'Grupos do WhatsApp.' },
      {
        name: 'Comunicação · Transmissões',
        description: 'Transmissões (broadcasts) e importação de destinatários.',
      },
      {
        name: 'Comunicação · Campanhas de IA',
        description:
          'Campanhas em que a IA envia um template da Meta a um grupo de contatos e responde executando as ações habilitadas.',
      },
      {
        name: 'Comunicação · Templates e respostas rápidas',
        description: 'Templates aprovados pela Meta e respostas rápidas.',
      },
      {
        name: 'Comunicação · Conexões',
        description: 'Conexões com a Meta Cloud API e a Z-API.',
      },
      {
        name: 'Comunicação · IA',
        description: 'Atendimento por IA e base de conhecimento.',
      },
      {
        name: 'Comunicação · Dashboards e relatórios',
        description: 'Dashboards e relatórios de atendimento.',
      },
      {
        name: 'Comunicação · Configurações',
        description:
          'Configurações de atendimento, mídia e membros atribuíveis.',
      },
      {
        name: 'Comunicação · Chatbots',
        description:
          'Construtor visual de chatbot: fluxos de menus, perguntas, condições e integrações, com passagem para atendente ou para a IA, simulador e sessões.',
      },
      {
        name: 'Comunicação · Formulários (Flows)',
        description:
          'WhatsApp Flows: telas nativas da Meta (cadastro, agendamento, pesquisa) montadas no Steel, publicadas na WABA e enviadas por mensagem ou template, com a resposta gravada no contato e no CRM.',
      },
      {
        name: 'Comunicação · Tempo real e webhooks',
        description: 'SSE de eventos e webhooks de entrada da Meta e da Z-API.',
      },
      {
        name: 'Comunicação · Pesquisas',
        description:
          'Pesquisas de satisfação NPS, CSAT e CES por WhatsApp e e-mail: regras de envio, envio avulso, relatórios e o link público do e-mail.',
      },
      {
        name: 'Comunicação · Equipes',
        description:
          'Equipes de atendimento (líderes e agentes) e a visibilidade das conversas.',
      },
      {
        name: 'Comunicação · Ligações',
        description:
          'Ligações do "Ligar" pelo PABX: gravação, transcrição, resumo e onde aparecem (conversa, chamado, CRM).',
      },
      {
        name: 'Comunicação · Atendente de voz',
        description:
          'Atendente de voz com IA na URA do PABX (ADR 0046): ajustes, filas e números atendidos, segredo do dialplan, minutos do mês e os endpoints que o dialplan chama.',
      },
      {
        name: 'Comunicação · Pix',
        description:
          'Cobrança Pix dentro da conversa: envio do "copia e cola" pelo atendente ou pela IA, baixa do pagamento e ligação com a oportunidade do CRM.',
      },
    ],
  },
  {
    name: 'ServiceDesk',
    tags: [
      {
        name: 'ServiceDesk · Chamados',
        description:
          'Chamados ITIL (incidente, requisição, mudança, problema): abertura, quadro kanban, fases, SLA, participantes, escalonamento, rastreabilidade e tempo real. Agentes veem todos; solicitantes só os próprios.',
      },
      {
        name: 'ServiceDesk · Histórico e anexos',
        description:
          'Chat do chamado: mensagens públicas e notas internas (só agentes), edição/exclusão pelo autor em até 15 minutos e anexos (imagem, vídeo, áudio, documento — até 25 MB, bucket privado servido por rota autenticada).',
      },
      {
        name: 'ServiceDesk · Execução do atendimento',
        description:
          'Tarefas com responsável, prazo e ordem; custos por categoria (faturável ou não); peças do catálogo ou texto livre com fluxo de status e baixa de estoque. Só agentes.',
      },
      {
        name: 'ServiceDesk · Aprovações e assinaturas',
        description:
          'Pedidos de aprovação por e-mail com link público (token de uso único guardado como SHA-256; a primeira resposta decide) e assinaturas digitais (PNG + SHA-256 da imagem e de um snapshot do chamado).',
      },
      {
        name: 'ServiceDesk · Visões salvas',
        description:
          'Filtros, colunas e modo (kanban/lista/tabela) salvos do quadro de chamados — pessoais ou compartilhados.',
      },
      {
        name: 'ServiceDesk · Base de conhecimento',
        description:
          'Artigos (árvore, rascunho/publicado, interno/portal, categoria, tags), busca, votos de utilidade, comentários do editor, mídia e vínculo com chamados.',
      },
      {
        name: 'ServiceDesk · Configurações',
        description:
          'Configuração do ServiceDesk (ITIL 4): geral, departamentos, catálogo, classificações, impacto/urgência/prioridade/severidade e matriz, fluxos (fases e transições), calendários, SLA/OLA, escalonamento, automações, campos customizados, modelos, respostas prontas e peças.',
      },
      {
        name: 'ServiceDesk · Clientes e contatos',
        description:
          'Cadastro de clientes e empresas (CPF/CNPJ validado, endereço via ViaCEP) e seus contatos. Só agentes (membros de um departamento) e admins do ServiceDesk.',
      },
      {
        name: 'ServiceDesk · Portal do contato',
        description:
          'Portal público do contato do cliente (`/suporte`): link mágico por e-mail (token SHA-256, 7 dias, uso único), sessão própria de 12 horas no cookie `sd.portal_session` (sem Better Auth), lista e abertura de chamados, conversa com anexo, avaliação do atendimento e a base de conhecimento publicada. Tudo filtrado no service pelo contato e pelas empresas dele.',
      },
      {
        name: 'ServiceDesk · Painéis',
        description:
          'Painéis customizáveis (motor de dashboards com fontes de chamados, custos, eventos e artigos): contagem, soma, média, % de SLA, MTTR, backlog, criados × resolvidos, CSAT. Padrões "Dashboard analítico" e "KPIs (TV)"; modo TV em tela cheia. Só agentes.',
      },
      {
        name: 'ServiceDesk · WhatsApp',
        description:
          'Conexões de WhatsApp próprias do módulo (Z-API ou Meta Cloud API, credenciais cifradas, webhook e teste), conversas do ServiceDesk e a aba WhatsApp do chamado: vincular/iniciar/desvincular, janela de 24 h da Meta, envio de texto, arquivo e modelo aprovado — tudo espelhado no histórico do chamado.',
      },
      {
        name: 'ServiceDesk · Agente de IA',
        description:
          'Copiloto do agente (resumo, sugestão de resposta, classificação, rascunho da solução e conversa livre sobre o chamado) e pré-atendimento do solicitante (portal e WhatsApp): resolve pela base de conhecimento ou abre o chamado já triado. Usa o provedor e a cota de IA do workspace (ADR 0007); o contexto enviado vai com dados pessoais mascarados.',
      },
      {
        name: 'ServiceDesk · Monitoramento',
        description:
          'Origens de monitoramento (Zabbix e webhook genérico) e a entrada pública que abre chamado a partir do alerta: token por origem guardado como SHA-256, deduplicação por evento, mapa severidade → prioridade, vínculo com o item de configuração pelo host, encerramento automático na normalização e reabertura por instabilidade (flapping).',
      },
      {
        name: 'ServiceDesk · Inventário',
        description:
          'Inventário e descoberta de ativos: o agente (Windows e Linux) envia hardware, software e uso de disco e memória com um token por workspace; a varredura SNMP do worker descobre equipamentos de rede por faixa de IP; ambos alimentam a CMDB, abrem alertas de disco e memória e formam o catálogo de software.',
      },
      {
        name: 'ServiceDesk · Incidente maior',
        description:
          'Incidente maior declarado a partir de um chamado de incidente: agrupa os chamados filhos (com sugestões por categoria, item de configuração e cliente), abre a sala de guerra (swarming) e publica atualizações nas páginas de status. Só agentes.',
      },
      {
        name: 'ServiceDesk · Páginas de status',
        description:
          'Páginas de status públicas por cliente ou serviço: a administração (sessão) e a página aberta ao cliente, com inscrição por e-mail (confirmação em duas etapas) e aviso por e-mail e WhatsApp a cada atualização publicada.',
      },
      {
        name: 'ServiceDesk · E-mail',
        description:
          'Caixas de e-mail monitoradas por IMAP (credenciais cifradas, teste de conexão, leitura sob demanda, pausa), padrões do chamado aberto por e-mail, listas de remetentes e confirmação automática de abertura. A resposta pública do agente volta pela caixa, encadeada e com o código do chamado no assunto.',
      },
      {
        name: 'ServiceDesk · Notificações',
        description:
          'Central de notificações do módulo: preferências do próprio usuário (matriz evento × canal — no app, e-mail e WhatsApp, com os padrões do catálogo e o resumo diário opcional) e seguir/parar de seguir um chamado para receber seus eventos.',
      },
      {
        name: 'ServiceDesk · Plantão',
        description:
          'Escalas de plantão (on-call): camadas (primeira chamada, retaguarda…) com rodízio determinístico por fuso, trocas pontuais, linha do tempo das próximas semanas e quem está de plantão agora. Com calendário de expediente a escala só vale fora do horário comercial; o escalonamento pode avisar e reatribuir para quem está de plantão.',
      },
      {
        name: 'ServiceDesk · Chamados recorrentes',
        description:
          'Rotinas periódicas (manutenção preventiva): agenda no fuso da regra (frequência, intervalo, dias, horário, vigência e antecedência), valores do chamado gerado, pré-visualização das próximas ocorrências, histórico de "abriu, pulou ou falhou" e o "gerar agora". O worker abre os chamados com ator de sistema, de forma idempotente por ocorrência.',
      },
      {
        name: 'ServiceDesk · Mudanças e CAB',
        description:
          'Calendário de mudanças: janelas de manutenção e de congelamento (com recorrência simplificada e alvo por item de configuração ou departamento), as ocorrências expandidas do intervalo e as mudanças posicionadas pela janela planejada, com congelamento e conflito de item já detectados — aviso, não bloqueio: um admin confirma e o que foi ignorado fica na rastreabilidade. Inclui os comitês de mudança (CAB) com membros, votos obrigatórios, quórum e seleção por condições, e as rodadas de aprovação do chamado (um pedido por membro, contagem de votos e fechamento automático).',
      },
      {
        name: 'ServiceDesk · Contratos e horas',
        description:
          'Contratos de atendimento (franquia de horas, valor da hora, arredondamento, mínimo por chamado e a tabela de valores por tipo × prioridade × janela), os períodos de faturamento com consumo e excedente, e o apontamento de horas no chamado: cronômetro (um aberto por usuário) e lançamento manual. O período fechado congela os apontamentos.',
      },
      {
        name: 'ServiceDesk · Relatórios de SLA',
        description:
          'Relatórios de SLA agendados: recorte (clientes, departamentos, tipos), período apurado no fuso do relatório, formatos PDF/CSV gravados no bucket privado, agenda (dia 1–28, hora e fuso) e destinatários — e-mails livres mais os responsáveis das contas. O histórico guarda o resumo apurado (volume, cumprimento de prazo, MTTR, tempo de primeira resposta, CSAT, violações e as quebras por departamento, cliente e prioridade) e serve os arquivos por rota autenticada. O worker confere de hora em hora e nunca envia o mesmo período duas vezes.',
      },
      {
        name: 'ServiceDesk · Risco preditivo',
        description:
          'Risco de violação de SLA por heurística explicável (ADR 0016 — nada passa por LLM): a fila por risco, a previsão de um chamado com os fatores que pegaram e a frase do motivo de cada um, e os agrupamentos de incidentes repetidos como sugestão de problema (abrir o problema e descartar são ações do agente).',
      },
      {
        name: 'ServiceDesk · IA vs. técnico',
        description:
          'Painel que compara o que a IA sugeriu (triagem automática e copiloto) com o que o técnico fez: precisão por campo da classificação, calibração da confiança, aproveitamento das respostas e soluções sugeridas, desfecho do pré-atendimento e o consumo da cota de IA do ServiceDesk. Só leitura, só agentes, nada chama a IA.',
      },
      {
        name: 'ServiceDesk · Integrações',
        description:
          'Integrações com Slack e GitHub: conexão por workspace (Slack por OAuth do app, GitHub por token do repositório, tudo cifrado e nunca devolvido), canal por time para os eventos escolhidos do catálogo de notificações, abertura de chamado a partir de uma mensagem do Slack com a thread espelhada no histórico, vínculo de issue/PR com chamados de problema e mudança e o espelhamento do estado (fechada, reaberta, mesclada) por webhook assinado, com reconciliação horária.',
      },
      {
        name: 'ServiceDesk · CMDB',
        description:
          'Itens de configuração (CMDB) com hierarquia, atributos por tipo, garantia e chamados vinculados; tipos de item customizáveis.',
      },
    ],
  },
  {
    name: 'Páginas públicas do CRM',
    tags: [
      {
        name: 'CRM público · Formulários',
        description:
          'Formulários publicados — leitura e envio por visitantes, sem sessão (o `publicToken` é o acesso).',
      },
      {
        name: 'CRM público · Propostas',
        description:
          'Proposta compartilhada com o cliente: leitura, registro de visualização e aceite (o `shareToken` é o acesso).',
      },
      {
        name: 'CRM público · Landing pages',
        description:
          'Landing pages publicadas e registro de visualizações (o `shareToken` é o acesso).',
      },
      {
        name: 'CRM público · Integrações',
        description:
          'API de entrada de leads para sistemas externos, autenticada por chave de API do workspace.',
      },
      {
        name: 'CRM público · Workflows',
        description:
          'Gatilho de workflow por webhook (o `webhookToken` é o acesso).',
      },
      {
        name: 'CRM público · Descadastro',
        description:
          'Descadastro LGPD de campanhas de e-mail, incluindo o one-click do RFC 8058.',
      },
      {
        name: 'CRM público · Campanhas',
        description:
          'Link rastreado, pixel de abertura e webhook do Resend das campanhas multicanal.',
      },
      {
        name: 'CRM público · Sites',
        description:
          'Registro anônimo de visualizações dos sites publicados (sem sessão; o slug do site é o acesso).',
      },
      {
        name: 'CRM público · Modo TV',
        description:
          'Painel do CRM no telão da equipe de vendas: link somente leitura, sem login (o token é o acesso; revogar corta a tela).',
      },
      {
        name: 'CRM público · Newsletter',
        description:
          'Inscrição pública na newsletter, confirmação dupla, central de preferências e descadastro de um clique (RFC 8058). Sem sessão: o link assinado é o acesso.',
      },
    ],
  },
  {
    name: 'Plataforma',
    tags: [
      {
        name: 'Status',
        description:
          'Página de status pública e coleta de health checks dos componentes.',
      },
      {
        name: 'Comercial',
        description: 'Formulário "Fale com vendas" do site.',
      },
      {
        name: 'Redes sociais (OAuth e mídia)',
        description:
          'Callback OAuth das redes sociais do CRM e blobs temporários servidos às APIs das redes.',
      },
    ],
  },
  {
    name: 'Admin global',
    tags: [
      {
        name: 'Admin · Workspaces',
        description:
          'Gestão de qualquer workspace pelo admin da plataforma: detalhe, membros, perfis, módulos, features, plano, suspensão e exclusão.',
      },
      {
        name: 'Admin · Backups e operações',
        description:
          'Backups FULL/por workspace, download assinado, restauração e acompanhamento de operações assíncronas.',
      },
      {
        name: 'Admin · Métricas',
        description: 'Visão geral e métricas de uso da plataforma.',
      },
      {
        name: 'Admin · Changelog',
        description:
          'E-mails de novidades (changelog) para usuários: rascunho, destinatários e disparo.',
      },
      {
        name: 'Admin · Steel IA',
        description:
          'Margem da plataforma sobre o preço real dos modelos de IA (ADR 0019).',
      },
    ],
  },
  {
    name: 'Steel AI',
    tags: [
      {
        name: 'Steel AI',
        description:
          'Assistente de IA transversal (ServiceDesk, CRM, Comunicação e plataforma): conversas privadas, resposta em stream (SSE) e ações propostas no modo agente, que só executam com a confirmação do usuário.',
      },
      {
        name: 'Steel Agents',
        description:
          'Agentes autônomos: rodam por agenda, evento ou botão, com as permissões do responsável. Cada ferramenta é automática ou requer aprovação (exclusão sempre requer), e as aprovações acontecem pela caixa de entrada.',
      },
      {
        name: 'Steel MCP',
        description:
          'Servidor MCP remoto para clientes de IA (Claude, ChatGPT, Cursor…): as ferramentas de leitura do Steel AI, artigos da base de conhecimento e páginas da Wiki como resources e prompts prontos. Autenticado por OAuth do Steel (token por usuário e workspace).',
      },
    ],
  },
  {
    name: 'Legado (Nexo)',
    tags: [
      {
        name: 'Sticky Notes',
        description:
          'Notas rápidas pessoais. **Legado da base Nexo** — mantido por compatibilidade, sem evolução planejada.',
      },
      {
        name: 'Links Curtos',
        description:
          'Links salvos do usuário. **Legado da base Nexo** — mantido por compatibilidade, sem evolução planejada.',
      },
    ],
  },
  {
    // Public API v1 (`public/openapi.v1.json`, ADR 0035). The v1 document
    // drops the `v1 · ` prefix; the main document never uses these tags.
    name: 'API pública v1',
    tags: [
      {
        name: 'v1 · Autenticação',
        description:
          'Login do `steel` CLI pelo fluxo de dispositivo e logout (revogar o token em uso).',
      },
      {
        name: 'v1 · Conta',
        description:
          'O token pessoal em uso: dono, workspace, escopos e módulos.',
      },
      {
        name: 'v1 · ServiceDesk',
        description:
          'Chamados (listar, ver, abrir, comentar, mudar de fase) e o catálogo de serviços.',
      },
      {
        name: 'v1 · CRM',
        description:
          'Leads (listar, criar, importar CSV), oportunidades (listar, mudar de etapa) e funis.',
      },
      {
        name: 'v1 · Comunicação',
        description:
          'WhatsApp: templates aprovados, envio de template e situação de uma transmissão.',
      },
      {
        name: 'v1 · Webhooks',
        description:
          'Webhooks de saída: catálogo de eventos, endpoints, entregas, escuta em tempo real (`steel listen`) e eventos de teste.',
      },
    ],
  },
] as const satisfies readonly TagGroupDefinition[]

export type TagName = (typeof TAG_GROUPS)[number]['tags'][number]['name']
