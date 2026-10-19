# Gravação das ligações no PABX (transcrição e resumo)

Quando usar: ligar a gravação das ligações do botão **Ligar** (WhatsApp) num
PABX do cliente, para o Steel guardar o áudio, transcrever e resumir a
ligação na conversa, no chamado e no CRM. Decisão: [ADR 0043](../adr/0043-pabx-call-recording-transcription-and-summary.md).

> **Só com OK explícito por PABX.** Comece pelo PABX de teste
> **172.20.28.248** (devices 0, 191, 192, 447, 515). PABX de cliente em
> produção (ex.: 172.20.28.100) só com autorização do responsável. Antes de
> mexer, faça backup em `/root/steel-backups/` como no click-to-call.

## Como funciona

1. Com **Gravar ligações** ligado (WhatsApp › Configurações › Atendimento),
   o Steel manda `gravar=1` junto do pedido de ligação ao
   `steel_call_endpoint.php`. Sem o ajuste, nada muda: o parâmetro nem é
   enviado.
2. O PHP grava `STEEL_RECORD=1` no call file. O dialplan liga o
   `MixMonitor` no canal do ramal **antes** do `Goto` para o contexto do
   tenant; a opção `b` só grava enquanto a ligação está em ponte (o toque não
   entra).
3. Ao desligar, o `MixMonitor` fecha o arquivo e chama
   `steel-upload-recording.sh`, que converte para MP3 (se o `lame` existir) e
   envia para `<callback_url>/recording` com o mesmo `callback_token` do
   webhook de status.
4. O Steel confere o token, o tipo do arquivo (pelos bytes) e o tamanho
   (**até 10 MB**), guarda no MinIO e o worker transcreve e resume.

Tamanho: WAV de 8 kHz ≈ 1 MB por minuto (cabe ~10 min); MP3 mono 32 kbit/s
≈ 240 KB por minuto (cabe ~40 min). Instale o `lame` no PABX se der.

## 1. Servidor do Steel (uma vez)

O nginx do servidor precisa aceitar o upload. No `server` do Steel, junto
das outras `location`:

```nginx
# Gravações das ligações (ADR 0043): até 10 MB por arquivo.
location /api/pabx/ {
    client_max_body_size 11m;
    proxy_pass http://steel_app;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering on;
}
```

Depois: `sudo nginx -t && sudo systemctl reload nginx`. Se o PABX chega pelo
proxy de borda (Apache do 10.10.100.31), confira que ele não limita o corpo
(`LimitRequestBody` ausente ou ≥ 11 MB) — ver
[proxy de borda](./mcp-edge-proxy.md).

Nada mais: o bucket `phone-call-recordings` é criado no primeiro upload e a
fila `phone-call-ai` sobe com o worker.

## 2. PABX — PHP do endpoint

Em `/var/www/html/steel_call_endpoint.php`, onde o call file é montado, leia
o parâmetro e grave a variável no call file (junto das que já levam o
`callback_url` e o `callback_token`):

```php
// Gravação pedida pelo Steel (ADR 0043). Ausente = não grava.
$gravar = (($_POST['gravar'] ?? '') === '1') ? '1' : '0';

// ... na montagem do call file, ao lado dos outros Setvar:
$callFile .= "Setvar: STEEL_RECORD={$gravar}\n";
```

Confira o nome das variáveis que o PHP já usa para a URL e o token de
callback (abaixo aparecem como `STEEL_CALLBACK_URL` e `STEEL_CALLBACK_TOKEN`;
use os nomes que estiverem lá).

## 3. PABX — dialplan

Em `/etc/asterisk/extensions_rt.conf`, no contexto `steel-api-*` que roda
no canal do ramal, **logo antes** do
`Goto(${SIPPEER(${RAMAL},context)},0${DESTINO},1)`:

```
 same => n,GotoIf($["${STEEL_RECORD}" != "1"]?steel_sem_gravacao)
 same => n,Set(STEEL_REC_FILE=/var/spool/asterisk/monitor/steel/${UNIQUEID}.wav)
 same => n,MixMonitor(${STEEL_REC_FILE},b,/usr/local/bin/steel-upload-recording.sh ${STEEL_REC_FILE} ${STEEL_CALLBACK_URL} ${STEEL_CALLBACK_TOKEN})
 same => n(steel_sem_gravacao),Goto(${SIPPEER(${RAMAL},context)},0${DESTINO},1)
```

(Troque a linha do `Goto` existente pela última linha acima, com o rótulo.)

Opcional: tocar um aviso curto **para o atendente** antes da discagem
(`same => n,Playback(steel/aviso-gravacao)`). O aviso ao contato é lido pelo
atendente — o Steel mostra o texto na faixa da ligação. Tocar o aviso para o
contato exigiria mudar o `Dial` do contexto do tenant, que não é nosso.

Recarregue: `asterisk -rx "dialplan reload"`.

## 4. PABX — script de upload

```sh
sudo mkdir -p /var/spool/asterisk/monitor/steel
sudo chown asterisk:asterisk /var/spool/asterisk/monitor/steel
sudo tee /usr/local/bin/steel-upload-recording.sh >/dev/null <<'EOF'
#!/bin/sh
# Envia a gravação da ligação ao Steel (ADR 0043).
# Uso: steel-upload-recording.sh <arquivo.wav> <callback_url> <callback_token>
FILE="$1"; URL="${2%/}/recording"; TOKEN="$3"
LOG=/var/log/asterisk/steel-recording.log
[ -s "$FILE" ] || exit 0
(
  UPLOAD="$FILE"
  if command -v lame >/dev/null 2>&1; then
    MP3="${FILE%.wav}.mp3"
    lame --quiet -m m -b 32 "$FILE" "$MP3" && UPLOAD="$MP3"
  fi
  for TRY in 1 2 3; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 \
      -F "token=$TOKEN" -F "file=@$UPLOAD" "$URL")
    echo "$(date -Is) $(basename "$FILE") tentativa=$TRY http=$CODE" >> "$LOG"
    case "$CODE" in 2??|4??) break ;; esac  # 4xx não melhora repetindo
    sleep $((TRY * 30))
  done
  rm -f "$FILE" "${FILE%.wav}.mp3"
) &
EOF
sudo chmod 755 /usr/local/bin/steel-upload-recording.sh
```

O script volta na hora (o envio roda em segundo plano) e apaga o arquivo
local depois de tentar: a cópia que vale é a do Steel.

## 5. Testar

1. No Steel (homologação, workspace de teste), ligue **Gravar ligações** em
   WhatsApp › Configurações › Atendimento.
2. Faça uma ligação pelo **Ligar** com um device do PABX de teste. A faixa
   da ligação mostra "Ligação gravada." e o aviso.
3. Fale alguns segundos e desligue. Em até ~1 min o card da ligação aparece
   na conversa com o player; depois, "Transcrevendo e resumindo…" vira o
   resumo, o sentimento e os próximos passos.
4. No PABX: `tail /var/log/asterisk/steel-recording.log` deve mostrar
   `http=201`.

| Sintoma | Causa provável |
| ------- | -------------- |
| `http=413` | nginx/Apache sem o `client_max_body_size` do passo 1 ou arquivo acima de 10 MB (instale o `lame`) |
| `http=409` | ligação sem `gravar=1` (ajuste desligado quando discou), não atendida, mais de 24 h ou já enviada |
| `http=401` | token errado: o script recebeu outra variável no lugar do `callback_token` |
| `http=415` | o arquivo não é WAV/MP3/OGG (confira o formato do `MixMonitor`) |
| `http=000` | o PABX não alcança a URL de callback (rede/VPN) |
| Card sem resumo, "Transcrição indisponível no servidor" | falta `OPENAI_API_KEY` no `.env` do servidor |
| "A cota de IA do mês acabou" | cota do workspace em Ajustes › Steel IA |

## Desfazer

Desligue **Gravar ligações** no Steel: o PABX para de receber `gravar=1` e
não grava mais nada. Para remover do PABX, volte o `Goto` original no
dialplan, tire a linha do `Setvar` do PHP e apague o script (backups em
`/root/steel-backups/`).

## LGPD

- Desligado por padrão; quem liga é o OWNER/ADMIN do workspace.
- O texto do aviso mostrado ao atendente fica gravado em cada ligação.
- O áudio é apagado depois da retenção (padrão 90 dias) pelo job das 03:00
  (`purge-call-recordings`), que também apaga áudio de ligação que não
  existe mais (conversa ou contato excluídos). Admin apaga na hora pelo card
  ("Apagar áudio"), com auditoria.
- Detalhes em [LGPD](../lgpd.md#gravação-das-ligações-pabx).
