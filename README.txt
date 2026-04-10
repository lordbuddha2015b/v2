Bliss TaskPro V2
Workflow And Integration Notes

Source Of Truth Folder
- This folder is the active app folder used for deployment:
  E:\Bob_Coding\Bliss TaskPro_V2\v2\Blissinfra

Main Runtime Files
- index.html: Master app entry
- engineer.html: Engineer app entry
- shared.js: Shared frontend logic, sessions, local cache, login API call, Hostinger API calls
- master.js: Master workflow logic
- engineer.js: Engineer workflow logic
- storage.php: Hostinger JSON/task/report backend
- upload.php: Hostinger file upload backend
- styles.css: Shared styling
- .htaccess: HTTPS redirect, rewrite rules, security headers

Current Architecture
- Login verification uses Google Apps Script only.
- Tasks, drafts, sync, and report persistence use Hostinger storage.
- File uploads use Hostinger uploads folder.
- Browser local storage is used as device cache and fallback.

Login Flow
1. User opens index.html or engineer.html.
2. User enters ID and password.
3. shared.js sends login request to the Google Apps Script URL.
4. If login is valid, session details are stored in browser storage.
5. After login, the app fetches the latest task state from Hostinger storage.php.

Master App Flow
1. Master logs in.
2. Master creates drafts from client, engineer, category, and activity.
3. Master assigns a draft into a task by adding Site ID, date, location, district, and instructions.
4. The full app state is saved to Hostinger through storage.php.
5. storage.php writes the app state JSON and also creates or updates the per-site workspace and datasheet.
6. Master can export PDF and save reports into the Hostinger Reports folder.

Engineer App Flow
1. Engineer logs in.
2. Engineer task list is loaded from Hostinger state.
3. Engineer opens a task and updates site engineer name, status, measurement text, GPS, and uploads.
4. Documents, photos, and measurement images are uploaded through upload.php.
5. Task data is saved back through storage.php.
6. File remove action updates task state and also attempts physical file deletion from Hostinger.

Hostinger State Storage
- Main JSON state file:
  json/hostinger_state.json

- This file is auto-created by storage.php if missing.

- Stored sections:
  - options
  - settings
  - drafts
  - tasks

Per Site Workspace Structure
- uploads/SITEID/
- uploads/SITEID/Documents/
- uploads/SITEID/Site Photos/
- uploads/SITEID/Measurement Photos/
- uploads/SITEID/Reports/
- uploads/SITEID/SITEID_DataSheet.json

Upload Backend
- upload.php accepts POST form data:
  - file
  - siteId
  - fileType

- fileType values:
  - document
  - photo
  - measurement

- upload.php creates the site workspace if needed and returns:
  - fileURL
  - fileName
  - fileId
  - relativePath

Storage Backend
- storage.php supports:
  - GET action=getState
  - GET action=getTask
  - POST action=syncState
  - POST action=savePdfToDrive
  - POST action=saveReportFiles
  - POST action=deleteDriveFile

Conflict Safe Sync
- storage.php now merges incoming device state with the stored Hostinger state.
- Tasks are merged by Site ID or task base identity.
- The newer task version is kept based on updatedAt, completedAt, and createdAt timestamps.
- This prevents an older Master device copy from overwriting a newer Engineer-completed task.
- This also helps preserve site engineer name, status, rollback reason, uploaded files, and other newer task fields.

Important Runtime Note
- This app needs PHP runtime support.
- If the app is opened from a static host or from a local file path, storage.php and upload.php will not run.
- In that case the app shows:
  "Unable to reach Hostinger storage right now. Cached data is still available."

Correct Hosting Requirement
- index.html, engineer.html, shared.js, master.js, engineer.js, storage.php, upload.php, uploads, json, images, styles.css must all be deployed together on a PHP-enabled host.
- Hostinger public_html is the intended runtime target.

Local Cache Behavior
- Device cache is stored in browser localStorage and sessionStorage.
- Clear Cache removes device data only.
- Clear Cache does not remove Hostinger server data.

Reference / Non-runtime Files In This Folder
- Bliss TaskPro_Login_Credential.xlsx
- hostinger_state.json.txt
- thumbnail.png

These appear to be reference/support files and are not required by the app runtime.

Maintenance Rule
- Keep this README.txt updated whenever app architecture, storage flow, login flow, sync flow, or deployment flow changes.
