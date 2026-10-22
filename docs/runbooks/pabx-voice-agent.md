# Atendente de voz com IA na URA do PABX

Quando usar: ligar o atendente de voz (IA) numa fila ou num número (DID) de um
PABX, para atender, identificar o contato, abrir ou consultar chamado e passar
para uma pessoa com o contexto. Decisão: [ADR 0046](../adr/0046-pabx-voice-agent-ivr-realtime.md).

> **Nada aqui é aplicado por código deste repositório.** O trecho de dialplan
> abaixo é um modelo: só entra em um PABX com OK explícito do responsável, e
> **primeiro só no PABX de teste 172.20.28.248**. PABX de cliente em produção
> (ex.: 172.20.28.100) só com autorização. Antes de mexer, faça backup de
> `/etc/asterisk/` em `/root/steel-backups/` como nos outros runbooks de PABX.

## Como funciona

1. Entra uma ligação na fila/DID. O dialplan pergunta ao Steel
   (`POST /api/pabx/voice-agent/session`) se a IA pode atender. Resposta
   `OK:<uuid>` = pode; `NO:<motivo>` = siga o fluxo humano de sempre.
2. O dialplan abre `AudioSocket(<uuid>, <ip-do-worker>:<porta>)`. O worker
   (`steel-worker`) aceita a conexão e abre uma sessão de voz em tempo real com
   a OpenAI. A primeira coisa dita é o **aviso de atendimento automatizado**.
3. A IA conversa. Pode identificar o contato, abrir chamado (com confirmação
   por voz), consultar chamado **do próprio telefone** e passar para uma pessoa.
4. Ao terminar (cliente desligou, transferência, silêncio, limite de tempo ou
   erro) o `AudioSocket()` retorna e o dialplan pergunta onde a ligação vai
   (`POST /api/pabx/voice-agent/outcome`): `TRANSFER|<ramal ou fila>` ou
   `HANGUP`. **Quem transfere é o Asterisk**, nunca o Steel.
5. A ligação fica registrada (conversa, chamado, CRM) como as outras, com a
   transcrição e o resumo da IA. Não há gravação de áudio.

## 1. Servidor do Steel (uma vez)

1. No `.env` do servidor (`/var/www/steel/.env`, vem do SOPS):

   ```env
   OPENAI_API_KEY=...                      # já existe (transcrição)
   VOICE_AGENT_AUDIOSOCKET_PORT=8090       # liga o servidor AudioSocket do worker
   VOICE_AGENT_AUDIOSOCKET_BIND=10.10.100.31   # IP privado que o PABX alcança
   # VOICE_AGENT_REALTIME_MODEL=gpt-realtime   # opcional
   ```

   `VOICE_AGENT_AUDIOSOCKET_BIND` é lido pelo `docker-compose.yml` (padrão
   `127.0.0.1`, ou seja, fechado). Sem `VOICE_AGENT_AUDIOSOCKET_PORT` o worker
   nem abre a porta.
2. **Firewall**: o protocolo `AudioSocket` não tem senha. Libere a porta
   **somente para o IP do PABX** (o UUID de uso único é a segunda trava, mas a
   primeira é a rede):

   ```sh
   sudo ufw allow from 172.20.28.248 to any port 8090 proto tcp
   ```

3. Suba de novo o worker (`docker compose up -d steel-worker`), **fora do
   horário de atendimento**: reiniciar o worker corta as ligações que a IA
   estiver atendendo (o dialplan então leva o cliente para uma pessoa).
4. O `nginx` já aceita `/api/pabx/` (runbook de gravação). Confira que o PABX
   alcança `https://<steel>/api/pabx/voice-agent/session` (rede/VPN).

Conferir: `docker logs steel-worker 2>&1 | grep voice_agent.server_listening`.

## 2. Steel — configurar o workspace

Em **Comunicação › Configurações › Atendente de voz** (OWNER/ADMIN):

1. **Em nome de quem o atendente age**: prefira uma conta de serviço do
   workspace com só as permissões necessárias (`sd-tickets` × `CREATE`/`VIEW`,
   `contacts` × `VIEW`). Os chamados abertos pela IA saem no nome dela.
2. **Aviso falado**: revise o texto (o padrão já diz que é atendimento
   automatizado por IA e que a conversa é transcrita).
3. **Orientações da empresa**, **voz**, **duração máxima** (padrão 5 min),
   **teto de minutos por mês** (padrão 300) e **silêncio tolerado** (20 s).
4. **Ramal ou fila que atende uma pessoa** (destino geral). Cada fila/número
   pode ter o seu.
5. **Filas e números atendidos**: cadastre os do PABX de teste.
6. **Segredo do PABX**: *Gerar segredo* e copie na hora (não aparece de novo).
   Anote também o **id do workspace** (Ajustes › Geral).
7. Só então ligue **Ligar o atendente de voz** e salve. O aviso "Servidor ainda
   não está pronto" some quando o passo 1 foi feito.

## 3. PABX — dialplan (modelo; não aplicar sem OK)

Requisitos: Asterisk ≥ 16.6 / 17 com `res_audiosocket` e `app_audiosocket`
(`asterisk -rx "module show like audiosocket"`) e `func_curl`.

No contexto de entrada da fila/DID, **antes** de enviar para a fila de pessoas
(o contexto `steel-voz-ia` abaixo é novo; ajuste `fluxo-humano` para o destino
que a fila usa hoje):

```
[steel-voz-ia]
; Variáveis do workspace (id e segredo do passo 2).
exten => s,1,NoOp(Steel atendente de voz)
 same => n,Set(STEEL_URL=https://steel.exemplo.com.br/api/pabx/voice-agent)
 same => n,Set(STEEL_WS=<id-do-workspace>)
 same => n,Set(STEEL_SECRET=<segredo>)
 same => n,Set(STEEL_AUDIOSOCKET=10.10.100.31:8090)
 same => n,Answer()
 ; 1) A IA pode atender? Qualquer falha de rede cai no fluxo humano.
 same => n,Set(RES=${CURL(${STEEL_URL}/session,workspace=${STEEL_WS}&secret=${STEEL_SECRET}&caller=${URIENCODE(${CALLERID(num)})}&queue=${URIENCODE(${STEEL_FILA})}&did=${URIENCODE(${STEEL_DID})})})
 same => n,GotoIf($["${RES:0:3}" = "OK:"]?agente:humano)
 ; 2) Conversa por voz (retorna ao fim da sessão).
 same => n(agente),Set(STEEL_SESSION=${RES:3})
 same => n,AudioSocket(${STEEL_SESSION},${STEEL_AUDIOSOCKET})
 ; 3) Para onde vai a ligação?
 same => n,Set(OUT=${CURL(${STEEL_URL}/outcome,workspace=${STEEL_WS}&secret=${STEEL_SECRET}&session=${STEEL_SESSION})})
 same => n,GotoIf($["${OUT:0:9}" = "TRANSFER|"]?transfere:fim)
 same => n(transfere),Set(STEEL_DESTINO=${OUT:9})
 same => n,Goto(fluxo-humano,${STEEL_DESTINO},1)
 same => n(fim),Hangup()
 same => n(humano),Goto(fluxo-humano,s,1)
```

- `STEEL_FILA` e `STEEL_DID` são a fila e o número discado que o contexto de
  entrada já conhece (defina com `Set` antes do `Goto(steel-voz-ia,s,1)`).
- `fluxo-humano` é o contexto que hoje atende a fila: o destino que o Steel
  devolve (`200`, `suporte`...) precisa existir como extensão **nesse**
  contexto (`exten => 200,1,Dial(...)` / `exten => suporte,1,Queue(suporte)`).
- Se o cliente desligar durante a conversa, o Asterisk encerra o canal e o
  dialplan não continua: é o esperado.
- Recarregue: `asterisk -rx "dialplan reload"`.

## 4. Aceite — medir a latência no PABX de teste (obrigatório)

**Não ligue o atendente para clientes antes de fechar este passo.** Quem
executa: o integrador, no PABX de teste, com um workspace de teste.

1. Faça **10 ligações** de teste de números diferentes (celular e fixo, rede
   boa e ruim), cada uma com pelo menos 4 turnos (cumprimento, um problema, o
   número de um chamado, "quero falar com uma pessoa").
2. Em cada ligação, confira: o aviso de atendimento automatizado é a primeira
   fala; interromper a IA fala por cima dela (ela cala); o silêncio de 20 s
   transfere; pedir uma pessoa transfere para o destino certo; o cliente
   desligando encerra limpo.
3. Leia a latência de cada sessão no log do worker:

   ```sh
   docker logs steel-worker 2>&1 | grep voice_agent.session_ended
   ```

   Os campos `latencyP50Ms`, `latencyP95Ms`, `latencyMaxMs` e `latencyTurns` são
   o tempo, por turno, **do fim da fala do cliente (já detectado pelo
   provedor) até o primeiro áudio da resposta chegar ao worker**. No Axiom:
   `['steel-logs'] | where message == "voice_agent.session_ended"`.
4. Critério de aceite, sobre todos os turnos das 10 ligações:

   | Medida | Meta | Reprova se |
   | ------ | ---- | ---------- |
   | p50 | < 1,0 s | ≥ 1,3 s |
   | p95 | < 1,8 s | ≥ 2,5 s |

   A latência percebida pelo cliente soma ainda ~0,5 s de detecção de fim de
   fala e o trecho de rede do PABX. Registre os números (p50/p95 por ligação e
   o geral) no card da entrega.
5. Se reprovar: confira a rota de rede PABX → worker → OpenAI (`ping`/`mtr`),
   a região do servidor e se `VOICE_AGENT_REALTIME_MODEL` é o modelo mais
   rápido disponível; repita. Não afrouxe a meta sem nova decisão do product
   owner.
6. Confira também, em cada ligação: o card aparece na conversa do WhatsApp do
   número, com transcrição, resumo e, quando houve, o chamado na aba
   **Ligações**; o uso aparece em **Ajustes › Steel AI › Uso** como "Atendente
   de voz (URA)"; os minutos do mês sobem em Atendente de voz.

## Operação

- **Desligar na hora**: Comunicação › Configurações › Atendente de voz ›
  desligar. As próximas ligações já seguem o fluxo humano (`NO:disabled`). Para
  uma fila só: desligue a chave dela em *Filas e números atendidos*.
- **Girar o segredo**: *Gerar novo segredo* e atualize `STEEL_SECRET` no
  dialplan; o anterior para de valer na hora (o dialplan cai no fluxo humano
  até atualizar).
- **Custo**: teto de minutos por workspace e cota mensal de IA. Passou do teto
  ou da cota, o Steel responde `NO:no_minutes` / `NO:no_quota` e o fluxo humano
  atende.
- **Respostas `NO:`**: `disabled` (desligado), `no_route` (fila/número não
  cadastrado), `not_ready` (sem chave, sem porta, sem "age em nome de" ou
  módulo desligado), `no_minutes`, `no_quota`, `invalid_caller` (número
  anônimo), `no_connection` (o workspace não tem conexão de WhatsApp para
  guardar a conversa).

| Sintoma | Causa provável |
| ------- | -------------- |
| Dialplan sempre cai no humano, HTTP 401 | `STEEL_WS`/`STEEL_SECRET` errados (segredo girado?) |
| `NO:no_route` | a fila/DID que o dialplan manda não é igual ao cadastrado (maiúsculas, espaços) |
| `OK:` mas silêncio e volta ao humano | o PABX não alcança `STEEL_AUDIOSOCKET` (firewall/BIND) ou o worker não abriu a porta (`voice_agent.server_listening`) |
| Aviso não é falado, sessão cai | falha com a OpenAI: veja `voice_agent.session_crashed` / `provider_error` no log e a chave `OPENAI_API_KEY` |
| IA não abre chamado | a conta "age em nome de" não tem `sd-tickets` × `CREATE`, ou o módulo ServiceDesk está desligado |
| Ligação sem resumo | cota de IA do mês acabou ou Steel AI desligado (`aiSkipReason` no card) |
| Cliente ouve eco/corte | áudio fora de `slin` 8 kHz: confira que nenhum `Set(CHANNEL(...))` força outro formato antes do `AudioSocket()` |
