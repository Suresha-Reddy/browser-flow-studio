const api = window.flowStudio || null;
let flows = [],
  current = null,
  selectedStep = null,
  recording = false,
  testing = false,
  waitingForHuman = false,
  localInput = {},
  localDocuments = {};
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const runtimeHumanField = (field = "") =>
  /\b(otp|one[_ -]?time|captcha|verification[_ -]?code)\b/i.test(field);
const sample = {
  file: "flows/drafts/pan_new_49a.v1.yaml",
  status: "draft",
  definition: {
    schemaVersion: 1,
    application: {
      key: "pan_new_49a",
      name: "New PAN — Form 49A",
      portal: "protean_pan",
      version: 1,
      entryUrl: "https://example.com",
    },
    fields: [
      {
        key: "surname",
        label: "Surname",
        type: "text",
        required: true,
        sensitive: true,
      },
      {
        key: "mobile",
        label: "Mobile",
        type: "phone",
        required: true,
        sensitive: true,
      },
    ],
    documents: [],
    flow: {
      initialState: "registration",
      terminalStates: ["completed", "cancelled", "submission_unknown"],
      states: {
        registration: {
          detect: { visibleText: ["Online PAN Application"] },
          steps: [
            {
              id: "fill_surname",
              type: "fill",
              field: "surname",
              target: { labels: ["Surname"] },
              success: [],
            },
            {
              id: "fill_mobile",
              type: "fill",
              field: "mobile",
              target: { labels: ["Mobile Number"] },
              success: [],
            },
            {
              id: "continue",
              type: "click",
              target: { role: { type: "button", name: "Continue" } },
              success: [],
            },
          ],
          transitions: { success: "personal_details" },
        },
        personal_details: {
          detect: { visibleText: ["Personal Details"] },
          steps: [
            {
              id: "fill_dob",
              type: "date",
              field: "date_of_birth",
              target: { labels: ["Date of Birth"] },
            },
          ],
          transitions: { success: "preview" },
        },
        preview: {
          detect: { visibleText: ["Application Preview"] },
          steps: [
            {
              id: "approve",
              type: "human_approval",
              reason: "final_submission",
              prompt: "Approve final submission",
            },
            {
              id: "submit",
              type: "submit",
              requiresHumanApproval: true,
              target: { text: ["Final Submit"] },
              success: [],
            },
          ],
          transitions: { success: "confirmation" },
        },
        confirmation: {
          detect: { visibleText: ["Application submitted successfully"] },
          steps: [
            {
              id: "extract_reference",
              type: "extract",
              key: "reference",
              required: true,
              target: { cssFallbacks: ["#reference"] },
            },
          ],
          transitions: { success: "completed" },
        },
      },
    },
  },
};
function toast(x) {
  const t = $("#toast");
  t.textContent = x;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}
async function init() {
  flows = api
    ? await api.listFlows()
    : [
        {
          file: sample.file,
          name: "pan",
          status: "draft",
          key: "pan_new_49a",
          title: "New PAN — Form 49A",
          portal: "protean_pan",
          version: 1,
          states: 4,
        },
      ];
  renderFlows();
  bind();
  if (flows[0]) await openFlow(flows[0].file);
}
function renderFlows(filter = "") {
  const box = $("#flow-list");
  box.innerHTML = "";
  flows
    .filter((f) => f.title.toLowerCase().includes(filter.toLowerCase()))
    .forEach((f) => {
      const b = document.createElement("button");
      b.className = "flow-item" + (current?.file === f.file ? " active" : "");
      b.innerHTML = `<span class="flow-icon">${f.portal.slice(0, 2).toUpperCase()}</span><span class="flow-copy"><strong>${f.title}</strong><span>${f.portal} · ${f.states} states</span></span><span class="version-chip">v${f.version}</span>`;
      b.onclick = () => openFlow(f.file);
      box.appendChild(b);
    });
}
async function openFlow(file) {
  current = api ? await api.loadFlow(file) : sample;
  localInput = {};
  localDocuments = {};
  if (api) {
    const saved = await api.loadTestData(current.definition.application.key);
    localInput = saved?.input || {};
    localDocuments = saved?.documents || {};
  }
  $("#empty-state").classList.add("hidden");
  $("#editor").classList.remove("hidden");
  renderAll();
  renderFlows();
}
function d() {
  return current.definition;
}
function allSteps() {
  return Object.entries(d().flow.states).flatMap(([state, s]) =>
    (s.steps || []).map((step) => ({ state, step })),
  );
}
function renderAll() {
  const x = d(),
    steps = allSteps(),
    published = (current.status || "draft") === "published";
  $("#flow-title").textContent = x.application.name;
  $("#portal-label").textContent = x.application.portal.toUpperCase();
  $("#version-label").textContent = `VERSION ${x.application.version}`;
  $("#flow-meta").textContent =
    `${Object.keys(x.flow.states).length} states · ${steps.length} steps`;
  $("#app-name").value = x.application.name;
  $("#portal-key").value = x.application.portal;
  $("#entry-url").value = x.application.entryUrl;
  $("#record-url").value = x.application.entryUrl;
  $("#flow-key").value = x.application.key;
  $("#flow-version").value = x.application.version;
  $("#entry-states").value = (
    x.flow.entryStates?.length ? x.flow.entryStates : [x.flow.initialState]
  ).join(", ");
  $("#definition-source").value = JSON.stringify(x, null, 2);
  $("#metric-fields").textContent = x.fields?.length || 0;
  $("#metric-documents").textContent = x.documents?.length || 0;
  $("#metric-states").textContent = Object.keys(x.flow.states).length;
  const status = current.status || "draft";
  $("#status-row .status").textContent =
    status[0].toUpperCase() + status.slice(1);
  $("#status-row .status").className = `status ${status}`;
  $("#save-btn").disabled = published;
  $("#definition-source").disabled = published;
  $("#publish-btn").classList.toggle("hidden", published);
  $("#new-version-btn").classList.toggle("hidden", !published);
  ["#add-field-btn", "#add-document-btn", "#add-state-btn"].forEach(
    (q) => ($(q).disabled = published),
  );
  $("#add-manual-step-btn").disabled = published;
  renderFields();
  renderDocuments();
  renderTestInputs();
  renderLocalDocuments();
  renderGraph();
  renderSteps();
  $("#inspect-command").textContent =
    `npm run run -- ${current.file} --mode inspect --step-by-step`;
  $("#verify-command").textContent =
    `npm run run -- ${current.file} --data test-data/private/input.json --mode verify`;
}

function renderTestInputs() {
  const box = $("#local-input-list");
  if (!box) return;
  box.innerHTML = "";
  const preRunFields = (d().fields || []).filter(
    (field) => !runtimeHumanField(`${field.key} ${field.label}`),
  );
  preRunFields.forEach((field) => {
    const label = document.createElement("label");
    label.className = field.type === "textarea" ? "full" : "";
    label.append(document.createTextNode(field.label || field.key));
    let control;
    if (field.type === "select" && field.options?.length) {
      control = document.createElement("select");
      control.append(new Option("Select…", ""));
      field.options.forEach((option) =>
        control.append(new Option(String(option), String(option))),
      );
    } else {
      control = document.createElement("input");
      const inputTypes = {
        date: "date",
        email: "email",
        phone: "tel",
        number: "number",
      };
      control.type = field.sensitive
        ? "password"
        : inputTypes[field.type] || "text";
    }
    control.dataset.field = field.key;
    control.value = localInput[field.key] ?? "";
    control.placeholder = field.required
      ? "Required for local test"
      : "Optional";
    control.oninput = () => {
      localInput[field.key] = control.value;
    };
    label.append(control);
    box.append(label);
  });
  if (!box.children.length)
    box.innerHTML =
      '<div class="data-empty full">No pre-run values are needed. OTP and CAPTCHA are requested only when the browser reaches those steps.</div>';
}

async function saveLocalTestData() {
  const missingFields = (d().fields || []).filter(
    (field) =>
      field.required &&
      !runtimeHumanField(`${field.key} ${field.label}`) &&
      !String(localInput[field.key] ?? "").trim(),
  );
  if (missingFields.length) {
    toast(
      "Enter required test values: " +
        missingFields.map((field) => field.label || field.key).join(", "),
    );
    $("#local-input-list")
      .querySelector(`[data-field="${CSS.escape(missingFields[0].key)}"]`)
      ?.focus();
    return false;
  }
  const missingDocuments = (d().documents || []).filter(
    (document) => document.required && !localDocuments[document.key],
  );
  if (missingDocuments.length) {
    toast(
      "Choose required files: " +
        missingDocuments.map((document) => document.key).join(", "),
    );
    return false;
  }
  await api?.saveTestData({
    flowKey: d().application.key,
    input: localInput,
    documents: localDocuments,
  });
  return true;
}

function setTestUi(active, status) {
  testing = active;
  if (!active) waitingForHuman = false;
  $("#test-status").textContent = status;
  $("#test-status").className = `status ${active ? "draft" : "neutral"}`;
  $("#run-browser-test").disabled = active;
  $("#stop-browser-test").disabled = !active;
  $("#send-test-response").disabled = !active || !waitingForHuman;
}

async function startBrowserTest() {
  tab("verify");
  if (!api) return toast("Browser testing requires the desktop app");
  if (testing) return toast("A browser test is already running");
  try {
    const validation = await validate();
    if (!validation.valid)
      return toast(`Fix ${validation.errors.length} blocker(s) before testing`);
    if (!(await saveLocalTestData())) return;
    $("#test-console").classList.remove("hidden");
    $("#test-log").textContent =
      "Opening Chrome and replaying the recorded flow…\n";
    $("#test-response").value = "";
    setTestUi(true, "Running");
    await api.startFlowTest({
      file: current.file,
      flowKey: d().application.key,
    });
    toast("Browser test started");
  } catch (error) {
    setTestUi(false, "Failed");
    $("#test-log").textContent += `\n${error.message}\n`;
    toast(error.message);
  }
}
function renderFields() {
  const box = $("#fields-table");
  box.innerHTML = "";
  (d().fields || []).forEach((f, i) => {
    const r = document.createElement("div");
    r.className = "data-row";
    r.innerHTML = `<div><strong>${f.label}</strong><span>${f.key}</span></div><span>${f.type}</span><span>${f.required ? "Required" : "Optional"}</span><button class="icon-button" aria-label="Remove field">×</button>`;
    r.querySelector("button").onclick = () => {
      d().fields.splice(i, 1);
      syncSource();
    };
    box.appendChild(r);
  });
  if (!box.children.length)
    box.innerHTML =
      '<div class="data-empty">No fields yet. Add fields or record the portal.</div>';
}
function renderDocuments() {
  const box = $("#documents-table");
  box.innerHTML = "";
  (d().documents || []).forEach((f, i) => {
    const r = document.createElement("div");
    r.className = "data-row";
    r.innerHTML = `<div><strong>${f.key.replaceAll("_", " ")}</strong><span>${(f.acceptedMimeTypes || f.acceptedTypes)?.join(", ") || "Any file"}</span></div><span>Upload</span><span>${f.required ? "Required" : "Optional"}</span><button class="icon-button" aria-label="Remove document">×</button>`;
    r.querySelector("button").onclick = () => {
      d().documents.splice(i, 1);
      syncSource();
    };
    box.appendChild(r);
  });
  if (!box.children.length)
    box.innerHTML =
      '<div class="data-empty">No supporting documents defined.</div>';
}

function renderLocalDocuments() {
  const box = $("#local-document-list");
  if (!box) return;
  box.innerHTML = "";
  (d().documents || []).forEach((doc) => {
    const row = document.createElement("div");
    row.className = "document-map-row";
    const file = localDocuments[doc.key];
    row.innerHTML = `<div><strong>${escapeHtml(doc.key.replaceAll("_", " "))}</strong><span>${file ? escapeHtml((Array.isArray(file) ? file : [file]).map((x) => x.split(/[\\/]/).pop()).join(", ")) : "No file selected"}</span></div><button class="button secondary">${file ? "Change" : "Choose file"}</button>`;
    row.querySelector("button").onclick = async () => {
      const path = await api?.chooseFile({
        acceptedTypes: doc.acceptedMimeTypes || doc.acceptedTypes,
        multiple: doc.multiple,
      });
      if (path) {
        localDocuments[doc.key] = path;
        renderLocalDocuments();
      }
    };
    box.appendChild(row);
  });
  if (!box.children.length)
    box.innerHTML =
      '<div class="data-empty">Add an upload document to the definition first.</div>';
}
function renderGraph() {
  const graph = $("#graph");
  graph.innerHTML = "";
  Object.entries(d().flow.states).forEach(([key, state], index) => {
    const column = document.createElement("section");
    column.className = "state-column";
    const next = state.transitions?.success || "terminal";
    column.innerHTML = `<div class="state-node${key === d().flow.initialState ? " initial" : ""}"><div class="state-node-heading"><span class="state-index">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(key.replaceAll("_", " "))}</strong><span>${(state.steps || []).length} steps</span></div></div><span class="node-type">${key === d().flow.initialState ? "ENTRY" : "STATE"} · → ${escapeHtml(next)}</span></div><div class="state-step-list"></div>`;
    const list = column.querySelector(".state-step-list");
    (state.steps || []).forEach((step, stepIndex) => {
      const item = document.createElement("button");
      item.className =
        "canvas-step" + (selectedStep === step.id ? " active" : "");
      item.innerHTML = `<span>${String(stepIndex + 1).padStart(2, "0")}</span><strong>${escapeHtml(step.id.replaceAll("_", " "))}</strong><em>${escapeHtml(step.type)}</em>`;
      item.onclick = () => {
        selectedStep = step.id;
        tab("steps");
        renderSteps();
        renderInspector(key, step);
      };
      list.appendChild(item);
    });
    if (!(state.steps || []).length)
      list.innerHTML =
        '<div class="canvas-empty">No steps in this state.</div>';
    graph.appendChild(column);
  });
}
function renderSteps() {
  const box = $("#step-list");
  box.innerHTML = "";
  allSteps().forEach(({ state, step }, i) => {
    const r = document.createElement("div");
    r.className = "step-item" + (selectedStep === step.id ? " active" : "");
    r.innerHTML = `<span class="step-number">${String(i + 1).padStart(2, "0")}</span><span><strong>${step.id.replaceAll("_", " ")}</strong><span>${state}</span></span><span class="step-kind">${step.type}</span>`;
    r.onclick = () => {
      selectedStep = step.id;
      renderSteps();
      renderInspector(state, step);
    };
    box.appendChild(r);
  });
  if (!box.children.length)
    box.innerHTML = '<div class="data-empty">No semantic steps yet.</div>';
}
function renderInspector(state, step) {
  const published = (current.status || "draft") === "published";
  $("#step-inspector").innerHTML =
    `<div class="card-head"><div><h2>${step.id}</h2><p>${state} · ${step.type}</p></div><span class="code-badge">STEP</span></div><div class="inspector-actions"><button id="edit-selected-step" class="button secondary" ${published ? "disabled" : ""}>Edit step</button><button id="delete-selected-step" class="button danger" ${published ? "disabled" : ""}>Delete step</button></div><div class="inspector-grid"><label>Step ID<input value="${step.id}" disabled></label><label>Action type<input value="${step.type}" disabled></label><label>Input field<input value="${step.field || step.document || step.key || "—"}" disabled></label><label>Assertions<input value="${(step.success || []).length}" disabled></label></div><pre class="inspector-code">${escapeHtml(JSON.stringify(step, null, 2))}</pre>`;
  $("#edit-selected-step").onclick = () => openStepDialog("edit", state, step);
  $("#delete-selected-step").onclick = () => deleteStep(state, step.id);
}

function openStepDialog(mode, state, step) {
  const dialog = $("#step-dialog"),
    stateSelect = $("#step-state"),
    states = Object.keys(d().flow.states);
  stateSelect.innerHTML = "";
  states.forEach((key) => stateSelect.append(new Option(key, key)));
  const targetState = state || d().flow.initialState;
  stateSelect.value = targetState;
  const nextNumber = allSteps().length + 1;
  const value =
    mode === "edit"
      ? step
      : {
          id: `manual_step_${nextNumber}`,
          type: "human_input",
          reason: "other",
          prompt: "Complete this step manually in the browser, then continue.",
          inputMode: "operator_in_browser",
        };
  dialog.dataset.mode = mode;
  dialog.dataset.originalState = state || "";
  dialog.dataset.originalId = step?.id || "";
  $("#step-dialog-title").textContent =
    mode === "edit" ? "Edit step" : "Add manual step";
  $("#step-json").value = JSON.stringify(value, null, 2);
  $("#step-dialog-error").classList.add("hidden");
  dialog.showModal();
}

function saveStepFromDialog(event) {
  event.preventDefault();
  const dialog = $("#step-dialog"),
    targetState = $("#step-state").value,
    errorBox = $("#step-dialog-error");
  try {
    const step = JSON.parse($("#step-json").value);
    if (!step || typeof step !== "object" || Array.isArray(step))
      throw new Error("Step JSON must be an object");
    if (!String(step.id || "").trim()) throw new Error("Step ID is required");
    if (!String(step.type || "").trim())
      throw new Error("Step type is required");
    if (!d().flow.states[targetState]) throw new Error("Choose a valid state");
    const originalId = dialog.dataset.originalId,
      originalState = dialog.dataset.originalState,
      duplicate = allSteps().some(
        ({ state, step: existing }) =>
          existing.id === step.id &&
          !(
            dialog.dataset.mode === "edit" &&
            state === originalState &&
            existing.id === originalId
          ),
      );
    if (duplicate) throw new Error(`Step ID '${step.id}' is already in use`);
    if (dialog.dataset.mode === "edit") {
      const source = d().flow.states[originalState]?.steps || [],
        index = source.findIndex((existing) => existing.id === originalId);
      if (index < 0) throw new Error("The original step no longer exists");
      source.splice(index, 1);
      if (originalState === targetState)
        d().flow.states[targetState].steps.splice(index, 0, step);
      else d().flow.states[targetState].steps.push(step);
    } else {
      d().flow.states[targetState].steps.push(step);
    }
    selectedStep = step.id;
    dialog.close();
    syncSource();
    tab("steps");
    renderInspector(targetState, step);
    toast(
      dialog.dataset.mode === "edit" ? "Step updated" : "Manual step added",
    );
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  }
}

function deleteStep(state, stepId) {
  if (!confirm(`Delete step '${stepId}'? This cannot be undone.`)) return;
  const steps = d().flow.states[state]?.steps || [],
    index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return;
  steps.splice(index, 1);
  selectedStep = null;
  syncSource();
  $("#step-inspector").innerHTML =
    '<div class="empty-small">Step deleted. Select another step to inspect it.</div>';
  toast("Step deleted");
}
function escapeHtml(s) {
  return s.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}
function syncSource() {
  $("#definition-source").value = JSON.stringify(d(), null, 2);
  renderAll();
  markDirty();
}
function markDirty() {
  $("#save-state").textContent = "Unsaved changes";
}
async function save() {
  try {
    current.definition = JSON.parse($("#definition-source").value);
    if (api) await api.saveFlow(current);
    $("#save-state").textContent = "Saved locally";
    renderAll();
    toast("Draft saved");
  } catch (e) {
    toast("Invalid JSON: " + e.message);
  }
}
function repairFieldIssue(index, mode) {
  const fields = d().fields || [],
    field = fields[index];
  if (!field) return;
  if (mode === "remove") fields.splice(index, 1);
  else {
    field.key =
      (field.key || `field_${index + 1}`).trim() || `field_${index + 1}`;
    field.label =
      field.key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()) ||
      `Field ${index + 1}`;
  }
  syncSource();
  void save().then(validate);
}
function repairRecordedDefinition() {
  let removedDuplicates = 0,
    removedRecorderNoise = 0,
    convertedHumanSteps = 0,
    addedAssertions = 0;
  const repeatReferences = new Set(
    allSteps()
      .filter(({ step }) => step.type === "repeat")
      .flatMap(({ step }) => step.steps || []),
  );
  for (const state of Object.values(d().flow.states)) {
    const seen = new Map(),
      seenClicks = new Map(),
      fieldKeys = new Set(
        (state.steps || [])
          .filter((step) =>
            ["fill", "date", "select", "radio"].includes(step.type),
          )
          .map((step) => step.field),
      ),
      fieldLabels = new Set(
        (d().fields || [])
          .filter((field) => fieldKeys.has(field.key))
          .flatMap((field) => [field.key, field.label])
          .map((value) =>
            String(value || "")
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, ""),
          ),
      );
    state.steps = (state.steps || []).filter((step) => {
      if (step.type === "click") {
        const rawText = String(
            step.target?.role?.name || step.target?.text?.[0] || "",
          ),
          textKey = rawText
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, ""),
          baseId = step.id.replace(/^click_/, "").replace(/_\d+$/, ""),
          duplicateBase = step.id.replace(/_\d+$/, "");
        if (
          fieldKeys.has(baseId) ||
          fieldLabels.has(textKey) ||
          (rawText.length > 120 && !step.target?.role)
        ) {
          removedRecorderNoise++;
          return false;
        }
        if (textKey && seenClicks.get(textKey) === duplicateBase) {
          removedDuplicates++;
          return false;
        }
        if (textKey) seenClicks.set(textKey, duplicateBase);
        return true;
      }
      const repairable = [
        "fill",
        "date",
        "select",
        "checkbox",
        "radio",
        "upload",
      ].includes(step.type);
      if (!repairable) return true;
      const baseId = step.id.replace(/_\d+$/, ""),
        signature = JSON.stringify({
          type: step.type,
          field: step.field,
          document: step.document,
          target: step.target,
        }),
        previousBase = seen.get(signature);
      if (previousBase === baseId && !repeatReferences.has(step.id)) {
        removedDuplicates++;
        return false;
      }
      seen.set(signature, baseId);
      return true;
    });
    state.steps = state.steps.map((step) => {
      if (
        !["fill", "date"].includes(step.type) ||
        !runtimeHumanField(
          `${step.field || ""} ${(d().fields || []).find((field) => field.key === step.field)?.label || ""}`,
        )
      )
        return step;
      convertedHumanSteps++;
      const captcha = /captcha/i.test(step.field || "");
      return {
        id: step.id,
        type: "human_input",
        reason: captcha ? "captcha" : "otp",
        prompt: captcha
          ? "Enter the CAPTCHA in Chrome, or enter it in Flow Studio so the agent fills Chrome."
          : "Enter the OTP in Chrome, or enter it in Flow Studio so the agent fills Chrome.",
        inputMode: captcha ? "operator_in_browser" : "callback_value",
        target: structuredClone(step.target),
        maximumAttempts: 3,
      };
    });
    for (const step of state.steps) {
      const hasAssertion = step.success?.length || step.successAny?.length;
      if (
        hasAssertion ||
        !["fill", "date", "select"].includes(step.type) ||
        runtimeHumanField(
          `${step.field || ""} ${(d().fields || []).find((field) => field.key === step.field)?.label || ""}`,
        )
      )
        continue;
      step.success = [
        {
          type:
            step.type === "select"
              ? "selected_value_equals"
              : "field_value_equals",
          expected: `{{fields.${step.field}}}`,
          target: structuredClone(step.target),
        },
      ];
      addedAssertions++;
    }
  }
  return {
    removedDuplicates,
    removedRecorderNoise,
    convertedHumanSteps,
    addedAssertions,
  };
}
async function validate() {
  await save();
  const repairs = repairRecordedDefinition();
  if (
    repairs.removedDuplicates ||
    repairs.removedRecorderNoise ||
    repairs.convertedHumanSteps ||
    repairs.addedAssertions
  ) {
    $("#definition-source").value = JSON.stringify(d(), null, 2);
    if (api) await api.saveFlow(current);
    renderAll();
  }
  const r = api
    ? await api.validateFlow(current.file)
    : { valid: true, errors: [], warnings: ["Preview mode"], summary: {} };
  const box = $("#validation-results");
  box.innerHTML = "";
  if (
    repairs.removedDuplicates ||
    repairs.removedRecorderNoise ||
    repairs.convertedHumanSteps ||
    repairs.addedAssertions
  )
    box.innerHTML += `<div class="check pass"><span>✓</span><div><strong>Recorded flow repaired</strong><p>Removed ${repairs.removedDuplicates} duplicate action(s), removed ${repairs.removedRecorderNoise} field-focus/noise click(s), converted ${repairs.convertedHumanSteps} OTP/CAPTCHA step(s) to explicit human pauses, and added ${repairs.addedAssertions} safe field assertion(s).</p></div></div>`;
  (r.errors || []).forEach((text, issueIndex) => {
    const match = text.match(/^fields\.(\d+)\.(label|key):/),
      actions = match
        ? `<div class="issue-actions"><button class="button secondary issue-fix" data-field="${match[1]}">Generate label</button><button class="text-button issue-remove" data-field="${match[1]}">Remove field</button></div>`
        : "";
    box.innerHTML += `<div class="check fail"><span>×</span><div><strong>Action required</strong><p>${escapeHtml(text)}</p>${actions}</div></div>`;
  });
  (r.warnings || []).forEach((text) => {
    box.innerHTML += `<div class="check warn"><span>!</span><div><strong>Improvement recommended</strong><p>${escapeHtml(text)}</p></div></div>`;
  });
  if (!r.errors?.length)
    box.innerHTML =
      `<div class="check pass"><span>✓</span><div><strong>Definition is valid</strong><p>${r.summary?.states || Object.keys(d().flow.states).length} states and ${r.summary?.steps || allSteps().length} steps passed structural checks.</p></div></div>` +
      box.innerHTML;
  box
    .querySelectorAll(".issue-fix")
    .forEach(
      (button) =>
        (button.onclick = () =>
          repairFieldIssue(Number(button.dataset.field), "fix")),
    );
  box
    .querySelectorAll(".issue-remove")
    .forEach(
      (button) =>
        (button.onclick = () =>
          repairFieldIssue(Number(button.dataset.field), "remove")),
    );
  const total = (r.errors?.length || 0) + (r.warnings?.length || 0),
    ready = r.valid && !r.warnings?.length;
  $("#metric-readiness").textContent = ready
    ? "Ready to finalize"
    : r.valid
      ? `${r.warnings.length} improvements`
      : `${r.errors.length} blockers`;
  $("#readiness-progress").style.width = ready
    ? "100%"
    : r.valid
      ? "72%"
      : Math.max(20, 60 - total * 8) + "%";
  $("#readiness-progress").classList.toggle("ready", ready);
  toast(
    ready
      ? "Flow is ready to finalize"
      : r.valid
        ? "Flow is valid with improvements"
        : "Validation found issues",
  );
  return r;
}
function tab(name) {
  $$(".tab").forEach((x) =>
    x.classList.toggle("active", x.dataset.tab === name),
  );
  $$(".tab-panel").forEach((x) => x.classList.add("hidden"));
  $(`#tab-${name}`).classList.remove("hidden");
}
function bind() {
  $$(".tab").forEach((x) => (x.onclick = () => tab(x.dataset.tab)));
  $("#search").oninput = (e) => renderFlows(e.target.value);
  $("#save-btn").onclick = save;
  $("#validate-btn").onclick = startBrowserTest;
  $("#run-validation-btn").onclick = validate;
  $("#add-manual-step-btn").onclick = () =>
    openStepDialog("add", d().flow.initialState);
  $("#save-step-btn").onclick = saveStepFromDialog;
  $("#run-browser-test").onclick = startBrowserTest;
  $("#stop-browser-test").onclick = async () => {
    await api?.stopFlowTest();
    $("#test-log").textContent += "\nStopping browser test…\n";
    $("#test-status").textContent = "Stopping";
  };
  $("#send-test-response").onclick = async () => {
    if (!testing || !waitingForHuman)
      return toast("The browser flow is not waiting for human input");
    try {
      waitingForHuman = false;
      $("#send-test-response").disabled = true;
      await api?.sendFlowTestInput($("#test-response").value);
      $("#test-response").value = "";
      $("#test-log").textContent += "\nHuman continuation sent securely.\n";
      toast("Flow continuation sent");
    } catch (error) {
      toast(error.message);
    }
  };
  $("#test-response").onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#send-test-response").click();
    }
  };
  api?.onFlowTestEvent((value) => {
    $("#test-console").classList.remove("hidden");
    $("#test-log").textContent += value;
    $("#test-log").scrollTop = $("#test-log").scrollHeight;
    if (
      /Response \(optional\):|Type APPROVE|Enter the authorized value/i.test(
        value,
      )
    ) {
      waitingForHuman = true;
      $("#send-test-response").disabled = false;
      $("#test-response").focus();
    }
  });
  api?.onFlowTestStopped(({ code, signal }) => {
    const succeeded = code === 0;
    setTestUi(false, succeeded ? "Passed" : "Failed");
    $("#test-log").textContent += succeeded
      ? "\nBrowser verification completed successfully.\n"
      : `\nBrowser verification stopped${signal ? ` (${signal})` : ` with exit code ${code}`}.\n`;
    toast(succeeded ? "Browser test passed" : "Browser test failed — see log");
  });
  $("#new-flow-btn").onclick = $("#empty-new-btn").onclick = () =>
    $("#new-flow-dialog").showModal();
  $("#create-flow-btn").onclick = async (e) => {
    e.preventDefault();
    const x = {
      name: $("#new-name").value,
      portal: $("#new-portal").value,
      entryUrl: $("#new-url").value,
      key: $("#new-name").value,
    };
    if (!x.name || !x.entryUrl) return;
    current = api ? await api.createFlow(x) : sample;
    flows = api ? await api.listFlows() : flows;
    $("#new-flow-dialog").close();
    await openFlow(current.file);
  };
  $("#definition-source").oninput = markDirty;
  ["app-name", "portal-key", "entry-url"].forEach(
    (id) =>
      ($("#" + id).onchange = (e) => {
        const map = {
          "app-name": "name",
          "portal-key": "portal",
          "entry-url": "entryUrl",
        };
        d().application[map[id]] = e.target.value;
        syncSource();
      }),
  );
  $("#entry-states").onchange = (e) => {
    const values = e.target.value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    d().flow.entryStates = values.length ? values : [d().flow.initialState];
    syncSource();
  };
  $("#add-field-btn").onclick = () => {
    d().fields.push({
      key: `field_${d().fields.length + 1}`,
      label: "New field",
      type: "text",
      required: true,
    });
    syncSource();
  };
  $("#add-document-btn").onclick = () => {
    d().documents ??= [];
    d().documents.push({
      key: `document_${d().documents.length + 1}`,
      required: true,
      multiple: false,
      acceptedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
      acceptedExtensions: [".pdf", ".jpg", ".jpeg", ".png"],
      maxBytes: 10485760,
    });
    syncSource();
  };
  $("#add-state-btn").onclick = () => {
    const key = `state_${Object.keys(d().flow.states).length + 1}`;
    d().flow.states[key] = {
      detect: { visibleText: ["replace_me"] },
      steps: [],
      transitions: { success: "completed" },
    };
    syncSource();
  };
  $("#record-shortcut").onclick = () => tab("teach");
  $("#export-shortcut").onclick = () => tab("export");
  $("#start-record-btn").onclick = async () => {
    if (!api) return toast("Recording requires the desktop app");
    try {
      recording = true;
      const captureValues = $("#capture-values").checked;
      $("#record-log").textContent =
        `Launching dedicated Chrome profile…\nValue capture: ${captureValues ? "local plaintext enabled" : "redacted"}\n`;
      $("#record-status").textContent = "Recording";
      $("#start-record-btn").disabled = true;
      $("#stop-record-btn").disabled = false;
      $("#generate-draft-btn").disabled = true;
      await api.startRecording({ url: $("#record-url").value, captureValues });
    } catch (e) {
      recording = false;
      $("#record-status").textContent = "Failed";
      $("#start-record-btn").disabled = false;
      $("#stop-record-btn").disabled = true;
      $("#generate-draft-btn").disabled = false;
      toast(e.message);
    }
  };
  $("#stop-record-btn").onclick = async () => {
    try {
      $("#record-status").textContent = "Finalizing";
      $("#stop-record-btn").disabled = true;
      await api?.stopRecording();
      recording = false;
      $("#record-status").textContent = "Ready";
      $("#start-record-btn").disabled = false;
      $("#generate-draft-btn").disabled = false;
      toast("Recording saved and ready to generate");
    } catch (e) {
      $("#record-status").textContent = "Stop failed";
      toast(e.message);
    }
  };
  api?.onRecordEvent((x) => {
    $("#record-log").textContent += x;
    $("#record-log").scrollTop = $("#record-log").scrollHeight;
  });
  api?.onRecordStopped(() => {
    recording = false;
    $("#record-status").textContent = "Ready";
    $("#start-record-btn").disabled = false;
    $("#stop-record-btn").disabled = true;
    $("#generate-draft-btn").disabled = false;
  });
  $("#save-document-map").onclick = async () => {
    const missing = (d().documents || []).filter(
      (x) => x.required && !localDocuments[x.key],
    );
    if (missing.length)
      return toast(
        "Choose required files: " + missing.map((x) => x.key).join(", "),
      );
    const file = await api?.saveDocumentMap({
      flowKey: d().application.key,
      documents: localDocuments,
    });
    if (file) {
      $("#document-map-result").textContent = "Saved: " + file;
      $("#document-map-result").classList.remove("hidden");
      toast("Local document map saved");
    }
  };
  $("#generate-draft-btn").onclick = async () => {
    try {
      if (recording) return toast("Stop and finalize the recording first");
      const f = await api?.latestRecording();
      if (!f) return toast("No recording with captured steps was found");
      const out = current.file;
      $("#generate-draft-btn").disabled = true;
      await api.generateDraft({
        eventsFile: f,
        output: out,
        key: d().application.key,
      });
      await openFlow(out);
      toast("Draft generated from recorded steps");
    } catch (e) {
      toast(e.message);
    } finally {
      $("#generate-draft-btn").disabled = false;
    }
  };
  $("#new-version-btn").onclick = async () => {
    current = await api.newVersion(current.file);
    flows = await api.listFlows();
    renderFlows();
    renderAll();
    toast("Editable next version created");
  };
  $("#publish-btn").onclick = async () => {
    const r = await validate();
    if (!r.valid || r.warnings?.length) {
      tab("verify");
      return toast(
        !r.valid
          ? `Fix ${r.errors.length} validation blocker(s) shown here`
          : `Resolve ${r.warnings.length} readiness warning(s) before finalizing`,
      );
    }
    const out = await api?.publishFlow(current.file);
    toast("Version finalized");
    flows = await api.listFlows();
    renderFlows();
    if (out) current = await api.loadFlow(out);
    renderAll();
  };
  $("#export-btn").onclick = async () => {
    const r = await validate();
    if (!r.valid) {
      tab("verify");
      return toast(
        `Fix ${r.errors.length} validation blocker(s) shown in Verify`,
      );
    }
    const dir = await api?.chooseDirectory();
    if (!dir) return;
    const out = await api.exportFlow({
      file: current.file,
      output: dir + "/" + d().application.key + "-v" + d().application.version,
    });
    $("#export-result").textContent = "Generated package: " + out;
    $("#export-result").classList.remove("hidden");
    toast("Portable package generated");
  };
}
init();
