
/* ============================================================
   Tauri 兼容层
   ============================================================ */
const HAS_TAURI = !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);
// 尚未在 DSH 官方能力中确认/未实现后端的功能：仅原型预览，Tauri 环境回退为空数据
const PROTO_CMDS = new Set([
  "reload_plugin",
  "get_plugin_config","set_plugin_config","import_local_plugin",
  "toggle_skill","get_skill_config","set_skill_config",
  "toggle_mcp","test_mcp","add_mcp","remove_mcp",
  "get_usage_stats","get_usage_limits","set_usage_limits",
  "export_config","import_config","reset_config",
  "list_endpoints","add_endpoint","update_endpoint","remove_endpoint","set_active_endpoint"
]);
async function invoke(cmd, args){
  if(HAS_TAURI){
    if(PROTO_CMDS.has(cmd)) return Promise.reject(new Error("该操作待接入 DSH 官方能力"));
    return window.__TAURI__.core.invoke(cmd, args);
  }
  return MOCK[cmd] ? MOCK[cmd](args) : Promise.resolve(null);
}
window.addEventListener("unhandledrejection", e => {
  const msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason);
  try { appendLog("操作待接入：" + msg, "log-stop"); } catch(_) {}
});

/* ===== 演示数据已剔除：浏览器预览仅返回空数据，不展示伪造内容 ===== */
const MOCK = {
  get_state: () => {
    const ep=currentEndpoint();
    return {status:"stopped",host:"127.0.0.1",port:ep.port,workspace:ep.workspace||"",
      url:`http://127.0.0.1:${ep.port}/`,dsh_home:ep.dshHome||"",dsh_path:ep.path};
  },
  start_harness: () => ({status:"starting"}),
  stop_harness: () => ({status:"stopped"}),
  list_plugins: () => [],
  list_skills: () => [],
  list_mcp: () => [],
  list_sessions: () => [],
  get_session: () => [],
  get_market: () => [],
  scan_wsl: () => [],
  list_endpoints: () => [],
  get_usage_stats: () => null,
  get_usage_limits: () => null,
  get_dsh_settings: () => null
};


/* ============================================================
   多端管理（核心新增）
   ============================================================ */
const EP_KEY="dsh_launcher_endpoints";
const DEFAULT_ENDPOINTS=[
  {id:"ep-win",name:"本地 Windows",type:"windows",path:"",port:7602,
   workspace:"",dshHome:"",version:"",status:"stopped",active:true,ssh:""}
];
let endpoints=loadEndpoints();

function loadEndpoints(){
  try{const d=JSON.parse(localStorage.getItem(EP_KEY)||"null");return d&&d.length?d:JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS))}
  catch(e){return JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS))}
}
function saveEndpoints(){localStorage.setItem(EP_KEY,JSON.stringify(endpoints))}
function currentEndpoint(){return endpoints.find(e=>e.active)||endpoints[0]}
function setActiveEndpoint(id){
  endpoints.forEach(e=>e.active=(e.id===id));
  saveEndpoints();
  updateEndpointUI();
  // 切换端后刷新所有数据
  const ep=currentEndpoint();
  $("urlInput").value=`http://127.0.0.1:${ep.port}/`;
  $("openUrlLink").textContent=`http://127.0.0.1:${ep.port}/`;
  appendLog(`[多端] 已切换到「${ep.name}」（${ep.type}，端口 ${ep.port}）`,"log-ready");
  if(document.querySelector('.tab-content[data-tab="session"]').classList.contains("active")){
    loadSessions();
  }
  if(document.querySelector('.tab-content[data-tab="capability"]').classList.contains("active")){
    capLoaded=false;
    loadCapabilityData();
  }
  if(launcherPrefs){
    launcherPrefs.endpoints = endpoints;
    invoke("set_launcher_prefs",{prefsJson:launcherPrefs}).catch(()=>{});
  }
}

function typeLabel(t){return t==="windows"?"Windows":t==="wsl"?"WSL":"SSH 远程（待开发）"}
function typeTagClass(t){return t==="windows"?"tag-builtin":t==="wsl"?"tag-wsl":"tag-ssh"}

function updateEndpointUI(){
  const ep=currentEndpoint();
  $("epName").textContent=ep.name;
  $("epDot").style.background=ep.status==="running"?"var(--success-green)":ep.status==="error"?"var(--error-red)":"#999";
  // 下拉列表
  const dd=$("endpointDropdown");
  dd.innerHTML=endpoints.map(e=>`
    <div class="ep-item ${e.active?"active":""}" data-id="${escapeHtml(e.id)}">
      <span>${escapeHtml(e.name)}</span>
      <span class="ep-type">${escapeHtml(typeLabel(e.type))}</span>
    </div>`).join("")+`<div class="ep-manage" id="epManageBtn">管理多端设置...</div>`;
  dd.querySelectorAll(".ep-item").forEach(item=>{
    item.onclick=()=>{setActiveEndpoint(item.dataset.id);dd.classList.remove("show")};
  });
  $("epManageBtn").onclick=()=>{dd.classList.remove("show");openSettings();switchSettingsSection("endpoints")};
}

function renderEndpointList(){
  const box=$("endpointList");
  box.innerHTML="";
  endpoints.forEach(e=>{
    const card=document.createElement("div");
    card.className="endpoint-card"+(e.active?" active":"");
    const statusCls=e.status==="running"?"badge-on":e.status==="error"?"badge-err":"badge-off";
    const statusTxt=e.status==="running"?"运行中":e.status==="error"?"异常":e.status==="unknown"?"未知":"已停止";
    card.innerHTML=`
      <div class="ec-head">
        <div><span class="ec-name">${escapeHtml(e.name)}</span>
          <span class="ec-type ${typeTagClass(e.type)}">${escapeHtml(typeLabel(e.type))}</span>
          ${e.active?'<span class="ec-type tag-builtin">当前</span>':""}</div>
        <span class="status-badge ${statusCls}">${statusTxt}</span>
      </div>
      <div class="ec-meta">
        类型：${escapeHtml(typeLabel(e.type))}${e.distro?`（${escapeHtml(e.distro)}）`:""}${e.ssh?` · ${escapeHtml(e.ssh)}`:""}<br>
        DSH 路径：${escapeHtml(e.path)}<br>
        端口：${escapeHtml(String(e.port))} · 版本：${escapeHtml(e.version||"未检测")}<br>
        工作目录：${escapeHtml(e.workspace||"未设置")}
      </div>
      <div class="ec-actions">
        ${e.active?"":`<button class="btn-small" data-act="activate" data-id="${escapeHtml(e.id)}">切换到此端</button>`}
        <button class="btn-small" data-act="edit" data-id="${escapeHtml(e.id)}">编辑</button>
        <button class="btn-small" data-act="ping" data-id="${escapeHtml(e.id)}">检测连通</button>
        ${e.type==="windows"?"":`<button class="btn-danger" data-act="remove" data-id="${escapeHtml(e.id)}">删除</button>`}
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.onclick=()=>{
      const id=btn.dataset.id,act=btn.dataset.act,e=endpoints.find(x=>x.id===id);
      if(act==="activate"){setActiveEndpoint(id);renderEndpointList()}
      else if(act==="edit"){showConfirm("编辑端",`编辑「${e.name}」配置（原型）。\n实际实现将弹出表单修改名称、路径、端口等。`,()=>{})}
      else if(act==="ping"){appendLog(`[多端] 检测 ${e.name} 连通性...`,"log-start");
        invoke("ping_endpoint",{endpoint:e}).then(status=>{
          e.status=status||"unknown";saveEndpoints();renderEndpointList();updateEndpointUI();
          appendLog(`[多端] ${e.name} ${status==="error"?"不可达":status==="running"?"运行中":"可达"}`,"log-ready");
        }).catch(()=>{e.status="error";saveEndpoints();renderEndpointList();appendLog(`[多端] ${e.name} 检测失败`,"log-error")})}
      else if(act==="remove"){showConfirm("删除端",`确定要删除端「${e.name}」吗？该端的会话与配置不会被删除，仅从管理列表移除。`,()=>{
        endpoints=endpoints.filter(x=>x.id!==id);if(e.active&&endpoints.length)endpoints[0].active=true;saveEndpoints();renderEndpointList();updateEndpointUI();
      })}
    };
  });
}

$("btnScanEndpoints")?.addEventListener("click",async()=>{
  appendLog("[多端] 正在扫描 WSL 子系统中的 DSH...","log-start");
  const found=await invoke("scan_terminals");
  let added=0;
  found.forEach(f=>{
    if(!f.path){
      appendLog(`[多端] ${f.name} 未检测到 WSL 原生 dsh，已跳过（仅接受 WSL 内安装的 dsh）`,"log-stop");
      return;
    }
    if(!endpoints.some(e=>e.distro===f.distro)){
      endpoints.push({id:"ep-wsl-"+Date.now()+Math.random().toString(36).slice(2,6),
        name:f.name,type:"wsl",distro:f.distro,path:f.path,port:7600+endpoints.length,
        workspace:"~",dshHome:"~/.config/dsh-launcher/harness",version:f.version,status:"stopped",active:false,ssh:""});
      added++;
    }
  });
  saveEndpoints();renderEndpointList();
  appendLog(`[多端] 扫描完成，新增 ${added} 个 WSL 端`,"log-ready");
});
$("btnRefreshEndpoints")?.addEventListener("click",()=>{renderEndpointList();appendLog("[多端] 端状态已刷新","log-stop")});
$("newEpType")?.addEventListener("change",function(){$("sshFields").style.display=this.value==="ssh"?"flex":"none"});
$("btnAddEndpoint")?.addEventListener("click",()=>{
  const name=$("newEpName").value.trim(),type=$("newEpType").value,path=$("newEpPath").value.trim();
  if(type==="ssh"){showConfirm("提示","SSH 远程端暂待开发：DSH 目前不能安全地直接暴露到公网，本版本不提供远程端点。",()=>{});return}
  if(!name||!path){showConfirm("提示","请填写端名称和 DSH 路径。",()=>{});return}
  endpoints.push({id:"ep-"+Date.now(),name,type,path,port:+$("newEpPort").value||7602,
    workspace:$("newEpWorkspace").value.trim(),dshHome:"~/.config/dsh-launcher/harness",
    version:"未检测",status:"stopped",active:false,ssh:type==="ssh"?$("newEpSsh").value.trim():"",
    distro:type==="wsl"?"自定义":""});
  saveEndpoints();renderEndpointList();updateEndpointUI();
  $("newEpName").value="";$("newEpPath").value="";$("newEpWorkspace").value="";$("newEpSsh").value="";
  appendLog(`[多端] 已添加端「${name}」`,"log-ready");
});

// 端切换器下拉
$("endpointBtn").onclick=e=>{e.stopPropagation();$("endpointDropdown").classList.toggle("show")};
document.addEventListener("click",()=>$("endpointDropdown").classList.remove("show"));

/* ============================================================
   全局状态 & 工具
   ============================================================ */
let dshRunning=false;
let logLines=0;
let currentSessionId=null;
let currentSessionTitle="";

function $(id){return document.getElementById(id)}
function escapeHtml(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function appendLog(text,cls){
  const box=$("logContent");const s=document.createElement("span");
  if(cls)s.className=cls;s.textContent=text+"\n";
  box.appendChild(s);box.scrollTop=box.scrollHeight;logLines++;
  $("logLineCount").textContent=logLines;
}
// 把 pnpm / dsh 的原始输出翻译成用户能看懂的中文进度行；返回 null 表示忽略该行
function translatePluginLine(body){
  if(/^Progress:/.test(body)){
    const done=/done/.test(body);
    const n=(body.match(/resolved\s+(\d+)/)||[])[1]||"?";
    const d=(body.match(/downloaded\s+(\d+)/)||[])[1]||"0";
    return done?`✅ 依赖解析完成（共解析 ${n} 个包）`:`⏳ 依赖进度：已解析 ${n} 个包（下载 ${d}）`;
  }
  if(/^Packages:/.test(body))return `✅ 依赖变更：${body.replace(/^Packages:/,"").trim()}`;
  if(body.includes("node_modules/")&&/(install|build)\$/.test(body)){
    const pkg=(body.split("node_modules/")[1]||"").split(/[\/ ]/)[0]||"?";
    return `🔨 构建脚本：${pkg}`;
  }
  if(body.includes("git-hosted plugins build on install"))return "⚠️ git 源插件构建脚本被 pnpm 拦截（可在确认弹窗中放行后自动重试）";
  if(body.startsWith("dsh: pnpm failed"))return "❌ pnpm 安装失败，原因见下方输出";
  if(body.includes("Lockfile passes"))return null;
  if(body.trim().startsWith("[WARN]"))return null;
  return body;
}
// 把安装失败的错误摘要翻译成人话；无法识别返回 null
function explainInstallError(msg){
  if(msg.includes("Failed to connect")||msg.includes("Couldn't connect")||msg.includes("connect timed out"))return "网络无法连接 GitHub（请检查网络或加速器后重试）";
  if(msg.includes("UNABLE_TO_VERIFY")||msg.includes("local issuer certificate"))return "SSL 证书验证失败（加速器/代理证书未被信任：请关闭加速器，或为 git 导入其 CA 证书）";
  if(msg.includes("ENOTFOUND"))return "DNS 解析失败（请检查网络）";
  if(msg.includes("ETIMEDOUT"))return "连接超时（请检查网络或加速器）";
  if(msg.includes("ERR_PNPM_GIT_RESOLVE_FAILED"))return "GitHub 仓库解析失败（多为网络问题）";
  if(msg.includes("ENOENT"))return "缺少依赖工具（如 git/pnpm），请确认已安装";
  return null;
}
function updateStatus(running,starting){
  const dot=$("statusDot"),txt=$("statusText");
  dot.className="status-dot"+(starting?" starting":running?" running":"");
  txt.textContent=starting?"DSH 启动中...":running?"DSH 运行中":"DSH 未运行";
  $("btnStart").disabled=running||starting;$("btnStop").disabled=!running;
  const ep=currentEndpoint();if(running)ep.status="running";else if(!starting)ep.status="stopped";
}
function showConfirm(title,msg,onOk){
  $("confirmTitle").textContent=title;$("confirmMsg").textContent=msg;
  $("confirmModal").classList.add("show");
  $("confirmOk").onclick=()=>{$("confirmModal").classList.remove("show");onOk&&onOk()};
  $("confirmCancel").onclick=()=>$("confirmModal").classList.remove("show");
}
function fmtTime(ms){const d=new Date(ms);return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}

/* ============================================================
   主 Tab 切换
   ============================================================ */
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.onclick=()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
    document.querySelector(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add("active");
    if(btn.dataset.tab==="session")loadSessions();
    if(btn.dataset.tab==="capability"&&!capLoaded){loadCapabilityData()}
  };
});

/* 能力中心子 Tab */
document.querySelectorAll('.capability-wrap .sub-tab-btn').forEach(btn=>{
  btn.onclick=()=>{
    const wrap=btn.closest(".capability-wrap");
    wrap.querySelectorAll(".sub-tab-btn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    wrap.querySelectorAll(".sub-tab-content").forEach(c=>c.classList.remove("active"));
    wrap.querySelector(`.sub-tab-content[data-sub="${btn.dataset.sub}"]`).classList.add("active");
  };
});

/* ============================================================
   设置抽屉 + 可拖拽拉伸
   ============================================================ */
function openSettings(){
  $("settingsMask").classList.add("show");
  $("settingsDrawer").classList.add("show");
  renderEndpointList();
}
function closeSettings(){
  $("settingsMask").classList.remove("show");
  $("settingsDrawer").classList.remove("show");
}
function switchSettingsSection(sec){
  document.querySelectorAll(".settings-nav .nav-item").forEach(n=>n.classList.remove("active"));
  document.querySelector(`.settings-nav .nav-item[data-sec="${sec}"]`).classList.add("active");
  document.querySelectorAll(".settings-section").forEach(s=>s.classList.remove("active"));
  document.querySelector(`.settings-section[data-sec="${sec}"]`).classList.add("active");
}
$("btnOpenSettings").onclick=openSettings;
$("settingsClose").onclick=closeSettings;
$("settingsMask").onclick=closeSettings;

document.querySelectorAll(".settings-nav .nav-item").forEach(item=>{
  item.onclick=()=>{
    document.querySelectorAll(".settings-nav .nav-item").forEach(n=>n.classList.remove("active"));
    item.classList.add("active");
    document.querySelectorAll(".settings-section").forEach(s=>s.classList.remove("active"));
    document.querySelector(`.settings-section[data-sec="${item.dataset.sec}"]`).classList.add("active");
    if(item.dataset.sec==="runtime"){refreshUsage();loadDshSettings();loadCordis()}
    if(item.dataset.sec==="endpoints")renderEndpointList();
    if(item.dataset.sec==="about")loadEnvInfo();
  };
});

/* 抽屉拖拽拉伸 */
const DRAWER_KEY="dsh_launcher_drawer_width";
let savedDrawerWidth=parseInt(localStorage.getItem(DRAWER_KEY)||"440");
if(savedDrawerWidth<320)savedDrawerWidth=320;
if(savedDrawerWidth>760)savedDrawerWidth=760;
document.documentElement.style.setProperty("--drawer-width",savedDrawerWidth+"px");
$("drawerWidthLabel").textContent=savedDrawerWidth+"px";

let isDragging=false,dragStartX=0,dragStartWidth=0;
$("dragHandle").addEventListener("mousedown",e=>{
  isDragging=true;dragStartX=e.clientX;
  dragStartWidth=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--drawer-width"))||440;
  $("dragHandle").classList.add("dragging");
  document.body.style.cursor="ew-resize";
  document.body.style.userSelect="none";
  e.preventDefault();
});
document.addEventListener("mousemove",e=>{
  if(!isDragging)return;
  // 抽屉在右侧，向左拖增大宽度
  let newWidth=dragStartWidth+(dragStartX-e.clientX);
  newWidth=Math.max(320,Math.min(760,newWidth));
  document.documentElement.style.setProperty("--drawer-width",newWidth+"px");
  $("drawerWidthLabel").textContent=newWidth+"px";
});
document.addEventListener("mouseup",()=>{
  if(!isDragging)return;
  isDragging=false;
  $("dragHandle").classList.remove("dragging");
  document.body.style.cursor="";
  document.body.style.userSelect="";
  const w=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--drawer-width"));
  localStorage.setItem(DRAWER_KEY,w.toString());
});

/* ============================================================
   看板娘配置
   ============================================================ */
const KANBAN_KEY="dsh_launcher_kanban";
const DEFAULT_KANBAN={enabled:true,width:340,opacity:0.38,position:"rb",avoid:false,customSrc:"",x:null,y:null};
let kanbanCfg=loadKanban();
function loadKanban(){try{return {...DEFAULT_KANBAN,...JSON.parse(localStorage.getItem(KANBAN_KEY)||"{}")}}catch(e){return {...DEFAULT_KANBAN}}}
function saveKanban(){localStorage.setItem(KANBAN_KEY,JSON.stringify(kanbanCfg))}
function applyKanban(){
  const img=$("kanbanImg");
  img.classList.toggle("hidden",!kanbanCfg.enabled);
  if(kanbanCfg.x!=null){
    img.style.right="auto";img.style.bottom="auto";img.style.left=kanbanCfg.x+"px";img.style.top=kanbanCfg.y+"px";
  }else{
    img.style.left="";img.style.top="";img.style.right="";img.style.bottom="";
    img.classList.toggle("lb",kanbanCfg.position==="lb");
  }
  document.documentElement.style.setProperty("--kanban-width",kanbanCfg.width+"px");
  document.documentElement.style.setProperty("--kanban-opacity",kanbanCfg.opacity);
  document.documentElement.style.setProperty("--kanban-bottom",kanbanCfg.avoid?"64px":"24px");
  if(kanbanCfg.customSrc)img.src=kanbanCfg.customSrc;
  $("swKanban").classList.toggle("on",kanbanCfg.enabled);
  $("kanbanSize").value=kanbanCfg.width;$("kanbanSizeVal").textContent=kanbanCfg.width+"px";
  $("kanbanOpacity").value=Math.round(kanbanCfg.opacity*100);$("kanbanOpacityVal").textContent=kanbanCfg.opacity.toFixed(2);
  $("kanbanPosition").value=kanbanCfg.position;
  $("swKanbanAvoid").classList.toggle("on",kanbanCfg.avoid);
}
$("kanbanImg").addEventListener("error",()=>{$("kanbanImg").style.display="none"});
$("swKanban").onclick=function(){kanbanCfg.enabled=!kanbanCfg.enabled;saveKanban();applyKanban()};
$("kanbanSize").oninput=function(){kanbanCfg.width=+this.value;$("kanbanSizeVal").textContent=this.value+"px";applyKanban()};
$("kanbanSize").onchange=saveKanban;
$("kanbanOpacity").oninput=function(){kanbanCfg.opacity=+this.value/100;$("kanbanOpacityVal").textContent=kanbanCfg.opacity.toFixed(2);applyKanban()};
$("kanbanOpacity").onchange=saveKanban;
$("kanbanPosition").onchange=function(){kanbanCfg.position=this.value;kanbanCfg.x=null;kanbanCfg.y=null;saveKanban();applyKanban()};
$("swKanbanAvoid").onclick=function(){kanbanCfg.avoid=!kanbanCfg.avoid;saveKanban();applyKanban()};
$("btnKanbanReset").onclick=function(){kanbanCfg={...DEFAULT_KANBAN};saveKanban();applyKanban();appendLog("[启动器] 看板娘已恢复默认设置","log-stop")};
$("btnKanbanPick").onclick=async function(){
  if(HAS_TAURI){const path=await invoke("pick_file",{filters:[{name:"图片",extensions:["png","jpg","jpeg"]}]});if(path){kanbanCfg.customSrc=path;saveKanban();applyKanban()}}
  else{const input=document.createElement("input");input.type="file";input.accept="image/*";
    input.onchange=e=>{const f=e.target.files[0];if(f){const r=new FileReader();r.onload=ev=>{kanbanCfg.customSrc=ev.target.result;saveKanban();applyKanban()};r.readAsDataURL(f)}};input.click()}
};

/* 看板娘拖拽定位 + 锁定 */
let kanbanEditing=false,kanbanDragging=false,kanbanDragOffset={x:0,y:0};
$("btnEditKanbanPos").onclick=function(){
  kanbanEditing=true;
  $("kanbanImg").classList.add("draggable");
  appendLog("[启动器] 看板娘可自由拖拽，拖到合适位置后点击“确定位置”锁定","log-stop");
};
$("btnLockKanbanPos").onclick=function(){
  kanbanEditing=false;kanbanDragging=false;
  $("kanbanImg").classList.remove("draggable");
  saveKanban();
  appendLog("[启动器] 看板娘位置已锁定","log-ready");
};
$("kanbanImg").addEventListener("pointerdown",e=>{
  if(!kanbanEditing)return;
  kanbanDragging=true;
  const r=$("kanbanImg").getBoundingClientRect();
  kanbanDragOffset={x:e.clientX-r.left,y:e.clientY-r.top};
  e.preventDefault();
});
window.addEventListener("pointermove",e=>{
  if(!kanbanDragging)return;
  kanbanCfg.x=Math.max(0,Math.round(e.clientX-kanbanDragOffset.x));
  kanbanCfg.y=Math.max(0,Math.round(e.clientY-kanbanDragOffset.y));
  applyKanban();
});
window.addEventListener("pointerup",()=>{kanbanDragging=false});

/* 通用偏好真实接线 */
const DEFAULT_LAUNCHER_PREFS={endpoints:[],close_behavior:"tray",single_instance:true,remember_window:true,auto_start:false,auto_open_browser:false,always_on_top:false,ui_zoom:1,ui_zoom_locked:false,port_policy:"takeover",save_log:true,log_retention_days:15,window:{x:null,y:null,width:960,height:720}};
let launcherPrefs = null;
function setSwitch(id,on){const el=$(id);if(el)el.classList.toggle("on",!!on)}
function isSwitchOn(id){return !!($(id)&&$(id).classList.contains("on"))}
async function loadLauncherPrefs(){
  try{launcherPrefs=await invoke("get_launcher_prefs")}
  catch(e){launcherPrefs={close_behavior:"tray",single_instance:true,remember_window:true,auto_start:false,auto_open_browser:false,always_on_top:false,ui_zoom:1,ui_zoom_locked:false,port_policy:"takeover",save_log:true,log_retention_days:15}}
  $("closeBehavior").value=launcherPrefs.close_behavior||"tray";
  $("launchBehavior").value=launcherPrefs.auto_start?"auto":"manual";
  setSwitch("swAutoBrowser",!!launcherPrefs.auto_open_browser);
  setSwitch("swRememberWin",launcherPrefs.remember_window!==false);
  setSwitch("swAlwaysOnTop",!!launcherPrefs.always_on_top);
  setSwitch("swSaveLog",launcherPrefs.save_log!==false);
  $("logRetention").value=String(launcherPrefs.log_retention_days||15);
  $("portPolicy").value=launcherPrefs.port_policy||"takeover";
  setSwitch("swSingleInstance",true);
  $("swSingleInstance").classList.add("locked");
  $("swSingleInstance").title="当前版本固定开启，避免多实例";
  applyUiZoom();
}
async function saveLauncherPrefs(){
  if(!launcherPrefs)return;
  launcherPrefs.endpoints = endpoints;
  launcherPrefs.auto_start=$("launchBehavior").value==="auto";
  launcherPrefs.auto_open_browser=isSwitchOn("swAutoBrowser");
  launcherPrefs.close_behavior=$("closeBehavior").value;
  launcherPrefs.remember_window=isSwitchOn("swRememberWin");
  launcherPrefs.always_on_top=isSwitchOn("swAlwaysOnTop");
  launcherPrefs.ui_zoom=parseInt($("uiZoom")?.value||"100")/100;
  launcherPrefs.ui_zoom_locked=isSwitchOn("swLockZoom");
  launcherPrefs.save_log=isSwitchOn("swSaveLog");
  launcherPrefs.log_retention_days=parseInt($("logRetention").value||"15");
  launcherPrefs.port_policy=$("portPolicy").value;
  launcherPrefs.single_instance=true;
  try{await invoke("set_launcher_prefs",{prefsJson:launcherPrefs})}catch(e){appendLog("保存偏好失败："+e,"log-error")}
}
function applyUiZoom(){
  const z=(launcherPrefs&&typeof launcherPrefs.ui_zoom==="number"&&launcherPrefs.ui_zoom>0)?launcherPrefs.ui_zoom:1;
  document.documentElement.style.setProperty("--ui-zoom",String(z));
  if($("uiZoom"))$("uiZoom").value=Math.round(z*100);
  if($("uiZoomVal"))$("uiZoomVal").textContent=Math.round(z*100)+"%";
  const locked=!!(launcherPrefs&&launcherPrefs.ui_zoom_locked);
  setSwitch("swLockZoom",locked);
  if($("uiZoom"))$("uiZoom").disabled=locked;
}
$("uiZoom").addEventListener("input",function(){
  document.documentElement.style.setProperty("--ui-zoom",String(+this.value/100));
  $("uiZoomVal").textContent=this.value+"%";
});
$("uiZoom").addEventListener("change",function(){launcherPrefs.ui_zoom=+this.value/100;saveLauncherPrefs()});
$("swLockZoom").addEventListener("click",()=>{
  const on=!isSwitchOn("swLockZoom");setSwitch("swLockZoom",on);$("uiZoom").disabled=on;
  launcherPrefs.ui_zoom_locked=on;saveLauncherPrefs();
});
$("btnResetZoom").addEventListener("click",()=>{
  launcherPrefs.ui_zoom=1;launcherPrefs.ui_zoom_locked=false;
  document.documentElement.style.setProperty("--ui-zoom","1");
  applyUiZoom();saveLauncherPrefs();appendLog("[缩放] 已恢复默认 100%","log-stop");
});
$("closeBehavior").addEventListener("change",saveLauncherPrefs);
$("launchBehavior").addEventListener("change",saveLauncherPrefs);
$("logRetention").addEventListener("change",saveLauncherPrefs);
$("portPolicy").addEventListener("change",saveLauncherPrefs);
$("swAutoBrowser").addEventListener("click",()=>{setSwitch("swAutoBrowser",!isSwitchOn("swAutoBrowser"));saveLauncherPrefs()});
$("swRememberWin").addEventListener("click",()=>{setSwitch("swRememberWin",!isSwitchOn("swRememberWin"));saveLauncherPrefs()});
$("swSaveLog").addEventListener("click",()=>{setSwitch("swSaveLog",!isSwitchOn("swSaveLog"));saveLauncherPrefs()});
$("swAlwaysOnTop").addEventListener("click",async()=>{
  const on=!isSwitchOn("swAlwaysOnTop");setSwitch("swAlwaysOnTop",on);launcherPrefs.always_on_top=on;
  try{await invoke("set_always_on_top",{enabled:on});appendLog(on?"[启动器] 已开启窗口置顶":"[启动器] 已关闭窗口置顶","log-stop")}
  catch(e){appendLog("设置窗口置顶失败："+e,"log-error")}
});
$("swAutoStart").addEventListener("click",async()=>{
  const on=!isSwitchOn("swAutoStart");setSwitch("swAutoStart",on);
  try{await invoke("set_autostart",{enabled:on});appendLog(on?"[启动器] 已开启开机自启动":"[启动器] 已关闭开机自启动","log-ready")}
  catch(e){appendLog("设置开机自启动失败："+e,"log-error")}
});

/* ============================================================
   DSH 启停
   ============================================================ */
$("btnStart").onclick=async function(){
  updateStatus(false,true);
  const ep=currentEndpoint();
  appendLog(`正在启动「${ep.name}」的 DSH 基座（端口 ${ep.port}）...`,"log-start");
  try{
    await invoke("start_harness",{port:ep.port,endpoint_id:ep.id,endpoint:ep});
    if(!HAS_TAURI){
      setTimeout(()=>{
        appendLog(`DSH Web 服务就绪：http://127.0.0.1:${ep.port}/`,"log-ready");
        appendLog("自动加载 DSH 内置插件与已启用插件");
        updateStatus(true,false);dshRunning=true;
      },800);
    }
  }catch(e){
    appendLog("启动失败："+e,"log-error");
    if(String(e).includes("已被占用")){
      appendLog('[提示] 可在设置-启动行为中把端口占用策略改为"自动接管已有实例"，或先停止现有实例再启动',"log-stop");
    }
    updateStatus(false,false);
  }
};
$("btnStop").onclick=async function(){
  appendLog("正在终止 DSH 所有子进程...");
  try{await invoke("stop_harness",{endpoint_id:currentEndpoint().id});
    if(!HAS_TAURI){setTimeout(()=>{appendLog("DSH 基座已完全停止","log-stop");updateStatus(false,false);dshRunning=false},600)}
  }
  catch(e){appendLog("停止异常："+e,"log-error")}
};
$("btnForceStop").onclick=()=>{
  showConfirm("强制终止 DSH","将强制结束端口上的 DSH 进程（含非启动器托管的外部实例）。正在写入的会话可能被中断，请确认。",async()=>{
    appendLog("正在强制终止 DSH 所有进程（含外部实例）...","log-start");
    try{
      await invoke("stop_harness",{force:true,endpoint_id:currentEndpoint().id});
      appendLog("已执行强制终止","log-stop");
      if(!HAS_TAURI){updateStatus(false,false);dshRunning=false}
    }catch(e){appendLog("强制终止异常："+e,"log-error")}
  });
};
$("clearLog").onclick=()=>{$("logContent").innerHTML="";logLines=0;$("logLineCount").textContent="0"};
$("openUrlLink").onclick=()=>invoke("open_browser",{endpoint_id:currentEndpoint().id});
$("btnOpenBrowser").onclick=()=>invoke("open_browser",{endpoint_id:currentEndpoint().id});
$("btnOpenBrowserMain").onclick=()=>invoke("open_browser",{endpoint_id:currentEndpoint().id});
$("btnOpenLogDir").onclick=()=>invoke("open_logs_dir");
$("btnOpenLogDir2").onclick=()=>invoke("open_logs_dir");
async function copyToClipboard(text,label){
  if(!text){appendLog("[复制] 内容为空","log-stop");return}
  try{await invoke("copy_text",{text});appendLog(`[复制] ${label} 已复制到剪贴板`,"log-stop")}
  catch(e){appendLog(`[复制] 失败：${e}`,"log-error")}
}
$("btnCopyUrl").onclick=()=>copyToClipboard($("urlInput").value,"访问地址");
$("btnCopyVersion").onclick=()=>copyToClipboard($("dshVersionText").value.replace(/^检测中\.\.\.$/,"")||$("dshVersionText").value,"DSH 版本");
$("copyLog").onclick=async()=>{
  try{const t=await invoke("read_launcher_log");if(!t){appendLog("[复制] 日志为空","log-stop");return}await copyToClipboard(t,"启动器日志")}
  catch(e){appendLog("[复制] 读取日志失败："+e,"log-error")}
};
$("exportLog").onclick=async()=>{
  try{
    const t=await invoke("read_launcher_log");
    const p=await invoke("save_text_file",{defaultName:"dsh-launcher.log",content:t||""});
    if(p)appendLog(`[日志] 已导出：${p}`,"log-ready");
  }catch(e){appendLog("导出日志失败："+e,"log-error")}
};
async function loadDshVersion(){
  try{
    const v=await invoke("dsh_version");
    $("dshVersionText").value=v.version||"未知";
    if(v.path){
      $("dshVersionText").title=v.path;
      const dir=v.path.replace(/[\\/][^\\/]*$/,"");
      if($("dshInstallText"))$("dshInstallText").value=dir;
      if($("installPath"))$("installPath").textContent="安装目录："+dir;
    }
  }catch(e){$("dshVersionText").value="检测失败"}
}
async function checkDshUpdate(){
  const btn=$("btnCheckDshUpdate");if(btn){btn.disabled=true;btn.textContent="检查中..."}
  try{
    const r=await fetch("https://registry.npmjs.org/@deepseek-ai/dsh/latest");
    if(!r.ok)throw new Error("HTTP "+r.status);
    const d=await r.json();const latest=d.version;
    const inst=$("dshVersionText").value||"";
    if(!latest){appendLog("[DSH] 无法获取最新版本","log-error");if(btn){btn.disabled=false;btn.textContent="检查更新"}return}
    if(inst&&inst===latest){appendLog(`[DSH] 已是最新版本 ${latest}`,"log-ready");if(btn){btn.disabled=false;btn.textContent="已最新"}}
    else{
      appendLog(`[DSH] 检测到新版本：${inst||"未安装"} → ${latest}，点击「安装 / 更新 DSH」`,"log-stop");
      if(btn){btn.disabled=false;btn.textContent="检查更新"}
    }
  }catch(e){appendLog("[DSH] 检查更新失败："+e,"log-error");if(btn){btn.disabled=false;btn.textContent="检查更新"}}
}
$("btnCheckDshUpdate")?.addEventListener("click",checkDshUpdate);
$("btnInstallDsh")?.addEventListener("click",()=>{
  showConfirm("安装 / 更新 DSH","将通过 npm 全局安装最新版 @deepseek-ai/dsh，需要联网，可能需要几分钟。当前会话数据不受影响。",async()=>{
    const btn=$("btnInstallDsh");if(btn){btn.disabled=true;btn.textContent="安装中..."}
    appendLog("[DSH] 正在安装 / 更新 DSH 本体...","log-start");
    try{
      const r=await invoke("install_or_update_dsh");
      appendLog(`[DSH] ${r}`,"log-ready");
      await loadDshVersion();
      appendLog("[DSH] 更新完成，请重启 DSH 使新版本生效","log-stop");
    }catch(e){appendLog("[DSH] 安装/更新失败："+e,"log-error")}
    if(btn){btn.disabled=false;btn.textContent="安装 / 更新 DSH"}
  });
});
$("btnClearCache")?.addEventListener("click",()=>showConfirm("清空启动器缓存","确定清空启动器缓存吗？会重置偏好并清理日志，之后界面刷新。",async()=>{
  try{
    await invoke("clear_launcher_cache");
    localStorage.clear();
    appendLog("[缓存] 已清空，界面即将刷新","log-stop");
    setTimeout(()=>location.reload(),500);
  }catch(e){appendLog("清空失败："+e,"log-error")}
}));
$("btnHideTray").onclick=()=>invoke("hide_to_tray");
$("btnCopyInstall").onclick=()=>copyToClipboard($("dshInstallText")?.value||"","DSH 安装目录");

/* ============================================================
   会话管理
   ============================================================ */
function selectSessionItem(div){
  document.querySelectorAll(".session-item").forEach(x=>x.classList.remove("active"));
  if(div)div.classList.add("active");
}
async function loadSessions(){
  const list=await invoke("list_sessions",{filter:($("sessionSearch")?.value||""),endpoint_id:currentEndpoint().id});
  const box=$("sessionList");
  if(!list||!list.length){box.innerHTML='<div class="session-empty" style="padding:20px;text-align:center;font-size:12px">本机 Windows DSH 暂无会话记录</div>';return}
  box.innerHTML="";
  list.forEach(s=>{
    const div=document.createElement("div");div.className="session-item";
    div.innerHTML=`<div class="s-title">${escapeHtml(s.title||"未命名会话")}</div>
      <div class="s-meta">${escapeHtml(s.workspace||"")} · ${fmtTime(s.mtime_ms)} · ${(s.size/1024).toFixed(1)}KB</div>`;
    div.onclick=()=>{currentSessionTitle=s.title||"未命名会话";selectSessionItem(div);loadSessionDetail(s.id)};
    box.appendChild(div);
  });
}
$("btnRefreshSessions")?.addEventListener("click",loadSessions);
$("sessionSearch")?.addEventListener("keyup",e=>{if(e.key==="Enter")searchSessions()});
$("btnSearchSession")?.addEventListener("click",searchSessions);
async function searchSessions(){
  const q=($("sessionSearch")?.value||"").trim();
  const box=$("sessionList");
  if(!q){loadSessions();return}
  box.innerHTML='<div class="session-empty" style="padding:20px;text-align:center;font-size:12px">正在全文检索...</div>';
  let hits=[];
  try{hits=await invoke("search_sessions",{query:q,limit:80})}
  catch(e){box.innerHTML='<div class="session-empty" style="padding:20px;text-align:center;font-size:12px">搜索失败：'+escapeHtml(String(e))+'</div>';return}
  box.innerHTML="";
  if(!hits||!hits.length){box.innerHTML='<div class="session-empty" style="padding:20px;text-align:center;font-size:12px">没有匹配「'+escapeHtml(q)+'」的会话内容</div>';return}
  hits.forEach(h=>{
    const div=document.createElement("div");div.className="session-item";
    div.innerHTML=`<div class="s-title">${escapeHtml(h.title)}</div>
      <div class="s-meta">${escapeHtml(h.workspace||"")} · ${fmtTime(h.mtime_ms)}</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:5px;line-height:1.45">${escapeHtml(h.snippet)}</div>`;
    div.onclick=()=>{currentSessionTitle=h.title;selectSessionItem(div);loadSessionDetail(h.id)};
    box.appendChild(div);
  });
}
$("btnDeleteSession")?.addEventListener("click",()=>{
  if(!currentSessionId){showConfirm("删除会话","请先选择左侧要删除的会话。",()=>{});return}
  showConfirm("删除会话","确定删除当前会话吗？会移入回收站，可恢复。",async()=>{
    try{
      await invoke("delete_session",{id:currentSessionId,endpoint_id:currentEndpoint().id});
      currentSessionId=null;
      $("sessionDetail").innerHTML='<div class="session-empty">会话已移入回收站</div>';
      loadSessions();
      appendLog("[会话] 已删除并移入回收站","log-stop");
    }catch(e){appendLog("删除失败："+e,"log-error")}
  });
});
$("btnExportSession")?.addEventListener("click",async()=>{
  if(!currentSessionId){showConfirm("导出会话","请先选择左侧要导出的会话。",()=>{});return}
  try{
    const blocks=await invoke("get_session",{id:currentSessionId,endpoint_id:currentEndpoint().id});
    const roleName={user:"用户",assistant:"助手",tool:"工具调用",result:"工具结果",info:"信息"};
    let md=`# ${currentSessionTitle}\n\n`;
    md+=`- 会话 ID：${currentSessionId}\n- 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;
    (blocks||[]).forEach(b=>{
      md+=`## ${roleName[b.kind]||b.kind||"内容"}\n\n${b.text||""}\n\n`;
    });
    const p=await invoke("save_text_file",{defaultName:`session-${currentSessionId}.md`,content:md});
    if(p)appendLog(`[会话] 已导出：${p}`,"log-ready");
  }catch(e){appendLog("导出会话失败："+e,"log-error")}
});
async function loadSessionDetail(id){
  currentSessionId=id;
  const blocks=await invoke("get_session",{id,endpoint_id:currentEndpoint().id});
  const box=$("sessionDetail");
  if(!blocks||!blocks.length){box.innerHTML='<div class="session-empty">无法加载会话内容</div>';return}
  box.innerHTML=`<div style="margin-bottom:10px;font-size:12px;color:var(--text-secondary)">会话 ID：${escapeHtml(id)}（端：${escapeHtml(currentEndpoint().name)}）</div>`;
  blocks.forEach(b=>{const d=document.createElement("div");d.className="msg "+(b.kind==="user"?"user":b.kind==="tool"?"tool":"assistant");d.textContent=b.text;box.appendChild(d)});
}

/* ============================================================
   会话回收站
   ============================================================ */
async function renderTrash(){
  const box=$("trashBody");box.innerHTML='<div class="market-empty">加载回收站...</div>';
  let list=[];
  try{list=await invoke("list_trash")}catch(e){box.innerHTML='<div class="market-empty">加载失败：'+escapeHtml(String(e))+'</div>';return}
  box.innerHTML="";
  if(!list||!list.length){box.innerHTML='<div class="market-empty">回收站为空</div>';return}
  list.forEach(t=>{
    const card=document.createElement("div");card.className="market-card";
    card.innerHTML=`
      <div class="mc-head">
        <span class="mc-name">${escapeHtml(t.title)}</span>
        <span class="status-badge badge-off" title="${escapeHtml(t.workspace)}">${escapeHtml(t.workspace||"未知工作区")}</span>
      </div>
      <div class="mc-meta">ID: ${escapeHtml(t.id)} · ${fmtTime(t.deleted_ms)} · ${(t.size/1024).toFixed(1)}KB</div>
      <div class="cc-actions" style="margin-top:8px">
        <button class="btn-small" data-act="restore" data-id="${escapeHtml(t.id)}">恢复</button>
        <button class="btn-danger" data-act="purge" data-id="${escapeHtml(t.id)}">彻底删除</button>
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll("button[data-act]").forEach(b=>{
    b.onclick=e=>{
      e.stopPropagation();const id=b.dataset.id,act=b.dataset.act;
      if(act==="restore"){
        invoke("restore_session",{id}).then(()=>{appendLog(`[回收站] 会话 ${id} 已恢复`,"log-ready");renderTrash();loadSessions()}).catch(err=>appendLog("[回收站] 恢复失败："+err,"log-error"));
      }else if(act==="purge"){
        showConfirm("彻底删除","确定彻底删除该会话吗？此操作不可恢复。",async()=>{
          try{await invoke("purge_trash",{id});appendLog(`[回收站] 会话 ${id} 已彻底删除`,"log-error");renderTrash()}
          catch(err){appendLog("[回收站] 删除失败："+err,"log-error")}
        });
      }
    };
  });
}
$("btnOpenTrash")?.addEventListener("click",()=>{$("trashModal").classList.add("show");renderTrash()});
$("trashClose")?.addEventListener("click",()=>$("trashModal").classList.remove("show"));
$("trashRefresh")?.addEventListener("click",renderTrash);
$("trashEmpty")?.addEventListener("click",()=>showConfirm("清空回收站","确定清空回收站吗？所有已删除会话将被永久删除，不可恢复。",async()=>{
  try{const n=await invoke("empty_trash");appendLog(`[回收站] 已清空 ${n} 个会话`,"log-error");renderTrash()}
  catch(err){appendLog("[回收站] 清空失败："+err,"log-error")}
}));

/* ============================================================
   插件管理
   ============================================================ */
let pluginData=[],skillData=[],mcpData=[];
let capLoaded=false;
async function fetchPlugins(){try{pluginData=await invoke("list_plugins",{endpoint_id:currentEndpoint().id})}catch(e){pluginData=[]}}
async function fetchSkills(){try{skillData=await invoke("list_skills",{endpoint_id:currentEndpoint().id})}catch(e){skillData=[]}}
async function fetchMcp(){try{mcpData=await invoke("list_mcp",{endpoint_id:currentEndpoint().id})}catch(e){mcpData=[]}}
async function loadCapabilityData(){
  await Promise.all([fetchPlugins(),fetchSkills(),fetchMcp()]);
  renderPlugins();renderSkills();renderMcp();
  capLoaded=true;
}
let selectedPlugins=new Set();
let pluginDir=1;
function updatePluginDirBtn(){const b=$("btnPluginDir");if(b)b.textContent=pluginDir===1?"升序":"降序"}
function filteredPluginList(){
  const kw=($("pluginSearch")?.value||"").toLowerCase();
  const kindFilter=$("pluginKindFilter")?.value||"";
  const statusFilter=$("pluginStatusFilter")?.value||"";
  const sortKey=$("pluginSort")?.value||"";
  let list=pluginData.filter(p=>{
    if(kw&&!((p.name||"").toLowerCase().includes(kw)||(p.id||"").toLowerCase().includes(kw)))return false;
    if(kindFilter&&p.kind!==kindFilter)return false;
    if(statusFilter==="enabled"&&!p.enabled)return false;
    if(statusFilter==="disabled"&&p.enabled)return false;
    return true;
  });
  const kindOrder={builtin:0,extension:1,selfdev:2};
  const dir=pluginDir;
  if(sortKey==="name")list=list.slice().sort((a,b)=>dir*(a.name||"").localeCompare(b.name||""));
  else if(sortKey==="version")list=list.slice().sort((a,b)=>dir*String(a.version||"").localeCompare(String(b.version||""),undefined,{numeric:true}));
  else if(sortKey==="author")list=list.slice().sort((a,b)=>dir*(a.author||"").localeCompare(b.author||""));
  else if(sortKey==="kind")list=list.slice().sort((a,b)=>dir*((kindOrder[a.kind]??9)-(kindOrder[b.kind]??9)));
  else list=list.slice().sort((a,b)=>dir*(((kindOrder[a.kind]??9)-(kindOrder[b.kind]??9))||(a.name||"").localeCompare(b.name||"")));
  return list;
}
function updatePluginBatchBar(){
  const bar=$("pluginBatchBar"),count=$("pluginBatchCount");
  if(!bar)return;
  if(selectedPlugins.size>0){bar.style.display="flex";count.textContent=selectedPlugins.size}
  else{bar.style.display="none";count.textContent="0"}
}
function renderPlugins(){
  const box=$("pluginList");box.innerHTML="";
  if(!pluginData||!pluginData.length){box.innerHTML='<div class="session-empty">暂无插件（可在「插件市场」安装，或「导入本地」目录）</div>';updatePluginBatchBar();return}
  const kindLabel={builtin:"内置",extension:"扩展",selfdev:"自研"};
  const kindCls={builtin:"tag-builtin",extension:"tag-third",selfdev:"tag-wsl"};
  const list=filteredPluginList();
  list.forEach(p=>{
    const card=document.createElement("div");card.className="cap-card";
    const tagCls=kindCls[p.kind]||"tag-third";
    // 模板内置 bundle（source=bundle）无行级启停入口，disable 条目对 bundle 行无效，
    // 不显示无效按钮；npm 本家扩展（source=npm）可正常启停。
    const canToggle=(p.kind==="extension"||p.source==="local"||(p.kind==="builtin"&&p.source==="npm"));
    const canUninstall=(p.kind==="extension"&&p.source!=="preset")||p.source==="local";
    const canCheck=p.kind==="extension"&&p.source==="npm";
    const canRegister=p.kind==="extension"&&p.source==="npm"&&!p.enabled;
    card.innerHTML=`
      <div class="cc-head">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <input type="checkbox" class="plugin-check" data-id="${escapeHtml(p.id)}" ${selectedPlugins.has(p.id)?"checked":""} title="选择">
          <span class="cc-name">${escapeHtml(p.name)}</span><span class="cc-ver">${p.version?"v"+escapeHtml(p.version):""}</span>
          <span class="cc-tag ${tagCls}">${kindLabel[p.kind]||"插件"}</span>
        </div>
        <span class="status-badge ${p.enabled?"badge-on":"badge-off"}">${p.enabled?"已启用":"已禁用"}</span>
      </div>
      <div class="cc-desc">${escapeHtml(p.desc)}</div>
      <div class="cc-meta">ID: ${escapeHtml(p.id)}${p.author?` · 作者: ${escapeHtml(p.author)}`:""}${p.kind==="builtin"?" · 本家 @deepseek-ai":""}${p.kind==="builtin"&&p.source==="bundle"?" · 内置 bundle，跟随 DSH 发行版":""}${p.skills&&p.skills.length?` · 技能: ${p.skills.map(escapeHtml).join(", ")}`:""}</div>
      <div class="cc-actions">
        ${canToggle?`<button class="btn-small" data-act="toggle" data-id="${escapeHtml(p.id)}">${p.enabled?"禁用":"启用"}</button>`:""}
        ${canCheck?`<button class="btn-small" data-act="check" data-id="${escapeHtml(p.id)}">检查更新</button>`:""}
        ${canRegister?`<button class="btn-small" data-act="register" data-id="${escapeHtml(p.id)}">注册</button>`:""}
        ${p.dir?`<button class="btn-small" data-act="open" data-id="${escapeHtml(p.id)}">打开目录</button>`:""}
        ${canUninstall?`<button class="btn-danger" data-act="uninstall" data-id="${escapeHtml(p.id)}">卸载</button>`:""}
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll("input.plugin-check").forEach(cb=>{
    cb.onclick=e=>{
      e.stopPropagation();
      const id=cb.dataset.id;
      if(cb.checked)selectedPlugins.add(id);else selectedPlugins.delete(id);
      updatePluginBatchBar();
    };
  });
  box.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.onclick=async e=>{
      e.stopPropagation();const id=btn.dataset.id,act=btn.dataset.act,p=pluginData.find(x=>x.id===id);
      if(act==="toggle"){
        const next=!p.enabled;
        const tip=p.kind==="builtin"?"（本家组件，禁用后可能影响 DSH 功能；写入后会自动做配置校验）":(p.kind==="extension"?"（扩展插件；写入后会自动做配置校验）":"");
        showConfirm("启用/禁用插件",`确定要${next?"启用":"禁用"}「${p.name}」吗？${tip}`,async()=>{
          try{await invoke("set_plugin_enabled",{id,enabled:next});appendLog(`[插件] ${id} ${next?"已启用":"已禁用"}，重启 DSH 后生效`,"log-ready");await fetchPlugins();renderPlugins()}
          catch(err){appendLog(`[插件] 操作失败：${err}`,"log-error")}
        });
      }
      else if(act==="check"){await checkPluginUpdate(p,btn)}
      else if(act==="register"){
        try{const r=await invoke("register_plugin",{id});appendLog(`[插件] ${r}`,"log-ready");await fetchPlugins();renderPlugins()}
        catch(err){appendLog(`[插件] 注册失败：${err}`,"log-error")}
      }
      else if(act==="update"){
        btn.disabled=true;btn.textContent="更新中...";
        try{const r=await invoke("install_market_plugin",{target:p.id});appendLog(`[插件] ${p.name} 已更新：${r}`,"log-ready");await fetchPlugins();renderPlugins()}
        catch(err){appendLog(`[插件] 更新失败：${err}`,"log-error");btn.disabled=false;btn.textContent="重试更新"}
      }
      else if(act==="open"){
        try{await invoke("open_plugin_folder",{id})}catch(err){appendLog(`打开目录失败：${err}`,"log-error")}
      }
      else if(act==="uninstall"){
        showConfirm("卸载插件",`确定要卸载插件「${p.name}」吗？${p.source==="local"?"将删除本地目录并移除注册，重启 DSH 后生效。":"将调用 pnpm 卸载依赖。"}`,async()=>{
          try{const r=await invoke("remove_plugin",{id});selectedPlugins.delete(id);appendLog(`[插件] ${r}`,"log-ready");await fetchPlugins();renderPlugins()}
          catch(err){appendLog(`[插件] 卸载失败：${err}`,"log-error")}
        });
      }
    };
  });
  updatePluginBatchBar();
}
async function checkPluginUpdate(p,btn){
  btn.disabled=true;btn.textContent="检查中...";
  try{
    const r=await fetch(`https://registry.npmjs.org/${encodeURIComponent(p.id)}/latest`);
    if(!r.ok)throw new Error("HTTP "+r.status);
    const d=await r.json();const latest=d.version;
    if(!latest){appendLog(`[更新] ${p.name} 无版本信息`,"log-stop");btn.disabled=false;btn.textContent="检查更新";return}
    const inst=p.version||"";
    if(inst&&inst!==latest){
      appendLog(`[更新] ${p.name} ${inst} → ${latest}`,"log-stop");
      btn.dataset.act="update";btn.textContent="更新 "+latest;btn.disabled=false;
    }else{
      appendLog(`[更新] ${p.name} 已是最新 ${latest}`,"log-ready");
      btn.textContent="已最新";
    }
  }catch(e){appendLog(`[更新] ${p.name} 检查失败：${e}`,"log-error");btn.disabled=false;btn.textContent="检查更新"}
}
$("btnRefreshPlugin")?.addEventListener("click",async()=>{await fetchPlugins();renderPlugins()});
$("pluginSearch")?.addEventListener("input",renderPlugins);
$("pluginKindFilter")?.addEventListener("change",renderPlugins);
$("pluginStatusFilter")?.addEventListener("change",renderPlugins);
$("pluginSort")?.addEventListener("change",renderPlugins);
$("btnPluginDir")?.addEventListener("click",()=>{pluginDir=pluginDir===1?-1:1;updatePluginDirBtn();renderPlugins()});
updatePluginDirBtn();
$("btnSelectAllPlugins")?.addEventListener("click",()=>{
  const list=filteredPluginList();
  const allSelected=list.length>0&&list.every(p=>selectedPlugins.has(p.id));
  if(allSelected){selectedPlugins.clear()}else{list.forEach(p=>selectedPlugins.add(p.id))}
  renderPlugins();
});
document.querySelectorAll("#pluginBatchBar button[data-batch]").forEach(btn=>{
  btn.onclick=async()=>{
    const act=btn.dataset.batch;
    if(act==="clear"){selectedPlugins.clear();renderPlugins();return}
    const ids=Array.from(selectedPlugins);
    let ok=0,skip=0;
    for(const id of ids){
      const p=pluginData.find(x=>x.id===id);if(!p)continue;
      if(act==="enable"||act==="disable"){
        // 模板内置 bundle 无启停入口，跳过
        if(!(p.kind==="extension"||p.source==="local"||(p.kind==="builtin"&&p.source==="npm"))){skip++;continue}
        try{await invoke("set_plugin_enabled",{id,enabled:act==="enable"});ok++}
        catch(err){appendLog(`[批量] ${p.name} 失败：${err}`,"log-error")}
      }else if(act==="uninstall"){
        if(p.kind==="builtin"&&p.source!=="npm"){skip++;continue}
        try{await invoke("remove_plugin",{id});ok++}
        catch(err){appendLog(`[批量] ${p.name} 卸载失败：${err}`,"log-error")}
      }
    }
    appendLog(`[批量] ${act==="uninstall"?"卸载":(act==="enable"?"启用":"禁用")}完成：成功 ${ok}，跳过 ${skip}，重启 DSH 后生效`,"log-stop");
    selectedPlugins.clear();
    await fetchPlugins();renderPlugins();
  };
});
$("btnImportPlugin")?.addEventListener("click",async()=>{
  try{
    const p=await invoke("pick_workspace");
    if(!p)return;
    const name=await invoke("import_plugin",{path:p});
    appendLog(`[插件] 已导入并注册：${name}，重启 DSH 后生效`,"log-ready");
    await fetchPlugins();renderPlugins();
  }catch(e){appendLog("导入插件失败："+e,"log-error")}
});

/* 插件市场（v2：借鉴主流插件市场设计重设计——发现货架 + 分类侧栏 + 安装状态机 + 详情抽屉） */
const MARKET_URL="https://awesome-dsh-plugin.com/plugins.json";
const MARKET_CACHE_KEY="dsh_market_cache_v2";
const MARKET_TTL=10*60*1000;                 // 缓存有效期：10 分钟
const MARKET_VIEW_KEY="dsh_market_view_v2";
const MARKET_CAT_KEY="dsh_market_cat_v2";
const MARKET_RECENT_KEY="dsh_market_recent_v2";
let marketData=[];
let marketCategories={};
let marketLoading=false;
let marketCacheAge=0;                        // 缓存时间戳（ms）
let marketOffline=false;                     // 最近一次在线拉取是否失败
let marketView="discover";                   // discover | all | installed | update
let marketCat="";                            // 侧栏分类筛选
let marketSort="combo";                      // combo | stars | added | name
let marketSource="";                         // "" | npm | github
let marketSearchKw="";
let marketInstalling=new Set();              // 安装中的目标（防重复点击）
let marketRecent=loadMarketRecent();
let marketHeroIndex=0;
let marketHeroTimer=null;
let marketDetailOpen=false;
let marketDetailName="";
let marketSearchTimer=null;
let marketStateCache=null;                   // 已装插件映射缓存（名称→本地插件）
function loadMarketRecent(){
  try{const a=JSON.parse(localStorage.getItem(MARKET_RECENT_KEY)||"[]");return Array.isArray(a)?a:[]}
  catch(e){return []}
}
function saveMarketRecent(){try{localStorage.setItem(MARKET_RECENT_KEY,JSON.stringify(marketRecent.slice(0,12)))}catch(e){}}
function recordMarketRecent(name){
  if(!name)return;
  marketRecent=marketRecent.filter(n=>n!==name);
  marketRecent.unshift(name);
  saveMarketRecent();
}
function marketTarget(m){
  if(m.install){const parts=m.install.trim().split(/\s+/);if(parts.length)return parts[parts.length-1]}
  return m.npm||m.name;
}
function marketInstalledMap(){
  const map=new Map();
  (pluginData||[]).forEach(p=>{
    if(p.id)map.set(String(p.id).toLowerCase(),p);
    if(p.name)map.set(String(p.name).toLowerCase(),p);
  });
  return map;
}
function refreshMarketStateCache(){marketStateCache=marketInstalledMap()}
function cmpVersion(a,b){
  const pa=String(a||"").replace(/^v/,"").split(".").map(n=>parseInt(n,10)||0);
  const pb=String(b||"").replace(/^v/,"").split(".").map(n=>parseInt(n,10)||0);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){
    const x=pa[i]||0,y=pb[i]||0;
    if(x!==y)return x>y?1:-1;
  }
  return 0;
}
function marketState(m){
  const im=marketStateCache||marketInstalledMap();
  const installed=!!(m.installed||im.has(String(m.name||"").toLowerCase())||(m.npm&&im.has(String(m.npm).toLowerCase())));
  let update=false,localVersion="";
  if(installed){
    const local=im.get(String(m.name||"").toLowerCase())||(m.npm?im.get(String(m.npm).toLowerCase()):null);
    if(local&&local.version)localVersion=local.version;
    if(m.version&&localVersion&&cmpVersion(m.version,localVersion)>0)update=true;
  }
  return {installed,update,localVersion};
}
function marketDesc(m){
  if(!m.description)return "";
  return m.description.zh||m.description.en||"";
}
function marketCategoryZh(m){
  const c=marketCategories[m.category];
  return c?(c.zh||c.en||m.category):(m.category||"");
}
function marketMaxStars(){
  let max=0;
  (marketData||[]).forEach(m=>{const s=m.stars||0;if(s>max)max=s});
  return max;
}
function starsNorm(m,max){
  if(max<=0)return 0;
  return Math.log1p(m.stars||0)/Math.log1p(max);
}
function daysSinceAdded(m){
  if(!m.added)return 9999;
  const t=Date.parse(m.added);
  return isNaN(t)?9999:(Date.now()-t)/86400000;
}
function comboScore(m,max){
  // 综合排序：热度（星标对数归一化）60% + 时效（指数衰减）40%，npm 可安装小幅加成
  const rec=Math.exp(-daysSinceAdded(m)/180);
  return +(0.6*starsNorm(m,max)+0.4*rec+(m.npm?0.05:0)).toFixed(4);
}
const REC_CAT_WEIGHT={
  session:1.0,memory:0.9,tools:0.9,skill:0.9,workflow:0.8,model:0.7,
  ui:0.6,notify:0.6,dev:0.5,usage:0.4,vision:0.4,market:0.3,theme:0.2,fun:0.1
};
function interestProfile(){
  // 从已装插件构建分类兴趣画像：某分类装的越多，权重越高
  const prof=new Map();
  const im=marketInstalledMap();
  (marketData||[]).forEach(m=>{
    if(!m.category)return;
    const installed=im.has(String(m.name||"").toLowerCase())||(m.npm&&im.has(String(m.npm).toLowerCase()));
    if(installed)prof.set(m.category,(prof.get(m.category)||0)+1);
  });
  return prof;
}
function profileMatch(m,prof){
  if(!prof||!prof.size)return 0;
  const base=prof.get(m.category)||0;
  let max=0;prof.forEach(v=>{if(v>max)max=v});
  return max?base/max:0;
}
function recScore(m,max,prof){
  const cat=REC_CAT_WEIGHT[m.category]!=null?REC_CAT_WEIGHT[m.category]:0.3;
  const rec=Math.exp(-daysSinceAdded(m)/180);
  const hasProf=!!(prof&&prof.size);
  if(hasProf){
    // 个性化推荐：兴趣匹配 30% + 分类基础 25% + 热度 30% + 时效 15%
    return +(0.30*profileMatch(m,prof)+0.25*cat+0.30*starsNorm(m,max)+0.15*rec).toFixed(4);
  }
  // 通用推荐：分类相关度 45% + 热度 35% + 时效 20%
  return +(0.45*cat+0.35*starsNorm(m,max)+0.20*rec).toFixed(4);
}
function recommendMarket(max,prof){
  return (marketData||[]).slice().sort((a,b)=>recScore(b,max,prof)-recScore(a,max,prof)).slice(0,12);
}
function marketRelatedToInstalled(){
  // 与已装插件同分类、且尚未安装的高分插件
  const im=marketInstalledMap();
  const cats=new Set();
  (marketData||[]).forEach(m=>{
    if(im.has(String(m.name||"").toLowerCase())||(m.npm&&im.has(String(m.npm).toLowerCase())))cats.add(m.category);
  });
  const max=marketMaxStars();
  return (marketData||[]).filter(m=>{
    if(!cats.has(m.category))return false;
    return !marketState(m).installed;
  }).sort((a,b)=>comboScore(b,max)-comboScore(a,max));
}
/* 搜索高亮：先按原始文本定位命中区间，再逐段转义，避免实体错位 */
function hlText(s,kw){
  const raw=String(s==null?"":s);
  if(!kw)return escapeHtml(raw);
  const low=raw.toLowerCase(),k=kw.toLowerCase();
  let out="",idx=0,pos=low.indexOf(k);
  while(pos!==-1){
    out+=escapeHtml(raw.slice(idx,pos))+'<span class="mk-hl">'+escapeHtml(raw.slice(pos,pos+k.length))+'</span>';
    idx=pos+k.length;
    pos=low.indexOf(k,idx);
  }
  out+=escapeHtml(raw.slice(idx));
  return out;
}
function marketFlags(){
  const max=marketMaxStars();
  const sorted=(marketData||[]).slice().sort((a,b)=>comboScore(b,max)-comboScore(a,max));
  return {
    hot:new Set(sorted.slice(0,10).map(m=>m.name)),
    pick:new Set(recommendMarket(max,interestProfile()).slice(0,5).map(m=>m.name))
  };
}
function mkTagsHTML(m,flags){
  let html="";
  if(flags&&flags.pick&&flags.pick.has(m.name))html+='<span class="mk-tag mk-tag-pick">精选</span>';
  if(flags&&flags.hot&&flags.hot.has(m.name))html+='<span class="mk-tag mk-tag-hot">热门</span>';
  if(daysSinceAdded(m)<30)html+='<span class="mk-tag mk-tag-new">新</span>';
  return html;
}
function mkInstallBtnHTML(m,st){
  if(marketInstalling.has(marketTarget(m))){
    return '<button class="btn-small mk-install-btn" data-act="install" data-name="'+escapeHtml(m.name)+'" disabled>安装中...</button>';
  }
  if(st.installed&&st.update){
    return '<button class="btn-small mk-install-btn update" data-act="install" data-name="'+escapeHtml(m.name)+'" title="市场有新版本可用">更新</button>';
  }
  if(st.installed){
    return '<button class="btn-small mk-install-btn installed" data-act="noop" disabled>已安装</button>';
  }
  return '<button class="btn-primary mk-install-btn" data-act="install" data-name="'+escapeHtml(m.name)+'">安装</button>';
}
function mkCardHTML(m,flags,opts){
  const st=marketState(m);
  const catZh=marketCategoryZh(m);
  const avatar='https://github.com/'+encodeURIComponent(m.owner||'')+'.png';
  const initial=(m.owner||"?").trim().charAt(0).toUpperCase();
  const card=document.createElement("div");
  card.className="mk-card";
  card.dataset.mname=String(m.name||"");
  card.innerHTML=`
    <div class="mc2-head">
      <div class="mk-avatar"><img src="${escapeHtml(avatar)}" loading="lazy" alt=""></div>
      <div style="min-width:0;flex:1">
        <div class="mk-name"><span>${hlText(m.name||"未命名插件",marketSearchKw)}</span>${mkTagsHTML(m,flags)}</div>
        <div class="mk-owner">@${escapeHtml(m.owner||"未知")}</div>
      </div>
    </div>
    <div class="mk-desc">${hlText(marketDesc(m)||"（暂无说明）",marketSearchKw)}</div>
    <div class="mk-foot">
      <div class="mk-stats">
        ${m.stars?'<span title="GitHub 星标">★ '+m.stars+'</span>':""}
        ${catZh?'<span>'+escapeHtml(catZh)+'</span>':""}
        <span>${m.npm?"npm":"GitHub"}</span>
      </div>
      <div class="mk-actions">${mkInstallBtnHTML(m,st)}</div>
    </div>`;
  const img=card.querySelector(".mk-avatar img");
  if(img)img.addEventListener("error",()=>{const p=img.parentNode;if(p)p.textContent=initial});
  card.addEventListener("click",e=>{
    if(e.target.closest("button"))return;
    openMarketDetail(m);
  });
  card.querySelectorAll("button[data-act='install']").forEach(b=>{
    b.onclick=e=>{e.stopPropagation();marketDoInstall(m,b)};
  });
  return card;
}
function setHeroIndex(i,skipReset){
  const total=document.querySelectorAll("#marketHero .mk-hero-item").length;
  if(!total)return;
  marketHeroIndex=((i%total)+total)%total;
  const track=$("marketHeroTrack");
  if(track)track.style.transform=`translateX(-${marketHeroIndex*100}%)`;
  document.querySelectorAll("#marketHero .mk-hero-dot").forEach((d,idx)=>d.classList.toggle("active",idx===marketHeroIndex));
  if(!skipReset)startHeroAuto();
}
function startHeroAuto(){
  stopHeroAuto();
  marketHeroTimer=setInterval(()=>{
    const total=document.querySelectorAll("#marketHero .mk-hero-item").length;
    if(total>1)setHeroIndex(marketHeroIndex+1);
  },6000);
}
function stopHeroAuto(){
  if(marketHeroTimer){clearInterval(marketHeroTimer);marketHeroTimer=null}
}
function renderHero(){
  const box=$("marketHero");if(!box)return;
  const max=marketMaxStars();
  const prof=interestProfile();
  const items=recommendMarket(max,prof).slice(0,5);
  if(!items.length){box.style.display="none";return}
  box.style.display="";
  box.innerHTML="";
  const track=document.createElement("div");track.className="mk-hero-track";track.id="marketHeroTrack";
  items.forEach(m=>{
    const st=marketState(m);
    const catZh=marketCategoryZh(m);
    const avatar='https://github.com/'+encodeURIComponent(m.owner||'')+'.png';
    const initial=(m.owner||"?").trim().charAt(0).toUpperCase();
    const item=document.createElement("div");item.className="mk-hero-item";
    item.innerHTML=`
      <div class="mk-hero-avatar"><img src="${escapeHtml(avatar)}" loading="lazy" alt=""></div>
      <div class="mk-hero-body">
        <div class="mk-hero-name">${hlText(m.name||"未命名插件",marketSearchKw)}<span class="mk-hero-badge">精选</span></div>
        <div class="mk-hero-meta">@${escapeHtml(m.owner||"未知")}${m.stars?' · ★ '+m.stars:""}${catZh?" · "+escapeHtml(catZh):""}${m.npm?" · npm":" · GitHub"}</div>
        <div class="mk-hero-desc">${hlText(marketDesc(m)||"（暂无说明）",marketSearchKw)}</div>
      </div>
      <div class="mk-hero-actions">
        ${mkInstallBtnHTML(m,st)}
        <button class="btn-small" data-act="detail">详情</button>
      </div>`;
    const img=item.querySelector("img");
    if(img)img.addEventListener("error",()=>{const p=img.parentNode;if(p)p.textContent=initial});
    item.querySelectorAll("button[data-act='install']").forEach(b=>{b.onclick=e=>{e.stopPropagation();marketDoInstall(m,b)}});
    item.querySelector("button[data-act='detail']").onclick=e=>{e.stopPropagation();openMarketDetail(m)};
    track.appendChild(item);
  });
  box.appendChild(track);
  const prev=document.createElement("button");prev.className="mk-hero-arrow prev";prev.innerHTML="&#8249;";
  const next=document.createElement("button");next.className="mk-hero-arrow next";next.innerHTML="&#8250;";
  const dots=document.createElement("div");dots.className="mk-hero-dots";
  items.forEach((_,i)=>{
    const d=document.createElement("button");d.className="mk-hero-dot"+(i===0?" active":"");d.dataset.i=i;
    d.onclick=()=>setHeroIndex(i);
    dots.appendChild(d);
  });
  box.appendChild(prev);box.appendChild(next);box.appendChild(dots);
  prev.onclick=()=>setHeroIndex(marketHeroIndex-1);
  next.onclick=()=>setHeroIndex(marketHeroIndex+1);
  box.onmouseenter=stopHeroAuto;
  box.onmouseleave=startHeroAuto;
  setHeroIndex(0,true);
  startHeroAuto();
}
function renderShelves(){
  const box=$("marketShelves");if(!box)return;
  box.innerHTML="";
  const max=marketMaxStars();
  const prof=interestProfile();
  const flags=marketFlags();
  const sections=[];
  const hot=(marketData||[]).slice().sort((a,b)=>comboScore(b,max)-comboScore(a,max)).slice(0,10);
  if(hot.length)sections.push({title:"热门插件",note:"综合热度排序",items:hot});
  const fresh=(marketData||[]).filter(m=>daysSinceAdded(m)<120).sort((a,b)=>(b.added||"").localeCompare(a.added||"")).slice(0,8);
  if(fresh.length)sections.push({title:"最新上架",note:"近 4 个月添加",items:fresh});
  const rec=recommendMarket(max,prof).slice(0,10);
  if(rec.length)sections.push({title:"为你推荐",note:prof.size?"根据已装插件分类偏好生成":"综合推荐",items:rec});
  const rel=marketRelatedToInstalled().slice(0,10);
  if(rel.length)sections.push({title:"已装插件的同类",note:"同分类高分推荐",items:rel});
  const recent=marketRecent.map(n=>marketData.find(m=>String(m.name||"").toLowerCase()===String(n).toLowerCase())).filter(Boolean).slice(0,8);
  if(recent.length)sections.push({title:"最近浏览",note:"点击卡片查看详情",items:recent});
  if(!sections.length){
    box.innerHTML='<div class="market-empty">暂无推荐内容</div>';
    return;
  }
  sections.forEach(s=>{
    const sec=document.createElement("div");sec.className="mk-shelf";
    const head=document.createElement("div");head.className="mk-shelf-head";
    head.innerHTML='<span class="mk-shelf-title">'+escapeHtml(s.title)+'</span><span class="mk-shelf-note">'+escapeHtml(s.note||"")+'</span>';
    const row=document.createElement("div");row.className="mk-shelf-row";
    s.items.forEach(m=>row.appendChild(mkCardHTML(m,flags,{shelf:true})));
    sec.appendChild(head);sec.appendChild(row);
    box.appendChild(sec);
  });
}
function marketFilteredList(){
  const kw=marketSearchKw;
  let list=(marketData||[]).filter(m=>{
    if(marketCat&&m.category!==marketCat)return false;
    const st=marketState(m);
    if(marketView==="installed"&&!st.installed)return false;
    if(marketView==="update"&&(!st.installed||!st.update))return false;
    if(marketSource==="npm"&&!m.npm)return false;
    if(marketSource==="github"&&m.npm)return false;
    if(kw){
      const hay=String(m.name+" "+(m.owner||"")+" "+marketDesc(m)+" "+(m.npm||"")).toLowerCase();
      if(!hay.includes(kw))return false;
    }
    return true;
  });
  const max=marketMaxStars();
  if(marketSort==="stars")list=list.slice().sort((a,b)=>(b.stars||0)-(a.stars||0));
  else if(marketSort==="name")list=list.slice().sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  else if(marketSort==="added")list=list.slice().sort((a,b)=>(b.added||"").localeCompare(a.added||""));
  else list=list.slice().sort((a,b)=>comboScore(b,max)-comboScore(a,max));
  return list;
}
function renderGrid(){
  const body=$("marketBody");if(!body)return;
  const list=marketFilteredList();
  body.innerHTML="";
  if(!list.length){
    body.innerHTML='<div class="market-empty">'+(marketSearchKw?'没有找到与「'+escapeHtml(marketSearchKw)+'」匹配的插件':'该条件下暂无插件')+'</div>';
    return;
  }
  const flags=marketFlags();
  const frag=document.createDocumentFragment();
  list.forEach(m=>frag.appendChild(mkCardHTML(m,flags,{})));
  body.appendChild(frag);
}
function renderSidebar(){
  const box=$("marketCats");if(!box)return;
  box.innerHTML="";
  const cnt=new Map();let total=0;
  (marketData||[]).forEach(m=>{
    total++;
    if(m.category)cnt.set(m.category,(cnt.get(m.category)||0)+1);
  });
  const mk=function(k,label,n){
    const row=document.createElement("div");
    row.className="ms-cat"+(marketCat===k?" active":"");
    row.innerHTML='<span class="ms-name">'+escapeHtml(label)+'</span><span class="ms-cnt">'+n+'</span>';
    row.onclick=()=>{marketCat=k||"";localStorage.setItem(MARKET_CAT_KEY,marketCat);renderMarket()};
    box.appendChild(row);
  };
  mk("","全部",total);
  Object.keys(marketCategories||{}).forEach(k=>{
    const c=marketCategories[k];
    mk(k,(c&&(c.zh||c.en))||k,cnt.get(k)||0);
  });
  const foot=$("marketSideFoot");
  if(foot){
    let installed=0,upd=0;
    (marketData||[]).forEach(m=>{const st=marketState(m);if(st.installed){installed++;if(st.update)upd++}});
    foot.innerHTML='<div>已安装 <b style="color:var(--success-green)">'+installed+'</b></div>'+
      '<div>可更新 <b style="color:var(--error-red)">'+upd+'</b></div>'+
      '<div style="color:var(--text-secondary);font-size:10px">数据来源 awesome-dsh-plugin.com</div>';
  }
}
function renderStats(){
  const el=$("marketStats");if(!el)return;
  const n=(marketData||[]).length;
  if(!n){el.textContent="";return}
  let installed=0,upd=0;
  (marketData||[]).forEach(m=>{const st=marketState(m);if(st.installed){installed++;if(st.update)upd++}});
  el.textContent="共 "+n+" 个插件 · 已安装 "+installed+(upd?" · 可更新 "+upd:"");
}
function setMarketState(kind,text){
  const el=$("marketDataState");if(!el)return;
  el.className="mb-state"+(kind&&kind!=="ok"?" "+kind:"");
  el.textContent=text||"";
}
function updateMarketState(){
  if(marketLoading){setMarketState("","同步中...");return}
  if(marketOffline){setMarketState("offline","离线 · 使用缓存");return}
  if(marketData.length&&marketCacheAge){
    const age=Date.now()-marketCacheAge;
    const ago=age<60000?"刚刚":age<3600000?Math.round(age/60000)+" 分钟前":Math.round(age/3600000)+" 小时前";
    setMarketState("","数据 "+ago);
  }else{
    setMarketState("","");
  }
}
function saveMarketCache(){
  try{localStorage.setItem(MARKET_CACHE_KEY,JSON.stringify({t:Date.now(),plugins:marketData,categories:marketCategories}))}
  catch(e){}
}
function loadMarketCache(){
  try{
    const d=JSON.parse(localStorage.getItem(MARKET_CACHE_KEY)||"null");
    if(d&&Array.isArray(d.plugins)){
      marketData=d.plugins;marketCategories=d.categories||{};marketCacheAge=d.t||0;
      return true;
    }
  }catch(e){}
  return false;
}
async function loadMarket(force){
  if(marketLoading)return;
  marketLoading=true;
  updateMarketState();
  try{
    const resp=await fetch(MARKET_URL,{cache:force?"reload":"default"});
    if(!resp.ok)throw new Error("HTTP "+resp.status);
    const data=await resp.json();
    marketData=data.plugins||[];
    marketCategories=data.categories||{};
    marketCacheAge=Date.now();
    marketOffline=false;
    saveMarketCache();
    appendLog(`[市场] 已获取 ${marketData.length} 个社区插件`,"log-ready");
    renderMarket();
  }catch(err){
    marketOffline=true;
    const had=marketData.length>0;
    if(!had&&!loadMarketCache()){
      setMarketState("error","加载失败");
      const body=$("marketBody");
      if(body)body.innerHTML='<div class="market-empty">市场数据加载失败：'+escapeHtml(String(err))+'</div>';
      appendLog(`[市场] 加载失败：${err}`,"log-error");
    }else{
      setMarketState("offline","离线 · 使用缓存");
      appendLog(`[市场] 在线获取失败，回退本地缓存：${err}`,"log-stop");
      renderMarket();
    }
  }finally{
    marketLoading=false;
    updateMarketState();
  }
}
function syncTabs(){
  document.querySelectorAll("#marketTabs .mt-tab").forEach(t=>t.classList.toggle("active",t.dataset.view===marketView));
}
function openMarket(){
  const modal=$("marketModal");if(!modal)return;
  modal.classList.add("show");
  const v=localStorage.getItem(MARKET_VIEW_KEY);
  if(v==="all"||v==="installed"||v==="update")marketView=v;
  marketCat=localStorage.getItem(MARKET_CAT_KEY)||"";
  syncTabs();
  if(!marketData.length){
    if(!loadMarketCache()){
      setMarketState("","加载中...");
      const body=$("marketBody");
      if(body)body.innerHTML='<div class="market-empty">正在从 awesome-dsh-plugin.com 拉取市场数据...</div>';
      loadMarket(false);
    }else{
      renderMarket();
      loadMarket(false);
    }
  }else{
    renderMarket();
    if(Date.now()-marketCacheAge>MARKET_TTL&&!marketOffline)loadMarket(false);
  }
}
function closeMarket(){
  stopHeroAuto();
  closeMarketDetail();
  const modal=$("marketModal");
  if(modal)modal.classList.remove("show");
}
async function marketDoInstall(m,btn){
  const target=marketTarget(m);
  if(marketInstalling.has(target))return;
  marketInstalling.add(target);
  if(btn){btn.disabled=true;btn.innerHTML="安装中..."}
  appendLog(`[市场] 正在安装 ${m.name}（${target}）...`,"log-start");
  try{
    const r=await invoke("install_market_plugin",{target});
    appendLog(`[市场] 安装完成：${r}`,"log-ready");
    await fetchPlugins();renderPlugins();
    renderMarket();
    if(marketDetailOpen&&marketDetailName===m.name)openMarketDetail(m);
  }catch(err){
    const msg=String(err);
    // pnpm 构建白名单拦截：二次询问用户，确认后加入 allowBuilds 并自动重试
    const bm=msg.match(/__BUILD_BLOCKED__:([^\s\n]+)/);
    if(bm){
      const key=bm[1];
      appendLog(`[市场] ${m.name} 的构建脚本被 pnpm 白名单拦截（${key}）`,"log-stop");
      showConfirm("构建白名单确认",`插件「${m.name}」（${key}）需要执行构建脚本（prepare），pnpm 出于安全默认拦截。\n\n是否将 ${key} 加入 pnpm-workspace.yaml 的 allowBuilds 白名单，并自动重试安装？\n\n提示：构建脚本来自第三方插件，加入白名单即允许它在安装时执行。`,async()=>{
        try{
          await invoke("allow_builds",{pkg:key});
          appendLog(`[市场] ${key} 已加入构建白名单，自动重试安装...`,"log-stop");
          marketInstalling.delete(target);
          await marketDoInstall(m,btn);
        }catch(e2){
          appendLog(`[市场] 加入白名单失败：${e2}`,"log-error");
          renderMarket();
        }
      });
      return;
    }
    appendLog(`[市场] 安装失败：${msg}`,"log-error");
    const why=explainInstallError(msg);
    if(why)appendLog(`[市场] 原因：${why}`,"log-error");
    renderMarket();
  }finally{
    marketInstalling.delete(target);
  }
}
function marketDoUninstall(m){
  const target=marketTarget(m);
  showConfirm("卸载插件",`确定卸载「${m.name}」吗？卸载后可随时在市场中重新安装。`,async()=>{
    try{
      appendLog(`[市场] 正在卸载 ${m.name}...`,"log-start");
      const r=await invoke("uninstall_market_plugin",{target});
      appendLog(`[市场] 卸载完成：${r}`,"log-ready");
      await fetchPlugins();renderPlugins();
      renderMarket();
      if(marketDetailOpen&&marketDetailName===m.name)openMarketDetail(m);
    }catch(err){
      const umsg=String(err);
      appendLog(`[市场] 卸载失败：${umsg}`,"log-error");
      const uwhy=explainInstallError(umsg);
      if(uwhy)appendLog(`[市场] 原因：${uwhy}`,"log-error");
    }
  });
}
function marketDetailHTML(m){
  const st=marketState(m);
  const catZh=marketCategoryZh(m);
  const avatar='https://github.com/'+encodeURIComponent(m.owner||'')+'.png';
  const flags=marketFlags();
  const rel=(marketData||[]).filter(x=>x.category===m.category&&x.name!==m.name)
    .sort((a,b)=>comboScore(b,marketMaxStars())-comboScore(a,marketMaxStars())).slice(0,5);
  return `
  <div class="mk-detail-head">
    <span class="mkd-title">插件详情</span>
    <button class="settings-close" data-act="close" title="关闭">&times;</button>
  </div>
  <div class="mk-detail-body">
    <div class="mkd-top">
      <div class="mkd-avatar"><img src="${escapeHtml(avatar)}" loading="lazy" alt=""></div>
      <div style="min-width:0">
        <div class="mkd-name">${escapeHtml(m.name||"未命名插件")}${mkTagsHTML(m,flags)}</div>
        <div class="mkd-owner">@${escapeHtml(m.owner||"未知")}${m.stars?' · ★ '+m.stars:""}</div>
      </div>
    </div>
    <div class="mkd-tags">
      ${catZh?'<span class="mk-tag mk-tag-pick">'+escapeHtml(catZh)+'</span>':""}
      <span class="mk-tag ${m.npm?"mk-tag-hot":"mk-tag-new"}">${m.npm?"npm 可安装":"GitHub 源码"}</span>
      ${st.installed?`<span class="mk-tag mk-tag-new">已安装${st.localVersion?" v"+escapeHtml(st.localVersion):""}</span>`:""}
      ${st.update?'<span class="mk-tag mk-tag-update">可更新 v'+escapeHtml(m.version||"")+'</span>':""}
    </div>
    <div class="mkd-actions">
      ${mkInstallBtnHTML(m,st)}
      ${st.installed?'<button class="btn-danger" data-act="uninstall">卸载</button>':""}
      ${m.url?'<button class="btn-small" data-act="home" data-url="'+escapeHtml(m.url)+'">打开主页</button>':""}
    </div>
    <div class="mkd-section-title">简介</div>
    <div class="mkd-desc">${escapeHtml(marketDesc(m)||"（暂无说明）")}</div>
    <div class="mkd-section-title">信息</div>
    <div class="mkd-info-row"><span class="mkd-k">作者</span><span class="mkd-v">@${escapeHtml(m.owner||"未知")}</span></div>
    ${catZh?'<div class="mkd-info-row"><span class="mkd-k">分类</span><span class="mkd-v">'+escapeHtml(catZh)+'</span></div>':""}
    <div class="mkd-info-row"><span class="mkd-k">星标</span><span class="mkd-v">★ ${m.stars||0}</span></div>
    <div class="mkd-info-row"><span class="mkd-k">添加时间</span><span class="mkd-v">${escapeHtml(m.added||"未知")}</span></div>
    <div class="mkd-info-row"><span class="mkd-k">来源</span><span class="mkd-v">${m.npm?escapeHtml(m.npm):"GitHub"}</span></div>
    <div class="mkd-section-title">相关推荐</div>
    <div class="mkd-related">
      ${rel.length?rel.map(r=>`
        <div class="mkd-rel-item" data-act="related" data-name="${escapeHtml(r.name)}">
          <div style="min-width:0">
            <div class="mkd-rel-name">${escapeHtml(r.name)}</div>
            <div class="mkd-rel-meta">${escapeHtml(marketCategoryZh(r))}${r.stars?" · ★ "+r.stars:""} · ${r.npm?"npm":"GitHub"}</div>
          </div>
        </div>`).join(""):'<div style="font-size:12px;color:var(--text-secondary)">暂无同类插件</div>'}
    </div>
  </div>`;
}
function openMarketDetail(m){
  if(!m)return;
  marketDetailOpen=true;
  marketDetailName=m.name;
  recordMarketRecent(m.name);
  const d=$("marketDetail");if(!d)return;
  d.classList.add("open");
  d.innerHTML=marketDetailHTML(m);
  const img=d.querySelector(".mkd-avatar img");
  if(img)img.addEventListener("error",()=>{const p=img.parentNode;if(p)p.textContent=(m.owner||"?").trim().charAt(0).toUpperCase()});
  d.querySelectorAll("[data-act]").forEach(el=>{
    el.onclick=e=>{
      e.stopPropagation();
      const act=el.dataset.act;
      if(act==="close")closeMarketDetail();
      else if(act==="install")marketDoInstall(m,el);
      else if(act==="uninstall")marketDoUninstall(m);
      else if(act==="home"){const url=el.dataset.url;if(url)invoke("open_external",{url}).catch(err=>appendLog("打开链接失败："+err,"log-error"))}
      else if(act==="related"){const nm=el.dataset.name;const rm=marketData.find(x=>x.name===nm);if(rm)openMarketDetail(rm)}
    };
  });
}
function closeMarketDetail(){
  marketDetailOpen=false;
  marketDetailName="";
  const d=$("marketDetail");
  if(d)d.classList.remove("open");
}
function renderMarket(){
  refreshMarketStateCache();
  marketSearchKw=($("marketSearch")?.value||"").trim().toLowerCase();
  const sw=$("marketSearch");
  if(sw)sw.closest(".mb-search")?.classList.toggle("has-value",!!marketSearchKw);
  updateMarketState();
  renderSidebar();
  renderStats();
  const body=$("marketBody");
  if(body)body.innerHTML="";
  if(marketView==="discover"&&!marketCat&&!marketSearchKw){
    const hero=$("marketHero"),sh=$("marketShelves");
    if(hero)hero.style.display="";
    if(sh)sh.style.display="";
    renderHero();
    renderShelves();
    return;
  }
  stopHeroAuto();
  const hero=$("marketHero"),sh=$("marketShelves");
  if(hero)hero.style.display="none";
  if(sh)sh.style.display="none";
  renderGrid();
}
$("btnOpenMarket")?.addEventListener("click",openMarket);
$("marketClose")?.addEventListener("click",closeMarket);
$("marketModal")?.addEventListener("click",e=>{if(e.target===$("marketModal"))closeMarket()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("marketModal")?.classList.contains("show"))closeMarket()});
$("marketRefresh")?.addEventListener("click",()=>{appendLog("[市场] 正在刷新数据...","log-start");loadMarket(true)});
$("marketTabs")?.addEventListener("click",e=>{
  const tab=e.target.closest(".mt-tab");if(!tab)return;
  marketView=tab.dataset.view;
  localStorage.setItem(MARKET_VIEW_KEY,marketView);
  syncTabs();
  renderMarket();
});
$("marketSort")?.addEventListener("change",e=>{marketSort=e.target.value;renderMarket()});
$("marketSource")?.addEventListener("change",e=>{marketSource=e.target.value;renderMarket()});
$("marketSearch")?.addEventListener("input",()=>{clearTimeout(marketSearchTimer);marketSearchTimer=setTimeout(renderMarket,200)});
$("btnMarketClear")?.addEventListener("click",()=>{
  const s=$("marketSearch");
  if(s){s.value="";s.focus()}
  renderMarket();
});

/* ============================================================
   Skill 管理
   ============================================================ */
function renderSkills(){
  const sel=$("skillFilter");
  const prev=sel.value;
  sel.innerHTML='<option value="">全部插件</option>';
  [...new Set(skillData.map(s=>s.plugin))].filter(Boolean).forEach(p=>{const o=document.createElement("option");o.value=p;o.textContent=p;sel.appendChild(o)});
  sel.value=prev;
  const filter=sel.value,onlyOn=$("skillOnlyEnabled").checked;
  const box=$("skillList");
  box.innerHTML="";
  if(!skillData||!skillData.length){box.innerHTML='<div class="session-empty">未扫描到技能（Skill 是目录下带 frontmatter 的 SKILL.md，属于 DSH 原生技能体系）</div>';return}
  skillData.filter(s=>(!filter||s.plugin===filter)&&(!onlyOn||s.enabled)).forEach(s=>{
    const card=document.createElement("div");card.className="cap-card";
    card.innerHTML=`
      <div class="cc-head">
        <div><span class="cc-name">${escapeHtml(s.name)}</span><span class="cc-ver">${escapeHtml(s.plugin)}</span></div>
        <span class="status-badge ${s.enabled?"badge-on":"badge-off"}">${s.enabled?"已启用":"已禁用"}</span>
      </div>
      <div class="cc-desc">${escapeHtml(s.desc)}</div>
      <div class="cc-meta">ID: ${escapeHtml(s.id)}</div>
      <div class="cc-actions">
        <button class="btn-small" data-act="detail" data-id="${escapeHtml(s.id)}">详情</button>
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();const id=btn.dataset.id,act=btn.dataset.act,s=skillData.find(x=>x.id===id);
      if(act==="detail"){showConfirm("技能详情",`名称：${s.name}\n所属插件：${s.plugin}\n说明：${s.desc||"（无说明）"}`,()=>{})}
    };
  });
}
$("skillFilter")?.addEventListener("change",renderSkills);
$("skillOnlyEnabled")?.addEventListener("change",renderSkills);
$("btnRefreshSkill")?.addEventListener("click",async()=>{await fetchSkills();renderSkills()});

/* ============================================================
   MCP 管理
   ============================================================ */
function renderMcp(){
  const box=$("mcpList");box.innerHTML="";
  if(!mcpData||!mcpData.length){box.innerHTML='<div class="session-empty">暂无 MCP 服务</div>';return}
  mcpData.forEach(m=>{
    const card=document.createElement("div");card.className="cap-card";
    const badgeCls=m.status==="connected"?"badge-on":m.status==="error"?"badge-err":"badge-off";
    const badgeTxt=m.status==="connected"?"已连接":m.status==="error"?"连接异常":"未连接";
    card.innerHTML=`
      <div class="cc-head">
        <div><span class="cc-name">${escapeHtml(m.name)}</span><span class="cc-ver">${escapeHtml((m.protocol||"").toUpperCase())}</span></div>
        <span class="status-badge ${badgeCls}">${badgeTxt}</span>
      </div>
      <div class="cc-desc">${escapeHtml(m.desc)}</div>
      <div class="cc-meta">ID: ${escapeHtml(m.id)} · 端口: ${escapeHtml(m.port)} · 地址: ${escapeHtml(m.url)}</div>
      <div class="cc-actions">
        <button class="btn-small" data-act="toggle" data-id="${escapeHtml(m.id)}">${m.status==="connected"?"断开":"连接"}</button>
        <button class="btn-small" data-act="test" data-id="${escapeHtml(m.id)}">测试连接</button>
        <button class="btn-small" data-act="config" data-id="${escapeHtml(m.id)}">配置</button>
        <button class="btn-danger" data-act="remove" data-id="${escapeHtml(m.id)}">删除</button>
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll("button[data-act]").forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();const id=btn.dataset.id,act=btn.dataset.act,m=mcpData.find(x=>x.id===id);
      if(act==="toggle"){m.status=m.status==="connected"?"disconnected":"connected";renderMcp();appendLog(`[MCP] ${id} ${m.status==="connected"?"已连接":"已断开"}`,"log-ready")}
      else if(act==="test"){appendLog(`[MCP] 测试 ${id} 连接...`,"log-start");setTimeout(()=>{appendLog(`[MCP] ${id} 连接${m.status==="connected"?"正常":"失败"}`,m.status==="connected"?"log-ready":"log-error")},500)}
      else if(act==="config"){showConfirm("MCP 配置",`服务「${m.name}」配置面板（原型）。\n协议：${m.protocol}\n地址：${m.url}\n端口：${m.port}`,()=>{})}
      else if(act==="remove"){showConfirm("删除 MCP",`确定要删除 MCP 服务「${m.name}」吗？`,()=>{mcpData=mcpData.filter(x=>x.id!==id);renderMcp();appendLog(`[MCP] ${id} 已删除`,"log-error")})}
    };
  });
}
$("btnAddMcp")?.addEventListener("click",()=>showConfirm("添加 MCP","DSH 当前未暴露可编辑的原生 MCP 配置入口，此项暂待接入；MCP 能力通常由插件（plugin）暴露。",()=>{}));
$("btnRefreshMcp")?.addEventListener("click",async()=>{await fetchMcp();renderMcp()});
$("btnTestAllMcp")?.addEventListener("click",()=>appendLog("[MCP] 当前没有已接入的 MCP 服务，无法测试","log-stop"));

/* ============================================================
   运行与用量
   ============================================================ */
function refreshUsage(){
  $("usageToken").textContent="待接入";
  $("usageSession").textContent="待接入";
  $("usagePlugin").textContent="待接入";
  $("barToken").style.width="0%";
  $("barSession").style.width="0%";
  $("barPlugin").style.width="0%";
}
$("btnRefreshUsage")?.addEventListener("click",refreshUsage);
$("btnExportUsage")?.addEventListener("click",()=>appendLog("[用量] 用量统计尚未接入，无可导出数据","log-stop"));

async function loadDshSettings(){
  try{ $("dshSettingsText").value = await invoke("get_dsh_settings"); }
  catch(e){ $("dshSettingsText").value = "读取失败：" + e; }
}
$("btnReloadDshSettings")?.addEventListener("click",loadDshSettings);
$("btnSaveDshSettings")?.addEventListener("click",async()=>{
  try{
    await invoke("set_dsh_settings",{text:$("dshSettingsText").value});
    appendLog("[配置] settings.yaml 已保存，重启 DSH 后生效","log-ready");
  }catch(e){appendLog("保存失败："+e,"log-error")}
});
async function loadCordis(){
  try{ $("cordisPatchText").value = await invoke("get_cordis_patch"); }
  catch(e){ $("cordisPatchText").value = "读取失败：" + e; }
}
$("btnReloadCordis")?.addEventListener("click",loadCordis);
$("btnSaveCordis")?.addEventListener("click",async()=>{
  try{
    await invoke("set_cordis_patch",{text:$("cordisPatchText").value});
    appendLog("[配置] cordis.patch.yml 已保存，重启 DSH 后生效","log-ready");
  }catch(e){appendLog("保存失败："+e,"log-error")}
});
async function loadEnvInfo(){
  const box=$("envInfo");box.innerHTML='<div class="si-desc">加载中...</div>';
  let info={},version="";
  try{info=await invoke("get_env_info")}catch(e){box.innerHTML='<div class="si-desc">读取环境信息失败：'+escapeHtml(String(e))+'</div>';return}
  try{const v=await invoke("dsh_version");version=v.version||""}catch(e){}
  const rows=[
    {label:"DSH 路径",value:info.dsh_path||"未检测到",dir:null},
    {label:"DSH 版本",value:version||"未知",dir:null},
    {label:"DSH_HOME",value:info.dsh_home||"",dir:info.dsh_home||""},
    {label:"安装目录",value:info.install_dir||"",dir:info.install_dir||""},
    {label:"访问端口",value:String(info.port||7602),dir:null},
    {label:"日志目录",value:info.logs_dir||"",dir:info.logs_dir||""},
    {label:"会话目录",value:info.sessions_dir||"",dir:info.sessions_dir||""},
    {label:"启动器程序",value:info.exe_path||"",dir:info.exe_path?(info.exe_path.replace(/[\\/][^\\/]*$/,"")):null}
  ];
  box.innerHTML="";
  rows.forEach(r=>{
    const row=document.createElement("div");
    row.style.cssText="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px dashed var(--border-color)";
    const label=document.createElement("div");label.style.cssText="width:110px;flex:none;font-size:12px;color:var(--text-secondary)";label.textContent=r.label;
    const val=document.createElement("div");val.style.cssText="flex:1;font-size:12px;font-family:Consolas,monospace;word-break:break-all";val.textContent=r.value;
    const copyBtn=document.createElement("button");copyBtn.className="btn-small";copyBtn.textContent="复制";
    copyBtn.onclick=()=>copyToClipboard(r.value,r.label);
    row.appendChild(label);row.appendChild(val);row.appendChild(copyBtn);
    if(r.dir){
      const openBtn=document.createElement("button");openBtn.className="btn-small";openBtn.textContent="打开";
      openBtn.onclick=async()=>{try{await invoke("open_dir",{path:r.dir})}catch(e){appendLog("打开失败："+e,"log-error")}};
      row.appendChild(openBtn);
    }
    box.appendChild(row);
  });
}
["limitToken","limitSession","limitDaily"].forEach(id=>{const el=$(id);if(!el)return;el.oninput=function(){$(id+"Val").textContent=(+this.value).toLocaleString()}});

/* ============================================================
   数据与维护
   ============================================================ */
document.querySelectorAll(".action-grid button[data-open]").forEach(btn=>{
  btn.onclick=()=>{
    const map={sessions:"打开 DSH 会话目录",plugins:"打开插件安装目录",settings:"打开 DSH 配置文件",logs:"打开启动器日志目录",dshhome:"打开 DSH_HOME",trash:"打开会话回收站"};
    appendLog(`[维护] ${map[btn.dataset.open]}（端：${currentEndpoint().name}）`,"log-stop");
    if(HAS_TAURI)invoke("open_path",{path:btn.dataset.open,endpoint_id:currentEndpoint().id});
  };
});
$("btnExportConfig")?.addEventListener("click",async()=>{
  try{
    const incLauncher=$("expLauncher")?.checked!==false;
    const incDsh=$("expDsh")?.checked!==false;
    const incEndpoints=$("expEndpoints")?.checked!==false;
    const out={version:2,exportedAt:new Date().toISOString()};
    if(incEndpoints){
      out.local_prefs={
        kanban:localStorage.getItem(KANBAN_KEY),
        endpoints:localStorage.getItem(EP_KEY),
        drawer:localStorage.getItem(DRAWER_KEY)
      };
    }
    if(incLauncher){
      out.launcher_prefs=await invoke("get_launcher_prefs").catch(()=>null);
    }
    if(incDsh){
      out.dsh_settings=await invoke("get_dsh_settings");
      out.cordis_patch=await invoke("get_cordis_patch").catch(()=>null);
    }
    const data=JSON.stringify(out,null,2);
    const p=await invoke("save_text_file",{defaultName:"dsh-launcher-config.json",content:data});
    if(p)appendLog("[维护] 配置已导出："+p,"log-ready");
  }catch(e){appendLog("导出失败："+e,"log-error")}
});
$("btnImportConfig")?.addEventListener("click",async()=>{
  try{
    const content=await invoke("pick_and_read_config");
    if(!content)return;
    const data=JSON.parse(content);
    const incLauncher=$("expLauncher")?.checked!==false;
    const incDsh=$("expDsh")?.checked!==false;
    const incEndpoints=$("expEndpoints")?.checked!==false;
    if(data.version>=2){
      if(incEndpoints&&data.local_prefs){
        if(data.local_prefs.kanban)localStorage.setItem(KANBAN_KEY,data.local_prefs.kanban);
        if(data.local_prefs.endpoints)localStorage.setItem(EP_KEY,data.local_prefs.endpoints);
        if(data.local_prefs.drawer)localStorage.setItem(DRAWER_KEY,data.local_prefs.drawer);
      }
      if(incLauncher&&data.launcher_prefs && typeof data.launcher_prefs==="object")await invoke("set_launcher_prefs",{prefsJson:data.launcher_prefs});
    }else{
      // 兼容 v1：旧的 launcher_prefs 里放的是 localStorage 字符串
      if(incEndpoints&&data.launcher_prefs){
        if(data.launcher_prefs.kanban)localStorage.setItem(KANBAN_KEY,data.launcher_prefs.kanban);
        if(data.launcher_prefs.endpoints)localStorage.setItem(EP_KEY,data.launcher_prefs.endpoints);
        if(data.launcher_prefs.drawer)localStorage.setItem(DRAWER_KEY,data.launcher_prefs.drawer);
      }
    }
    if(incDsh&&data.dsh_settings!==undefined)await invoke("set_dsh_settings",{text:data.dsh_settings});
    if(incDsh&&data.cordis_patch!==undefined)await invoke("set_cordis_patch",{text:data.cordis_patch});
    appendLog("[维护] 配置已导入，界面即将刷新","log-ready");
    setTimeout(()=>location.reload(),600);
  }catch(e){appendLog("导入失败："+e,"log-error")}
});
$("btnResetUI")?.addEventListener("click",()=>showConfirm("重置外观与偏好","确定要重置启动器外观与偏好设置吗？看板娘、窗口、启动行为将恢复默认（多端列表保留）。",async()=>{
  kanbanCfg={...DEFAULT_KANBAN};saveKanban();applyKanban();
  localStorage.removeItem(DRAWER_KEY);
  try{await invoke("set_launcher_prefs",{prefsJson:JSON.parse(JSON.stringify(DEFAULT_LAUNCHER_PREFS))})}
  catch(e){appendLog("重置偏好失败："+e,"log-error")}
  appendLog("[维护] 外观与偏好已重置","log-stop");
}));
$("btnResetEndpoints")?.addEventListener("click",()=>showConfirm("重置多端列表","确定要重置多端列表吗？将恢复默认的本地 Windows 端，其他端从列表移除（不删除端上的数据）。",()=>{endpoints=JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS));saveEndpoints();renderEndpointList();updateEndpointUI();appendLog("[维护] 多端列表已重置","log-stop")}));
$("btnResetDsh")?.addEventListener("click",()=>showConfirm("重置当前端 DSH 配置","确定要重置当前端 DSH 配置吗？settings.yaml 与 cordis.patch.yml 将恢复为默认，重启 DSH 后生效。",async()=>{
  try{
    await invoke("reset_dsh_config");
    appendLog("[维护] settings.yaml 与 cordis.patch.yml 已重置为默认，重启 DSH 后生效","log-ready");
  }catch(e){appendLog("重置 DSH 配置失败："+e,"log-error")}
}));
$("btnResetAll")?.addEventListener("click",()=>showConfirm("重置全部配置","确定要重置全部配置吗？此操作不可撤销，所有设置将恢复默认，界面将刷新。",async()=>{
  kanbanCfg={...DEFAULT_KANBAN};saveKanban();applyKanban();
  endpoints=JSON.parse(JSON.stringify(DEFAULT_ENDPOINTS));saveEndpoints();renderEndpointList();updateEndpointUI();
  localStorage.removeItem(DRAWER_KEY);
  try{await invoke("set_launcher_prefs",{prefsJson:JSON.parse(JSON.stringify(DEFAULT_LAUNCHER_PREFS))})}
  catch(e){appendLog("重置偏好失败："+e,"log-error")}
  try{await invoke("reset_dsh_config")}
  catch(e){appendLog("重置 DSH 配置失败："+e,"log-error")}
  location.reload();
}));

/* ============================================================
   防崩溃：配置备份 / 安全模式
   ============================================================ */
async function loadBackupList(){
  const box=$("backupList");if(!box)return;
  try{
    const list=await invoke("list_config_backups");
    if(!list||list.length===0){box.innerHTML='<div class="si-desc">暂无备份（修改配置时会自动备份）</div>';return}
    box.innerHTML=list.map(b=>{
      const d=new Date(b.timestamp);
      const ts=`${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      const tags=[];
      if(b.has_settings)tags.push("settings");
      if(b.has_patch)tags.push("patch");
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span><b>${ts}</b> <span style="color:var(--text-secondary)">${escapeHtml(b.label)}</span> <span style="color:var(--text-secondary);font-size:11px">[${tags.join(",")}]</span></span>
        <button class="btn-small" data-restore="${b.timestamp}">恢复</button>
      </div>`;
    }).join("");
    box.querySelectorAll("button[data-restore]").forEach(btn=>{
      btn.onclick=()=>{
        const ts=btn.dataset.restore;
        showConfirm("恢复配置备份",`确定要恢复该备份吗？当前 settings.yaml 与 cordis.patch.yml 将被覆盖，重启 DSH 后生效。`,async()=>{
          try{await invoke("restore_config_backup",{timestamp:ts});appendLog("[防崩溃] 已恢复配置备份 "+ts,"log-ready");loadBackupList()}
          catch(e){appendLog("[防崩溃] 恢复失败："+e,"log-error")}
        });
      };
    });
  }catch(e){box.innerHTML='<div class="si-desc">加载失败：'+escapeHtml(String(e))+'</div>'}
}
$("btnBackupNow")?.addEventListener("click",async()=>{
  try{const ts=await invoke("backup_config_now",{label:"用户手动备份"});appendLog("[防崩溃] 已创建配置备份 "+ts,"log-ready");loadBackupList()}
  catch(e){appendLog("[防崩溃] 备份失败："+e,"log-error")}
});
$("btnSafeMode")?.addEventListener("click",()=>{
  showConfirm("安全模式启动","安全模式会临时移走当前配置（settings.yaml / cordis.patch.yml），用默认空配置启动 DSH。原配置会保留，可随时「退出安全模式」恢复。确定继续吗？",async()=>{
    try{
      await invoke("start_harness_safe",{});
      appendLog("[安全模式] 已用默认配置启动 DSH","log-ready");
      $("btnSafeMode").style.display="none";
      $("btnExitSafeMode").style.display="";
    }catch(e){appendLog("[安全模式] 启动失败："+e,"log-error")}
  });
});
$("btnExitSafeMode")?.addEventListener("click",()=>{
  showConfirm("退出安全模式","将恢复安全模式前的原有配置，重启 DSH 后生效。确定吗？",async()=>{
    try{
      const r=await invoke("exit_safe_mode");
      appendLog(r?"[安全模式] 已恢复原有配置，重启 DSH 后生效":"[安全模式] 无待恢复的配置","log-ready");
      $("btnSafeMode").style.display="";
      $("btnExitSafeMode").style.display="none";
    }catch(e){appendLog("[安全模式] 退出失败："+e,"log-error")}
  });
});
// 初始化时检查是否处于安全模式
(async()=>{
  try{
    const safe=await invoke("is_safe_mode");
    if(safe){$("btnSafeMode").style.display="none";$("btnExitSafeMode").style.display=""}
  }catch(e){}
})();

/* ============================================================
   初始化
   ============================================================ */
applyKanban();
updateEndpointUI();
loadLauncherPrefs();
loadCapabilityData();
loadBackupList();

$("btnRestoreBundleSnapshot")?.addEventListener("click",()=>{
  showConfirm("回退 bundle 列表","将把 profile 的 bundles 与依赖回退到最近一次启动自检通过的快照，重启 DSH 后生效。",async()=>{
    try{
      const ok=await invoke("restore_bundle_snapshot");
      if(ok){appendLog("[维护] 已回退到上次可用 bundle 快照，重启 DSH 后生效","log-ready")}
      else{appendLog("[维护] 没有可回退的 bundle 快照（与当前一致）","log-stop")}
    }catch(e){appendLog("[维护] 回退失败："+e,"log-error")}
  });
});
$("btnUninstallDsh")?.addEventListener("click",()=>{
  showConfirm("卸载 DSH","将静默停止 DSH 并执行 npm 全局卸载 @deepseek-ai/dsh。数据目录 %APPDATA%\\dsh-launcher 会保留。",async()=>{
    const btn=$("btnUninstallDsh"); if(btn){btn.disabled=true;btn.textContent="卸载中..."}
    appendLog("[DSH] 正在静默停止并卸载 DSH 本体...","log-start");
    try{
      await invoke("stop_harness",{force:true,endpoint_id:currentEndpoint().id});
      const r=await invoke("uninstall_dsh");
      appendLog(`[DSH] ${r}`,"log-ready");
      await loadDshVersion();
      appendLog("[DSH] 卸载完成；如需恢复请点「重装 DSH」","log-stop");
    }catch(e){appendLog("[DSH] 卸载失败："+e,"log-error")}
    if(btn){btn.disabled=false;btn.textContent="卸载 DSH"}
  });
});
$("btnReinstallDsh")?.addEventListener("click",()=>{
  showConfirm("重装 DSH","将静默停止 DSH、卸载后安装最新版 @deepseek-ai/dsh。数据目录保留，重启 DSH 后生效。",async()=>{
    const btn=$("btnReinstallDsh"); if(btn){btn.disabled=true;btn.textContent="重装中..."}
    appendLog("[DSH] 正在重装 DSH 本体（停止→卸载→安装最新）...","log-start");
    try{
      await invoke("stop_harness",{force:true,endpoint_id:currentEndpoint().id});
      const u=await invoke("uninstall_dsh");
      appendLog(`[DSH] 卸载：${u}`,"log-stop");
      const r=await invoke("install_or_update_dsh");
      appendLog(`[DSH] 安装：${r}`,"log-ready");
      await loadDshVersion();
      appendLog("[DSH] 重装完成，请重启 DSH 使新版本生效","log-stop");
    }catch(e){appendLog("[DSH] 重装失败："+e,"log-error")}
    if(btn){btn.disabled=false;btn.textContent="重装 DSH（卸载后装最新版）"}
  });
});
loadDshVersion();
updateStatus(false,false);
appendLog("DSH Launcher 启动器已就绪","log-ready");
appendLog(`当前端：${currentEndpoint().name}（${typeLabel(currentEndpoint().type)}）`,"log-stop");
appendLog("提示：点击顶部端名称可快速切换端；点击「设置」可配置看板娘、多端、用量等","log-stop");

if(HAS_TAURI&&window.__TAURI__.event){
  window.__TAURI__.event.listen("harness-log",e=>{
    const {level,text}=e.payload;
    const raw=String(text);
    let disp=raw,cls=level==="err"?"log-error":level==="ready"?"log-ready":"";
    if(raw.startsWith("[插件]")){
      const tr=translatePluginLine(raw.slice(4));
      if(tr===null)return;
      disp="[插件] "+tr;
      cls="log-plugin";
    }
    appendLog(disp,cls);
  });
  window.__TAURI__.event.listen("harness-status",e=>{
    const {status}=e.payload;
    if(status==="ready"){dshRunning=true;updateStatus(true,false)}
    else if(status==="starting")updateStatus(false,true);
    else{dshRunning=false;updateStatus(false,false)}
  });
}

// 初始化：用真实后端状态回填本地端信息
(async function initState(){
  try{
    const s=await invoke("get_state");
    const ep=currentEndpoint();
    if(s){
      if(s.dsh_home){ep.dshHome=s.dsh_home}
      if(s.dsh_path){ep.path=s.dsh_path}
      if(s.url){$("urlInput").value=s.url;$("openUrlLink").textContent=s.url}
      if(s.port){ep.port=s.port}
      saveEndpoints();
      if(s.status==="ready"){dshRunning=true;updateStatus(true,false)}
      else if(s.status==="starting"){updateStatus(false,true)}
    }
  }catch(e){appendLog("初始化状态失败："+e,"log-error")}
  try{const sessions=await invoke("list_sessions",{filter:""});appendLog("自检: 会话 "+(sessions?sessions.length:0)+" 个","log-stop")}catch(e){}
})();
