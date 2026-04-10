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
$docType = trim((string)($_POST['docType'] ?? ''));
$file = $_FILES['file'] ?? null;

$folderMap = [
    'photo' => 'Site Photos',
    'document' => 'Documents',
    'measurement' => 'Measurement Photos'
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

$workspace = null;
try {
    $workspace = ensure_site_workspace($siteId);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => $error->getMessage() ?: 'Unable to create upload directory.'
    ]);
    exit;
}
$targetDir = $workspace[$fileType . 'Dir'];

$originalName = (string)($file['name'] ?? 'upload.bin');
$extension = pathinfo($originalName, PATHINFO_EXTENSION);
$baseName = pathinfo($originalName, PATHINFO_FILENAME);
$safeBaseName = preg_replace('/[^A-Za-z0-9_-]+/', '_', $baseName);
$safeBaseName = trim((string)$safeBaseName, '_');
$safeBaseName = $safeBaseName !== '' ? $safeBaseName : 'file';
$safeExtension = preg_replace('/[^A-Za-z0-9]+/', '', (string)$extension);
$uniqueSuffix = date('YmdHis') . '_' . substr(bin2hex(random_bytes(4)), 0, 8);
$safeDocType = preg_replace('/[^A-Za-z0-9_-]+/', '_', $docType);
$safeDocType = trim((string)$safeDocType, '_');
$nameParts = [];
if ($fileType === 'document' && $safeDocType !== '') {
    $nameParts[] = $safeDocType;
}
$nameParts[] = $siteId;
$nameParts[] = $safeBaseName;
$nameParts[] = $uniqueSuffix;
$fileName = implode('_', array_filter($nameParts)) . ($safeExtension !== '' ? '.' . strtolower($safeExtension) : '');
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
$relativePath = 'uploads/' . $siteId . '/' . $folderMap[$fileType] . '/' . $fileName;
$relativeUrl = implode('/', array_map('rawurlencode', explode('/', $relativePath)));
$scriptDir = trim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/upload.php')), '/');
$baseUrl = $scheme . '://' . $host . ($scriptDir !== '' ? '/' . $scriptDir : '');
$fileUrl = rtrim($baseUrl, '/') . '/' . $relativeUrl;

echo json_encode([
    'status' => 'success',
    'fileURL' => $fileUrl,
    'fileName' => $fileName,
    'fileId' => $relativePath,
    'relativePath' => $relativePath
]);

function ensure_site_workspace(string $siteId): array
{
    $siteDir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . $siteId;
    $documentsDir = $siteDir . DIRECTORY_SEPARATOR . 'Documents';
    $photosDir = $siteDir . DIRECTORY_SEPARATOR . 'Site Photos';
    $measurementDir = $siteDir . DIRECTORY_SEPARATOR . 'Measurement Photos';
    $reportsDir = $siteDir . DIRECTORY_SEPARATOR . 'Reports';
    $datasheetPath = $siteDir . DIRECTORY_SEPARATOR . $siteId . '_DataSheet.json';

    foreach ([$siteDir, $documentsDir, $photosDir, $measurementDir, $reportsDir] as $dir) {
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create upload directory.');
        }
    }

    if (!is_file($datasheetPath)) {
        file_put_contents($datasheetPath, json_encode([
            'siteId' => $siteId,
            'masterEntryHeaders' => ['Site ID', 'Client', 'Engineer', 'Category', 'Activity', 'Date', 'Location', 'District', 'Instructions', 'Created Date'],
            'engineerEntryHeaders' => ['Site Engineer Name', 'Status', 'Documents JSON', 'Photos JSON', 'Measurement Text', 'Measurement Images JSON', 'Latitude', 'Longitude', 'Completed Date', 'Rollback Reason'],
            'masterEntry' => [],
            'engineerEntry' => [],
            'task' => ['siteId' => $siteId],
            'updatedAt' => gmdate('c')
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    return [
        'siteDir' => $siteDir,
        'documentDir' => $documentsDir,
        'photoDir' => $photosDir,
        'measurementDir' => $measurementDir,
        'reportsDir' => $reportsDir,
        'datasheetPath' => $datasheetPath
    ];
}
