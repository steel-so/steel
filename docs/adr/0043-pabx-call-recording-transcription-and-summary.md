# 0043 — Voz no PABX, fase 1: a ligação vira gravação, transcrição e resumo

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner (frente 4 do roadmap do Steel AI, aprovada em 18/10) + time de engenharia

## Contexto

O "Ligar" da conversa do WhatsApp disca pelo PABX do próprio usuário
(Asterisk, um por device, endereço e token em `steel.device`). O dialplan
avisa o Steel por `POST /api/pabx/calls/webhook` com um token por ligação
(só o SHA-256 fica no banco), e a ligação termina como `COMPLETED` com uma
duração — e mais nada. O que foi dito some.

Restrições que pesaram:

- **Não mexemos nos PABX.** Cada PABX é de um cliente; o integrador aplica
  um trecho de dialplan/PHP documentado, primeiro só no PABX de teste
  (172.20.28.248).
- **LGPD.** Gravar voz é tratamento de dado pessoal: precisa de aviso ao
  contato, prazo de retenção e exclusão. Desligado por padrão.
- **Anthropic não transcreve áudio.** A resposta automática do WhatsApp já
  usa o Whisper da OpenAI, com a chave da plataforma, qualquer que seja o
  provedor do chat do workspace.
- **O proxy do Next (`proxy.ts`) só bufferiza 10 MB do corpo**, e a API de
  transcrição aceita até 25 MB por arquivo.
- **Visibilidade já existe** em cada lugar onde a ligação aparece: conversa
  (equipe/responsável), chamado (agente do ServiceDesk) e CRM (RBAC do
  recurso).

## Decisão

A gravação sobe do PABX para o Steel ao fim da ligação, autenticada pelo
mesmo token por ligação; um job transcreve, resume e anexa a ligação à
conversa, ao chamado aberto dela e à pessoa/oportunidade do CRM com o mesmo
telefone. Tudo opt-in por workspace.

### Gravação

- **Ajuste por workspace** (WhatsApp › Configurações › Atendimento):
  gravar ligações (padrão: desligado), texto do aviso de gravação, retenção
  do áudio em dias (padrão 90, de 1 a 1.825) e transcrever/resumir com o
  Steel AI (padrão: ligado).
- **Aviso.** Quando a gravação está ligada, o Steel pede `gravar=1` ao PABX e
  a faixa da ligação mostra ao atendente o aviso para ler ao contato. O
  texto mostrado fica gravado na ligação (`recordingNotice`), como prova do
  aviso. O PABX pode, além disso, tocar um áudio de aviso (runbook).
- **Upload**: `POST /api/pabx/calls/webhook/recording`, multipart com
  `token` e `file`. Fica sob o prefixo público do webhook, então não muda o
  `proxy.ts`. Só aceita quando a ligação pediu gravação, foi atendida (ou
  ainda não tem relatório final — o upload pode chegar antes do `HANGUP`),
  ainda não tem gravação e foi criada há menos de 24 h. O tipo é conferido
  pelos bytes do arquivo (WAV, MP3 ou OGG), não pelo nome. **Limite de
  10 MB**: é o que o proxy entrega inteiro e cabe na API de transcrição. O
  runbook converte para MP3 mono de 32 kbit/s (≈ 40 min em 10 MB) quando o
  `lame` existe no PABX; WAV de 8 kHz cabe ≈ 10 min.
- **Armazenamento**: bucket privado `phone-call-recordings`, chave
  `<workspaceId>/<callId>.<ext>` (entra na exportação e na exclusão do
  workspace por prefixo). O áudio é servido pelo app com suporte a `Range`
  (o MinIO não é público), depois da mesma checagem de visibilidade da
  lista.
- **Retenção e exclusão**: a data de expiração é congelada no upload
  (`recordingExpiresAt`); o job de retenção das 03:00 apaga o áudio vencido
  e varre objetos órfãos (ligação apagada em cascata com a conversa, o
  contato ou o workspace). Admin do módulo apaga a gravação na hora pelo
  card. Transcrição e resumo ficam com a ligação e saem junto com ela.

### Transcrição e resumo

- Fila `phone-call-ai`, job `process-recording`. Pula (`SKIPPED`, com o
  motivo) quando a transcrição está desligada, o Steel AI está desligado no
  workspace, a cota do mês acabou ou não há chave da OpenAI.
- **Transcrição** com o Whisper (`whisper-1`, o mesmo caminho da resposta
  automática, agora em `src/lib/ai/transcription.ts`). Custo por minuto
  (US$ 0,006 × margem da plataforma, ADR 0019) lançado no razão de uso como
  `PHONE_CALL_AI`.
- **Resumo, sentimento e próximos passos** com o modelo de resposta do
  WhatsApp do workspace, em JSON validado, também como `PHONE_CALL_AI`.
- **Mascaramento de dados pessoais** antes do provedor: gancho previsto para
  quando a frente de proteções (ADR 0041) chegar à `main` — hoje é um TODO
  no service.
- **Onde aparece**: na linha do tempo da conversa (card entre as
  mensagens), numa aba "Ligações" do chamado vinculado à conversa (só
  agentes) e na atividade da pessoa e da oportunidade do CRM. O vínculo é
  resolvido no processamento: chamado mais recente da conversa (aberto
  primeiro), pessoa do CRM cujo telefone casa com o do contato (DDD + 8
  últimos dígitos, para pegar números com e sem o nono dígito) e a
  oportunidade aberta mais recente em que ela é o contato principal.
- **Quem vê**: em cada lugar, a regra daquele registro — quem vê a conversa,
  agentes do ServiceDesk, quem tem `VIEW` em pessoas/oportunidades do CRM. O
  áudio libera para quem vê qualquer um dos registros vinculados.
- **"Criar tarefa"** a partir de um próximo passo: tarefa do chamado na aba
  do ServiceDesk; tarefa do CRM (pessoa/oportunidade) no CRM e na conversa
  quando há pessoa vinculada.

### Fase 2 (planejada; construída na [ADR 0046](./0046-pabx-voice-agent-ivr-realtime.md), 22/10/2026)

Atendente de voz com IA na URA: o PABX entrega a ligação recebida a um
serviço de voz em tempo real (Asterisk `AudioSocket`/`ExternalMedia` para um
worker que fala com um modelo de voz em streaming). O atendente identifica o
contato pelo número, abre chamado, consulta status de chamado e transfere
para um ramal ou fila com o contexto (resumo + chamado) já anexado — usando
as mesmas ferramentas do registro do Steel AI, com a confirmação e os
limites de alçada das ADRs 0021 e 0041. Pré-requisitos: latência medida no
PABX de teste, decisão de provedor de voz (custo por minuto), e aviso de
atendimento automatizado na URA. Ganha ADR própria quando for aprovada.

## Consequências

- A ligação passa a deixar rastro: o que foi dito, o resumo e o que fazer
  depois aparecem onde o time já trabalha, sem ninguém digitar.
- Cada PABX precisa do trecho do runbook
  (`docs/runbooks/pabx-call-recording.md`) e o nginx precisa aceitar 10 MB
  em `/api/pabx/`. Sem isso nada quebra: a ligação segue como hoje.
- Ligações acima de ~40 min (MP3) ou ~10 min (WAV) não sobem. Se virar
  problema: upload direto ao MinIO por URL pré-assinada e transcrição em
  pedaços.
- O áudio só vale enquanto a retenção deixar; quem precisa guardar mais
  aumenta o prazo, nunca sem limite (máximo de 5 anos).
- Revisitar quando a ADR 0041 estiver na `main` (mascaramento antes do
  provedor) e quando a fase 2 for aprovada.
