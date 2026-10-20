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

## Diagnóstico

| Sintoma | Causa provável |
| --- | --- |
| Botão **Ligar** usa o click-to-call (toca o ramal) | Usuário sem `pabx_webphone_enabled` |
| "Telefone web sem conexão · Reconectar" | WSS inacessível/certificado não cobre o nome, ou o PABX recusou o registro (segredo trocado) |
| "Permita o microfone no navegador" | Microfone bloqueado no site; precisa de HTTPS |
| `PABX_CALL_FAILED … não está habilitado para WebRTC` | O ramal não tem `transport=wss`, `encryption=yes` e `dtlsenable=yes` |
| Liga mas sem áudio | RTP/ICE bloqueado entre o navegador e o PABX (UDP 10000-20000) |
| Chamada cai "O contato está ocupado/Número não encontrado" | Resposta SIP 486/404 da rota de saída do tenant |
