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
    .kcard-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .kbadge { font-size: 9px; padding: 2px 6px; border-radius: 10px; border: 1px solid #30363d; color: #8b949e; }
    .kbadge.pending { border-color: #9e6a03; color: #d29922; }
    .kbadge.integrated { border-color: #238636; color: #3fb950; }
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
      <div class="modal-actions">
        <button class="btn primary" id="task-save">Salvar</button>
        <button class="btn" id="task-integrate" style="display:none">Integrar com IA</button>
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

  window.renderKanban = function () {
    var board = document.getElementById("kanban-board");
    if (!board) return;
    var tasks = taskNodes();
    var pending = tasks.filter(function (t) {
      return t.metadata && t.metadata.integration_status === "pending";
    }).length;

    var counter = document.getElementById("task-pending");
    if (counter) {
      counter.textContent = pending > 0 ? pending + " task(s) pendente(s) de integração" : "";
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
        html += '<div class="kcard-meta">';
        html += '<span class="kbadge ' + escapeHtml(integration) + '">' + escapeHtml(integration) + '</span>';
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
  function el(id) { return document.getElementById(id); }

  function setStatus(message, kind) {
    var node = el("task-modal-status");
    if (!node) return;
    node.textContent = message || "";
    node.className = "modal-status" + (kind ? " " + kind : "");
  }

  function openTaskModal(task) {
    modal = el("task-modal");
    if (!modal) return;
    el("task-modal-title").textContent = task ? "Editar task" : "Nova task";
    el("task-id").value = task ? task.id : "";
    el("task-name").value = task ? task.name : "";
    el("task-description").value = task && task.description ? task.description : "";
    var meta = (task && task.metadata) || {};
    el("task-goal").value = meta.goal || "";
    el("task-acceptance").value = Array.isArray(meta.acceptance) ? meta.acceptance.join("\\n") : "";
    el("task-files").value = Array.isArray(meta.files) ? meta.files.join(", ") : "";
    el("task-column").value = task ? columnForStatus(task.status) : "backlog";
    el("task-link").value = "";
    el("task-integrate").style.display = task ? "" : "none";
    el("task-delete").style.display = task ? "" : "none";
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

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () { switchView(tab.getAttribute("data-view")); });
    });
    var save = el("task-save");
    var cancel = el("task-cancel");
    var del = el("task-delete");
    var integrate = el("task-integrate");
    var add = el("kanban-add");
    if (add) add.addEventListener("click", function () { openTaskModal(null); });
    if (save) save.addEventListener("click", saveTask);
    if (cancel) cancel.addEventListener("click", closeTaskModal);
    if (del) del.addEventListener("click", deleteTask);
    if (integrate) integrate.addEventListener("click", integrateTask);
    var backdrop = el("task-modal");
    if (backdrop) backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeTaskModal(); });
    if (typeof loadGraph === "function") loadGraph();
  });
})();
`
