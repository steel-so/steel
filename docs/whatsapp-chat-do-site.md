# Chat para o site (E1)

Widget de chat que o cliente cola no site. A conversa cai no mesmo inbox do
zap, com equipes, SLA, chatbot (Z2) e a IA de atendimento. Manual do usuário:
`content/docs/comunicacao/chat-do-site.mdx`.

## Desenho

- **Conexão virtual.** Ao ligar o chat pela primeira vez o workspace ganha uma
  `WhatsAppConnection` com `provider = WIDGET` (módulo COMMUNICATION,
  `phoneNumber = 'widget'`, sempre `CONNECTED`). Ela não aparece na lista de
  conexões nem nas campanhas do CRM (`provider: { not: 'WIDGET' }`). O
  cliente de envio do `WIDGET` (`src/lib/whatsapp/widget-client.ts`) não faz
  rede: a mensagem já está gravada na conversa e o navegador a recebe por
  polling.
- **Visitante.** `WhatsAppWidgetVisitor` liga um navegador a um
  `WhatsAppContact` (`waId = widget:<uuid>`). O navegador guarda um token
  aleatório num cookie do site do cliente (e no `localStorage`); o banco guarda
  só o SHA-256. O visitante e o contato nascem na **primeira mensagem**, nunca
  ao abrir o chat.
- **Entrada.** A mensagem do visitante passa por
  `WhatsAppWebhookService.ingestInboundMessage`, o mesmo caminho do WhatsApp
  (fila, SLA, chatbot, IA, sentimento). A equipe configurada entra por
  `routeTeamId` (só quando a mensagem abre ou reabre a conversa).
- **Saída.** Respostas de atendente, IA e chatbot são mensagens `OUT` comuns;
  `GET /api/widget/messages` devolve as novas (cursor `after`).
- **Fora do horário.** Usa o horário de atendimento da Comunicação
  (`WhatsAppBusinessHoursService.check`). O aviso é gravado como mensagem
  `OUT`, no máximo uma vez a cada 12 h por conversa.
- **Pesquisa (T1).** Com `showSurvey`, o chat mostra a pesquisa aberta do
  contato depois que a conversa fecha e a resposta entra por
  `SatisfactionSurveyService.handleInbound`. O envio da pesquisa pelo cliente
  `WIDGET` apenas marca a pesquisa como enviada.
- **Portal.** `showPortal` mostra um link para `/suporte` (o portal abre em
  outra aba: ele não pode ser embutido, `frame-ancestors 'none'`).

## Segurança

- Credencial pública: chave `stw_...` (`?key=`) + cabeçalho `Origin` na lista
  `allowedOrigins` (exata ou `https://*.dominio`). Sem `Origin` ou fora da
  lista, 403 e nenhum cabeçalho CORS. O preflight valida igual.
- Limites (`src/lib/rate-limit.ts`): leitura por IP (240/min), novo visitante
  por IP (10 a cada 10 min), envio por visitante (20/min). Campo isca
  `website` nas mensagens.
- O script (`public/steel-widget.js`) vive num Shadow DOM e adota o CSS pelo
  CSSOM, então uma CSP estrita do site (sem estilo inline) não o quebra.
  Servido em caminho estável, com `Cross-Origin-Resource-Policy: cross-origin`
  (`next.config.ts`); `/steel-widget.js` e `/api/widget` estão em
  `PUBLIC_ROUTES` do `proxy.ts`.
- Trocar a chave (`POST .../widget/rotate-key`) invalida os trechos colados.

## Fora desta entrega

Arquivos enviados pelo visitante, indicador "digitando", tempo real por SSE
(hoje polling de 3 s com o chat aberto), histórico entre dispositivos
diferentes, e identificação do visitante pelo CRM (e-mail já cadastrado).
