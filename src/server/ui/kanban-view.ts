/**
 * Kanban view assets for the SDD dashboard.
 *
 * Kept as plain strings (not files) because the plugin is compiled with `tsc`
 * and `dist/` ships only JS — static assets would not be copied. The script is
 * a classic (non-module) script so it shares the global scope with the graph
 * script and can reuse `allNodes` / `loadGraph`.
 */

export const KANBAN_STYLE = `
    .app { display: flex; flex-direction: column; height: 100vh; }
    .views { flex: 1; min-height: 0; position: relative; }
    .topbar { display: flex; align-items: center; gap: 16px; padding: 10px 16px; background: #161b22; border-bottom: 1px solid #30363d; }
    .brand { font-size: 13px; font-weight: 600; color: #58a6ff; letter-spacing: .5px; }
    .tabs { display: flex; gap: 6px; }
    .tab { padding: 5px 14px; border-radius: 6px; border: 1px solid #30363d; background: transparent; color: #c9d1d9; cursor: pointer; font-size: 12px; transition: all .2s; }
    .tab:hover { border-color: #58a6ff; }
    .tab.active { background: #1f6feb; border-color: #1f6feb; color: #fff; }
    .task-pending { margin-left: auto; font-size: 11px; color: #d29922; }
    .kanban-wrap { height: 100%; overflow: auto; padding: 16px; }
    .kanban { display: flex; gap: 14px; align-items: flex-start; min-height: 100%; }
    .kcol { flex: 1 1 0; min-width: 220px; background: #161b22; border: 1px solid #30363d; border-radius: 10px; display: flex; flex-direction: column; max-height: calc(100vh - 130px); }
    .kcol.drop-target { border-color: #58a6ff; background: #1c2333; }
    .kcol-head { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #21262d; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: #8b949e; }
    .kcol-count { background: #21262d; border-radius: 10px; padding: 1px 8px; font-size: 10px; }
    .kcol-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; min-height: 60px; }
    .kcard { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px; cursor: grab; transition: border-color .2s, transform .1s; }
    .kcard:hover { border-color: #58a6ff; }
    .kcard.dragging { opacity: .5; }
    .kcard-title { font-size: 13px; font-weight: 500; color: #c9d1d9; }
    .kcard-id { font-size: 10px; color: #8b949e; margin-top: 2px; }
    .kanban-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; padding: 10px 14px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; font-size: 12px; }
    .kanban-toolbar input, .kanban-toolbar select { padding: 5px 8px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; font-size: 12px; outline: none; font-family: inherit; }
    .kanban-toolbar input:focus, .kanban-toolbar select:focus { border-color: #58a6ff; }
    .kanban-toolbar .search { min-width: 180px; }
    .kanban-toolbar .tb-label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    .kanban-toolbar .spacer { flex: 1; }
    .kcard-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .kbadge { font-size: 9px; padding: 2px 6px; border-radius: 10px; border: 1px solid #30363d; color: #8b949e; }
    .kbadge.pending { border-color: #9e6a03; color: #d29922; }
    .kbadge.integrated { border-color: #238636; color: #3fb950; }
    .kbadge.change-draft { border-color: #9e6a03; color: #d29922; }
    .kbadge.change-approved { border-color: #1f6feb; color: #58a6ff; }
    .kchange { font-size: 12px; color: #8b949e; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .kempty { color: #484f58; font-size: 11px; text-align: center; padding: 12px 0; }
    .kanban-new { margin-bottom: 14px; }
    .btn { padding: 6px 14px; border-radius: 6px; border: 1px solid #30363d; background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 12px; transition: all .2s; }
    .btn:hover { border-color: #58a6ff; }
    .btn.primary { background: #238636; border-color: #238636; color: #fff; }
    .btn.danger { background: #da3633; border-color: #da3633; color: #fff; }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: #000000aa; z-index: 50; align-items: center; justify-content: center; }
    .modal-backdrop.open { display: flex; }
    .modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; width: min(520px, 92vw); max-height: 88vh; overflow-y: auto; padding: 20px; }
    .modal h3 { font-size: 15px; color: #58a6ff; margin-bottom: 14px; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 11px; color: #8b949e; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .5px; }
    .field input, .field select, .field textarea { width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #30363d; background: #0d1117; color: #c9d1d9; font-size: 13px; outline: none; font-family: inherit; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: #58a6ff; }
    .field textarea { resize: vertical; min-height: 60px; }
    .modal-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    .modal-actions .spacer { flex: 1; }
    .modal-status { font-size: 11px; margin-top: 10px; min-height: 14px; color: #8b949e; }
    .modal-status.error { color: #f85149; }
    .modal-status.ok { color: #3fb950; }
`

export const KANBAN_MODAL_HTML = `
  <div class="modal-backdrop" id="task-modal">
    <div class="modal">
      <h3 id="task-modal-title">Nova task</h3>
      <input type="hidden" id="task-id">
      <div class="field">
        <label for="task-name">Nome</label>
        <input id="task-name" type="text" placeholder="Ex: Implementar login com Google">
      </div>
      <div class="field">
        <label for="task-description">Descrição</label>
        <textarea id="task-description" placeholder="Contexto e detalhes da task"></textarea>
      </div>
      <div class="field">
        <label for="task-goal">Objetivo</label>
        <input id="task-goal" type="text" placeholder="Resultado esperado">
      </div>
      <div class="field">
        <label for="task-acceptance">Critérios de aceite (um por linha)</label>
        <textarea id="task-acceptance" placeholder="Dado ... quando ... então ..."></textarea>
      </div>
      <div class="field">
        <label for="task-files">Arquivos previstos (separados por vírgula)</label>
        <input id="task-files" type="text" placeholder="src/auth.ts, src/auth.test.ts">
      </div>
      <div class="field">
        <label for="task-priority">Prioridade</label>
        <select id="task-priority">
          <option value="medium">Medium</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="field">
        <label for="task-column">Coluna</label>
        <select id="task-column">
          <option value="backlog">Backlog</option>
          <option value="ready">Ready</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div class="field">
        <label for="task-link">Vincular a (ID de feature/requirement/project — opcional)</label>
        <input id="task-link" type="text" placeholder="FEAT-001">
      </div>
      <div class="field" id="task-change-field" style="display:none">
        <label>Change SDD (autorização de escrita do código)</label>
        <div class="kchange" id="task-change-info">—</div>
      </div>
      <div class="modal-actions">
        <button class="btn primary" id="task-save">Salvar</button>
        <button class="btn" id="task-integrate" style="display:none">Integrar com IA</button>
        <button class="btn" id="task-change" style="display:none">Abrir Change SDD</button>
        <div class="spacer"></div>
        <button class="btn danger" id="task-delete" style="display:none">Excluir</button>
        <button class="btn" id="task-cancel">Cancelar</button>
      </div>
      <div class="modal-status" id="task-modal-status"></div>
    </div>
  </div>
`

export const KANBAN_SCRIPT = `
(function () {
  var COLUMN_ORDER = ["backlog", "ready", "in_progress", "blocked", "done"];
  var COLUMN_LABEL = { backlog: "Backlog", ready: "Ready", in_progress: "In Progress", blocked: "Blocked", done: "Done" };
  var STATUS_COLUMN = {
    DRAFT: "backlog", PROPOSED: "backlog", todo: "backlog",
    ready: "ready", APPROVED: "ready",
    in_progress: "in_progress", IMPLEMENTING: "in_progress", VERIFYING: "in_progress",
    blocked: "blocked", BLOCKED: "blocked", CONFLICT: "blocked", FAILED: "blocked", DRIFTED: "blocked",
    completed: "done", COMPLETED: "done", IMPLEMENTED: "done", VERIFIED: "done", DEPRECATED: "done", ROLLED_BACK: "done"
  };
  var STATUS_COLUMN_REV = {
    backlog: ["DRAFT","PROPOSED","todo"], ready: ["ready","APPROVED"],
    in_progress: ["in_progress","IMPLEMENTING","VERIFYING"],
    blocked: ["blocked","BLOCKED","CONFLICT","FAILED","DRIFTED"],
    done: ["completed","COMPLETED","IMPLEMENTED","VERIFIED","DEPRECATED","ROLLED_BACK"]
  };
  var COLUMN_IDX = { backlog: 0, ready: 1, in_progress: 2, blocked: 3, done: 4 };
  var PRIORITY_IDX = { critical: 0, high: 1, medium: 2, low: 3 };
  var INT_IDX = { pending: 0, manual: 1, integrated: 2 };
  var FILTER_KEY = "sdd-kanban-filters";

  function columnForStatus(status) { return STATUS_COLUMN[status] || "backlog"; }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function taskNodes() {
    return (typeof allNodes !== "undefined" ? allNodes : []).filter(function (n) { return n.type === "task"; });
  }

  function getFilters() {
    try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveFilters(f) { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch (e) {} }

  function applyFilters(tasks) {
    var f = getFilters();
    var q = (f.search || "").toLowerCase().trim();
    var link = f.link || "all";
    var integration = f.integration || "all";
    var priority = f.priority || "all";
    var column = f.column || "all";
    var sortKey = f.sort || "column";
    var order = f.order || "asc";

    var result = tasks;
    if (q) {
      result = result.filter(function (t) {
        var meta = t.metadata || {};
        var hay = [t.id, t.name, t.description || "", meta.goal || ""]
          .concat(Array.isArray(meta.files) ? meta.files : [])
          .concat(Array.isArray(meta.acceptance) ? meta.acceptance : [])
          .join(" ").toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }
    if (link !== "all") {
      result = result.filter(function (t) {
        var rels = (typeof allLinks !== "undefined" ? allLinks : []);
        var hasLink = rels.some(function (r) {
          var s = (typeof r.source === "object") ? r.source.id : r.source;
          var tt = (typeof r.target === "object") ? r.target.id : r.target;
          return s === t.id || tt === t.id;
        });
        if (link === "linked") return hasLink;
        if (link === "unlinked") return !hasLink;
        // link is a node type: check if any linked node is of that type
        var nodes = (typeof allNodes !== "undefined" ? allNodes : []);
        return rels.some(function (r) {
          var s = (typeof r.source === "object") ? r.source.id : r.source;
          var tt = (typeof r.target === "object") ? r.target.id : r.target;
          if (s !== t.id && tt !== t.id) return false;
          var otherId = s === t.id ? tt : s;
          var other = nodes.find(function (n) { return n.id === otherId; });
          return other && other.type === link;
        });
      });
    }
    if (integration !== "all") {
      result = result.filter(function (t) {
        var is = (t.metadata && t.metadata.integration_status) || "manual";
        return is === integration;
      });
    }
    if (priority !== "all") {
      result = result.filter(function (t) {
        var p = (t.metadata && t.metadata.priority) || "medium";
        return p === priority;
      });
    }
    if (column !== "all") {
      result = result.filter(function (t) { return columnForStatus(t.status) === column; });
    }

    // Sort
    var dir = order === "desc" ? -1 : 1;
    result = result.slice().sort(function (a, b) {
      var cmp = 0;
      if (sortKey === "priority") cmp = PRIORITY_IDX[(a.metadata && a.metadata.priority) || "medium"] - PRIORITY_IDX[(b.metadata && b.metadata.priority) || "medium"];
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "created") cmp = a.created_at.localeCompare(b.created_at);
      else if (sortKey === "updated") cmp = a.updated_at.localeCompare(b.updated_at);
      else if (sortKey === "integration") cmp = INT_IDX[(a.metadata && a.metadata.integration_status) || "manual"] - INT_IDX[(b.metadata && b.metadata.integration_status) || "manual"];
      else if (sortKey === "links") {
        var rels = (typeof allLinks !== "undefined" ? allLinks : []);
        var countA = rels.filter(function (r) { return (typeof r.source === "object" ? r.source.id : r.source) === a.id || (typeof r.target === "object" ? r.target.id : r.target) === a.id; }).length;
        var countB = rels.filter(function (r) { return (typeof r.source === "object" ? r.source.id : r.source) === b.id || (typeof r.target === "object" ? r.target.id : r.target) === b.id; }).length;
        cmp = countA - countB;
      }
      else { // "column"
        cmp = COLUMN_IDX[columnForStatus(a.status)] - COLUMN_IDX[columnForStatus(b.status)];
        if (cmp === 0) cmp = PRIORITY_IDX[(a.metadata && a.metadata.priority) || "medium"] - PRIORITY_IDX[(b.metadata && b.metadata.priority) || "medium"];
        if (cmp === 0) cmp = a.name.localeCompare(b.name);
        return cmp;
      }
      if (cmp !== 0) return cmp * dir;
      // stable tiebreakers
      var colCmp = COLUMN_IDX[columnForStatus(a.status)] - COLUMN_IDX[columnForStatus(b.status)];
      if (colCmp !== 0) return colCmp;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  function renderToolbar() {
    var f = getFilters();
    var setVal = function (id, val) { var e = el(id); if (e) e.value = val || "all"; };
    setVal("kanban-search", f.search || "");
    setVal("kanban-filter-link", f.link || "all");
    setVal("kanban-filter-integration", f.integration || "all");
    setVal("kanban-filter-priority", f.priority || "all");
    setVal("kanban-filter-column", f.column || "all");
    setVal("kanban-sort", f.sort || "column");
    setVal("kanban-order", f.order || "asc");
  }

  function readToolbar() {
    var f = getFilters();
    var getVal = function (id) { var e = el(id); return e ? e.value : ""; };
    f.search = getVal("kanban-search");
    f.link = getVal("kanban-filter-link");
    f.integration = getVal("kanban-filter-integration");
    f.priority = getVal("kanban-filter-priority");
    f.column = getVal("kanban-filter-column");
    f.sort = getVal("kanban-sort");
    f.order = getVal("kanban-order");
    saveFilters(f);
    return f;
  }

  window.renderKanban = function () {
    var board = document.getElementById("kanban-board");
    if (!board) return;
    var all = taskNodes();
    var tasks = applyFilters(all);
    var pending = all.filter(function (t) {
      return t.metadata && t.metadata.integration_status === "pending";
    }).length;

    var awaitingChange = all.filter(function (t) {
      var status = t.metadata && t.metadata.change_status;
      return t.metadata && t.metadata.change_id && (status === "DRAFT" || status === "PROPOSED");
    }).length;

    var counter = document.getElementById("task-pending");
    if (counter) {
      var parts = [];
      if (pending > 0) parts.push(pending + " task(s) pendente(s) de integração");
      if (awaitingChange > 0) parts.push(awaitingChange + " Change(s) aguardando aprovação");
      counter.textContent = parts.join(" · ");
    }

    var html = "";

    COLUMN_ORDER.forEach(function (col) {
      var items = tasks.filter(function (t) { return columnForStatus(t.status) === col; });
      html += '<div class="kcol" data-column="' + col + '">';
      html += '<div class="kcol-head"><span>' + COLUMN_LABEL[col] + '</span><span class="kcol-count">' + items.length + '</span></div>';
      html += '<div class="kcol-body" data-column="' + col + '">';
      if (items.length === 0) {
        html += '<div class="kempty">sem tasks</div>';
      }
      items.forEach(function (t) {
        var meta = t.metadata || {};
        var integration = meta.integration_status || "manual";
        html += '<div class="kcard" draggable="true" data-id="' + escapeHtml(t.id) + '">';
        html += '<div class="kcard-title">' + escapeHtml(t.name) + '</div>';
        html += '<div class="kcard-id">' + escapeHtml(t.id) + '</div>';
        var pri = meta.priority || "medium";
        html += '<div class="kcard-meta">';
        html += '<span class="kbadge" style="border-color:' + ({ critical: '#da3633', high: '#d29922', medium: '#8b949e', low: '#484f58' }[pri] || '#8b949e') + ';color:' + ({ critical: '#f85149', high: '#d29922', medium: '#8b949e', low: '#484f58' }[pri] || '#8b949e') + '">' + escapeHtml(pri) + '</span>';
        html += '<span class="kbadge ' + escapeHtml(integration) + '">' + escapeHtml(integration) + '</span>';
        if (meta.change_id) {
          var changeDraft = !meta.change_status || meta.change_status === "DRAFT" || meta.change_status === "PROPOSED";
          html += '<span class="kbadge ' + (changeDraft ? "change-draft" : "change-approved") + '">' +
            escapeHtml(meta.change_id + " · " + (meta.change_status || "DRAFT")) + '</span>';
        }
        if (meta.goal) html += '<span class="kbadge">goal</span>';
        if (meta.files && meta.files.length) html += '<span class="kbadge">' + meta.files.length + ' arquivo(s)</span>';
        html += '</div></div>';
      });
      html += '</div></div>';
    });

    board.innerHTML = '<div class="kanban">' + html + '</div>';
    wireKanban();
  };

  function wireKanban() {
    document.querySelectorAll(".kcard").forEach(function (card) {
      card.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", card.getAttribute("data-id"));
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", function () { card.classList.remove("dragging"); });
      card.addEventListener("click", function () {
        var task = taskNodes().filter(function (t) { return t.id === card.getAttribute("data-id"); })[0];
        if (task) openTaskModal(task);
      });
    });

    document.querySelectorAll(".kcol-body").forEach(function (body) {
      body.addEventListener("dragover", function (e) {
        e.preventDefault();
        body.parentElement.classList.add("drop-target");
      });
      body.addEventListener("dragleave", function () {
        body.parentElement.classList.remove("drop-target");
      });
      body.addEventListener("drop", function (e) {
        e.preventDefault();
        body.parentElement.classList.remove("drop-target");
        var id = e.dataTransfer.getData("text/plain");
        var column = body.getAttribute("data-column");
        if (id && column) moveTask(id, column);
      });
    });
  }

  function moveTask(id, column) {
    api("POST", "/api/tasks/" + encodeURIComponent(id), { column: column })
      .then(function (res) {
        if (!res.ok) { console.error("Move failed", res); }
        if (typeof loadGraph === "function") loadGraph();
      })
      .catch(function (e) { console.error("Move failed", e); });
  }

  var modal = null;
  var currentTask = null;
  function el(id) { return document.getElementById(id); }

  /** Reflect the task's SDD Change (if any) in the modal. */
  function updateChangeUi(task) {
    var field = el("task-change-field");
    var button = el("task-change");
    var info = el("task-change-info");
    if (!field || !button || !info) return;

    var meta = (task && task.metadata) || {};
    var changeId = meta.change_id;
    if (!task) {
      field.style.display = "none";
      button.style.display = "none";
      return;
    }

    button.style.display = "";
    if (!changeId) {
      field.style.display = "none";
      info.innerHTML = "";
      button.textContent = "Abrir Change SDD";
      return;
    }

    var status = meta.change_status || "DRAFT";
    var draft = status === "DRAFT" || status === "PROPOSED";
    field.style.display = "";
    info.innerHTML = '<span class="kbadge ' + (draft ? "change-draft" : "change-approved") + '">' +
      escapeHtml(changeId + " · " + status) + '</span>';
    button.textContent = draft ? "Aprovar + gerar código" : "Gerar código";
  }

  function setStatus(message, kind) {
    var node = el("task-modal-status");
    if (!node) return;
    node.textContent = message || "";
    node.className = "modal-status" + (kind ? " " + kind : "");
  }

  function openTaskModal(task) {
    modal = el("task-modal");
    if (!modal) return;
    currentTask = task || null;
    el("task-modal-title").textContent = task ? "Editar task" : "Nova task";
    el("task-id").value = task ? task.id : "";
    el("task-name").value = task ? task.name : "";
    el("task-description").value = task && task.description ? task.description : "";
    var meta = (task && task.metadata) || {};
    el("task-goal").value = meta.goal || "";
    el("task-acceptance").value = Array.isArray(meta.acceptance) ? meta.acceptance.join("\\n") : "";
    el("task-files").value = Array.isArray(meta.files) ? meta.files.join(", ") : "";
    el("task-priority").value = meta.priority || "medium";
    el("task-column").value = task ? columnForStatus(task.status) : "backlog";
    el("task-link").value = "";
    el("task-integrate").style.display = task ? "" : "none";
    el("task-delete").style.display = task ? "" : "none";
    updateChangeUi(task);
    setStatus("", null);
    modal.classList.add("open");
  }

  function closeTaskModal() {
    if (modal) modal.classList.remove("open");
  }

  function splitList(value, separator) {
    return String(value || "")
      .split(separator)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function saveTask() {
    var id = el("task-id").value;
    var name = el("task-name").value.trim();
    if (!name) { setStatus("O nome é obrigatório.", "error"); return; }

    var payload = {
      name: name,
      description: el("task-description").value.trim(),
      goal: el("task-goal").value.trim(),
      acceptance: splitList(el("task-acceptance").value, "\\n"),
      files: splitList(el("task-files").value, ","),
      priority: el("task-priority").value,
      column: el("task-column").value
    };

    var url = id ? "/api/tasks/" + encodeURIComponent(id) : "/api/tasks";
    if (!id) {
      var link = el("task-link").value.trim();
      if (link) payload.link_to = link;
    }

    setStatus("Salvando...", null);
    api("POST", url, payload).then(function (res) {
      if (!res.ok) {
        setStatus((res.data && res.data.error) || ("Erro " + res.status), "error");
        return;
      }
      setStatus("Salvo. Integração: " + ((res.data.integration && res.data.integration.reason) || "ok"), "ok");
      if (typeof loadGraph === "function") loadGraph();
      setTimeout(closeTaskModal, 700);
    }).catch(function (e) {
      setStatus("Falha ao salvar: " + e, "error");
    });
  }

  function deleteTask() {
    var id = el("task-id").value;
    if (!id) return;
    setStatus("Excluindo...", null);
    api("DELETE", "/api/tasks/" + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) { setStatus("Erro ao excluir", "error"); return; }
      if (typeof loadGraph === "function") loadGraph();
      closeTaskModal();
    }).catch(function (e) { setStatus("Falha: " + e, "error"); });
  }

  /**
   * Open (or re-dispatch) the SDD Change of the task. A draft Change is
   * approved here, which is what unlocks code generation.
   */
  function openChange() {
    var id = el("task-id").value;
    if (!id) return;

    var meta = (currentTask && currentTask.metadata) || {};
    var status = meta.change_status || "DRAFT";
    var approve = !!meta.change_id && (status === "DRAFT" || status === "PROPOSED");

    setStatus(approve ? "Aprovando o Change e pedindo a implementação..." : "Abrindo o Change SDD...", null);
    api("POST", "/api/tasks/" + encodeURIComponent(id) + "/change", approve ? { approve: true } : {})
      .then(function (res) {
        if (!res.ok) {
          setStatus((res.data && res.data.error) || ("Erro " + res.status), "error");
          return;
        }
        var change = (res.data && res.data.change) || {};
        var integration = (res.data && res.data.integration) || {};
        var blockers = (res.data && res.data.blockers) || [];
        var detail = blockers.length > 0 ? blockers[0] : (integration.reason || "");
        setStatus(
          (change.id ? change.id + " · " + change.status + ". " : "") + detail,
          blockers.length > 0 ? "error" : "ok"
        );
        if (typeof loadGraph === "function") loadGraph();
      })
      .catch(function (e) { setStatus("Falha: " + e, "error"); });
  }

  function integrateTask() {
    var id = el("task-id").value;
    if (!id) return;
    setStatus("Solicitando integração...", null);
    api("POST", "/api/tasks/" + encodeURIComponent(id) + "/integrate", {}).then(function (res) {
      var integration = (res.data && res.data.integration) || {};
      setStatus(integration.reason || "Integração solicitada.", integration.queued ? "ok" : null);
      if (typeof loadGraph === "function") loadGraph();
    }).catch(function (e) { setStatus("Falha: " + e, "error"); });
  }

  function switchView(view) {
    var graph = document.getElementById("graph-view");
    var kanban = document.getElementById("kanban-view");
    if (!graph || !kanban) return;
    var showKanban = view === "kanban";
    graph.style.display = showKanban ? "none" : "";
    kanban.style.display = showKanban ? "block" : "none";
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-view") === view);
    });
    if (showKanban) {
      window.renderKanban();
    } else if (typeof fg !== "undefined" && fg) {
      var container = document.getElementById("graph-container");
      if (container) { fg.width(container.offsetWidth); fg.height(container.offsetHeight); }
    }
  }

  function onFilterChange() {
    readToolbar();
    window.renderKanban();
  }

  var debounceTimer = null;
  function onSearchInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { readToolbar(); window.renderKanban(); }, 200);
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderToolbar();
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () { switchView(tab.getAttribute("data-view")); });
    });
    var save = el("task-save");
    var cancel = el("task-cancel");
    var del = el("task-delete");
    var integrate = el("task-integrate");
    var change = el("task-change");
    var add = el("kanban-add");
    if (add) add.addEventListener("click", function () { openTaskModal(null); });
    if (save) save.addEventListener("click", saveTask);
    if (cancel) cancel.addEventListener("click", closeTaskModal);
    if (del) del.addEventListener("click", deleteTask);
    if (integrate) integrate.addEventListener("click", integrateTask);
    if (change) change.addEventListener("click", openChange);
    var backdrop = el("task-modal");
    if (backdrop) backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeTaskModal(); });

    // Toolbar wiring
    var searchInput = el("kanban-search");
    if (searchInput) searchInput.addEventListener("input", onSearchInput);
    ["kanban-filter-link", "kanban-filter-integration", "kanban-filter-priority", "kanban-filter-column", "kanban-sort", "kanban-order"].forEach(function (id) {
      var e = el(id);
      if (e) e.addEventListener("change", onFilterChange);
    });
    var resetBtn = el("kanban-reset-filters");
    if (resetBtn) resetBtn.addEventListener("click", function () {
      saveFilters({});
      renderToolbar();
      window.renderKanban();
    });

    if (typeof loadGraph === "function") loadGraph();
  });
})();
`
