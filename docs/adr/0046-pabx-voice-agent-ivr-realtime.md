# 0046 — Voz no PABX, fase 2: atendente de voz com IA na URA

- **Status:** Aceita
- **Data:** 2026-10-22
- **Decisores:** product owner (delegação da onda de fechamento do roadmap do Steel AI, 22/10) + time de engenharia

Continua a [ADR 0043](./0043-pabx-call-recording-transcription-and-summary.md)
(fase 1: gravação, transcrição e resumo) e usa as regras de confirmação e de
alçada das [ADR 0021](./0021-steel-ai-autopilot-mode.md) e
[0041](./0041-ai-guardrails-pii-injection-auto-reply-limits.md).

## Contexto

A fase 1 da voz transforma a ligação em informação depois que ela acaba. Falta
o outro lado: quem **liga** para a empresa cai numa URA de teclas ou numa fila
que pode estar cheia. A ADR 0043 deixou o atendente de voz como fase 2:
o PABX entrega a ligação recebida a um serviço de voz em tempo real, que
identifica o contato, abre ou consulta chamado e transfere para uma pessoa com
o contexto já anexado.

Restrições que pesaram:

- **Não mexemos nos PABX.** O trecho de dialplan fica documentado
  (`docs/runbooks/pabx-voice-agent.md`) e o integrador aplica primeiro só no
  PABX de teste. Nada deste repositório altera um PABX.
- **O chamador não é usuário do Steel.** Ninguém autenticou quem fala; qualquer
  coisa que ele diga é dado não confiável (injeção de prompt por voz existe).
- **Custo e abuso.** Áudio em tempo real é a chamada de IA mais cara do produto
  e o número da empresa é público. Precisa de teto de duração, teto mensal de
  minutos por workspace e de um interruptor por fila/DID.
- **Latência.** Uma conversa por voz só funciona abaixo de ~1 s entre o fim da
  fala do chamador e o início da resposta; isso precisa ser medido no PABX de
  teste antes de ligar para um cliente.
- **LGPD.** Falar com uma IA por telefone tem de ser avisado antes de qualquer
  coisa, e o áudio não deve ser guardado se a transcrição basta.

## Decisão

Um serviço de ponte no worker liga a ligação do Asterisk (`AudioSocket`) a uma
sessão de voz em tempo real da OpenAI, atrás de uma interface de provedor.
O atendente é **desligado por padrão** e um administrador o liga por workspace
e por fila/DID.

### Provedor

- **OpenAI Realtime API** (`gpt-realtime`, WebSocket), com a chave de plataforma
  `OPENAI_API_KEY` já usada pela transcrição. O modelo é configurável por
  `VOICE_AGENT_REALTIME_MODEL`.
- O provedor fica atrás de `RealtimeVoiceProvider`
  (`src/lib/voice-agent/provider.ts`): a ponte só conhece PCM 16-bit mono a
  8 kHz, eventos de transcrição, chamada de ferramenta e uso. Trocar de provedor
  é escrever outra implementação da interface; nenhuma outra peça muda.
- O áudio vai ao provedor em G.711 μ-law 8 kHz (`audio/pcmu`), o mesmo formato
  da telefonia: sem reamostragem e com 1/6 da banda do PCM de 24 kHz.

### Transporte e ciclo de vida da ligação

1. O dialplan chama `POST /api/pabx/voice-agent/session` com o segredo do
   workspace, o número de quem ligou e a fila/DID. O Steel confere se o
   atendente está ligado para aquela fila/DID, se há minutos no mês e cota de
   IA, **cria a ligação** (`WhatsAppPhoneCall` com `voiceAgent = true`) e
   responde `OK:<uuid>`; qualquer outra resposta (`NO:<motivo>`) manda o
   dialplan seguir o caminho humano de sempre.
2. O dialplan chama `AudioSocket(<uuid>, host:porta)`. O worker aceita a conexão
   TCP, lê o UUID, reivindica a ligação de forma atômica (o UUID é um segredo
   de uso único, válido por 2 minutos) e abre a sessão com o provedor.
3. Terminada a ponte, o dialplan chama `POST /api/pabx/voice-agent/outcome` e
   recebe `TRANSFER:<destino>` (com o contexto já anexado à ligação) ou
   `HANGUP`. Transferir é sempre feito pelo Asterisk, nunca pelo Steel.

### Segurança do endpoint do PABX

O dialplan se autentica com um **segredo por workspace** (gerado no Ajustes,
mostrado uma única vez, só o SHA-256 fica no banco), comparado em tempo
constante. As rotas ficam sob `/api/pabx/` e limitadas por IP como o webhook de
status. A porta do `AudioSocket` não tem autenticação própria no protocolo:
quem a alcança precisa de um UUID emitido pelo Steel e ainda não usado, e o
runbook manda restringir a porta ao IP do PABX no firewall.

### Regras da conversa

- **Aviso obrigatório de atendimento automatizado**, falado palavra por palavra
  no início (texto do workspace ou o padrão da plataforma). O texto falado fica
  em `recordingNotice` da ligação, como prova. Nenhuma ferramenta roda antes de
  o aviso terminar.
- **Duração máxima** (padrão 5 min, até 15) e **teto mensal de minutos** por
  workspace (padrão 300). A ponte usa o menor entre a duração máxima e o saldo
  de minutos do mês; ao esgotar, transfere para uma pessoa.
- **Transferência para humano** em qualquer erro do provedor, silêncio do
  chamador (padrão 20 s), limite de duração ou pedido explícito dele ("quero
  falar com uma pessoa"). Sem destino configurado, a ligação é encerrada com
  uma despedida — nunca fica muda.
- **Sem gravação de áudio.** A transcrição vem da própria sessão em tempo real
  e é a única coisa guardada; o resumo, o sentimento e os próximos passos saem
  do mesmo pipeline da ADR 0043 (fila `phone-call-ai`, que pula o Whisper
  quando a ligação já traz a transcrição).

### Ferramentas (registro do Steel AI)

O atendente age como uma **identidade de execução** escolhida pelo admin
(`runAsUser`, como o dono de um Steel Agent, ADR 0020): as permissões são as
dela, e `resolveToolAccess` + `hasToolAccess` do registro decidem o que ela
pode. Ferramentas liberadas, todas pelo registro (`runTool`), com a origem
`VOICE` no `AiActionLog`:

| Ferramenta de voz | Registro / serviço | Regras |
| --- | --- | --- |
| `identify_contact` | `zap_contacts_search` pelo número de quem ligou | só leitura; devolve nome e se é conhecido |
| `open_ticket` | `sd_create_ticket` | em dois passos: a 1ª chamada devolve a prévia (`preview`) para o modelo ler ao chamador; só `confirmed: true` depois de um "sim" executa. No máximo **1 chamado por ligação**; só `INCIDENT` e `SERVICE_REQUEST`; descrição leva o número do chamador. Negada se a fala do chamador acionou as heurísticas de injeção (ADR 0041) |
| `ticket_status` | `SdTicketService.get` | só chamados **do próprio chamador** (contato do ServiceDesk ou ligação anterior com o mesmo telefone); devolve código, título, fase e prazo, nada de histórico, e-mail ou descrição. Outro número responde "não encontrei" |
| `transfer_to_human` | decisão da ponte | ramal/fila da rota, senão o destino geral; leva o resumo e o chamado aberto |

Alçada (ADR 0021/0041): a abertura de chamado é a única escrita, é um CREATE
não destrutivo, sem exclusão e sem mensagem a cliente; como a ADR 0021, roda sem
tela de confirmação porque quem confirma é o chamador, por voz. Um chamador não
autenticado nunca lê dado de outra pessoa.

**Dados pessoais.** O áudio do chamador chega ao provedor sem como mascarar
(a voz é o dado); isso é dito no aviso e no texto da LGPD. Tudo o que o Steel
devolve ao modelo é mínimo (nome e dados do próprio chamado), e o texto que
vira resumo passa pelo `AiUsageService.prepare` da fase 1, com o mascaramento
da ADR 0041.

### Uso, custo e auditoria

- Cada sessão lança uma linha no razão de uso com a feature `VOICE_AGENT`
  (tokens de áudio e de texto do `response.done`, preço do modelo × margem da
  plataforma, ADR 0019). Os minutos contam no teto do workspace, o custo na cota
  mensal de IA (ADR 0019): sem cota, a sessão nem abre.
- Eventos de auditoria: `voice_agent_settings` (criar/atualizar/girar segredo),
  `voice_agent_route` e, por ligação, `whatsapp_phone_call` (`voice_start`,
  `voice_end`, `voice_transfer`, com o motivo).

### Onde fica

- Ponte: `src/lib/voice-agent/*` (protocolo AudioSocket, codec, provedor, ponte,
  ferramentas); servidor TCP no worker (`worker/voice-agent-server.ts`),
  ligado só com `VOICE_AGENT_AUDIOSOCKET_PORT`.
- Regras: `VoiceAgentService`; ajustes em Comunicação › Ajustes › Atendente de
  voz; uso no painel de uso de IA.

## Consequências

- Quem liga fora do horário ou com a fila cheia é atendido, tem o contato
  identificado e o chamado aberto, e a pessoa que atender depois já sabe do que
  se trata. O custo aceito é o de áudio em tempo real: por isso os dois tetos e
  o interruptor por fila/DID.
- O worker passa a manter conexões longas (uma por ligação). Um deploy do
  worker corta as ligações em curso; o runbook manda fazê-lo fora do horário e a
  transferência por erro do dialplan cobre quem estiver falando.
- A latência fim a fim depende da rede entre PABX, worker e OpenAI. **Não ligar
  o atendente para clientes antes de executar o passo de aceite do runbook** no
  PABX de teste. A ponte mede, por turno, do fim da fala detectado pelo provedor
  ao primeiro áudio da resposta (campos `latencyP50Ms`/`latencyP95Ms` do log
  `voice_agent.session_ended`); meta p50 < 1 s e p95 < 1,8 s, a soma de ~0,5 s
  de detecção de fim de fala fica por conta do cliente.
- Sem gravação de áudio não há como reouvir a ligação; a transcrição do
  provedor pode errar. Se um cliente precisar da prova em áudio, a ADR 0043
  (gravação no PABX) continua valendo e é independente.
- Revisitar quando: o preço do áudio em tempo real mudar (tabela em
  `src/lib/voice-agent/pricing.ts`); houver pedido de mais ferramentas
  (consulta de oportunidade no CRM, agendamento); ou o provedor de voz for
  trocado (implementar outra `RealtimeVoiceProvider`).
