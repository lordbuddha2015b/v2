<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode([
        'status' => 'error',
        'message' => 'Method not allowed.'
    ]);
    exit;
}

$siteId = strtoupper(trim((string)($_POST['siteId'] ?? '')));
$fileType = strtolower(trim((string)($_POST['fileType'] ?? '')));
$file = $_FILES['file'] ?? null;

$folderMap = [
    'photo' => 'photos',
    'document' => 'documents',
    'measurement' => 'measurement'
];

if ($siteId === '' || !preg_match('/^[A-Z0-9_-]+$/', $siteId)) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'Invalid Site ID.'
    ]);
    exit;
}

if (!isset($folderMap[$fileType])) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'Invalid file type.'
    ]);
    exit;
}

if (!$file || !isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'No file uploaded.'
    ]);
    exit;
}

if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'message' => 'File upload failed.'
    ]);
    exit;
}

$baseDir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads';
$targetDir = $baseDir
    . DIRECTORY_SEPARATOR . $siteId
    . DIRECTORY_SEPARATOR . $folderMap[$fileType];

if (!is_dir($targetDir) && !mkdir($targetDir, 0775, true) && !is_dir($targetDir)) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Unable to create upload directory.'
    ]);
    exit;
}

$originalName = (string)($file['name'] ?? 'upload.bin');
$extension = pathinfo($originalName, PATHINFO_EXTENSION);
$baseName = pathinfo($originalName, PATHINFO_FILENAME);
$safeBaseName = preg_replace('/[^A-Za-z0-9_-]+/', '_', $baseName);
$safeBaseName = trim((string)$safeBaseName, '_');
$safeBaseName = $safeBaseName !== '' ? $safeBaseName : 'file';
$safeExtension = preg_replace('/[^A-Za-z0-9]+/', '', (string)$extension);
$uniqueSuffix = date('YmdHis') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
$fileName = $safeBaseName . '_' . $uniqueSuffix . ($safeExtension !== '' ? '.' . strtolower($safeExtension) : '');
$targetPath = $targetDir . DIRECTORY_SEPARATOR . $fileName;

if (!move_uploaded_file($file['tmp_name'], $targetPath)) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Unable to save uploaded file.'
    ]);
    exit;
}

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443)
    || (strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https');
$scheme = $isHttps ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$relativeUrl = 'uploads/' . rawurlencode($siteId) . '/' . rawurlencode($folderMap[$fileType]) . '/' . rawurlencode($fileName);
$fileUrl = $scheme . '://' . $host . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/v2/upload.php'), '/\\') . '/' . $relativeUrl;

echo json_encode([
    'status' => 'success',
    'fileURL' => $fileUrl,
    'fileName' => $fileName
]);
