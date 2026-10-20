<?php
declare(strict_types=1);

/**
 * POST /steel_webphone_endpoint.php
 *
 * Provisiona o telefone web (WebRTC) de um ramal: devolve as credenciais SIP
 * (segredo incluso) para o Steel entregar ao navegador do dono do ramal.
 *
 * Obrigatorios: iddevice, ramal, token (o mesmo token do device usado em
 * steel_call_endpoint.php). Chamado somente pelo backend do Steel; o segredo
 * nunca deve ser logado nem guardado.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function reply(int $status, bool $ok, string $message, array $extra = []): void
{
    http_response_code($status);
    echo json_encode(['ok' => $ok, 'mensagem' => $message] + $extra, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    reply(405, false, 'Use POST.');
}

$iddevice = filter_var($_POST['iddevice'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
$ramal = trim((string) ($_POST['ramal'] ?? ''));
$token = trim((string) ($_POST['token'] ?? ''));

if ($iddevice === false || !preg_match('/^[A-Za-z0-9]{2,20}$/', $ramal) || $token === '' || strlen($token) > 64) {
    reply(422, false, 'Parâmetros inválidos.');
}

try {
    require '/etc/asterisk/steel_call_api.php';
    require '/etc/asterisk/steel_webphone_api.php';

    $steel = new PDO(
        'mysql:host=' . STEEL_CALL_DB_HOST . ';port=' . STEEL_CALL_DB_PORT . ';dbname=steel;charset=utf8mb4',
        STEEL_CALL_DB_USER,
        STEEL_CALL_DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    $statement = $steel->prepare('SELECT token FROM device WHERE id = :iddevice AND ativo = 1 LIMIT 1');
    $statement->execute(['iddevice' => $iddevice]);
    $device = $statement->fetch();
} catch (Throwable $exception) {
    error_log('steel_webphone_endpoint device lookup error: ' . $exception->getMessage());
    reply(503, false, 'Serviço de validação indisponível.');
}

if (!$device || !hash_equals((string) $device['token'], $token)) {
    reply(401, false, 'Token ou dispositivo inválido.');
}

try {
    // Usuario so-leitura, restrito as colunas abaixo de realtimedb.sippeers.
    $realtime = new PDO(
        'mysql:host=localhost;dbname=realtimedb;charset=utf8mb4',
        STEEL_WEBPHONE_DB_USER,
        STEEL_WEBPHONE_DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    $statement = $realtime->prepare(
        'SELECT secret, transport, encryption, dtlsenable FROM sippeers WHERE name = :ramal AND `enable` = 1 LIMIT 1'
    );
    $statement->execute(['ramal' => $ramal]);
    $peer = $statement->fetch();
} catch (Throwable $exception) {
    error_log('steel_webphone_endpoint peer lookup error: ' . $exception->getMessage());
    reply(503, false, 'Serviço de ramais indisponível.');
}

if (!$peer) {
    reply(404, false, 'Ramal não encontrado.');
}

// So entrega ramais configurados para WebRTC (WSS + DTLS-SRTP).
if (stripos((string) $peer['transport'], 'ws') === false
    || strtolower((string) $peer['encryption']) !== 'yes'
    || strtolower((string) $peer['dtlsenable']) !== 'yes'
    || (string) $peer['secret'] === '') {
    reply(422, false, 'Este ramal não está habilitado para WebRTC.');
}

reply(200, true, 'Credenciais do telefone web.', [
    'ramal' => $ramal,
    'secret' => (string) $peer['secret'],
    'domain' => STEEL_WEBPHONE_SIP_DOMAIN,
    'wss' => STEEL_WEBPHONE_WSS_URL,
]);
