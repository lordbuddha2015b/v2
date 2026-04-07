(function () {
  const STORAGE_KEY = "bliss-taskpro-state-v2";
  const MASTER_SETTINGS_KEY = "bliss-taskpro-master-settings";
  const ENGINEER_SETTINGS_KEY = "bliss-taskpro-engineer-settings";
  const MASTER_SESSION_KEY = "bliss-taskpro-master-session";
  const ENGINEER_SESSION_KEY = "bliss-taskpro-engineer-session";
  const SHARED_SCRIPT_URL_KEY = "scriptURL";
  const SHARED_SESSION_TOKEN_KEY = "sessionToken";
  const SHARED_ROLE_KEY = "userRole";
  const SHARED_DISPLAY_NAME_KEY = "displayName";
  const MASTER_SCRIPT_URL_KEY = "bliss-taskpro-master-script-url";
  const ENGINEER_SCRIPT_URL_KEY = "bliss-taskpro-engineer-script-url";
  const APPS_SCRIPT_PROXY_URL = "./api/apps-script-proxy.php";
  const HOSTINGER_UPLOAD_URL = "./upload.php";
  const DEFAULT_LOGIN_API = {
    master: "https://script.google.com/macros/s/AKfycbxdVLShug748qRYTRjDsg3INyGLGXAnKeqPnNA2AHzjoSbdu1YABRhwlUN47JXe46yU/exec",
    engineer: "https://script.google.com/macros/s/AKfycbwFAw5fOPSCQ3w1sX4hfc4utmuSlDTIy_6hgC1DCbhkJX6ZgKSakGV6YIIwFmsJmks/exec"
  };

  const defaults = {
    options: {
      clients: ["JIO", "Retail", "Others"],
      engineers: ["Naveen", "Rocky", "Sriram"],
      categories: ["Project", "O&M", "Others"],
      activities: ["Enod B", "5G", "Upgradation", "Repair", "Others"],
      districts: []
    },
    settings: {
      master: {
        googleScriptUrl: "",
        autoSyncEnabled: false
      },
      engineer: {
        googleScriptUrl: "",
        autoSyncEnabled: false
      }
    },
    drafts: [],
    tasks: []
  };

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaults));
  }

  function readState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    const storedSettings = readSettings();
    if (!raw) {
      const clean = cloneDefaults();
      clean.settings = normalizeSettings(storedSettings, clean.settings);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      return clean;
    }

    try {
      const parsed = JSON.parse(raw);
      const base = cloneDefaults();
      return {
        options: normalizeOptions(parsed.options, base.options),
        settings: normalizeSettings(storedSettings || parsed.settings, base.settings),
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
      };
    } catch (error) {
      const clean = cloneDefaults();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
      return clean;
    }
  }

  function writeState(state) {
    writeSettings(state.settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeStateForStorage(state)));
    return state;
  }

  function sanitizeStateForStorage(state) {
    return {
      ...state,
      tasks: (state.tasks || []).map((task) => ({
        ...task,
        documents: (task.documents || []).map(stripFileContent),
        photos: (task.photos || []).map(stripFileContent),
        measurementImages: (task.measurementImages || []).map(stripFileContent)
      }))
    };
  }

  function stripFileContent(file) {
    if (!file || typeof file !== "object") return file;
    const { base64Content, previewUrl, ...rest } = file;
    return rest;
  }

  function readSettings() {
    return normalizeSettings({
      master: readAppSettings(MASTER_SETTINGS_KEY),
      engineer: readAppSettings(ENGINEER_SETTINGS_KEY)
    }, cloneDefaults().settings);
  }

  function writeSettings(settings) {
    const normalized = normalizeSettings(settings, cloneDefaults().settings);
    localStorage.setItem(MASTER_SETTINGS_KEY, JSON.stringify(normalized.master));
    localStorage.setItem(ENGINEER_SETTINGS_KEY, JSON.stringify(normalized.engineer));
  }

  function readAppSettings(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function normalizeOptions(input, fallback) {
    const base = JSON.parse(JSON.stringify(fallback));
    const next = input || {};
    return {
      clients: mergeOptionList(base.clients, next.clients),
      engineers: mergeOptionList(base.engineers, next.engineers),
      categories: mergeOptionList(base.categories, next.categories),
      activities: mergeOptionList(base.activities, next.activities),
      districts: mergeOptionList(base.districts, next.districts)
    };
  }

  function mergeRemoteOptions(currentOptions, remoteOptions) {
    return normalizeOptions({ ...(currentOptions || {}), ...(remoteOptions || {}) }, cloneDefaults().options);
  }

  function mergeOptionList(baseList, nextList) {
    const seen = new Set();
    return [...(Array.isArray(baseList) ? baseList : []), ...(Array.isArray(nextList) ? nextList : [])]
      .map((item) => String(item || "").trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }

  function clearLocalCache() {
    const appName = document.body?.dataset?.app === "engineer" ? "engineer" : "master";
    const state = readState();
    state.settings = normalizeSettings(state.settings, cloneDefaults().settings);
    if (appName === "master") {
      state.settings.master.googleScriptUrl = "";
      localStorage.removeItem(MASTER_SETTINGS_KEY);
      localStorage.removeItem(MASTER_SCRIPT_URL_KEY);
      sessionStorage.removeItem(MASTER_SESSION_KEY);
    } else {
      state.settings.engineer.googleScriptUrl = "";
      localStorage.removeItem(ENGINEER_SETTINGS_KEY);
      localStorage.removeItem(ENGINEER_SCRIPT_URL_KEY);
      sessionStorage.removeItem(ENGINEER_SESSION_KEY);
    }
    clearSharedLoginContext(appName);
    writeState(state);
  }

  function getScriptStorageKey(role) {
    return role === "engineer" ? ENGINEER_SCRIPT_URL_KEY : MASTER_SCRIPT_URL_KEY;
  }

  function readStoredScriptUrl(role) {
    const defaultLoginApi = sanitizeGoogleValue(DEFAULT_LOGIN_API[role] || DEFAULT_LOGIN_API.master);
    return sanitizeGoogleValue(
      localStorage.getItem(getScriptStorageKey(role))
      || localStorage.getItem(SHARED_SCRIPT_URL_KEY)
      || defaultLoginApi
    );
  }

  function persistRoleScriptUrl(role, scriptUrl) {
    const sanitized = sanitizeGoogleValue(scriptUrl);
    if (!sanitized) return "";
    localStorage.setItem(getScriptStorageKey(role), sanitized);
    localStorage.setItem(SHARED_SCRIPT_URL_KEY, sanitized);
    return sanitized;
  }

  function resolveGoogleScriptUrl(settings, role) {
    return sanitizeGoogleValue(settings?.googleScriptUrl) || readStoredScriptUrl(role);
  }

  async function proxyAppsScriptRequest({ scriptUrl, method = "GET", query = {}, body = null }) {
    const response = await fetch(APPS_SCRIPT_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scriptUrl,
        method,
        query,
        body
      })
    });
    return await response.json();
  }

  function clearSharedLoginContext(role) {
    if (!role || localStorage.getItem(SHARED_ROLE_KEY) === role) {
      localStorage.removeItem(SHARED_SCRIPT_URL_KEY);
      localStorage.removeItem(SHARED_SESSION_TOKEN_KEY);
      localStorage.removeItem(SHARED_ROLE_KEY);
      localStorage.removeItem(SHARED_DISPLAY_NAME_KEY);
    }
  }

  function cacheLoginContext(role, response) {
    const scriptUrl = persistRoleScriptUrl(role, response?.scriptURL || response?.user?.scriptURL || "");
    if (scriptUrl) {
      localStorage.setItem(SHARED_SCRIPT_URL_KEY, scriptUrl);
    }
    if (response?.sessionToken) {
      localStorage.setItem(SHARED_SESSION_TOKEN_KEY, response.sessionToken);
    }
    localStorage.setItem(SHARED_ROLE_KEY, role);
    localStorage.setItem(SHARED_DISPLAY_NAME_KEY, response?.name || response?.user?.name || "");
    return scriptUrl;
  }

  function uid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function extractTaskBaseId(taskId) {
    const value = String(taskId || "").trim();
    if (!value) return "";
    return value.replace(/^(draft|task|wip|complete)-/i, "");
  }

  function toLifecycleTaskId(taskId, statusOrStage) {
    const baseId = extractTaskBaseId(taskId);
    const rawStage = String(statusOrStage || "").trim().toLowerCase();
    const prefix = rawStage === "completed" || rawStage === "complete"
      ? "complete"
      : rawStage === "wip"
        ? "wip"
        : rawStage === "pending" || rawStage === "task"
          ? "task"
          : "draft";
    return baseId ? `${prefix}-${baseId}` : "";
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function statusClass(status) {
    if (status === "WIP") return "status-wip";
    if (status === "Completed") return "status-completed";
    return "status-pending";
  }

  function setOptions(select, items, placeholder) {
    if (!select) return;
    const head = placeholder ? `<option value="">${placeholder}</option>` : "";
    select.innerHTML = `${head}${items.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
  }

  function emptyMarkup(message) {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  function ensurePrefixedFiles(siteId, files, extra) {
    return Array.from(files || []).map((file) => ({
      id: uid("file"),
      originalName: file.name,
      storedName: `${siteId}_${file.name}`,
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      uploadedAt: new Date().toISOString(),
      ...extra
    }));
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function enrichFilesWithContent(siteId, files, extra) {
    const items = [];
    for (const file of Array.from(files || [])) {
      const dataUrl = await readFileAsDataUrl(file);
      const base64Content = String(dataUrl).split(",")[1] || "";
      items.push({
        id: uid("file"),
        originalName: file.name,
        storedName: `${siteId}_${file.name}`,
        type: file.type || "application/octet-stream",
        size: file.size || 0,
        uploadedAt: new Date().toISOString(),
        base64Content,
        previewUrl: dataUrl,
        ...extra
      });
    }
    return items;
  }

  async function uploadFileToHostinger(file, siteId, fileType, extra = {}) {
    if (!file) {
      throw new Error("File is required.");
    }
    if (!siteId) {
      throw new Error("Site ID is required.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("siteId", siteId);
    formData.append("fileType", fileType);

    const response = await fetch(HOSTINGER_UPLOAD_URL, {
      method: "POST",
      body: formData
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || payload?.status !== "success" || !payload?.fileURL) {
      throw new Error(payload?.message || "Unable to upload file to Hostinger.");
    }

    const fileUrl = String(payload.fileURL);
    const uploadedAt = new Date().toISOString();
    const storedName = String(payload.fileName || payload.storedName || file.name || "");
    const isImage = String(file.type || "").startsWith("image/");

    return {
      id: uid("file"),
      originalName: file.name,
      storedName,
      name: storedName,
      type: file.type || "application/octet-stream",
      size: file.size || 0,
      uploadedAt,
      fileURL: fileUrl,
      downloadURL: fileUrl,
      thumbnailUrl: isImage ? fileUrl : "",
      ...extra
    };
  }

  function countByStatus(tasks, status) {
    return tasks.filter((task) => task.status === status).length;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function loadDistricts() {
    const response = await fetch("./json/karnataka_districts.json");
    const data = await response.json();
    return data.map((item) => item.name);
  }

  async function postGoogleSync(state, payload) {
    const source = payload.source === "engineer" ? "engineer" : "master";
    const activeSettings = state.settings?.[source] || {};
    const endpoint = resolveGoogleScriptUrl(activeSettings, source);
    if (!endpoint) return { skipped: true };
    try {
      const data = await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "POST",
        body: { ...payload, state: sanitizeStateForStorage(state), activeSettings }
      });
      return data?.ok === false ? { skipped: false, error: new Error(data.message || data.error || "Sync failed"), sessionExpired: !!data.sessionExpired } : { skipped: false, data };
    } catch (error) {
      return { skipped: false, error };
    }
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function savePdfToDrive(settings, session, payload) {
    const endpoint = resolveGoogleScriptUrl(settings, session?.role || "master");
    if (!endpoint) return { ok: false, message: "Apps Script endpoint is not available." };
    try {
      return await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "POST",
        body: {
          action: "savePdfToDrive",
          source: session?.role || "master",
          userId: session?.userId || "",
          sessionToken: session?.sessionToken || "",
          payload
        }
      });
    } catch (error) {
      return { ok: false, message: error.message || "Unable to save PDF to Drive." };
    }
  }

  async function deleteDriveFile(settings, session, payload) {
    const endpoint = resolveGoogleScriptUrl(settings, session?.role || "engineer");
    if (!endpoint) return { ok: false, message: "Apps Script endpoint is not available." };
    try {
      return await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "POST",
        body: {
          action: "deleteDriveFile",
          source: session?.role || "engineer",
          userId: session?.userId || "",
          sessionToken: session?.sessionToken || "",
          payload
        }
      });
    } catch (error) {
      return { ok: false, message: error.message || "Unable to delete Drive file." };
    }
  }

  async function saveReportFiles(settings, session, payload) {
    const endpoint = resolveGoogleScriptUrl(settings, session?.role || "master");
    if (!endpoint) return { ok: false, message: "Apps Script endpoint is not available." };
    try {
      return await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "POST",
        body: {
          action: "saveReportFiles",
          source: session?.role || "master",
          userId: session?.userId || "",
          sessionToken: session?.sessionToken || "",
          payload
        }
      });
    } catch (error) {
      return { ok: false, message: error.message || "Unable to save report files." };
    }
  }

  async function fetchGoogleTask(settings, siteId, session) {
    const endpoint = resolveGoogleScriptUrl(settings, session?.role || "");
    if (!endpoint || !siteId) return null;
    try {
      return await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "GET",
        query: {
          action: "getTask",
          siteId,
          source: session?.role || "",
          userId: session?.userId || "",
          sessionToken: session?.sessionToken || ""
        }
      });
    } catch (error) {
      return null;
    }
  }

  async function fetchGoogleState(settings, session) {
    const endpoint = resolveGoogleScriptUrl(settings, session?.role || "");
    if (!endpoint) return null;
    try {
      return await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "GET",
        query: {
          action: "getState",
          source: session?.role || "",
          userId: session?.userId || "",
          sessionToken: session?.sessionToken || ""
        }
      });
    } catch (error) {
      return null;
    }
  }

  async function loginWithGoogle(settings, role, userId, password) {
    const endpoint = sanitizeGoogleValue(DEFAULT_LOGIN_API[role] || DEFAULT_LOGIN_API.master);
    if (!endpoint) {
      return { ok: false, message: "Default login API is not configured." };
    }
    try {
      const data = await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "POST",
        query: { action: "login" },
        body: {
          action: "login",
          source: role,
          activeSettings: settings,
          payload: { role, userId, password }
        }
      });
      if (data?.ok) {
        data.scriptURL = sanitizeGoogleValue(data.scriptURL) || endpoint;
        data.status = data.status || "success";
        return data;
      }
      return {
        ok: false,
        message: data?.message || data?.error || "Login failed.",
        error: data?.error || data?.message || "Login failed."
      };
    } catch (error) {
      return { ok: false, message: `Unable to verify login. ${error.message || ""}`.trim() };
    }
  }

  async function fetchGoogleConfig(settings) {
    const endpoint = resolveGoogleScriptUrl(settings, document.body?.dataset?.app === "engineer" ? "engineer" : "master");
    if (!endpoint) return null;
    try {
      const data = await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "GET"
      });
      if (!data?.ok) return null;
      return {
        googleScriptUrl: sanitizeGoogleValue(data.scriptURL) || endpoint,
        siteRootFolderId: sanitizeGoogleValue(data.siteRootFolderId)
      };
    } catch (error) {
      return null;
    }
  }

  function sanitizeGoogleValue(value) {
    const next = String(value || "").trim();
    if (!next) return "";
    if (next.includes("PASTE_")) return "";
    return next;
  }

  function mergeGoogleSettings(currentSettings, nextSettings) {
    return {
      googleScriptUrl: sanitizeGoogleValue(nextSettings?.googleScriptUrl) || currentSettings?.googleScriptUrl || "",
      autoSyncEnabled: typeof nextSettings?.autoSyncEnabled === "boolean"
        ? nextSettings.autoSyncEnabled
        : currentSettings?.autoSyncEnabled ?? false
    };
  }

  function normalizeSettings(input, fallback) {
    const base = JSON.parse(JSON.stringify(fallback));
    if (!input) {
      return {
        master: { ...base.master, googleScriptUrl: readStoredScriptUrl("master") },
        engineer: { ...base.engineer, googleScriptUrl: readStoredScriptUrl("engineer") }
      };
    }
    if (input.master || input.engineer) {
      return {
        master: { ...base.master, ...(input.master || {}), googleScriptUrl: sanitizeGoogleValue(input.master?.googleScriptUrl) || readStoredScriptUrl("master") },
        engineer: { ...base.engineer, ...(input.engineer || {}), googleScriptUrl: sanitizeGoogleValue(input.engineer?.googleScriptUrl) || readStoredScriptUrl("engineer") }
      };
    }
    return {
      master: { ...base.master, ...(input || {}), googleScriptUrl: sanitizeGoogleValue(input?.googleScriptUrl) || readStoredScriptUrl("master") },
      engineer: { ...base.engineer, googleScriptUrl: readStoredScriptUrl("engineer") }
    };
  }

  async function reverseGeocodeDistrict(latitude, longitude) {
    if (!latitude || !longitude) return "";
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });
      const data = await response.json();
      const address = data.address || {};
      return address.state_district || address.county || address.city_district || "";
    } catch (error) {
      return "";
    }
  }

  async function validateGoogleSession(settings, session) {
    const endpoint = resolveGoogleScriptUrl(settings, session?.role || "");
    if (!endpoint || !session?.userId || !session?.sessionToken) return { ok: false, sessionExpired: true };
    try {
      return await proxyAppsScriptRequest({
        scriptUrl: endpoint,
        method: "GET",
        query: {
          action: "validateSession",
          role: session.role || "",
          userId: session.userId || "",
          sessionToken: session.sessionToken || ""
        }
      });
    } catch (error) {
      return { ok: false, message: "Unable to validate session." };
    }
  }

  function getStatusHost() {
    let host = document.getElementById("floating-sync-status");
    if (host) return host;
    host = document.createElement("div");
    host.id = "floating-sync-status";
    host.className = "floating-sync-status hidden";
    host.innerHTML = '<div class="floating-sync-status__bar"></div><div class="floating-sync-status__text"></div>';
    document.body.appendChild(host);
    return host;
  }

  function showSyncStatus(message, tone = "working", persist = false) {
    const host = getStatusHost();
    host.className = `floating-sync-status tone-${tone}`;
    const normalizedMessage = String(message || "") === "Fetching latest updates from Google Sheets..."
      ? "Please Wait, Saving data."
      : message;
    host.querySelector(".floating-sync-status__text").textContent = normalizedMessage;
    host.classList.remove("hidden");
    if (!persist) {
      clearTimeout(showSyncStatus.timeoutId);
      showSyncStatus.timeoutId = setTimeout(() => {
        host.classList.add("hidden");
      }, tone === "working" ? 120000 : 2600);
    }
  }

  function hideSyncStatus() {
    const host = document.getElementById("floating-sync-status");
    clearTimeout(showSyncStatus.timeoutId);
    if (host) host.classList.add("hidden");
  }

  function saveEngineerSession(session) {
    sessionStorage.setItem(ENGINEER_SESSION_KEY, JSON.stringify(session));
  }

  function saveMasterSession(data) {
    sessionStorage.setItem(MASTER_SESSION_KEY, JSON.stringify(data));
  }

  function getMasterSession() {
    const raw = sessionStorage.getItem(MASTER_SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function formatLoginFailure(result) {
    const message = String(result?.message || result?.error || "Login failed.").trim();
    if (/Credential sheet not found/i.test(message) || /Credential sheet is empty/i.test(message)) {
      return `${message} Check your Google Sheet tabs and login rows.`;
    }
    if (/Default login API is not configured/i.test(message)) {
      return "Default login API is not configured.";
    }
    return message;
  }

  function clearMasterSession() {
    sessionStorage.removeItem(MASTER_SESSION_KEY);
  }

  function getEngineerSession() {
    const raw = sessionStorage.getItem(ENGINEER_SESSION_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object"
        ? parsed
        : { userId: "", name: String(parsed || ""), role: "engineer", sessionToken: "" };
    } catch (error) {
      return { userId: "", name: raw, role: "engineer", sessionToken: "" };
    }
  }

  function clearEngineerSession() {
    sessionStorage.removeItem(ENGINEER_SESSION_KEY);
  }

  window.BlissTaskPro = {
    readState,
    writeState,
    clearLocalCache,
    uid,
    extractTaskBaseId,
    toLifecycleTaskId,
    formatDate,
    statusClass,
    setOptions,
    emptyMarkup,
    ensurePrefixedFiles,
    enrichFilesWithContent,
    uploadFileToHostinger,
    countByStatus,
    escapeHtml,
    loadDistricts,
    postGoogleSync,
    delay,
    savePdfToDrive,
    deleteDriveFile,
    saveReportFiles,
    fetchGoogleTask,
    fetchGoogleState,
    reverseGeocodeDistrict,
    loginWithGoogle,
    fetchGoogleConfig,
    formatLoginFailure,
    validateGoogleSession,
    mergeGoogleSettings,
    mergeRemoteOptions,
    resolveGoogleScriptUrl,
    persistRoleScriptUrl,
    cacheLoginContext,
    clearSharedLoginContext,
    showSyncStatus,
    hideSyncStatus,
    saveMasterSession,
    getMasterSession,
    clearMasterSession,
    saveEngineerSession,
    getEngineerSession,
    clearEngineerSession
  };
})();
