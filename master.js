(function () {
  const app = window.BlissTaskPro;
  let state = app.readState();
  let selectedDraftId = "";
  let selectedMapPoint = null;
  let currentEditDraftId = "";
  let currentEditTaskId = "";
  let currentOpenTaskId = "";
  let pendingRollbackStatus = "";
  let masterSession = app.getMasterSession();
  let map;
  let mapMarker;
  let syncTimer = null;
  let sessionTimer = null;

  const navButtons = document.querySelectorAll("[data-page-target]");
  const sections = document.querySelectorAll(".page-section");
  const masterLoginScreen = document.getElementById("master-login-screen");
  const masterAppShell = document.getElementById("master-app-shell");

  const masterForm = document.getElementById("master-filter-form");
  const assignmentForm = document.getElementById("task-assignment-form");
  const masterSyncButton = document.getElementById("master-sync-button");

  const clientMaster = document.getElementById("clientMaster");
  const engineerMaster = document.getElementById("engineerMaster");
  const categoryMaster = document.getElementById("categoryMaster");
  const activityMaster = document.getElementById("activityMaster");
  const clientMasterOther = document.getElementById("clientMasterOther");
  const engineerMasterOther = document.getElementById("engineerMasterOther");
  const categoryMasterOther = document.getElementById("categoryMasterOther");
  const activityMasterOther = document.getElementById("activityMasterOther");
  const draftSelector = document.getElementById("draftSelector");
  const districtSelect = document.getElementById("assignDistrict");
  const assignmentFields = document.getElementById("assignment-fields");
  const assignmentEmptyState = document.getElementById("assignment-empty-state");

  const assignSiteId = document.getElementById("assignSiteId");
  const assignDate = document.getElementById("assignDate");
  const assignLocation = document.getElementById("assignLocation");
  const assignLatitude = document.getElementById("assignLatitude");
  const assignLongitude = document.getElementById("assignLongitude");
  const assignInstructions = document.getElementById("assignInstructions");

  function showMasterApp() {
    masterLoginScreen.classList.add("hidden");
    masterAppShell.classList.remove("hidden");
    document.getElementById("master-login-debug").classList.add("hidden");
    document.getElementById("master-user-eyebrow").textContent = masterSession?.name || "Master Workspace";
  }

  function showMasterLogin() {
    masterLoginScreen.classList.remove("hidden");
    masterAppShell.classList.add("hidden");
    document.getElementById("master-user-eyebrow").textContent = "Master Workspace";
  }

  function applyRemoteState(remoteState) {
    if (!remoteState) return;
    state.options = app.mergeRemoteOptions(state.options, remoteState.options || {});
    if (Array.isArray(remoteState.tasks)) {
      if (currentOpenTaskId) {
        const localOpenTask = state.tasks.find((task) => task.id === currentOpenTaskId);
        state.tasks = remoteState.tasks.map((task) => {
          if (task.id !== currentOpenTaskId || !localOpenTask) return task;
          return { ...localOpenTask };
        });
      } else {
        state.tasks = remoteState.tasks;
      }
    }
    app.writeState(state);
    refreshAll();
    if (currentOpenTaskId) openTaskDetailModal(currentOpenTaskId);
  }

  function forceLogout(message) {
    masterSession = null;
    app.clearMasterSession();
    app.clearSharedLoginContext("master");
    stopCrossDeviceSync();
    if (message) {
      app.showSyncStatus(message, "error");
    }
    showMasterLogin();
  }

  function saveState(action, payload) {
    app.writeState(state);
    if (!masterSession?.userId || !masterSession?.sessionToken) return;
    app.showSyncStatus("Saving data to Hostinger DataSheet...", "working", true);
    app.postGoogleSync(state, {
      app: "Bliss TaskPro",
      source: "master",
      userId: masterSession?.userId || "",
      sessionToken: masterSession?.sessionToken || "",
      action,
      payload,
      state
    }).then((result) => {
      if (result?.sessionExpired) {
        forceLogout("This Master login was used on another device. Please login again.");
        return;
      }
      if (result?.error) {
        app.showSyncStatus(result.error.message || "Sync failed. Data is still cached on this device.", "error");
        return;
      }
      if (result?.skipped) {
        app.showSyncStatus("Saved locally. Hostinger sync is currently unavailable.", "idle");
        return;
      }
      app.showSyncStatus("Saved to Hostinger DataSheet successfully.", "success");
    });
  }

  function setOptions() {
    app.setOptions(clientMaster, state.options.clients, "Select Client");
    app.setOptions(engineerMaster, state.options.engineers, "Select Engineer");
    app.setOptions(categoryMaster, state.options.categories, "Select Category");
    app.setOptions(activityMaster, state.options.activities, "Select Activity");
    app.setOptions(districtSelect, state.options.districts, "Select District");
  }

  function toggleOtherField(select, input, wrapId, label) {
    const show = /^other/i.test(select.value || "");
    const wrap = document.getElementById(wrapId);
    wrap.classList.toggle("hidden", !show);
    input.required = show;
    if (!show) input.value = "";
    input.placeholder = `Enter ${label}`;
  }

  function resolveSelectValue(selectValue, otherValue) {
    return /^other/i.test(selectValue || "") ? otherValue.trim() : selectValue;
  }

  function pushOptionIfMissing(key, value) {
    if (!value || state.options[key].includes(value)) return;
    state.options[key].push(value);
    state.options[key].sort((a, b) => a.localeCompare(b));
  }

  function getHiddenTaskIdsFromDrafts() {
    return new Set(
      (state.drafts || [])
        .filter((draft) => draft.editable && draft.sourceTaskId)
        .map((draft) => draft.sourceTaskId)
    );
  }

  function getVisibleTasks() {
    const hiddenTaskIds = getHiddenTaskIdsFromDrafts();
    return state.tasks.filter((task) => !hiddenTaskIds.has(task.id));
  }

  function prefillAssignmentFromTask(task) {
    if (!task) return;
    currentEditTaskId = task.id;
    assignSiteId.value = task.siteId || "";
    assignDate.value = task.date || new Date().toISOString().split("T")[0];
    assignLocation.value = task.location || "";
    assignLatitude.value = task.latitude || "";
    assignLongitude.value = task.longitude || "";
    districtSelect.value = task.district || "";
    assignInstructions.value = task.instructions || "";
    assignmentForm.querySelector('button[type="submit"]').textContent = "Update Task";
  }

  function resetAssignmentFieldsOnly() {
    assignSiteId.value = "";
    assignDate.value = new Date().toISOString().split("T")[0];
    assignLocation.value = "";
    assignLatitude.value = "";
    assignLongitude.value = "";
    districtSelect.value = "";
    assignInstructions.value = "";
    currentEditTaskId = "";
    assignmentForm.querySelector('button[type="submit"]').textContent = "Assign Task";
  }

  function renderStats() {
    const visibleTasks = getVisibleTasks();
    document.getElementById("master-total-tasks").textContent = visibleTasks.length;
    document.getElementById("master-pending-tasks").textContent = app.countByStatus(visibleTasks, "Pending");
    document.getElementById("master-wip-tasks").textContent = app.countByStatus(visibleTasks, "WIP");
    document.getElementById("master-completed-tasks").textContent = app.countByStatus(visibleTasks, "Completed");
  }

  function renderDrafts() {
    const host = document.getElementById("draft-list");
    const drafts = getAvailableDrafts();
    if (!drafts.length) {
      host.innerHTML = app.emptyMarkup("No unassigned drafts.");
      return;
    }

    host.innerHTML = drafts.slice().reverse().map((draft) => `
      <article class="stack-card">
        <h5>${app.escapeHtml(draft.client)} | ${app.escapeHtml(draft.engineer)}</h5>
        <p class="meta-line">${app.escapeHtml(draft.category)} | ${app.escapeHtml(draft.activity)}</p>
        ${draft.editable ? '<p class="fine-print">Editable draft</p>' : ""}
        <div class="action-row">
          <button class="secondary-button" type="button" data-edit-draft="${draft.id}">Edit Draft</button>
          <button class="secondary-button" type="button" data-delete-draft="${draft.id}">Delete Draft</button>
        </div>
      </article>
    `).join("");

    host.querySelectorAll("[data-edit-draft]").forEach((button) => {
      button.addEventListener("click", () => loadDraftForEdit(button.dataset.editDraft));
    });
    host.querySelectorAll("[data-delete-draft]").forEach((button) => {
      button.addEventListener("click", () => deleteDraft(button.dataset.deleteDraft));
    });
  }

  function getAvailableDrafts() {
    return state.drafts.filter((draft) => !state.tasks.some((task) => task.draftId === draft.id && task.id !== currentEditTaskId && !draft.sourceTaskId));
  }

  function renderDraftSelector() {
    const drafts = getAvailableDrafts();
    draftSelector.classList.toggle("draft-glow", !!drafts.length);
    if (!drafts.length) {
      draftSelector.innerHTML = '<option value="">No draft available</option>';
      document.getElementById("frozen-summary").innerHTML = "";
      toggleAssignmentVisibility(false);
      return;
    }

    draftSelector.innerHTML = `<option value="">Select Draft</option>${drafts.map((draft) => `
      <option value="${draft.id}">${app.escapeHtml(draft.client)} | ${app.escapeHtml(draft.engineer)} | ${app.escapeHtml(draft.category)} | ${app.escapeHtml(draft.activity)}</option>
    `).join("")}`;

    if (selectedDraftId && drafts.some((draft) => draft.id === selectedDraftId)) {
      draftSelector.value = selectedDraftId;
    }
    renderFrozenSummary();
  }

  function renderFrozenSummary() {
    const host = document.getElementById("frozen-summary");
    const draft = state.drafts.find((item) => item.id === draftSelector.value);
    if (!draft) {
      host.innerHTML = "";
      currentEditTaskId = "";
      toggleAssignmentVisibility(false);
      return;
    }

    selectedDraftId = draft.id;
    toggleAssignmentVisibility(true);
    if (draft.sourceTaskId) {
      const sourceTask = state.tasks.find((item) => item.id === draft.sourceTaskId);
      if (sourceTask) {
        prefillAssignmentFromTask(sourceTask);
      } else {
        resetAssignmentFieldsOnly();
      }
    } else {
      resetAssignmentFieldsOnly();
    }
    host.innerHTML = `
      <span class="frozen-chip">Client: ${app.escapeHtml(draft.client)}</span>
      <span class="frozen-chip">Engineer: ${app.escapeHtml(draft.engineer)}</span>
      <span class="frozen-chip">Category: ${app.escapeHtml(draft.category)}</span>
      <span class="frozen-chip">Activity: ${app.escapeHtml(draft.activity)}</span>
    `;
  }

  function loadDraftForEdit(draftId) {
    const draft = state.drafts.find((item) => item.id === draftId);
    if (!draft) return;
    currentEditDraftId = draft.id;
    setSelectWithOther(clientMaster, clientMasterOther, "clientMasterOtherWrap", "clients", draft.client);
    setSelectWithOther(engineerMaster, engineerMasterOther, "engineerMasterOtherWrap", "engineers", draft.engineer);
    setSelectWithOther(categoryMaster, categoryMasterOther, "categoryMasterOtherWrap", "categories", draft.category);
    setSelectWithOther(activityMaster, activityMasterOther, "activityMasterOtherWrap", "activities", draft.activity);
    masterForm.querySelector('button[type="submit"]').textContent = "Update Draft";
    document.querySelector('[data-page-target="master-page"]').click();
  }

  function deleteDraft(draftId) {
    const draft = state.drafts.find((item) => item.id === draftId);
    if (!draft) return;
    const linkedTask = state.tasks.some((task) => task.draftId === draftId);
    if (linkedTask) {
      window.alert("Assigned drafts cannot be deleted.");
      return;
    }
    state.drafts = state.drafts.filter((item) => item.id !== draftId);
    if (currentEditDraftId === draftId) {
      resetDraftForm();
    }
    saveState("deleteDraft", { draftId });
    refreshAll();
  }

  function setSelectWithOther(select, input, wrapId, optionKey, value) {
    const list = Array.isArray(state.options[optionKey]) ? state.options[optionKey] : [];
    const hasPreset = list.includes(value);
    select.value = hasPreset ? value : "Others";
    input.value = hasPreset ? "" : value || "";
    toggleOtherField(select, input, wrapId, optionKey);
  }

  function renderQueue() {
    const host = document.getElementById("queue-list");
    const visibleTasks = getVisibleTasks();
    if (!visibleTasks.length) {
      host.innerHTML = '<tr><td colspan="5"><div class="empty-state">No task assigned.</div></td></tr>';
      return;
    }

    host.innerHTML = visibleTasks.slice().reverse().map((task, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><button class="site-link-button" type="button" data-open-task="${task.id}">${app.escapeHtml(task.siteId)}</button></td>
        <td>${app.escapeHtml(task.engineer)}</td>
        <td>${app.escapeHtml(task.district || "-")}</td>
        <td>
          <button class="secondary-button status-action-button status-static-button ${app.statusClass(task.status)}" type="button" data-open-task="${task.id}">${task.status}</button>
          ${task.status === "Pending" ? `<div class="queue-inline-actions"><button class="mini-button" type="button" data-edit-task="${task.id}">Edit</button><button class="mini-button" type="button" data-delete-task="${task.id}">Delete</button></div>` : ""}
        </td>
      </tr>
    `).join("");

    host.querySelectorAll("[data-open-task]").forEach((button) => {
      button.addEventListener("click", () => openTaskDetailModal(button.dataset.openTask));
    });
    host.querySelectorAll("[data-edit-task]").forEach((button) => {
      button.addEventListener("click", () => loadTaskForEdit(button.dataset.editTask));
    });
    host.querySelectorAll("[data-delete-task]").forEach((button) => {
      button.addEventListener("click", () => deleteTask(button.dataset.deleteTask));
    });
  }

  function renderTaskTable() {
    const host = document.getElementById("master-task-table");
    const visibleTasks = getVisibleTasks();
    if (!visibleTasks.length) {
      host.innerHTML = '<tr><td colspan="8"><div class="empty-state">No task data yet.</div></td></tr>';
      return;
    }

    host.innerHTML = visibleTasks.slice().reverse().map((task, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><button class="site-link-button" data-open-task="${task.id}">${app.escapeHtml(task.siteId)}</button></td>
        <td>${app.escapeHtml(task.engineer)}</td>
        <td>${app.escapeHtml(task.siteEngineerName || "-")}</td>
        <td>${app.escapeHtml(task.district || "-")}</td>
        <td>${task.documents.filter((item) => item.answer === "Yes").length}</td>
        <td>${task.photos.length}</td>
        <td><button class="secondary-button status-action-button ${app.statusClass(task.status)}" data-open-task="${task.id}">${task.status}</button></td>
      </tr>
    `).join("");

    host.querySelectorAll("[data-open-task]").forEach((button) => {
      button.addEventListener("click", () => openTaskDetailModal(button.dataset.openTask));
    });
  }

  function collectSharePackage(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    return {
      selectedDocuments: task.documents.filter((item) => item.answer === "Yes" && document.querySelector(`[data-doc-id="${item.id}"]`)?.checked).map((item) => item.id),
      selectedPhotos: task.photos.filter((item) => document.querySelector(`[data-photo-id="${item.id}"]`)?.checked).map((item) => item.id),
      selectedMeasurementImages: task.measurementImages.filter((item) => document.querySelector(`[data-measurement-id="${item.id}"]`)?.checked).map((item) => item.id),
      includeMeasurement: document.getElementById("includeMeasurement")?.checked ?? true,
      includeMeasurementImages: document.getElementById("includeMeasurementImages")?.checked ?? true,
      includeInstructions: document.getElementById("includeInstructions")?.checked ?? true,
      includeGps: document.getElementById("includeGps")?.checked ?? true,
      includeRollbackReason: document.getElementById("includeRollbackReason")?.checked ?? true,
      workOrder: document.getElementById("shareWorkOrder")?.value.trim() || "",
      billingStatus: document.getElementById("shareBillingStatus")?.value || "No",
      invoiceNumber: document.getElementById("shareInvoiceNumber")?.value.trim() || "",
      value: document.getElementById("shareValue")?.value || ""
    };
  }

  async function toDataUrl(url) {
    if (!url) return "";
    if (String(url).startsWith("data:")) return String(url);
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      return "";
    }
  }

  async function optimizePdfImage(dataUrl, options = {}) {
    const { quality = 0.6, maxWidth = 1200, format = "image/jpeg" } = options;
    if (!dataUrl) return "";
    return await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const scale = image.width > maxWidth ? maxWidth / image.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(dataUrl);
          return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(format === "image/png"
          ? canvas.toDataURL("image/png")
          : canvas.toDataURL("image/jpeg", quality));
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  async function exportTaskPdf(task, share, remote = null, options = {}) {
    const { download = true, saveDriveCopy = true } = options;
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) return;
    app.showSyncStatus("Exporting...", "working", true);
    const pdf = new jsPDF();
    const selectedDocs = task.documents.filter((item) => share.selectedDocuments.includes(item.id));
    const selectedPhotos = task.photos.filter((item) => share.selectedPhotos.includes(item.id));
    const remoteDocuments = remote?.documents || [];
    const remotePhotos = remote?.photos || [];
    const exportDocuments = mergeExportItems(selectedDocs, remoteDocuments);
    const exportPhotos = mergeExportItems(selectedPhotos, remotePhotos);
    const selectedMeasurementImages = (task.measurementImages || []).filter((item) => share.selectedMeasurementImages.includes(item.id));
    const exportMeasurementImages = mergeExportItems(selectedMeasurementImages, remote?.measurementImages || []);
    let y = 18;

    const pageWidth = pdf.internal.pageSize.getWidth();

    const watermarkData = await optimizePdfImage(await toDataUrl("./images/BlissTaskPro_Logo.png"), { maxWidth: 900, format: "image/png" });

    function drawWatermark() {
      if (!watermarkData) return;
      try {
        if (typeof pdf.GState === "function" && typeof pdf.setGState === "function") {
          pdf.setGState(new pdf.GState({ opacity: 0.08 }));
        }
        pdf.addImage(watermarkData, "PNG", pageWidth / 2 - 38, 102, 76, 76);
        if (typeof pdf.GState === "function" && typeof pdf.setGState === "function") {
          pdf.setGState(new pdf.GState({ opacity: 1 }));
        }
      } catch (error) {}
    }

    function line(text, x = 16) {
      const lines = pdf.splitTextToSize(String(text), 175);
      pdf.text(lines, x, y);
      y += lines.length * 7;
      if (y > 270) {
        pdf.addPage();
        drawWatermark();
        y = 18;
      }
    }

    function ensureSpace(height = 20) {
      if (y + height > 270) {
        pdf.addPage();
        drawWatermark();
        y = 18;
      }
    }

    function sectionTitle(title) {
      ensureSpace(18);
      pdf.setFontSize(14);
      pdf.setFont(undefined, "bold");
      line(title);
      pdf.setFontSize(11);
      pdf.setFont(undefined, "normal");
    }

    function link(text, url) {
      ensureSpace(12);
      const lines = pdf.splitTextToSize(String(text), 175);
      const startY = y;
      pdf.setTextColor(0, 102, 204);
      pdf.textWithLink(lines[0], 16, y, { url });
      if (lines.length > 1) {
        for (let i = 1; i < lines.length; i += 1) {
          y += 7;
          pdf.text(lines[i], 16, y);
        }
      }
      pdf.setTextColor(0, 0, 0);
      y = startY + lines.length * 7;
      if (y > 270) {
        pdf.addPage();
        drawWatermark();
        y = 18;
      }
    }

    function addLinksBlock(title, items) {
      if (!items.length) {
        sectionTitle(title);
        line("No links available.");
        return;
      }
      sectionTitle(title);
      for (const item of items) {
        const fileName = item.storedName || item.name || title;
        if (!item?.url) {
          line(`${fileName}: Link unavailable`);
          return;
        }
        link(fileName, item.url);
      }
    }

    drawWatermark();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(30);
    pdf.text("Bliss TaskPro", pageWidth / 2, y, { align: "center" });
    y += 16;
    pdf.setFontSize(11);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(0, 0, 0);
    sectionTitle("Site Details");
    line(`Site ID: ${task.siteId}`);
    line(`Client: ${task.client}`);
    line(`Category: ${task.category}`);
    line(`Activity: ${task.activity}`);
    y -= 28;
    line(`Engineer: ${task.engineer}`, 112);
    line(`Site Engineer: ${task.siteEngineerName || "-"}`, 112);
    line(`Status: ${task.status}`, 112);
    y += 18;
    sectionTitle("Task Info");
    const infoStartY = y;
    const gpsMeta = buildGpsMeta(task);
    line(`Date: ${app.formatDate(task.date)}`);
    line(`Location: ${task.location}`);
    if (share.includeGps && gpsMeta.url) {
      ensureSpace(12);
      const startY = y;
      pdf.setTextColor(0, 0, 0);
      pdf.textWithLink(`GPS: ${gpsMeta.text}`, 16, y, { url: gpsMeta.url });
      y = startY + 7;
    } else {
      line(`GPS: ${share.includeGps ? gpsMeta.text : "-"}`);
    }
    line(`District: ${task.district || "-"}`);
    const afterTaskInfoY = y;
    y = infoStartY;
    pdf.setFontSize(14);
    pdf.setFont(undefined, "bold");
    line("Billing", 112);
    pdf.setFontSize(11);
    pdf.setFont(undefined, "normal");
    line(`WO: ${share.workOrder || "-"}`, 112);
    line(`Billing Status: ${share.billingStatus}`, 112);
    line(`Invoice No: ${share.invoiceNumber || "-"}`, 112);
    line(`Value: ${share.value || "-"}`, 112);
    y = Math.max(afterTaskInfoY, y) + 2;
    if (share.includeInstructions) {
      sectionTitle("Instructions");
      line(task.instructions || "-");
    }
    if (share.includeRollbackReason) {
      sectionTitle("Rollback Reason");
      line(task.rollbackReason || "-");
    }
    addLinksBlock("All Document Links", exportDocuments);
    if (share.includeMeasurement) {
      sectionTitle("Measurement");
      line(task.measurementText || "-");
    }
    if (share.includeMeasurementImages) {
      addLinksBlock("Measurement Image Links", exportMeasurementImages);
    }
    addLinksBlock("Photo Links", exportPhotos);
    const pdfDataUri = pdf.output("datauristring");
    const pdfBase64 = String(pdfDataUri).split(",")[1] || "";
    let driveSaveResult = null;
    if (saveDriveCopy && pdfBase64 && masterSession) {
      driveSaveResult = await app.savePdfToDrive(state.settings.master, masterSession, {
        siteId: task.siteId,
        fileName: `${task.siteId}_summary.pdf`,
        mimeType: "application/pdf",
        pdfBase64
      });
    }
    if (download) {
      pdf.save(`${task.siteId}_summary.pdf`);
    }
    if (driveSaveResult?.ok || (!saveDriveCopy && download)) {
      app.showSyncStatus(saveDriveCopy ? "PDF downloaded and saved in the Hostinger Reports folder." : "PDF exported successfully.", "success");
    } else if (saveDriveCopy && driveSaveResult && !driveSaveResult.ok) {
      app.showSyncStatus(driveSaveResult.message || "PDF downloaded, but Reports save failed.", "error");
    } else {
      app.hideSyncStatus();
    }
    return { pdfBase64 };
  }

  function safeJsonParse(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function filterLatestRemoteFiles(remoteItems, latestItems) {
    if (!remoteItems.length) return [];
    const names = latestItems.map((item) => item.storedName || item.name).filter(Boolean);
    if (!names.length) return remoteItems;
    return remoteItems.filter((item) => names.includes(item.name || item.storedName));
  }

  function mergeExportItems(localItems, remoteItems) {
    const map = new Map();
    (localItems || []).forEach((item) => {
      const key = item.storedName || item.name;
      if (key) map.set(key, { ...item });
    });
    (remoteItems || []).forEach((item) => {
      const key = item.name || item.storedName;
      if (!key) return;
      map.set(key, { ...(map.get(key) || {}), ...item, storedName: key });
    });
    return Array.from(map.values());
  }

  function buildGpsMeta(task) {
    const latitude = task?.gps?.latitude || task?.latitude || "";
    const longitude = task?.gps?.longitude || task?.longitude || "";
    if (!latitude || !longitude) {
      return { text: "-", url: "" };
    }
    const latText = String(latitude);
    const lngText = String(longitude);
    return {
      text: `${latText}, ${lngText}`,
      url: `https://www.google.com/maps?q=${encodeURIComponent(latText)},${encodeURIComponent(lngText)}`
    };
  }

  function toggleAssignmentVisibility(show) {
    assignmentFields?.classList.toggle("hidden", !show);
    assignmentEmptyState?.classList.toggle("hidden", show);
    [assignSiteId, assignDate, assignLocation, assignLatitude, assignLongitude, districtSelect, assignInstructions].forEach((field) => {
      if (!field) return;
      field.disabled = !show;
    });
  }

  async function openTaskDetailModal(taskId) {
    currentOpenTaskId = taskId;
    const task = state.tasks.find((item) => item.id === taskId);
    const host = document.getElementById("task-detail-modal-content");
    if (!task) {
      host.innerHTML = app.emptyMarkup("Task not found.");
      return;
    }

    const remote = await app.fetchGoogleTask(state.settings.master, task.siteId, masterSession);
    if (remote?.sessionExpired) {
      forceLogout("This Master login was used on another device. Please login again.");
      return;
    }
    const latestRow = remote?.latestRow || {};
    const latestDocuments = safeJsonParse(latestRow["Documents JSON"]);
    const latestPhotos = safeJsonParse(latestRow["Photos JSON"]);
    const latestMeasurementImages = safeJsonParse(latestRow["Measurement Images JSON"]);
    const remoteDocuments = filterLatestRemoteFiles(remote?.documents || [], latestDocuments);
    const remotePhotoPool = filterLatestRemoteFiles(remote?.photos || [], latestPhotos.concat(latestMeasurementImages));
    const remotePhotos = filterLatestRemoteFiles(remotePhotoPool, latestPhotos);
    const remoteMeasurementImages = filterLatestRemoteFiles(remotePhotoPool, latestMeasurementImages);
    const taskView = {
      ...task,
      siteEngineerName: latestRow["Site Engineer Name"] || task.siteEngineerName,
      status: latestRow.Status || task.status,
      measurementText: latestRow["Measurement Text"] || task.measurementText,
      gps: latestRow["GPS Latitude"] || latestRow["GPS Longitude"]
        ? { latitude: latestRow["GPS Latitude"], longitude: latestRow["GPS Longitude"] }
        : task.gps,
      documents: latestDocuments.length ? latestDocuments : task.documents,
      photos: latestPhotos.length ? latestPhotos : task.photos,
      measurementImages: latestMeasurementImages.length ? latestMeasurementImages : task.measurementImages
    };
    task.documents = taskView.documents;
    task.photos = taskView.photos;
    task.measurementImages = taskView.measurementImages;
    task.measurementText = taskView.measurementText;
    task.gps = taskView.gps;
    task.siteEngineerName = taskView.siteEngineerName;
    task.status = taskView.status;
    task.rollbackReason = taskView.rollbackReason || task.rollbackReason;

    const share = task.sharePackage || {
      selectedDocuments: taskView.documents.filter((item) => item.answer === "Yes").map((item) => item.id),
      selectedPhotos: taskView.photos.map((item) => item.id),
      selectedMeasurementImages: taskView.measurementImages.map((item) => item.id),
      includeMeasurement: true,
      includeMeasurementImages: true,
      includeInstructions: true,
      includeGps: true,
      includeRollbackReason: true,
      workOrder: "",
      billingStatus: "No",
      invoiceNumber: "",
      value: ""
    };
    const gpsMeta = buildGpsMeta(taskView);

    host.innerHTML = `
      <div class="detail-panel">
        <div class="task-hero">
          <div class="task-hero-main">
            <h4>Site ID: ${app.escapeHtml(taskView.siteId)}</h4>
            <p class="task-hero-client">Client: ${app.escapeHtml(taskView.client)}</p>
            <p class="meta-line"><strong>Engineer:</strong> ${app.escapeHtml(taskView.engineer)}</p>
            <p class="meta-line"><strong>Site Engineer:</strong> ${app.escapeHtml(taskView.siteEngineerName || "-")}</p>
          </div>
          <div class="task-hero-side">
            <p><strong>Date:</strong> ${app.formatDate(taskView.date)}</p>
            <p><strong>Location:</strong> ${app.escapeHtml(taskView.location)}</p>
            <p><strong>District:</strong> ${app.escapeHtml(taskView.district || "-")}</p>
            <p><strong>Status:</strong> <span class="status-pill ${app.statusClass(taskView.status)}">${taskView.status}</span></p>
          </div>
        </div>

        <div class="form-grid">
          <div><strong>Instructions</strong><p class="meta-line">${app.escapeHtml(taskView.instructions || "-")}</p></div>
          <div><strong>Measurement</strong><p class="meta-line">${app.escapeHtml(taskView.measurementText || "-")}</p></div>
          <div><strong>GPS</strong><p class="meta-line">${gpsMeta.url ? `<a href="${gpsMeta.url}" target="_blank" rel="noopener noreferrer">${app.escapeHtml(gpsMeta.text)}</a>` : "-"}</p></div>
          <div><strong>Rollback Reason</strong><p class="meta-line">${app.escapeHtml(taskView.rollbackReason || "-")}</p></div>
        </div>

        <div>
          <strong>Documents</strong>
          <div class="check-grid">
            ${taskView.documents.filter((item) => item.answer === "Yes").length
              ? taskView.documents.filter((item) => item.answer === "Yes").map((item) => `
                <label><input type="checkbox" data-doc-id="${item.id}" ${share.selectedDocuments.includes(item.id) ? "checked" : ""}>${app.escapeHtml(item.docType || item.storedName)}</label>
              `).join("")
              : '<span class="fine-print">No uploaded documents.</span>'}
          </div>
          <div class="photo-preview-grid">${(remoteDocuments.length ? remoteDocuments : taskView.documents.filter((item) => item.answer === "Yes")).map((item, index) => `
            <div class="preview-card">
              ${(item.thumbnailUrl || item.previewUrl) ? `<img class="photo-preview" src="${item.thumbnailUrl || item.previewUrl}" alt="${app.escapeHtml(item.name || item.storedName || `Document ${index + 1}`)}">` : `<span class="frozen-chip">${app.escapeHtml(item.docType || "Document")}</span>`}
              <span class="preview-name">${app.escapeHtml(item.name || item.storedName || `Document ${index + 1}`)}</span>
            </div>
          `).join("") || '<span class="fine-print">No uploaded documents.</span>'}</div>
        </div>

        <div>
          <strong>Photos</strong>
          <div class="check-grid">
            ${taskView.photos.length
              ? taskView.photos.map((item, index) => `<label><input type="checkbox" data-photo-id="${item.id}" ${share.selectedPhotos.includes(item.id) ? "checked" : ""}>Photo ${index + 1}</label>`).join("")
              : '<span class="fine-print">No uploaded photos.</span>'}
          </div>
          <div class="photo-preview-grid">${(remotePhotos.length ? remotePhotos : taskView.photos).map((item, index) => `
            <div class="preview-card">
              ${(item.thumbnailUrl || item.previewUrl) ? `<img class="photo-preview" src="${item.thumbnailUrl || item.previewUrl}" alt="${app.escapeHtml(item.name || item.storedName || `Photo ${index + 1}`)}">` : `<span class="frozen-chip">${app.escapeHtml(item.name || item.storedName || `Photo ${index + 1}`)}</span>`}
              <span class="preview-name">${app.escapeHtml(item.name || item.storedName || `Photo ${index + 1}`)}</span>
            </div>
          `).join("") || '<span class="fine-print">No uploaded photos.</span>'}</div>
        </div>

        <div>
          <strong>Measurement Images</strong>
          <div class="check-grid">
            ${taskView.measurementImages.length
              ? taskView.measurementImages.map((item, index) => `<label><input type="checkbox" data-measurement-id="${item.id}" ${share.selectedMeasurementImages?.includes(item.id) ? "checked" : ""}>Measurement ${index + 1}</label>`).join("")
              : '<span class="fine-print">No measurement images.</span>'}
          </div>
          <div class="photo-preview-grid">${(remoteMeasurementImages.length ? remoteMeasurementImages : taskView.measurementImages).map((item, index) => `
            <div class="preview-card">
              ${(item.thumbnailUrl || item.previewUrl) ? `<img class="photo-preview" src="${item.thumbnailUrl || item.previewUrl}" alt="${app.escapeHtml(item.name || item.storedName || `Measurement ${index + 1}`)}">` : `<span class="frozen-chip">${app.escapeHtml(item.name || item.storedName || `Measurement ${index + 1}`)}</span>`}
              <span class="preview-name">${app.escapeHtml(item.name || item.storedName || `Measurement ${index + 1}`)}</span>
            </div>
          `).join("") || '<span class="fine-print">No measurement images.</span>'}</div>
        </div>

        <div class="check-grid">
          <label><input type="checkbox" id="includeMeasurementImages" ${share.includeMeasurementImages ? "checked" : ""}>Measurement Images</label>
          <label><input type="checkbox" id="includeMeasurement" ${share.includeMeasurement ? "checked" : ""}>Measurement Text</label>
          <label><input type="checkbox" id="includeInstructions" ${share.includeInstructions ? "checked" : ""}>Instructions</label>
          <label><input type="checkbox" id="includeGps" ${share.includeGps ? "checked" : ""}>GPS</label>
          <label><input type="checkbox" id="includeRollbackReason" ${share.includeRollbackReason ? "checked" : ""}>Rollback Reason</label>
        </div>

        <div class="form-grid">
          <label><span>WO</span><input id="shareWorkOrder" type="text" value="${app.escapeHtml(share.workOrder)}"></label>
          <label><span>Billing Status</span><select id="shareBillingStatus"><option value="Yes" ${share.billingStatus === "Yes" ? "selected" : ""}>Yes</option><option value="No" ${share.billingStatus === "No" ? "selected" : ""}>No</option></select></label>
          <label><span>Invoice Number</span><input id="shareInvoiceNumber" type="text" value="${app.escapeHtml(share.invoiceNumber)}"></label>
          <label><span>Value</span><input id="shareValue" type="number" step="0.01" value="${app.escapeHtml(share.value)}"></label>
        </div>

        ${taskView.status === "Completed" ? `
          <div class="action-row">
            <button id="rollback-to-wip" class="secondary-button" type="button">Rollback To WIP</button>
            <button id="rollback-to-pending" class="secondary-button" type="button">Rollback To Pending</button>
          </div>
          <div id="rollback-panel" class="${pendingRollbackStatus ? "" : "hidden"}">
            <div class="form-grid">
              <label class="full-span"><span>Rollback Reason</span><textarea id="rollbackReason">${app.escapeHtml(taskView.rollbackReason || "")}</textarea></label>
            </div>
            <div class="action-row">
              <span class="fine-print">Selected rollback: ${app.escapeHtml(pendingRollbackStatus || "-")}</span>
              <button id="confirm-rollback" class="secondary-button" type="button">Submit Rollback</button>
              <button id="cancel-rollback" class="secondary-button" type="button">Cancel</button>
            </div>
          </div>
        ` : ""}

        <div class="action-row">
          <button id="save-share-package" class="secondary-button" type="button">Save</button>
          <button id="download-share-pdf" class="primary-button" type="button">Export PDF</button>
        </div>
      </div>
    `;

    document.getElementById("save-share-package").addEventListener("click", async () => {
      task.sharePackage = collectSharePackage(task.id);
      saveState("saveSharePackage", { taskId: task.id, sharePackage: task.sharePackage });
      const pdfResult = await exportTaskPdf(taskView, task.sharePackage, {
        ...remote,
        documents: remoteDocuments,
        photos: remotePhotos,
        measurementImages: remoteMeasurementImages
      }, {
        download: false,
        saveDriveCopy: false
      });
      const selectedFileIds = []
        .concat(task.sharePackage.selectedDocuments || [])
        .concat(task.sharePackage.selectedPhotos || [])
        .concat(task.sharePackage.selectedMeasurementImages || []);
      app.showSyncStatus("Saving selected files to Reports folder...", "working", true);
      const result = await app.saveReportFiles(state.settings.master, masterSession, {
        siteId: task.siteId,
        fileName: `${task.siteId}_summary.pdf`,
        mimeType: "application/pdf",
        pdfBase64: pdfResult?.pdfBase64 || "",
        selectedFileIds
      });
      if (result?.ok) {
        app.showSyncStatus("Reports folder updated successfully.", "success");
      } else {
        app.showSyncStatus(result?.message || "Unable to save selected files in Reports folder.", "error");
      }
      openTaskDetailModal(task.id);
    });

    document.getElementById("download-share-pdf").addEventListener("click", async () => {
      task.sharePackage = collectSharePackage(task.id);
      saveState("exportSharePdf", { taskId: task.id, sharePackage: task.sharePackage });
      await exportTaskPdf(taskView, task.sharePackage, {
        ...remote,
        documents: remoteDocuments,
        photos: remotePhotos,
        measurementImages: remoteMeasurementImages
      }, {
        download: true,
        saveDriveCopy: true
      });
    });

    if (taskView.status === "Completed") {
      document.getElementById("rollback-to-wip").addEventListener("click", () => toggleRollbackPanel("WIP"));
      document.getElementById("rollback-to-pending").addEventListener("click", () => toggleRollbackPanel("Pending"));
      document.getElementById("confirm-rollback")?.addEventListener("click", () => rollbackTask(task.id));
      document.getElementById("cancel-rollback")?.addEventListener("click", () => {
        pendingRollbackStatus = "";
        openTaskDetailModal(task.id);
      });
    }

    document.getElementById("task-detail-modal").classList.remove("hidden");
  }

  function toggleRollbackPanel(nextStatus) {
    pendingRollbackStatus = nextStatus;
    const rollbackPanel = document.getElementById("rollback-panel");
    if (rollbackPanel) rollbackPanel.classList.remove("hidden");
    const label = rollbackPanel?.querySelector(".fine-print");
    if (label) label.textContent = `Selected rollback: ${nextStatus}`;
    document.getElementById("rollbackReason")?.focus();
  }

  function rollbackTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    const nextStatus = pendingRollbackStatus;
    const reason = document.getElementById("rollbackReason")?.value.trim();
    if (!nextStatus) {
      window.alert("Please choose rollback target.");
      return;
    }
    if (!reason) {
      window.alert("Please enter rollback reason.");
      return;
    }
    const nextTaskId = app.toLifecycleTaskId(task.id || task.baseTaskId || task.draftId, nextStatus);
    task.status = nextStatus;
    task.id = nextTaskId;
    task.baseTaskId = app.extractTaskBaseId(nextTaskId);
    task.rollbackReason = reason;
    task.updatedAt = new Date().toISOString();
    saveState("rollbackTask", { taskId, nextStatus, reason });
    pendingRollbackStatus = "";
    closeTaskDetailModal();
    refreshAll();
  }

  function closeTaskDetailModal() {
    currentOpenTaskId = "";
    pendingRollbackStatus = "";
    document.getElementById("task-detail-modal").classList.add("hidden");
  }

  function resetAssignmentForm() {
    assignmentForm.reset();
    resetAssignmentFieldsOnly();
    selectedDraftId = "";
    draftSelector.value = "";
    renderFrozenSummary();
    toggleAssignmentVisibility(false);
  }

  function resetDraftForm() {
    currentEditDraftId = "";
    masterForm.reset();
    masterForm.querySelector('button[type="submit"]').textContent = "Save Draft For Assignment";
    toggleOtherField(clientMaster, clientMasterOther, "clientMasterOtherWrap", "client");
    toggleOtherField(engineerMaster, engineerMasterOther, "engineerMasterOtherWrap", "engineer");
    toggleOtherField(categoryMaster, categoryMasterOther, "categoryMasterOtherWrap", "category");
    toggleOtherField(activityMaster, activityMasterOther, "activityMasterOtherWrap", "activity");
  }

  function refreshAll() {
    state = app.readState();
    if (currentEditDraftId && !state.drafts.some((draft) => draft.id === currentEditDraftId)) {
      currentEditDraftId = "";
    }
    setOptions();
    toggleOtherField(clientMaster, clientMasterOther, "clientMasterOtherWrap", "client");
    toggleOtherField(engineerMaster, engineerMasterOther, "engineerMasterOtherWrap", "engineer");
    toggleOtherField(categoryMaster, categoryMasterOther, "categoryMasterOtherWrap", "category");
    toggleOtherField(activityMaster, activityMasterOther, "activityMasterOtherWrap", "activity");
    renderDrafts();
    renderDraftSelector();
    renderQueue();
    renderTaskTable();
    renderStats();
    masterForm.querySelector('button[type="submit"]').textContent = currentEditDraftId ? "Update Draft" : "Save Draft For Assignment";
  }

  async function syncFromGoogleState(options = {}) {
    const { silent = false } = options;
    if (!masterSession?.userId || !masterSession?.sessionToken) return;
    if (masterSyncButton) {
      masterSyncButton.disabled = true;
      masterSyncButton.textContent = "Syncing...";
    }
    if (!silent) app.showSyncStatus("Fetching latest updates from Hostinger DataSheet...", "working", true);
    const remoteState = await app.fetchGoogleState(state.settings.master, masterSession);
    if (remoteState?.sessionExpired) {
      forceLogout("This Master login was used on another device. Please login again.");
      return;
    }
    if (remoteState?.ok && remoteState.state) {
      applyRemoteState(remoteState.state);
      if (!silent) app.showSyncStatus("Latest updates synced on this device.", "success");
    } else if (!silent && !remoteState) {
      app.showSyncStatus("Unable to reach Hostinger storage right now. Cached data is still available.", "error");
    }
    if (masterSyncButton) {
      masterSyncButton.disabled = false;
      masterSyncButton.textContent = "Sync";
    }
  }

  async function validateActiveSession(options = {}) {
    const { silent = true } = options;
    if (!masterSession?.userId || !masterSession?.sessionToken) {
      if (masterSession) forceLogout("Session expired. Please login again.");
      return false;
    }
    const result = await app.validateGoogleSession(state.settings.master, masterSession);
    if (result?.ok) return true;
    if (result?.sessionExpired) {
      forceLogout("This Master login was used on another device. Please login again.");
      return false;
    }
    if (!silent) {
      app.showSyncStatus(result?.message || "Unable to validate session right now.", "error");
    }
    return true;
  }

  function startCrossDeviceSync() {
    stopCrossDeviceSync();
    if (!app.resolveGoogleScriptUrl(state.settings.master, "master") || !masterSession?.userId || !masterSession?.sessionToken) return;
    sessionTimer = setInterval(() => {
      validateActiveSession({ silent: true });
    }, 2000);
    if (state.settings.master.autoSyncEnabled !== false) {
      syncTimer = setInterval(() => {
        syncFromGoogleState({ silent: true });
      }, 10000);
    }
  }

  function stopCrossDeviceSync() {
    clearInterval(syncTimer);
    clearInterval(sessionTimer);
    syncTimer = null;
    sessionTimer = null;
  }

  function openMap() {
    selectedMapPoint = null;
    document.getElementById("map-modal").classList.remove("hidden");
    if (!map) {
      map = L.map("map-picker").setView([12.9716, 77.5946], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);
      map.on("click", (event) => {
        selectedMapPoint = event.latlng;
        document.getElementById("map-selected-output").textContent = `Lat: ${event.latlng.lat.toFixed(6)}, Lng: ${event.latlng.lng.toFixed(6)}`;
        if (mapMarker) map.removeLayer(mapMarker);
        mapMarker = L.marker(event.latlng).addTo(map);
      });
    }
    setTimeout(() => map.invalidateSize(), 120);
  }

  function closeMap() {
    document.getElementById("map-modal").classList.add("hidden");
  }

  async function applyCoords(lat, lng) {
    assignLatitude.value = lat;
    assignLongitude.value = lng;
    const district = await app.reverseGeocodeDistrict(lat, lng);
    if (district && state.options.districts.includes(district)) {
      districtSelect.value = district;
    } else if (district) {
      pushOptionIfMissing("districts", district);
      app.writeState(state);
      app.setOptions(districtSelect, state.options.districts, "Select District");
      districtSelect.value = district;
    }
  }

  function captureCurrentLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await applyCoords(position.coords.latitude.toFixed(6), position.coords.longitude.toFixed(6));
      },
      () => window.alert("Unable to fetch current location."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function syncDistrictFromInputs() {
    if (assignLatitude.value && assignLongitude.value) {
      await applyCoords(assignLatitude.value, assignLongitude.value);
    }
  }

  function loadTaskForEdit(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "Pending") return;
    const draft = {
      id: app.uid("draft"),
      client: task.client,
      engineer: task.engineer,
      category: task.category,
      activity: task.activity,
      editable: true,
      sourceTaskId: task.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.drafts = state.drafts.filter((item) => item.sourceTaskId !== task.id);
    state.drafts.push(draft);
    selectedDraftId = draft.id;
    currentEditTaskId = task.id;
    saveState("reopenPendingTaskAsDraft", {
      draftId: draft.id,
      sourceTaskId: task.id,
      siteId: task.siteId
    });
    renderDraftSelector();
    draftSelector.value = draft.id;
    renderFrozenSummary();
    toggleAssignmentVisibility(true);
    document.querySelector('[data-page-target="task-page"]').click();
  }

  function deleteTask(taskId) {
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "Pending") return;
    state.tasks = state.tasks.filter((item) => item.id !== taskId);
    saveState("deleteTask", { taskId });
    if (currentEditTaskId === taskId) resetAssignmentForm();
    refreshAll();
  }

  function openSettings() {
    document.getElementById("settings-modal").classList.remove("hidden");
  }

  function closeSettings() {
    document.getElementById("settings-modal").classList.add("hidden");
  }

  function clearCacheAndReset() {
    const confirmed = window.confirm("Clear all cached Bliss TaskPro data on this device and logout?");
    if (!confirmed) return;
    stopCrossDeviceSync();
    app.clearLocalCache();
    masterSession = null;
    state = app.readState();
    app.showSyncStatus("Cache cleared on this device.", "success");
    window.location.reload();
  }

  async function autofillMasterSettings() {
    const config = await app.fetchGoogleConfig(state.settings.master);
    if (!config) return;
    state.settings.master = app.mergeGoogleSettings(state.settings.master, config);
    app.persistRoleScriptUrl("master", state.settings.master.googleScriptUrl);
    app.writeState(state);
  }

  async function runPostLoginRefresh(options = {}) {
    const { silent = false } = options;
    await autofillMasterSettings();
    refreshAll();
    await syncFromGoogleState({ silent });
    if (masterSession) startCrossDeviceSync();
  }

  masterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(masterForm);
    const client = resolveSelectValue(String(form.get("client")), String(form.get("clientOther") || ""));
    const engineer = resolveSelectValue(String(form.get("engineer")), String(form.get("engineerOther") || ""));
    const category = resolveSelectValue(String(form.get("category")), String(form.get("categoryOther") || ""));
    const activity = resolveSelectValue(String(form.get("activity")), String(form.get("activityOther") || ""));
    if (!client || !engineer || !category || !activity) {
      window.alert("Please fill the Other field where selected.");
      return;
    }

    pushOptionIfMissing("clients", client);
    pushOptionIfMissing("engineers", engineer);
    pushOptionIfMissing("categories", category);
    pushOptionIfMissing("activities", activity);

    if (currentEditDraftId) {
      const draft = state.drafts.find((item) => item.id === currentEditDraftId);
      if (!draft) {
        window.alert("Draft not found.");
        return;
      }
      Object.assign(draft, {
        client,
        engineer,
        category,
        activity,
        updatedAt: new Date().toISOString()
      });
      saveState("updateDraft", draft);
    } else {
      const draft = { id: app.uid("draft"), client, engineer, category, activity, createdAt: new Date().toISOString() };
      state.drafts.push(draft);
      saveState("saveDraft", draft);
    }
    resetDraftForm();
    refreshAll();
  });

  assignmentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(assignmentForm);
    const draft = state.drafts.find((item) => item.id === String(form.get("draftId")));
    if (!draft) {
      window.alert("Please select a saved draft.");
      return;
    }
    const siteId = String(form.get("siteId")).trim();
    const duplicate = state.tasks.some((task) => task.siteId === siteId && task.id !== currentEditTaskId);
    if (duplicate) {
      window.alert("Site ID already exists.");
      return;
    }

    if (currentEditTaskId) {
      const task = state.tasks.find((item) => item.id === currentEditTaskId);
      if (!task || task.status !== "Pending") {
        window.alert("Only pending tasks can be updated.");
        return;
      }
      Object.assign(task, {
        draftId: draft.id,
        client: draft.client,
        engineer: draft.engineer,
        category: draft.category,
        activity: draft.activity,
        siteId,
        date: String(form.get("date")),
        location: String(form.get("location")).trim(),
        latitude: String(form.get("latitude")).trim(),
        longitude: String(form.get("longitude")).trim(),
        district: String(form.get("district")),
        instructions: String(form.get("instructions")).trim(),
        updatedAt: new Date().toISOString()
      });
      saveState("updateTask", task);
    } else {
      const task = {
        id: app.toLifecycleTaskId(draft.id, "Pending"),
        baseTaskId: app.extractTaskBaseId(draft.id),
        draftId: draft.id,
        client: draft.client,
        engineer: draft.engineer,
        category: draft.category,
        activity: draft.activity,
        siteId,
        date: String(form.get("date")),
        location: String(form.get("location")).trim(),
        latitude: String(form.get("latitude")).trim(),
        longitude: String(form.get("longitude")).trim(),
        district: String(form.get("district")),
        instructions: String(form.get("instructions")).trim(),
        status: "Pending",
        siteEngineerName: "",
        documents: [],
        photos: [],
        measurementText: "",
        measurementImages: [],
        gps: null,
        sharePackage: null,
        rollbackReason: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.tasks.push(task);
      saveState("assignTask", task);
    }

    if (draft.sourceTaskId) {
      state.drafts = state.drafts.filter((item) => item.id !== draft.id);
    }

    resetAssignmentForm();
    refreshAll();
    document.querySelector('[data-page-target="details-page"]').click();
  });

  draftSelector.addEventListener("change", () => {
    selectedDraftId = draftSelector.value;
    renderFrozenSummary();
  });

  assignLatitude.addEventListener("input", syncDistrictFromInputs);
  assignLongitude.addEventListener("input", syncDistrictFromInputs);

  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      navButtons.forEach((item) => item.classList.remove("active"));
      sections.forEach((section) => section.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.pageTarget).classList.add("active");
      if (button.dataset.pageTarget === "task-page" && !currentEditTaskId) {
        resetAssignmentForm();
      }
    });
  });

  document.getElementById("capture-master-location").addEventListener("click", captureCurrentLocation);
  document.getElementById("pick-master-location").addEventListener("click", openMap);
  document.getElementById("close-map-modal").addEventListener("click", closeMap);
  document.getElementById("save-map-point").addEventListener("click", async () => {
    if (!selectedMapPoint) return;
    await applyCoords(selectedMapPoint.lat.toFixed(6), selectedMapPoint.lng.toFixed(6));
    closeMap();
  });
  masterSyncButton?.addEventListener("click", syncFromGoogleState);
  document.getElementById("master-login-settings").addEventListener("click", openSettings);
  document.getElementById("master-clear-cache").addEventListener("click", clearCacheAndReset);
  document.getElementById("close-settings-modal").addEventListener("click", closeSettings);
  document.getElementById("save-google-settings").addEventListener("click", () => {
    closeSettings();
  });
  document.getElementById("close-task-detail-modal").addEventListener("click", closeTaskDetailModal);
  document.getElementById("master-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const debug = document.getElementById("master-login-debug");
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const settings = state.settings.master;
    const userId = document.getElementById("master-login-user").value.trim();
    const password = document.getElementById("master-login-password").value;
    debug.classList.add("hidden");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Signing In...";
    }
    app.showSyncStatus("Checking Master login...", "working", true);
    const result = await app.loginWithGoogle(settings, "master", userId, password);
    if (!result.ok) {
      debug.textContent = app.formatLoginFailure(result);
      debug.classList.remove("hidden");
      app.showSyncStatus(app.formatLoginFailure(result), "error");
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Login To Master App";
      }
      return;
    }
    debug.classList.add("hidden");
    masterSession = {
      userId: result.user.userId,
      name: result.user.name || result.user.userId,
      role: "master",
      sessionToken: result.sessionToken || "",
      sessionUpdatedAt: result.sessionUpdatedAt || ""
    };
    state.settings.master = app.mergeGoogleSettings(state.settings.master, {
      googleScriptUrl: result.scriptURL
    });
    app.cacheLoginContext("master", {
      scriptURL: state.settings.master.googleScriptUrl,
      sessionToken: masterSession.sessionToken,
      role: "master",
      name: masterSession.name
    });
    app.writeState(state);
    app.saveMasterSession(masterSession);
    refreshAll();
    showMasterApp();
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Login To Master App";
    }
    app.showSyncStatus("Master login success. Fetching latest data in background...", "working");
    runPostLoginRefresh({ silent: false });
  });
  document.getElementById("master-logout").addEventListener("click", () => {
    masterSession = null;
    app.clearMasterSession();
    app.clearSharedLoginContext("master");
    stopCrossDeviceSync();
    showMasterLogin();
  });

  clientMaster.addEventListener("change", () => toggleOtherField(clientMaster, clientMasterOther, "clientMasterOtherWrap", "client"));
  engineerMaster.addEventListener("change", () => toggleOtherField(engineerMaster, engineerMasterOther, "engineerMasterOtherWrap", "engineer"));
  categoryMaster.addEventListener("change", () => toggleOtherField(categoryMaster, categoryMasterOther, "categoryMasterOtherWrap", "category"));
  activityMaster.addEventListener("change", () => toggleOtherField(activityMaster, activityMasterOther, "activityMasterOtherWrap", "activity"));
  window.addEventListener("storage", () => {
    refreshAll();
    if (currentOpenTaskId) openTaskDetailModal(currentOpenTaskId);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !masterSession) return;
    validateActiveSession({ silent: true }).then((isValid) => {
      if (isValid && state.settings.master.autoSyncEnabled !== false) syncFromGoogleState({ silent: true });
    });
  });

  (async function init() {
    try {
      state.options.districts = await app.loadDistricts();
      app.writeState(state);
    } catch (error) {
      if (!state.options.districts.length) state.options.districts = ["Bengaluru Urban"];
    }
    assignDate.value = new Date().toISOString().split("T")[0];
    refreshAll();
    if (masterSession) {
      const isValid = await validateActiveSession({ silent: true });
      if (!isValid) return;
      await syncFromGoogleState({ silent: true });
      startCrossDeviceSync();
      showMasterApp();
    } else showMasterLogin();
  })();
})();
