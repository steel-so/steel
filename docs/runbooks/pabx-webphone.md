# Telefone web: ligar e atender pelo navegador

Quando usar: liberar o **telefone web** (botão **Ligar** e chamadas recebidas
no próprio Steel) para um usuário, ou instalar o provisionamento num PABX.
Decisão: [ADR 0044](../adr/0044-pabx-webphone-in-the-browser.md).

> **Só com OK explícito por PABX.** Comece pelo PABX de teste
> **172.20.28.248** (devices 0, 191, 192, 447, 515, WSS em
> `sbc.stratustelecom.com.br`). PABX de cliente em produção só com
> autorização do responsável. Faça backup em `/root/steel-backups/` antes.

## Como funciona

1. O navegador chama `GET /api/users/me/webphone`. O Steel lê o endereço e o
   token do device em `steel.device` e pergunta ao
   `steel_webphone_endpoint.php` do PABX, que devolve ramal, segredo SIP,
   domínio e WSS (só para ramais WebRTC).
2. O SIP.js conecta no `wss://…:8089/ws`, **registra o ramal** e fica pronto
   para ligar (`0` + DDD + número) e atender.
3. Só uma aba do navegador mantém o telefone (Web Lock). As outras mostram
   "Aberto em outra aba" e assumem quando a primeira fecha.

## 1. PABX (uma vez)

Os arquivos estão em `infra/pabx/`.

```bash
# Usuário só-leitura, restrito às colunas necessárias (senha aleatória).
PW=$(openssl rand -hex 16)
mysql -e "CREATE USER 'steel_webphone'@'localhost' IDENTIFIED BY '$PW';
  GRANT SELECT (name, secret, transport, encryption, dtlsenable, \`enable\`)
  ON realtimedb.sippeers TO 'steel_webphone'@'localhost'; FLUSH PRIVILEGES;"

# Configuração (modo 640, root:www-data): copie steel_webphone_api.php.example
# para /etc/asterisk/steel_webphone_api.php e troque a senha e o WSS.
install -m 640 -o root -g www-data steel_webphone_api.php.example /etc/asterisk/steel_webphone_api.php

# Endpoint (644, root:root), ao lado do steel_call_endpoint.php.
install -m 644 -o root -g root steel_webphone_endpoint.php /var/www/html/steel_webphone_endpoint.php
php -l /var/www/html/steel_webphone_endpoint.php
```

Pré-requisitos do PABX: `/etc/asterisk/steel_call_api.php` (o mesmo do
click-to-call), Asterisk com `tlsenable` no `http.conf` (porta 8089) e um
**nome DNS dentro do certificado** apontando para o PABX (o navegador não
valida certificado por IP). Teste:

```bash
curl -sk -o /dev/null -w '%{http_code}\n' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Protocol: sip' https://sbc.stratustelecom.com.br:8089/ws   # 101
```

## 2. Liberar um usuário

O usuário informa **ramal** e **device** no perfil (aba Perfil). Um
administrador confere que o ramal é dele e liga a liberação no banco do Steel:

```sql
UPDATE users
SET pabx_webphone_enabled = true
WHERE email = 'fulano@empresa.com.br'
  AND pabx_extension = '1122S' AND pabx_device_id = '0';
```

Trocar o ramal ou o device no perfil **desliga** a liberação. O perfil do
usuário fica em cache por 15 min (`user:<id>` no Redis); apague a chave para
valer na hora.

> **Antes de liberar:** o telefone web **registra** o ramal e substitui o
> registro do WebPhone antigo. Peça para fechar o antigo.

## 3. Histórico e gravação das ligações do telefone web

Desde o adendo de 22/10 ao [ADR 0044](../adr/0044-pabx-webphone-in-the-browser.md),
cada ligação feita ou atendida no navegador vira uma ligação do histórico da
conversa (e do chamado/CRM), igual ao "Ligar" por click-to-call. **Não exige
nada no PABX** para aparecer no histórico: o próprio navegador avisa o Steel.
Para **gravar** as ligações de saída do telefone web, o PABX precisa ler três
cabeçalhos do INVITE e reaproveitar o `MixMonitor` e o script de upload do
[runbook de gravação](./pabx-call-recording.md) (seções 3 e 4).

> **Só com OK explícito por PABX**, começando pelo de teste (172.20.28.248).
> Faça backup do `extensions_rt.conf` em `/root/steel-backups/` antes de editar.
> Este trecho **não foi aplicado em nenhum PABX**: é a receita para o
> integrador.

O navegador envia, nas ligações de saída:

| Cabeçalho SIP | Conteúdo |
| --- | --- |
| `X-Steel-Callback-Url` | URL do webhook de status do Steel (o upload vai em `<url>/recording`) |
| `X-Steel-Callback-Token` | segredo da ligação (o mesmo do click-to-call) |
| `X-Steel-Record` | `1` quando o workspace grava as ligações |

Sub-rotina a chamar no começo da rota de saída do tenant (`_0ZZ9XXXXXXXX`,
`_0ZZ[2-6]XXXXXXX`, …), só para o user-agent `steelphone`, que já é checado
ali. Ajuste `STEEL_HOST` para o host público do Steel:

```
[steel-webphone-record]
exten => s,1,GotoIf($["${CHANNEL(useragent)}" != "steelphone"]?fim)
 ; Os cabeçalhos vêm do navegador e o MixMonitor roda um comando:
 ; filtre os caracteres (evita injeção) e só aceite callback para o Steel.
 same => n,Set(STEEL_CALLBACK_URL=${FILTER(a-zA-Z0-9.:/_-,${SIP_HEADER(X-Steel-Callback-Url)})})
 same => n,Set(STEEL_CALLBACK_TOKEN=${FILTER(a-zA-Z0-9_-,${SIP_HEADER(X-Steel-Callback-Token)})})
 same => n,GotoIf($["${STEEL_CALLBACK_URL:0:8}" != "https://"]?fim)
 same => n,GotoIf($["${CUT(STEEL_CALLBACK_URL,/,3)}" != "STEEL_HOST"]?fim)
 same => n,GotoIf($["${STEEL_CALLBACK_TOKEN}" = ""]?fim)
 same => n,GotoIf($["${SIP_HEADER(X-Steel-Record)}" != "1"]?fim)
 same => n,Set(STEEL_REC_FILE=/var/spool/asterisk/monitor/steel/${UNIQUEID}.wav)
 same => n,MixMonitor(${STEEL_REC_FILE},b,/usr/local/bin/steel-upload-recording.sh ${STEEL_REC_FILE} ${STEEL_CALLBACK_URL} ${STEEL_CALLBACK_TOKEN})
 same => n(fim),Return()
```

Na rota: `same => n,Gosub(steel-webphone-record,s,1)` antes do `Dial`. Depois
`asterisk -rx "dialplan reload"`.

Opcional, para o Steel reconhecer a mesma chamada pelos dois lados:

- **Chamada recebida no navegador:** no contexto que toca o ramal WebRTC,
  `Set(SIPADDHEADER01=X-Steel-Uniqueid: ${UNIQUEID})` antes do `Dial`. O
  navegador repassa o `UNIQUEID` e o Steel reaproveita a ligação do
  click-to-call que já existe. Sem o cabeçalho, o Steel casa por ramal +
  número nos últimos 5 minutos.
- **Webhook de status do click-to-call:** acrescente `uniqueid=${UNIQUEID}`
  ao `CURL()` que já reporta `HANGUP`; o Steel guarda o id na ligação.

Limites desta fase: a chamada **recebida** no navegador aparece no histórico,
mas **não é gravada**; e o PABX não reporta o fim das ligações de saída do
navegador (quem reporta é o navegador). Se o navegador fechar no meio da
ligação, ela fica "em andamento" no histórico.

### Teste (PABX de teste)

1. Ligue **Gravar ligações** e **Transcrever** no Steel (WhatsApp ›
   Configurações › Atendimento) e use um usuário liberado no telefone web.
2. Da conversa de um contato, clique **Ligar**: a faixa do telefone mostra o
   aviso de gravação. Fale 20 s e desligue.
3. Em até 1 min, a ligação aparece na linha do tempo da conversa; com a
   gravação, o resumo aparece em alguns minutos. Confira também o chamado
   vinculado e a pessoa/oportunidade do CRM.
4. Ligue para o ramal e deixe tocar sem atender: aparece "Perdida" no
   histórico. Faça um "Ligar" por click-to-call com o telefone web aberto no
   mesmo ramal e atenda no navegador: continua **uma** ligação só.
5. Confira no banco: `select id, source, direction, status, pabx_unique_id from
   whatsapp_phone_calls order by created_at desc limit 5;`.

## Diagnóstico

| Sintoma | Causa provável |
| --- | --- |
| Botão **Ligar** usa o click-to-call (toca o ramal) | Usuário sem `pabx_webphone_enabled` |
| "Telefone web sem conexão · Reconectar" | WSS inacessível/certificado não cobre o nome, ou o PABX recusou o registro (segredo trocado) |
| "Permita o microfone no navegador" | Microfone bloqueado no site; precisa de HTTPS |
| `PABX_CALL_FAILED … não está habilitado para WebRTC` | O ramal não tem `transport=wss`, `encryption=yes` e `dtlsenable=yes` |
| Liga mas sem áudio | RTP/ICE bloqueado entre o navegador e o PABX (UDP 10000-20000) |
| Chamada cai "O contato está ocupado/Número não encontrado" | Resposta SIP 486/404 da rota de saída do tenant |
| A ligação do navegador não aparece no histórico | Usuário sem permissão de editar conversas no módulo Comunicação, ou sem ramal/device no perfil (o registro responde 403/422 e o telefone segue funcionando) |
| Ligação do navegador sem gravação | Workspace com **Gravar ligações** desligado, chamada **recebida** (não gravada), ou o PABX sem a sub-rotina `steel-webphone-record` |
| Ligação "em andamento" que ficou presa | O navegador fechou antes de desligar e o PABX não reportou o fim; corrija com `update whatsapp_phone_calls set status='FAILED', ended_at=now() where id='…'` |
