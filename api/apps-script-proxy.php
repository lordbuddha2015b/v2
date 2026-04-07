<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'ok' => false,
        'message' => 'Method not allowed.'
    ]);
    exit;
}

$raw = file_get_contents('php://input');
$request = json_decode($raw, true);

if (!is_array($request)) {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'message' => 'Invalid proxy request payload.'
    ]);
    exit;
}

$scriptUrl = trim((string)($request['scriptUrl'] ?? ''));
$method = strtoupper(trim((string)($request['method'] ?? 'GET')));
$query = is_array($request['query'] ?? null) ? $request['query'] : [];
$body = $request['body'] ?? null;

if ($scriptUrl === '') {
    http_response_code(400);
    echo json_encode([
        'ok' => false,
        'message' => 'Apps Script URL is missing.'
    ]);
    exit;
}

$targetUrl = $scriptUrl;
if (!empty($query)) {
    $separator = strpos($targetUrl, '?') === false ? '?' : '&';
    $targetUrl .= $separator . http_build_query($query);
}

$ch = curl_init($targetUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_MAXREDIRS, 10);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
curl_setopt($ch, CURLOPT_TIMEOUT, 120);
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Accept: application/json',
    'Content-Type: text/plain;charset=utf-8'
]);

if ($method !== 'GET') {
    $encodedBody = json_encode($body ?? new stdClass());
    curl_setopt($ch, CURLOPT_POSTFIELDS, $encodedBody);
}

$responseBody = curl_exec($ch);
$curlError = curl_error($ch);
$statusCode = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($responseBody === false || $curlError) {
    http_response_code(502);
    echo json_encode([
        'ok' => false,
        'message' => 'Unable to reach Apps Script endpoint.',
        'error' => $curlError ?: 'Unknown cURL error'
    ]);
    exit;
}

$decoded = json_decode($responseBody, true);
if (json_last_error() === JSON_ERROR_NONE) {
    echo json_encode($decoded);
    exit;
}

http_response_code($statusCode >= 400 ? $statusCode : 502);
echo json_encode([
    'ok' => false,
    'message' => 'Apps Script proxy returned non-JSON response.',
    'statusCode' => $statusCode,
    'contentType' => $contentType,
    'raw' => mb_substr($responseBody, 0, 500)
]);
