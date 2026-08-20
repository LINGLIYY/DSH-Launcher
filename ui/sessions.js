/* ============================================================
   DSH Launcher · sessions.js
   会话管理 Tab：列表（按工作区分组）、全文检索、详情渲染、
   删除/回收站（恢复/彻底删除/清空）、导出 Markdown。
   ============================================================ */
(function () {
  "use strict";
  const DSH = window.DSH;
  const { $, invoke, escapeHtml, appendLog, showConfirm, fmtTime } = DSH;

  let currentSessionId = null;
  let currentSessionTitle = "";

  function ep() { return DSH.endpoints ? DSH.endpoints.current() : null; }

  function selectSessionItem(div) {
    document.querySelectorAll(".session-item").forEach(x => x.classList.remove("active"));
    if (div) div.classList.add("active");
  }

  /* ---------- 列表（按工作区分组渲染） ---------- */
  async function loadSessions() {
    const list = await invoke("list_sessions", { filter: ($("sessionSearch") && $("sessionSearch").value) || "", endpoint_id: ep().id });
    const box = $("sessionList");
    if (!box) return;
    if (!list || !list.length) {
      box.innerHTML = '<div class="session-empty">本机 Windows DSH 暂无会话记录</div>';
      return;
    }
    box.innerHTML = "";
    // 按工作区分组
    const groups = new Map();
    list.forEach(s => {
      const ws = s.workspace || "（未分组）";
      if (!groups.has(ws)) groups.set(ws, []);
      groups.get(ws).push(s);
    });
    groups.forEach((items, ws) => {
      const g = document.createElement("div");
      g.className = "session-group";
      const gHead = document.createElement("div");
      gHead.className = "session-group-head";
      gHead.innerHTML = `<span class="sg-name">${escapeHtml(ws)}</span><span class="sg-count">${items.length}</span>`;
      g.appendChild(gHead);
      items.forEach(s => {
        const div = document.createElement("div");
        div.className = "session-item";
        div.innerHTML = `<div class="s-title">${escapeHtml(s.title || "未命名会话")}</div>
          <div class="s-meta">${fmtTime(s.mtime_ms)} · ${(s.size / 1024).toFixed(1)}KB</div>`;
        div.onclick = () => { currentSessionTitle = s.title || "未命名会话"; selectSessionItem(div); loadSessionDetail(s.id); };
        g.appendChild(div);
      });
      box.appendChild(g);
    });
  }

  async function searchSessions() {
    const q = ($("sessionSearch") && $("sessionSearch").value || "").trim();
    const box = $("sessionList");
    if (!box) return;
    if (!q) { loadSessions(); return; }
    box.innerHTML = '<div class="session-empty">正在全文检索...</div>';
    let hits = [];
    try { hits = await invoke("search_sessions", { query: q, limit: 80 }); }
    catch (e) {
      box.innerHTML = '<div class="session-empty">搜索失败：' + escapeHtml(String(e)) + '</div>';
      return;
    }
    box.innerHTML = "";
    if (!hits || !hits.length) {
      box.innerHTML = '<div class="session-empty">没有匹配「' + escapeHtml(q) + '」的会话内容</div>';
      return;
    }
    hits.forEach(h => {
      const div = document.createElement("div");
      div.className = "session-item";
      div.innerHTML = `<div class="s-title">${escapeHtml(h.title)}</div>
        <div class="s-meta">${escapeHtml(h.workspace || "")} · ${fmtTime(h.mtime_ms)}</div>
        <div class="s-snippet">${escapeHtml(h.snippet)}</div>`;
      div.onclick = () => { currentSessionTitle = h.title; selectSessionItem(div); loadSessionDetail(h.id); };
      box.appendChild(div);
    });
  }

  async function loadSessionDetail(id) {
    currentSessionId = id;
    const blocks = await invoke("get_session", { id, endpoint_id: ep().id });
    const box = $("sessionDetail");
    if (!box) return;
    if (!blocks || !blocks.length) { box.innerHTML = '<div class="session-empty">无法加载会话内容</div>'; return; }
    box.innerHTML = `<div class="sd-head">会话 ID：${escapeHtml(id)}（端：${escapeHtml(ep().name)}）</div>`;
    blocks.forEach(b => {
      const d = document.createElement("div");
      d.className = "msg " + (b.kind === "user" ? "user" : b.kind === "tool" ? "tool" : "assistant");
      d.textContent = b.text;
      box.appendChild(d);
    });
  }

  /* ---------- 回收站 ---------- */
  async function renderTrash() {
    const box = $("trashBody");
    if (!box) return;
    box.innerHTML = '<div class="market-empty">加载回收站...</div>';
    let list = [];
    try { list = await invoke("list_trash"); }
    catch (e) { box.innerHTML = '<div class="market-empty">加载失败：' + escapeHtml(String(e)) + '</div>'; return; }
    box.innerHTML = "";
    if (!list || !list.length) { box.innerHTML = '<div class="market-empty">回收站为空</div>'; return; }
    list.forEach(t => {
      const card = document.createElement("div");
      card.className = "market-card";
      card.innerHTML = `
        <div class="mc-head">
          <span class="mc-name">${escapeHtml(t.title)}</span>
          <span class="status-badge badge-off" title="${escapeHtml(t.workspace)}">${escapeHtml(t.workspace || "未知工作区")}</span>
        </div>
        <div class="mc-meta">ID: ${escapeHtml(t.id)} · ${fmtTime(t.deleted_ms)} · ${(t.size / 1024).toFixed(1)}KB</div>
        <div class="cc-actions" style="margin-top:8px">
          <button class="btn-small" data-act="restore" data-id="${escapeHtml(t.id)}">恢复</button>
          <button class="btn-danger" data-act="purge" data-id="${escapeHtml(t.id)}">彻底删除</button>
        </div>`;
      box.appendChild(card);
    });
    box.querySelectorAll("button[data-act]").forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const id = b.dataset.id, act = b.dataset.act;
        if (act === "restore") {
          invoke("restore_session", { id })
            .then(() => { appendLog(`[回收站] 会话 ${id} 已恢复`, "log-ready"); renderTrash(); loadSessions(); })
            .catch(err => appendLog("[回收站] 恢复失败：" + err, "log-error"));
        } else if (act === "purge") {
          showConfirm("彻底删除", "确定彻底删除该会话吗？此操作不可恢复。", async () => {
            try { await invoke("purge_trash", { id }); appendLog(`[回收站] 会话 ${id} 已彻底删除`, "log-error"); renderTrash(); }
            catch (err) { appendLog("[回收站] 删除失败：" + err, "log-error"); }
          });
        }
      };
    });
  }

  /* ---------- 导出 Markdown ---------- */
  async function exportSession() {
    if (!currentSessionId) { showConfirm("导出会话", "请先选择左侧要导出的会话。", () => { }); return; }
    try {
      const blocks = await invoke("get_session", { id: currentSessionId, endpoint_id: ep().id });
      const roleName = { user: "用户", assistant: "助手", tool: "工具调用", result: "工具结果", info: "信息" };
      let md = `# ${currentSessionTitle}\n\n`;
      md += `- 会话 ID：${currentSessionId}\n- 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;
      (blocks || []).forEach(b => {
        md += `## ${roleName[b.kind] || b.kind || "内容"}\n\n${b.text || ""}\n\n`;
      });
      const p = await invoke("save_text_file", { defaultName: `session-${currentSessionId}.md`, content: md });
      if (p) appendLog(`[会话] 已导出：${p}`, "log-ready");
    } catch (e) { appendLog("导出会话失败：" + e, "log-error"); }
  }

  /* ---------- 初始化 ---------- */
  function init() {
    const refresh = $("btnRefreshSessions");
    if (refresh) refresh.addEventListener("click", loadSessions);
    const search = $("sessionSearch");
    if (search) search.addEventListener("keyup", e => { if (e.key === "Enter") searchSessions(); });
    const btnSearch = $("btnSearchSession");
    if (btnSearch) btnSearch.addEventListener("click", searchSessions);
    const btnDel = $("btnDeleteSession");
    if (btnDel) btnDel.addEventListener("click", () => {
      if (!currentSessionId) { showConfirm("删除会话", "请先选择左侧要删除的会话。", () => { }); return; }
      showConfirm("删除会话", "确定删除当前会话吗？会移入回收站，可恢复。", async () => {
        try {
          await invoke("delete_session", { id: currentSessionId, endpoint_id: ep().id });
          currentSessionId = null;
          const sd = $("sessionDetail");
          if (sd) sd.innerHTML = '<div class="session-empty">会话已移入回收站</div>';
          loadSessions();
          appendLog("[会话] 已删除并移入回收站", "log-stop");
        } catch (e) { appendLog("删除失败：" + e, "log-error"); }
      });
    });
    const btnExp = $("btnExportSession");
    if (btnExp) btnExp.addEventListener("click", exportSession);
    const btnTrash = $("btnOpenTrash");
    if (btnTrash) btnTrash.addEventListener("click", () => { const m = $("trashModal"); if (m) m.classList.add("show"); renderTrash(); });
    const tc = $("trashClose");
    if (tc) tc.addEventListener("click", () => { const m = $("trashModal"); if (m) m.classList.remove("show"); });
    const tr = $("trashRefresh");
    if (tr) tr.addEventListener("click", renderTrash);
    const te = $("trashEmpty");
    if (te) te.addEventListener("click", () => showConfirm("清空回收站", "确定清空回收站吗？所有已删除会话将被永久删除，不可恢复。", async () => {
      try { const n = await invoke("empty_trash"); appendLog(`[回收站] 已清空 ${n} 个会话`, "log-error"); renderTrash(); }
      catch (err) { appendLog("[回收站] 清空失败：" + err, "log-error"); }
    }));
  }

  window.DSH = Object.assign(window.DSH || {}, {
    sessions: { init, load: loadSessions }
  });
})();
