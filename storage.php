<?php
header('Content-Type: application/json; charset=utf-8');

$defaultState = [
    'options' => [
        'clients' => ['JIO', 'Retail', 'Others'],
        'engineers' => ['Naveen', 'Rocky', 'Sriram'],
        'categories' => ['Project', 'O&M', 'Others'],
        'activities' => ['Enod B', '5G', 'Upgradation', 'Repair', 'Others'],
        'districts' => []
    ],
    'settings' => [
        'master' => ['googleScriptUrl' => '', 'autoSyncEnabled' => false],
        'engineer' => ['googleScriptUrl' => '', 'autoSyncEnabled' => false]
    ],
    'drafts' => [],
    'tasks' => []
];

$siteMasterHeaders = ['Site ID', 'Client', 'Engineer', 'Category', 'Activity', 'Date', 'Location', 'District', 'Instructions', 'Created Date'];
$siteEngineerHeaders = ['Site Engineer Name', 'Status', 'Documents JSON', 'Photos JSON', 'Measurement Text', 'Measurement Images JSON', 'Latitude', 'Longitude', 'Completed Date', 'Rollback Reason'];

function ensure_json_file(): string
{
    $dir = __DIR__ . DIRECTORY_SEPARATOR . 'json';

    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    $file = $dir . DIRECTORY_SEPARATOR . 'hostinger_state.json';

    if (!file_exists($file)) {
        $defaultData = [
            'options' => [
                'clients' => ['JIO', 'Retail', 'Others'],
                'engineers' => ['Naveen', 'Rocky', 'Sriram'],
                'categories' => ['Project', 'O&M', 'Others'],
                'activities' => ['Enod B', '5G', 'Upgradation', 'Repair', 'Others'],
                'districts' => []
            ],
            'settings' => [
                'master' => ['googleScriptUrl' => '', 'autoSyncEnabled' => false],
                'engineer' => ['googleScriptUrl' => '', 'autoSyncEnabled' => false]
            ],
            'drafts' => [],
            'tasks' => []
        ];

        file_put_contents($file, json_encode($defaultData, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    return $file;
}

try {
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $input = $method === 'POST' ? read_post_payload() : $_GET;
    $action = trim((string)($input['action'] ?? ''));

    if ($method === 'GET') {
        if ($action === 'getTask') {
            json_response(get_task_snapshot($input, $siteMasterHeaders, $siteEngineerHeaders));
        }
        if ($action === 'getState' || $action === '') {
            json_response(get_latest_app_state($defaultState));
        }
        json_response(['ok' => false, 'status' => 'error', 'message' => 'Unsupported action.'], 400);
    }

    if ($action === 'syncState') {
        $jsonFile = ensure_json_file();
        $incomingState = normalize_state($input['state'] ?? [], $defaultState);
        $storedState = normalize_state(read_json_file($jsonFile, $defaultState), $defaultState);
        $mergedState = merge_app_state($storedState, $incomingState, $defaultState);
        file_put_contents($jsonFile, json_encode($mergedState, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        persist_state($mergedState, $defaultState, $siteMasterHeaders, $siteEngineerHeaders);
        json_response([
            'ok' => true,
            'status' => 'success',
            'state' => $mergedState,
            'stateUpdatedAt' => gmdate('c')
        ]);
    }

    if ($action === 'savePdfToDrive') {
        json_response(save_pdf_to_reports($input['payload'] ?? []));
    }
    if ($action === 'saveReportFiles') {
        json_response(save_report_files($input['payload'] ?? []));
    }
    if ($action === 'deleteDriveFile') {
        json_response(delete_hostinger_file($input['payload'] ?? [], $defaultState, $siteMasterHeaders, $siteEngineerHeaders));
    }
    if ($action === 'deleteSiteTask') {
        json_response(delete_site_task($input['payload'] ?? [], $defaultState));
    }

    $state = normalize_state($input['state'] ?? [], $defaultState);
    persist_state($state, $defaultState, $siteMasterHeaders, $siteEngineerHeaders);
    json_response([
        'ok' => true,
        'status' => 'success',
        'action' => $action ?: 'syncState',
        'stateUpdatedAt' => gmdate('c')
    ]);
} catch (Throwable $error) {
    json_response([
        'ok' => false,
        'status' => 'error',
        'message' => $error->getMessage(),
        'error' => $error->getMessage()
    ], 500);
}

function read_post_payload(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return $_POST ?: [];
    }

    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        return $decoded;
    }

    parse_str($raw, $parsed);
    return is_array($parsed) ? $parsed : [];
}

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

function root_dir(): string
{
    return __DIR__;
}

function uploads_root(): string
{
    return root_dir() . DIRECTORY_SEPARATOR . 'uploads';
}

function json_root(): string
{
    return root_dir() . DIRECTORY_SEPARATOR . 'json';
}

function state_file_path(): string
{
    return ensure_json_file();
}

function ensure_dir(string $path): void
{
    if (!is_dir($path) && !mkdir($path, 0775, true) && !is_dir($path)) {
        throw new RuntimeException('Unable to create directory: ' . $path);
    }
}

function ensure_file_with_contents(string $path, array $contents): void
{
    if (is_file($path)) {
        return;
    }
    write_json_file($path, $contents);
}

function write_json_file(string $path, array $data): void
{
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        throw new RuntimeException('Unable to encode JSON for ' . $path);
    }
    if (file_put_contents($path, $json, LOCK_EX) === false) {
        throw new RuntimeException('Unable to write file: ' . $path);
    }
}

function read_json_file(string $path, array $fallback = []): array
{
    if (!is_file($path)) {
        return $fallback;
    }
    $raw = file_get_contents($path);
    if ($raw === false || trim($raw) === '') {
        return $fallback;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : $fallback;
}

function normalize_state($state, array $defaultState): array
{
    $input = is_array($state) ? $state : [];
    $tasks = [];
    foreach (($input['tasks'] ?? []) as $task) {
        $tasks[] = normalize_task($task);
    }

    return [
        'options' => normalize_options($input['options'] ?? [], $defaultState['options']),
        'settings' => [
            'master' => normalize_settings_app($input['settings']['master'] ?? [], $defaultState['settings']['master']),
            'engineer' => normalize_settings_app($input['settings']['engineer'] ?? [], $defaultState['settings']['engineer'])
        ],
        'drafts' => array_values(is_array($input['drafts'] ?? null) ? $input['drafts'] : []),
        'tasks' => $tasks
    ];
}

function normalize_settings_app($input, array $fallback): array
{
    $data = is_array($input) ? $input : [];
    return [
        'googleScriptUrl' => trim((string)($data['googleScriptUrl'] ?? $fallback['googleScriptUrl'] ?? '')),
        'autoSyncEnabled' => (bool)($data['autoSyncEnabled'] ?? $fallback['autoSyncEnabled'] ?? false)
    ];
}

function normalize_options($input, array $fallback): array
{
    $data = is_array($input) ? $input : [];
    return [
        'clients' => merge_option_list($fallback['clients'] ?? [], $data['clients'] ?? []),
        'engineers' => merge_option_list($fallback['engineers'] ?? [], $data['engineers'] ?? []),
        'categories' => merge_option_list($fallback['categories'] ?? [], $data['categories'] ?? []),
        'activities' => merge_option_list($fallback['activities'] ?? [], $data['activities'] ?? []),
        'districts' => merge_option_list($fallback['districts'] ?? [], $data['districts'] ?? [])
    ];
}

function merge_option_list(array $base, $next): array
{
    $items = array_merge($base, is_array($next) ? $next : []);
    $seen = [];
    $result = [];
    foreach ($items as $item) {
        $value = trim((string)$item);
        if ($value === '' || isset($seen[$value])) {
            continue;
        }
        $seen[$value] = true;
        $result[] = $value;
    }
    return $result;
}

function normalize_task($task): array
{
    $data = is_array($task) ? $task : [];
    $taskId = trim((string)($data['id'] ?? ''));
    $siteId = normalize_site_id($data['siteId'] ?? '');
    $baseTaskId = trim((string)($data['baseTaskId'] ?? ''));
    if ($baseTaskId === '') {
        $baseTaskId = extract_task_base_id($taskId);
    }
    if ($baseTaskId === '') {
        $baseTaskId = $siteId;
    }
    return [
        'id' => $taskId,
        'baseTaskId' => $baseTaskId,
        'draftId' => trim((string)($data['draftId'] ?? '')),
        'client' => trim((string)($data['client'] ?? '')),
        'engineer' => trim((string)($data['engineer'] ?? '')),
        'category' => trim((string)($data['category'] ?? '')),
        'activity' => trim((string)($data['activity'] ?? '')),
        'siteId' => $siteId,
        'date' => trim((string)($data['date'] ?? '')),
        'location' => trim((string)($data['location'] ?? '')),
        'latitude' => stringify_number_or_text($data['latitude'] ?? ''),
        'longitude' => stringify_number_or_text($data['longitude'] ?? ''),
        'district' => trim((string)($data['district'] ?? '')),
        'instructions' => trim((string)($data['instructions'] ?? '')),
        'status' => trim((string)($data['status'] ?? 'Pending')) ?: 'Pending',
        'siteEngineerName' => trim((string)($data['siteEngineerName'] ?? '')),
        'documents' => normalize_file_list($data['documents'] ?? []),
        'photos' => normalize_file_list($data['photos'] ?? []),
        'measurementText' => trim((string)($data['measurementText'] ?? '')),
        'measurementImages' => normalize_file_list($data['measurementImages'] ?? []),
        'gps' => normalize_gps($data['gps'] ?? null),
        'sharePackage' => is_array($data['sharePackage'] ?? null) ? $data['sharePackage'] : null,
        'rollbackReason' => trim((string)($data['rollbackReason'] ?? '')),
        'createdAt' => trim((string)($data['createdAt'] ?? '')),
        'completedAt' => trim((string)($data['completedAt'] ?? '')),
        'updatedAt' => trim((string)($data['updatedAt'] ?? '')),
        'siteWorkspace' => is_array($data['siteWorkspace'] ?? null) ? $data['siteWorkspace'] : null
    ];
}

function merge_app_state(array $storedState, array $incomingState, array $defaultState): array
{
    $mergedTasks = merge_task_sets($storedState['tasks'] ?? [], $incomingState['tasks'] ?? []);
    $mergedDrafts = cleanup_stale_drafts(
        merge_draft_sets($storedState['drafts'] ?? [], $incomingState['drafts'] ?? []),
        $mergedTasks
    );

    return [
        'options' => [
            'clients' => merge_option_list($defaultState['options']['clients'] ?? [], array_merge($storedState['options']['clients'] ?? [], $incomingState['options']['clients'] ?? [])),
            'engineers' => merge_option_list($defaultState['options']['engineers'] ?? [], array_merge($storedState['options']['engineers'] ?? [], $incomingState['options']['engineers'] ?? [])),
            'categories' => merge_option_list($defaultState['options']['categories'] ?? [], array_merge($storedState['options']['categories'] ?? [], $incomingState['options']['categories'] ?? [])),
            'activities' => merge_option_list($defaultState['options']['activities'] ?? [], array_merge($storedState['options']['activities'] ?? [], $incomingState['options']['activities'] ?? [])),
            'districts' => merge_option_list($defaultState['options']['districts'] ?? [], array_merge($storedState['options']['districts'] ?? [], $incomingState['options']['districts'] ?? []))
        ],
        'settings' => [
            'master' => normalize_settings_app($incomingState['settings']['master'] ?? $storedState['settings']['master'] ?? [], $defaultState['settings']['master']),
            'engineer' => normalize_settings_app($incomingState['settings']['engineer'] ?? $storedState['settings']['engineer'] ?? [], $defaultState['settings']['engineer'])
        ],
        'drafts' => $mergedDrafts,
        'tasks' => $mergedTasks
    ];
}

function merge_task_sets(array $storedTasks, array $incomingTasks): array
{
    $taskMap = [];

    foreach ($storedTasks as $task) {
        $normalized = normalize_task($task);
        $taskMap[task_merge_key($normalized)] = $normalized;
    }

    foreach ($incomingTasks as $task) {
        $normalized = normalize_task($task);
        $key = task_merge_key($normalized);
        $existing = $taskMap[$key] ?? null;
        if ($existing === null || task_updated_at_value($normalized) >= task_updated_at_value($existing)) {
            $taskMap[$key] = $normalized;
        }
    }

    return array_values($taskMap);
}

function merge_draft_sets(array $storedDrafts, array $incomingDrafts): array
{
    $draftMap = [];

    foreach ($storedDrafts as $draft) {
        if (!is_array($draft)) {
            continue;
        }
        $id = trim((string)($draft['id'] ?? ''));
        if ($id === '') {
            continue;
        }
        $draftMap[$id] = $draft;
    }

    foreach ($incomingDrafts as $draft) {
        if (!is_array($draft)) {
            continue;
        }
        $id = trim((string)($draft['id'] ?? ''));
        if ($id === '') {
            continue;
        }
        $existing = $draftMap[$id] ?? null;
        if ($existing === null || item_updated_at_value($draft) >= item_updated_at_value($existing)) {
            $draftMap[$id] = $draft;
        }
    }

    return array_values($draftMap);
}

function cleanup_stale_drafts(array $drafts, array $tasks): array
{
    $taskById = [];
    $taskByBaseId = [];

    foreach ($tasks as $task) {
        $normalizedTask = normalize_task($task);
        $taskId = trim((string)($normalizedTask['id'] ?? ''));
        $baseTaskId = trim((string)($normalizedTask['baseTaskId'] ?? ''));

        if ($taskId !== '') {
            $taskById[$taskId] = $normalizedTask;
        }
        if ($baseTaskId !== '') {
            $taskByBaseId[$baseTaskId] = $normalizedTask;
        }
    }

    $result = [];
    foreach ($drafts as $draft) {
        if (!is_array($draft)) {
            continue;
        }

        $sourceTaskId = trim((string)($draft['sourceTaskId'] ?? ''));
        if ($sourceTaskId === '') {
            $result[] = $draft;
            continue;
        }

        $linkedTask = $taskById[$sourceTaskId] ?? null;
        if ($linkedTask === null) {
            $linkedBaseId = extract_task_base_id($sourceTaskId);
            if ($linkedBaseId !== '' && isset($taskByBaseId[$linkedBaseId])) {
                $linkedTask = $taskByBaseId[$linkedBaseId];
            }
        }

        if ($linkedTask === null) {
            $result[] = $draft;
            continue;
        }

        if (item_updated_at_value($linkedTask) > item_updated_at_value($draft)) {
            continue;
        }

        $result[] = $draft;
    }

    return array_values($result);
}

function task_merge_key(array $task): string
{
    $siteId = trim((string)($task['siteId'] ?? ''));
    if ($siteId !== '') {
        return 'site:' . $siteId;
    }

    $baseTaskId = trim((string)($task['baseTaskId'] ?? ''));
    if ($baseTaskId !== '') {
        return 'base:' . $baseTaskId;
    }

    return 'id:' . trim((string)($task['id'] ?? uniqid('task', true)));
}

function task_updated_at_value(array $task): int
{
    return item_updated_at_value([
        'updatedAt' => $task['updatedAt'] ?? '',
        'completedAt' => $task['completedAt'] ?? '',
        'createdAt' => $task['createdAt'] ?? ''
    ]);
}

function item_updated_at_value($item): int
{
    if (!is_array($item)) {
        return 0;
    }

    foreach (['updatedAt', 'completedAt', 'createdAt'] as $field) {
        $value = trim((string)($item[$field] ?? ''));
        if ($value === '') {
            continue;
        }
        $timestamp = strtotime($value);
        if ($timestamp !== false) {
            return (int)$timestamp;
        }
    }

    return 0;
}

function normalize_file_list($items): array
{
    $result = [];
    if (!is_array($items)) {
        return $result;
    }

    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }
        $storedName = trim((string)($item['storedName'] ?? $item['name'] ?? ''));
        $relativePath = trim((string)($item['relativePath'] ?? ''));
        $id = trim((string)($item['id'] ?? $relativePath ?: $storedName));
        $result[] = [
            'id' => $id,
            'originalName' => trim((string)($item['originalName'] ?? $storedName)),
            'storedName' => $storedName,
            'name' => trim((string)($item['name'] ?? $storedName)),
            'type' => trim((string)($item['type'] ?? $item['mimeType'] ?? 'application/octet-stream')),
            'mimeType' => trim((string)($item['mimeType'] ?? $item['type'] ?? 'application/octet-stream')),
            'size' => (int)($item['size'] ?? 0),
            'uploadedAt' => trim((string)($item['uploadedAt'] ?? '')),
            'relativePath' => $relativePath,
            'fileURL' => trim((string)($item['fileURL'] ?? $item['url'] ?? $item['downloadURL'] ?? '')),
            'url' => trim((string)($item['url'] ?? $item['fileURL'] ?? $item['downloadURL'] ?? '')),
            'downloadURL' => trim((string)($item['downloadURL'] ?? $item['fileURL'] ?? $item['url'] ?? '')),
            'thumbnailUrl' => trim((string)($item['thumbnailUrl'] ?? '')),
            'answer' => trim((string)($item['answer'] ?? '')),
            'docType' => trim((string)($item['docType'] ?? ''))
        ];
    }

    return $result;
}

function normalize_gps($gps)
{
    if (!is_array($gps)) {
        return null;
    }
    $latitude = stringify_number_or_text($gps['latitude'] ?? '');
    $longitude = stringify_number_or_text($gps['longitude'] ?? '');
    if ($latitude === '' && $longitude === '') {
        return null;
    }
    $normalized = [
        'latitude' => $latitude,
        'longitude' => $longitude
    ];
    if (isset($gps['capturedAt'])) {
        $normalized['capturedAt'] = trim((string)$gps['capturedAt']);
    }
    if (isset($gps['source'])) {
        $normalized['source'] = trim((string)$gps['source']);
    }
    return $normalized;
}

function stringify_number_or_text($value): string
{
    if (is_int($value) || is_float($value)) {
        return (string)$value;
    }
    return trim((string)$value);
}

function extract_task_base_id(string $taskId): string
{
    return preg_replace('/^(draft|task|wip|complete)-/i', '', trim($taskId)) ?? '';
}

function normalize_site_id($siteId): string
{
    return strtoupper(trim((string)$siteId));
}

function persist_state(array $state, array $defaultState, array $siteMasterHeaders, array $siteEngineerHeaders): void
{
    ensure_dir(json_root());
    ensure_dir(uploads_root());

    write_json_file(state_file_path(), $state);

    foreach ($state['tasks'] as $task) {
        if (($task['siteId'] ?? '') === '') {
            continue;
        }
        $workspace = ensure_site_workspace($task['siteId'], $siteMasterHeaders, $siteEngineerHeaders);
        write_site_datasheet($workspace, $task, $siteMasterHeaders, $siteEngineerHeaders);
    }
}

function ensure_site_workspace(string $siteId, array $siteMasterHeaders, array $siteEngineerHeaders): array
{
    $trimmedSiteId = normalize_site_id($siteId);
    if ($trimmedSiteId === '') {
        throw new RuntimeException('Site ID is required.');
    }
    if (!$siteMasterHeaders) {
        $siteMasterHeaders = ['Site ID', 'Client', 'Engineer', 'Category', 'Activity', 'Date', 'Location', 'District', 'Instructions', 'Created Date'];
    }
    if (!$siteEngineerHeaders) {
        $siteEngineerHeaders = ['Site Engineer Name', 'Status', 'Documents JSON', 'Photos JSON', 'Measurement Text', 'Measurement Images JSON', 'Latitude', 'Longitude', 'Completed Date', 'Rollback Reason'];
    }

    $siteRelative = 'uploads/' . $trimmedSiteId;
    $siteDir = uploads_root() . DIRECTORY_SEPARATOR . $trimmedSiteId;
    $documentsDir = $siteDir . DIRECTORY_SEPARATOR . 'Documents';
    $photosDir = $siteDir . DIRECTORY_SEPARATOR . 'Site Photos';
    $measurementDir = $siteDir . DIRECTORY_SEPARATOR . 'Measurement Photos';
    $reportsDir = $siteDir . DIRECTORY_SEPARATOR . 'Reports';
    $datasheetPath = $siteDir . DIRECTORY_SEPARATOR . $trimmedSiteId . '_DataSheet.json';

    ensure_dir($siteDir);
    ensure_dir($documentsDir);
    ensure_dir($photosDir);
    ensure_dir($measurementDir);
    ensure_dir($reportsDir);
    ensure_file_with_contents($datasheetPath, [
        'siteId' => $trimmedSiteId,
        'masterEntryHeaders' => $siteMasterHeaders,
        'engineerEntryHeaders' => $siteEngineerHeaders,
        'masterEntry' => [],
        'engineerEntry' => [],
        'task' => normalize_task(['siteId' => $trimmedSiteId]),
        'updatedAt' => gmdate('c')
    ]);

    return [
        'siteId' => $trimmedSiteId,
        'siteDir' => $siteDir,
        'siteRelativePath' => $siteRelative,
        'documentsDir' => $documentsDir,
        'photosDir' => $photosDir,
        'measurementDir' => $measurementDir,
        'reportsDir' => $reportsDir,
        'datasheetPath' => $datasheetPath
    ];
}

function write_site_datasheet(array $workspace, array $task, array $siteMasterHeaders, array $siteEngineerHeaders): void
{
    $normalizedTask = normalize_task($task);
    $payload = [
        'siteId' => $workspace['siteId'],
        'masterEntryHeaders' => $siteMasterHeaders,
        'engineerEntryHeaders' => $siteEngineerHeaders,
        'masterEntry' => build_master_entry($normalizedTask, $siteMasterHeaders),
        'engineerEntry' => build_engineer_entry($normalizedTask, $siteEngineerHeaders),
        'task' => array_merge($normalizedTask, [
            'siteWorkspace' => site_workspace_to_object($workspace)
        ]),
        'updatedAt' => gmdate('c')
    ];

    write_json_file($workspace['datasheetPath'], $payload);
}

function build_master_entry(array $task, array $headers): array
{
    $row = [
        'Site ID' => $task['siteId'] ?? '',
        'Client' => $task['client'] ?? '',
        'Engineer' => $task['engineer'] ?? '',
        'Category' => $task['category'] ?? '',
        'Activity' => $task['activity'] ?? '',
        'Date' => $task['date'] ?? '',
        'Location' => $task['location'] ?? '',
        'District' => $task['district'] ?? '',
        'Instructions' => $task['instructions'] ?? '',
        'Created Date' => $task['createdAt'] ?? ''
    ];
    return subset_with_headers($row, $headers);
}

function build_engineer_entry(array $task, array $headers): array
{
    $row = [
        'Site Engineer Name' => $task['siteEngineerName'] ?? '',
        'Status' => $task['status'] ?? 'Pending',
        'Documents JSON' => safe_json(strip_transient_file_fields($task['documents'] ?? [])),
        'Photos JSON' => safe_json(strip_transient_file_fields($task['photos'] ?? [])),
        'Measurement Text' => $task['measurementText'] ?? '',
        'Measurement Images JSON' => safe_json(strip_transient_file_fields($task['measurementImages'] ?? [])),
        'Latitude' => $task['gps']['latitude'] ?? ($task['latitude'] ?? ''),
        'Longitude' => $task['gps']['longitude'] ?? ($task['longitude'] ?? ''),
        'Completed Date' => $task['completedAt'] ?? '',
        'Rollback Reason' => $task['rollbackReason'] ?? ''
    ];
    return subset_with_headers($row, $headers);
}

function subset_with_headers(array $row, array $headers): array
{
    $result = [];
    foreach ($headers as $header) {
        $result[$header] = $row[$header] ?? '';
    }
    return $result;
}

function safe_json($value): string
{
    $json = json_encode($value, JSON_UNESCAPED_SLASHES);
    return $json === false ? '[]' : $json;
}

function strip_transient_file_fields($items): array
{
    $result = [];
    foreach (normalize_file_list($items) as $item) {
        unset($item['previewUrl']);
        $result[] = $item;
    }
    return $result;
}

function read_site_datasheet(array $workspace): array
{
    $payload = read_json_file($workspace['datasheetPath'], []);
    $task = normalize_task($payload['task'] ?? ['siteId' => $workspace['siteId']]);
    $task['siteWorkspace'] = site_workspace_to_object($workspace);
    return $task;
}

function site_workspace_to_object(array $workspace): array
{
    $siteId = $workspace['siteId'];
    return [
        'siteId' => $siteId,
        'siteFolder' => [
            'name' => $siteId,
            'path' => $workspace['siteRelativePath'],
            'url' => relative_path_to_url($workspace['siteRelativePath'])
        ],
        'documentsFolder' => [
            'name' => 'Documents',
            'path' => 'uploads/' . $siteId . '/Documents',
            'url' => relative_path_to_url('uploads/' . $siteId . '/Documents')
        ],
        'photosFolder' => [
            'name' => 'Site Photos',
            'path' => 'uploads/' . $siteId . '/Site Photos',
            'url' => relative_path_to_url('uploads/' . $siteId . '/Site Photos')
        ],
        'measurementFolder' => [
            'name' => 'Measurement Photos',
            'path' => 'uploads/' . $siteId . '/Measurement Photos',
            'url' => relative_path_to_url('uploads/' . $siteId . '/Measurement Photos')
        ],
        'reportsFolder' => [
            'name' => 'Reports',
            'path' => 'uploads/' . $siteId . '/Reports',
            'url' => relative_path_to_url('uploads/' . $siteId . '/Reports')
        ],
        'datasheet' => [
            'name' => $siteId . '_DataSheet.json',
            'path' => 'uploads/' . $siteId . '/' . $siteId . '_DataSheet.json',
            'url' => relative_path_to_url('uploads/' . $siteId . '/' . $siteId . '_DataSheet.json')
        ]
    ];
}

function get_latest_app_state(array $defaultState): array
{
    $storedState = normalize_state(read_json_file(state_file_path(), $defaultState), $defaultState);
    $tasks = merge_tasks_with_datasheets($storedState['tasks']);
    $storedState['tasks'] = $tasks;
    $latestOptions = build_latest_options($tasks);
    $storedState['options'] = [
        'clients' => merge_option_list($storedState['options']['clients'] ?? [], $latestOptions['clients'] ?? []),
        'engineers' => merge_option_list($storedState['options']['engineers'] ?? [], $latestOptions['engineers'] ?? []),
        'categories' => merge_option_list($storedState['options']['categories'] ?? [], $latestOptions['categories'] ?? []),
        'activities' => merge_option_list($storedState['options']['activities'] ?? [], $latestOptions['activities'] ?? []),
        'districts' => merge_option_list($storedState['options']['districts'] ?? [], $latestOptions['districts'] ?? [])
    ];
    return [
        'ok' => true,
        'status' => 'success',
        'state' => $storedState
    ];
}

function merge_tasks_with_datasheets(array $stateTasks): array
{
    $taskMap = [];
    foreach ($stateTasks as $task) {
        $normalized = normalize_task($task);
        $key = ($normalized['siteId'] ?? '') !== '' ? 'site:' . $normalized['siteId'] : 'task:' . ($normalized['id'] ?? uniqid('task', true));
        $taskMap[$key] = $normalized;
    }

    ensure_dir(uploads_root());
    foreach (scandir(uploads_root()) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $siteDir = uploads_root() . DIRECTORY_SEPARATOR . $entry;
        if (!is_dir($siteDir)) {
            continue;
        }
        $workspace = ensure_site_workspace($entry, [], []);
        $taskMap['site:' . $workspace['siteId']] = read_site_datasheet($workspace);
    }

    return array_values($taskMap);
}

function build_latest_options(array $tasks): array
{
    $clients = [];
    $engineers = [];
    $categories = [];
    $activities = [];
    $districts = [];
    foreach ($tasks as $task) {
        $clients[] = $task['client'] ?? '';
        $engineers[] = $task['engineer'] ?? '';
        $categories[] = $task['category'] ?? '';
        $activities[] = $task['activity'] ?? '';
        $districts[] = $task['district'] ?? '';
    }
    return [
        'clients' => $clients,
        'engineers' => $engineers,
        'categories' => $categories,
        'activities' => $activities,
        'districts' => $districts
    ];
}

function get_task_snapshot(array $params, array $siteMasterHeaders, array $siteEngineerHeaders): array
{
    $siteId = normalize_site_id($params['siteId'] ?? '');
    if ($siteId === '') {
        return ['ok' => false, 'message' => 'Site ID is required.'];
    }

    $workspace = ensure_site_workspace($siteId, $siteMasterHeaders, $siteEngineerHeaders);
    $task = read_site_datasheet($workspace);

    return [
        'ok' => true,
        'siteId' => $siteId,
        'latestRow' => site_task_to_latest_row($task),
        'documents' => list_workspace_files($workspace['documentsDir'], 'documents'),
        'photos' => list_workspace_files($workspace['photosDir'], 'photos'),
        'measurementImages' => list_workspace_files($workspace['measurementDir'], 'measurementImages'),
        'reports' => list_workspace_files($workspace['reportsDir'], 'reports'),
        'siteWorkspace' => site_workspace_to_object($workspace)
    ];
}

function site_task_to_latest_row(array $task): array
{
    return [
        'Site Engineer Name' => $task['siteEngineerName'] ?? '',
        'Status' => $task['status'] ?? 'Pending',
        'Measurement Text' => $task['measurementText'] ?? '',
        'GPS Latitude' => $task['gps']['latitude'] ?? ($task['latitude'] ?? ''),
        'GPS Longitude' => $task['gps']['longitude'] ?? ($task['longitude'] ?? ''),
        'Documents JSON' => safe_json(strip_transient_file_fields($task['documents'] ?? [])),
        'Photos JSON' => safe_json(strip_transient_file_fields($task['photos'] ?? [])),
        'Measurement Images JSON' => safe_json(strip_transient_file_fields($task['measurementImages'] ?? [])),
        'Rollback Reason' => $task['rollbackReason'] ?? ''
    ];
}

function list_workspace_files(string $directory, string $group): array
{
    if (!is_dir($directory)) {
        return [];
    }

    $items = [];
    foreach (scandir($directory) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $absolutePath = $directory . DIRECTORY_SEPARATOR . $entry;
        if (!is_file($absolutePath)) {
            continue;
        }
        $relativePath = str_replace('\\', '/', ltrim(str_replace(root_dir(), '', $absolutePath), '\\/'));
        $items[] = file_descriptor_from_relative_path($relativePath, $group);
    }

    usort($items, static function (array $left, array $right): int {
        return strcmp($left['name'] ?? '', $right['name'] ?? '');
    });

    return $items;
}

function file_descriptor_from_relative_path(string $relativePath, string $group): array
{
    $absolutePath = root_dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    $name = basename($absolutePath);
    $mimeType = is_file($absolutePath) ? (mime_content_type($absolutePath) ?: 'application/octet-stream') : 'application/octet-stream';
    $url = relative_path_to_url($relativePath);
    return [
        'id' => $relativePath,
        'name' => $name,
        'storedName' => $name,
        'type' => $mimeType,
        'mimeType' => $mimeType,
        'size' => is_file($absolutePath) ? (int)filesize($absolutePath) : 0,
        'url' => $url,
        'fileURL' => $url,
        'downloadURL' => $url,
        'thumbnailUrl' => strpos($mimeType, 'image/') === 0 ? $url : '',
        'relativePath' => $relativePath,
        'group' => $group
    ];
}

function relative_path_to_url(string $relativePath): string
{
    $relativePath = trim(str_replace('\\', '/', $relativePath), '/');
    $parts = array_map('rawurlencode', array_filter(explode('/', $relativePath), 'strlen'));
    return rtrim(base_url(), '/') . '/' . implode('/', $parts);
}

function base_url(): string
{
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ((int)($_SERVER['SERVER_PORT'] ?? 0) === 443)
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $scheme = $isHttps ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $scriptDir = trim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return $scriptDir === '' ? $scheme . '://' . $host : $scheme . '://' . $host . '/' . $scriptDir;
}

function save_pdf_to_reports($payload): array
{
    $siteId = normalize_site_id($payload['siteId'] ?? '');
    $pdfBase64 = trim((string)($payload['pdfBase64'] ?? ''));
    $fileName = trim((string)($payload['fileName'] ?? ($siteId . '_summary.pdf')));
    if ($siteId === '') {
        return ['ok' => false, 'message' => 'Site ID is required to save PDF.'];
    }
    if ($pdfBase64 === '') {
        return ['ok' => false, 'message' => 'PDF content is required.'];
    }

    $workspace = ensure_site_workspace($siteId, [], []);
    $absolutePath = $workspace['reportsDir'] . DIRECTORY_SEPARATOR . sanitize_file_name($fileName);
    $binary = base64_decode($pdfBase64, true);
    if ($binary === false) {
        return ['ok' => false, 'message' => 'Invalid PDF content.'];
    }
    if (file_put_contents($absolutePath, $binary, LOCK_EX) === false) {
        return ['ok' => false, 'message' => 'Unable to save PDF file.'];
    }

    $relativePath = 'uploads/' . $siteId . '/Reports/' . basename($absolutePath);
    return [
        'ok' => true,
        'file' => file_descriptor_from_relative_path($relativePath, 'report'),
        'siteWorkspace' => site_workspace_to_object($workspace)
    ];
}

function save_report_files($payload): array
{
    $siteId = normalize_site_id($payload['siteId'] ?? '');
    if ($siteId === '') {
        return ['ok' => false, 'message' => 'Site ID is required to save report files.'];
    }

    $workspace = ensure_site_workspace($siteId, [], []);
    $task = read_site_datasheet($workspace);
    $indexedFiles = [];
    foreach (array_merge($task['documents'] ?? [], $task['photos'] ?? [], $task['measurementImages'] ?? []) as $item) {
        $indexedFiles[$item['id']] = $item;
    }

    $selectedFileIds = is_array($payload['selectedFileIds'] ?? null) ? $payload['selectedFileIds'] : [];
    $copiedFileIds = [];
    foreach ($selectedFileIds as $fileId) {
        $key = trim((string)$fileId);
        if ($key === '' || empty($indexedFiles[$key]['relativePath'])) {
            continue;
        }
        $sourceRelativePath = $indexedFiles[$key]['relativePath'];
        $sourceAbsolutePath = root_dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $sourceRelativePath);
        if (!is_file($sourceAbsolutePath)) {
            continue;
        }
        $targetName = sanitize_file_name($indexedFiles[$key]['storedName'] ?: basename($sourceAbsolutePath));
        $targetAbsolutePath = $workspace['reportsDir'] . DIRECTORY_SEPARATOR . $targetName;
        copy($sourceAbsolutePath, $targetAbsolutePath);
        $copiedFileIds[] = $key;
    }

    $pdfResult = save_pdf_to_reports($payload);
    if (!($pdfResult['ok'] ?? false)) {
        return $pdfResult;
    }

    return [
        'ok' => true,
        'file' => $pdfResult['file'],
        'copiedFileIds' => $copiedFileIds,
        'siteWorkspace' => site_workspace_to_object($workspace)
    ];
}

function delete_hostinger_file($payload, array $defaultState, array $siteMasterHeaders, array $siteEngineerHeaders): array
{
    $siteId = normalize_site_id($payload['siteId'] ?? '');
    $fileId = trim((string)($payload['fileId'] ?? ''));
    if ($siteId === '' || $fileId === '') {
        return ['ok' => false, 'message' => 'Site ID and file ID are required.'];
    }

    $workspace = ensure_site_workspace($siteId, $siteMasterHeaders, $siteEngineerHeaders);
    $task = read_site_datasheet($workspace);
    $deletedRelativePath = '';

    foreach (['documents', 'photos', 'measurementImages'] as $group) {
        $filtered = [];
        foreach ($task[$group] as $item) {
            if (($item['id'] ?? '') === $fileId) {
                $deletedRelativePath = $item['relativePath'] ?? '';
                continue;
            }
            $filtered[] = $item;
        }
        $task[$group] = $filtered;
    }

    if ($deletedRelativePath !== '') {
        $absolutePath = root_dir() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $deletedRelativePath);
        if (is_file($absolutePath)) {
            @unlink($absolutePath);
        }
    }

    $task['updatedAt'] = gmdate('c');
    write_site_datasheet($workspace, $task, $siteMasterHeaders, $siteEngineerHeaders);

    $state = normalize_state(read_json_file(state_file_path(), $defaultState), $defaultState);
    foreach ($state['tasks'] as &$stateTask) {
        if (($stateTask['siteId'] ?? '') === $siteId) {
            $stateTask = $task;
        }
    }
    unset($stateTask);
    write_json_file(state_file_path(), $state);

    return [
        'ok' => true,
        'task' => $task,
        'siteWorkspace' => site_workspace_to_object($workspace)
    ];
}

function delete_site_task($payload, array $defaultState): array
{
    $siteId = normalize_site_id($payload['siteId'] ?? '');
    if ($siteId === '') {
        return ['ok' => false, 'message' => 'Site ID is required.'];
    }

    $jsonFile = ensure_json_file();
    $state = normalize_state(read_json_file($jsonFile, $defaultState), $defaultState);

    $removedTask = null;
    $remainingTasks = [];

    foreach ($state['tasks'] as $task) {
        $normalizedTask = normalize_task($task);
        if (($normalizedTask['siteId'] ?? '') === $siteId) {
            $removedTask = $normalizedTask;
            continue;
        }
        $remainingTasks[] = $normalizedTask;
    }

    if ($removedTask === null) {
        return ['ok' => false, 'message' => 'Task not found for this Site ID.'];
    }

    $removedTaskId = trim((string)($removedTask['id'] ?? ''));
    $removedBaseTaskId = trim((string)($removedTask['baseTaskId'] ?? ''));
    $removedDraftId = trim((string)($removedTask['draftId'] ?? ''));

    $remainingDrafts = [];
    foreach ($state['drafts'] as $draft) {
        if (!is_array($draft)) {
            continue;
        }
        $draftId = trim((string)($draft['id'] ?? ''));
        $sourceTaskId = trim((string)($draft['sourceTaskId'] ?? ''));
        $sourceBaseTaskId = extract_task_base_id($sourceTaskId);

        if (
            ($removedDraftId !== '' && $draftId === $removedDraftId) ||
            ($removedTaskId !== '' && $sourceTaskId === $removedTaskId) ||
            ($removedBaseTaskId !== '' && $sourceBaseTaskId === $removedBaseTaskId)
        ) {
            continue;
        }

        $remainingDrafts[] = $draft;
    }

    $state['tasks'] = array_values($remainingTasks);
    $state['drafts'] = array_values($remainingDrafts);
    write_json_file($jsonFile, $state);

    $siteDir = uploads_root() . DIRECTORY_SEPARATOR . $siteId;
    if (is_dir($siteDir)) {
        remove_directory_recursive($siteDir);
    }

    return [
        'ok' => true,
        'status' => 'success',
        'siteId' => $siteId,
        'state' => $state
    ];
}

function remove_directory_recursive(string $directory): void
{
    if (!is_dir($directory)) {
        return;
    }

    foreach (scandir($directory) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $path = $directory . DIRECTORY_SEPARATOR . $entry;
        if (is_dir($path)) {
            remove_directory_recursive($path);
        } elseif (file_exists($path)) {
            @unlink($path);
        }
    }

    @rmdir($directory);
}

function sanitize_file_name(string $fileName): string
{
    $baseName = pathinfo($fileName, PATHINFO_FILENAME);
    $extension = pathinfo($fileName, PATHINFO_EXTENSION);
    $safeBaseName = preg_replace('/[^A-Za-z0-9._-]+/', '_', $baseName) ?: 'file';
    $safeExtension = preg_replace('/[^A-Za-z0-9]+/', '', $extension);
    return $safeExtension !== '' ? $safeBaseName . '.' . strtolower($safeExtension) : $safeBaseName;
}
