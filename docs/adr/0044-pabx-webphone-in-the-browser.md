# 0044 — Telefone web: ligar e atender pelo navegador, direto no PABX

- **Status:** Aceita
- **Data:** 2026-10-20
- **Decisores:** product owner + time de engenharia

## Contexto

O "Ligar" da conversa do WhatsApp ([ADR 0043](./0043-pabx-call-recording-transcription-and-summary.md)
e o click-to-call anterior) pede ao PABX que **toque o ramal do usuário** e
depois disque para o contato: o usuário precisa de um telefone (ou do
WebPhone da plataforma antiga) para atender. O pedido foi ligar **e atender
direto na web**, no Steel.

Restrições que pesaram:

- **Cada device é um PABX** (Asterisk, `ip1ext` e token em `steel.device`);
  os ramais WebRTC já existem lá (`transport=wss`, DTLS-SRTP, ICE, alaw).
- **O WSS do PABX já é público** (`wss://sbc.stratustelecom.com.br:8089/ws`,
  certificado curinga válido). O navegador conversa direto com o PABX;
  não há como passar por trás do nginx/Apache de borda sem mexer nos dois.
- **Registrar o ramal tira o registro de quem estava nele** (o chan_sip guarda
  um contato por ramal): ligar o Steel desliga o WebPhone antigo do mesmo ramal.
- **O navegador precisa do segredo SIP do ramal** para autenticar. Entregá-lo
  a quem escolher um ramal qualquer no perfil seria entregar o ramal de outro
  cliente do mesmo PABX (e a conta de telefone dele).

## Decisão

O Steel ganha um telefone no navegador (SIP.js sobre WSS) que **registra o
ramal do usuário, liga e atende**. Ele fica no canto da tela e em qualquer
página do workspace; a conversa só chama o mesmo telefone.

- **Credenciais pelo backend, segredo no PABX.** `GET /api/users/me/webphone`
  pergunta ao PABX do device (`steel_webphone_endpoint.php`, autenticado pelo
  token do device) e devolve ramal, segredo, domínio e WSS. O segredo não
  fica gravado no Steel, não é cacheado (`no-store`) e não vai para o log;
  cada entrega é auditada.
- **Liberação por administrador.** `users.pabx_webphone_enabled` só é ligado
  por SQL/administração. Trocar o ramal ou o device no perfil **desliga** a
  liberação. O usuário continua escolhendo o device, mas só recebe o segredo
  de um par ramal/device que alguém aprovou. (O click-to-call continua
  aceitando qualquer par: ele não entrega segredo, mas fica registrado como
  ponto a rever.)
- **Uma aba por vez** (Web Lock `steel-webphone:<usuário>`): duas abas
  registrando o mesmo ramal se desregistrariam. A aba seguinte espera e assume
  quando a primeira fecha.
- **Ligação de saída** discada como `0` + número nacional (padrão das rotas
  `_0ZZ9XXXXXXXX`/`_0ZZ[2-6]XXXXXXX` dos contextos); **entrada** toca no
  canto da tela (Atender/Recusar), com toque e título da aba.
- **Navegador:** `Permissions-Policy: microphone=(self)` (antes `()`, que
  bloquearia o microfone em todas as páginas) e `connect-src` com
  `wss://*.stratustelecom.com.br:8089`.

## Consequências

- Atender e ligar pelo navegador sem telefone, sem passar o áudio pelo Steel
  (o áudio vai do navegador ao PABX em SRTP).
- **Quem usa o telefone web precisa fechar o WebPhone antigo do mesmo ramal**,
  senão os dois disputam o registro a cada renovação.
- O segredo SIP fica visível para o dono do ramal no navegador (inevitável em
  qualquer softphone web). Não há credencial efêmera no chan_sip; rotacionar o
  segredo do ramal invalida o que já foi entregue.
- Cada PABX precisa do endpoint de provisionamento e de um usuário MySQL
  só-leitura (runbook `pabx-webphone.md`). PABX de cliente em produção só com
  OK explícito.
- A ligação feita pelo navegador **ainda não entra no histórico** da conversa
  (`whatsapp_phone_calls`) nem na gravação do ADR 0043; ficam para uma próxima
  fase.

## Adendo 2026-10-22 — histórico e gravação das ligações do telefone web

A última consequência acima ficou resolvida: a ligação feita ou atendida no
navegador agora entra no histórico (`whatsapp_phone_calls`) e no fluxo de
gravação, transcrição e resumo do [ADR 0043](./0043-pabx-call-recording-transcription-and-summary.md).

- **Quem registra é o navegador, o PABX confirma.** O telefone avisa o Steel
  quando vai ligar ou quando começa a tocar uma chamada
  (`POST /api/workspaces/{id}/phone-calls/webphone`) e relata o atendimento e o
  fim (`PATCH …/phone-calls/{callId}/webphone`). A duração é medida no
  servidor. Só o dono da ligação a atualiza; o primeiro relato final vale
  (PABX ou navegador), o outro só completa os vínculos.
- **Uma ligação, uma linha.** A ligação de saída do navegador nasce com um
  `callback_token` próprio, que o telefone envia no INVITE
  (`X-Steel-Callback-Url`, `X-Steel-Callback-Token`, `X-Steel-Record`): o PABX
  relata e envia a gravação com **o mesmo token** do click-to-call, então cai
  na mesma linha. Para a chamada que chega ao navegador, o Steel reaproveita a
  linha existente pelo `UNIQUEID` do Asterisk (`pabx_unique_id`, único por
  workspace; o PABX o manda no INVITE em `X-Steel-Uniqueid` e no webhook como
  `uniqueid`) ou, sem ele, pelo mesmo ramal + mesmo número (chave DDD + 8
  últimos dígitos) nos últimos 5 minutos. Esse segundo caso cobre o "Ligar" por
  click-to-call quando o ramal toca justamente no telefone web.
- **Vínculos pelas mesmas regras.** A conversa vem do número (contato do
  WhatsApp, com ou sem 9º dígito e `55`) ou da conversa de onde o usuário
  ligou; chamado, pessoa e oportunidade do CRM são resolvidos por
  `PhoneCallLinkService`, o mesmo serviço do processamento da gravação. Eles
  agora são resolvidos **ao fim da ligação**, mesmo sem gravação.
- **`conversation_id` passou a aceitar nulo.** Uma ligação de/para um número
  sem conversa ainda aparece no chamado e no CRM (por telefone) e guarda o
  nome do identificador de chamadas em `remote_name`. Novas colunas:
  `direction` (`OUTBOUND`/`INBOUND`), `source` (`CLICK_TO_CALL`/`WEBPHONE`),
  `pabx_unique_id` e `remote_name`.
- **Gravação.** Só ligações de **saída** do navegador pedem gravação (quando o
  workspace grava), porque só nelas o Steel tem um token a entregar ao PABX
  antes da chamada. O aviso de gravação aparece no telefone enquanto a
  ligação dura. A chamada **recebida** no navegador entra no histórico, mas
  não é gravada nesta fase: o PABX gravaria sem token. Fica para uma fase
  futura (token por SIP INFO ou gravação no navegador).
- **Consequências.** O dono do ramal passa a conhecer o token da própria
  ligação de saída (pode, no máximo, enviar a gravação dela). O PABX deve
  aceitar `X-Steel-Callback-Url` só do host do Steel (runbook). Uma ligação
  cujo navegador fechou no meio fica em andamento até o PABX relatar o fim;
  sem o snippet de relato no PABX, ela permanece assim.
