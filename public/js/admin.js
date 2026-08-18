/* 管理员后台 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
const state = { admin: null, meta: null, tab: 'upload' };

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}
const opt = (list, sel, def) => `<option value="">${def || '请选择'}</option>` + list.map(x => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

/* ---------- 移动端：抽屉式侧边栏 + 回顶 ---------- */
function bindMobileShell() {
  const sb = $('#sidebar');
  const tg = $('#menuToggle');
  if (tg && sb) {
    tg.addEventListener('click', () => {
      sb.classList.toggle('open');
      document.body.classList.toggle('drawer-open', sb.classList.contains('open'));
    });
    document.body.addEventListener('click', (e) => {
      if (!sb.classList.contains('open')) return;
      if (sb.contains(e.target) || tg.contains(e.target)) return;
      sb.classList.remove('open');
      document.body.classList.remove('drawer-open');
    });
  }
  if (!document.getElementById('toTop')) {
    const t = document.createElement('button');
    t.id = 'toTop'; t.className = 'to-top'; t.textContent = '↑';
    t.title = '回到顶部';
    t.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
    document.body.appendChild(t);
    window.addEventListener('scroll', () => t.classList.toggle('show', window.scrollY > 200));
  }
}

async function init() {
  const me = await api('GET', '/api/me');
  state.admin = me.admin;
  if (state.admin) {
    const [meta, nav] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/nav')]);
    state.meta = meta; state.nav = nav.nav; state.tiers = nav.tiers;
    renderSidebar(); tab('upload'); renderLoginState();
  } else {
    renderLoginState();
  }
  bindLogin(); bindProfile();
  bindMobileShell();
  $('#qDetailModal').addEventListener('click', (e) => { if (e.target.id === 'qDetailModal') $('#qDetailModal').style.display = 'none'; });
}
function renderSidebar() {
  $$('.menu-title').forEach(t => t.addEventListener('click', () => {
    tab(t.dataset.tab);
    // 手机端：点击后自动收起抽屉
    const sb = $('#sidebar');
    if (sb && sb.classList.contains('open')) {
      sb.classList.remove('open');
      document.body.classList.remove('drawer-open');
    }
  }));
}
function tab(name) {
  state.tab = name;
  $$('.menu-title').forEach(t => t.classList.toggle('open', t.dataset.tab === name));
  const c = $('#content');
  const t = { upload: uploadView, add: addView, students: studentsView, errors: errorsView, scores: scoresView, bank: bankView, extract: extractView, papers: papersView }[name];
  t(c);
}
function gate(c) {
  if (!state.admin) { c.innerHTML = '<div class="empty">请先登录管理员账号</div>'; return false; }
  return true;
}
function renderLoginState() {
  const b = $('#loginBtn');
  b.textContent = state.admin ? '退出(' + state.admin.username + ')' : '管理员登录';
  b.onclick = () => { if (state.admin) api('POST', '/api/logout').then(() => location.reload()); else openLogin(); };
  const pb = $('#profileBtn');
  pb.style.display = state.admin ? '' : 'none';
  pb.onclick = openProfile;
}
function openProfile() {
  $('#profilePhone').textContent = '当前绑定手机：' + (state.admin?.phone || '未绑定');
  $('#newPhone').value = (state.admin?.phone || '').replace(/\*\*/g, '');
  $('#profileErr').textContent = '';
  $('#profileModal').style.display = 'flex';
}
async function bindProfile() {
  $('#profileSave').addEventListener('click', async () => {
    const phone = $('#newPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { $('#profileErr').textContent = '请输入正确的 11 位手机号'; return; }
    try {
      const r = await api('PUT', '/api/admin/profile', { phone });
      state.admin.phone = r.phone; renderLoginState();
      $('#profileModal').style.display = 'none';
      alert('手机号已更新，下次可使用验证码登录');
    } catch (e) { $('#profileErr').textContent = e.message; }
  });
  $('#profileModal').addEventListener('click', (e) => { if (e.target.id === 'profileModal') $('#profileModal').style.display = 'none'; });
}

/* ---------- 资料上传与两步入库（支持拍照 / 图片 OCR） ---------- */
let capturedFile = null;
function uploadView(c) {
  if (!gate(c)) return;
  const m = state.meta;
  c.innerHTML = `<div class="page-title">资料上传与试卷智能入库</div>
    <div class="page-sub">第一步：上传 PDF/Word 试卷讲义，或<b>拍照 / 上传图片</b>（自动 OCR 识别文字）；原文件存入【原版试卷库】。第二步：解析拆分题目并确认入库。</div>
    <div class="card">
      <form id="upForm">
        <div class="row">
          <label class="field"><span>资料标题</span><input name="title" placeholder="如：2025 上海中学高二物理期中卷"></label>
          <label class="field"><span>所属梯队</span><select name="tier_id">${opt(m.tiers)}</select></label>
          <label class="field"><span>所属年级</span><select name="grade_id">${opt(m.grades)}</select></label>
        </div>
        <label class="field"><span>上传文件（PDF / Word / 图片 JPG·PNG）</span>
          <input type="file" name="file" id="upFile" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" required></label>
        <div class="cam-wrap">
          <button type="button" class="btn ghost" id="camOpen">📷 拍照上传</button>
          <input type="file" id="camCapture" accept="image/*" capture="environment" style="display:none" aria-label="拍照">
          <div id="camBox" style="display:none;margin-top:10px">
            <video id="camVideo" autoplay playsinline webkit-playsinline style="width:320px;max-width:100%;border:1px solid var(--border);border-radius:8px;background:#000"></video>
            <div class="right" style="margin-top:8px">
              <button type="button" class="btn sm" id="camShot">快门拍照</button>
              <button type="button" class="btn sm ghost" id="camCancel">取消</button>
            </div>
            <img id="camPreview" style="display:none;width:320px;max-width:100%;border:1px solid var(--ok);border-radius:8px;margin-top:8px">
          </div>
        </div>
        <button class="btn" type="submit">① 上传到原版试卷库</button>
      </form>
    </div>
    <div id="upList"></div>`;
  $('#upForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('title', e.target.title.value);
    fd.append('tier_id', e.target.tier_id.value);
    fd.append('grade_id', e.target.grade_id.value);
    if (capturedFile) fd.append('file', capturedFile, capturedFile.name);
    else if (e.target.file.files[0]) fd.append('file', e.target.file.files[0]);
    else { alert('请选择文件或拍照'); return; }
    await api('POST', '/api/admin/resources', fd);
    alert('已上传，进入第 2 步解析'); capturedFile = null; loadResList();
  });
  bindCamera();
  loadResList();
}
function bindCamera() {
  let stream = null;
  const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } $('#camVideo').srcObject = null; };
  const setCaptured = (file) => {
    capturedFile = file;
    const img = $('#camPreview'); img.src = URL.createObjectURL(file); img.style.display = '';
    $('#camVideo').style.display = 'none';
  };
  $('#camOpen').onclick = async () => {
    // iOS 局域网 http 下 getUserMedia 不可用，直接调原生相机
    if (!camSupported()) { $('#camCapture').click(); return; }
    $('#camBox').style.display = ''; $('#camPreview').style.display = 'none'; $('#camVideo').style.display = '';
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); $('#camVideo').srcObject = stream; }
    catch (e) { alert('无法打开摄像头：' + e.message + '\n请改用文件上传。'); $('#camBox').style.display = 'none'; }
  };
  $('#camCapture').onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) setCaptured(f); e.target.value = ''; };
  $('#camCancel').onclick = () => { stop(); $('#camBox').style.display = 'none'; };
  $('#camShot').onclick = () => {
    const v = $('#camVideo'); const cv = document.createElement('canvas');
    cv.width = v.videoWidth || 1280; cv.height = v.videoHeight || 960;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    cv.toBlob((blob) => {
      capturedFile = new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' });
      const img = $('#camPreview'); img.src = URL.createObjectURL(blob); img.style.display = '';
      $('#camVideo').style.display = 'none'; stop();
    }, 'image/jpeg');
  };
}
async function loadResList() {
  const { resources, tiers } = await api('GET', '/api/resources');
  $('#upList').innerHTML = `<h3 class="mt">原版试卷库（${resources.length}）</h3><table><tr><th>标题</th><th>梯队</th><th>状态</th><th>操作</th></tr>${
    resources.map(r => `<tr><td>${esc(r.title)}</td><td>${tiers.find(t => t.id == r.tier_id)?.name || '-'}</td>
      <td>${r.parsed ? '<span class="pill good">已拆分</span>' : '<span class="pill bad">未拆分</span>'}</td>
      <td><a class="btn sm ghost" href="/uploads/${esc(r.file_path)}" target="_blank">下载原卷</a>
      <button class="btn sm warn" data-parse="${r.id}">② 解析入库</button></td></tr>`).join('')
  }</table>`;
  $$('[data-parse]').forEach(b => b.addEventListener('click', () => parseFlow(b.dataset.parse)));
}
async function parseFlow(rid) {
  const r = await api('GET', '/api/resources/' + rid);
  const isImage = (r.file_type || '').startsWith('image/');
  if (isImage) { showImageParsePanel(r); return; }
  const { questions } = await api('POST', '/api/admin/resources/' + rid + '/parse');
  showParsePreview(questions, rid, r);
}
function showImageParsePanel(r) {
  const panel = document.createElement('div');
  panel.className = 'card';
  panel.innerHTML = `<h3>图片解析：OCR 文字识别</h3>
    <div class="muted mb">系统将调用浏览器端 OCR（需联网加载中文字库）识别图片文字，再自动拆分题目；离线时也可手动粘贴文字。</div>
    <div id="ocrStatus" class="muted mb"></div>
    <textarea id="ocrText" style="min-height:160px" placeholder="OCR 识别结果将出现在这里；若离线无法识别，可手动粘贴图片中的文字"></textarea>
    <div class="right" style="margin-top:8px">
      <button class="btn ghost" id="ocrBtn" type="button">📷 识别图片文字（OCR）</button>
      <button class="btn success" id="ocrParse" type="button">解析并拆分题目</button>
    </div>`;
  $('#upList').prepend(panel);
  const ocrBtn = $('#ocrBtn');
  if (typeof Tesseract === 'undefined') {
    ocrBtn.disabled = true; ocrBtn.textContent = 'OCR 不可用（离线）';
    $('#ocrStatus').textContent = '当前环境未加载 OCR 组件，请手动粘贴文本后点击「解析并拆分题目」。';
  }
  ocrBtn.onclick = async () => {
    if (typeof Tesseract === 'undefined') return;
    $('#ocrStatus').textContent = '正在识别中…（首次约需下载中文字库）';
    try {
      const resp = await fetch('/uploads/' + r.file_path);
      const blob = await resp.blob();
      const { data: { text } } = await Tesseract.recognize(blob, 'chi_sim+eng', { logger: mb => { if (mb.status === 'recognizing text') $('#ocrStatus').textContent = '识别中…' + Math.round(mb.progress * 100) + '%'; } });
      $('#ocrText').value = text;
      $('#ocrStatus').textContent = '识别完成，可修正后点击「解析并拆分题目」。';
    } catch (e) { $('#ocrStatus').textContent = 'OCR 失败：' + e.message + '，请手动粘贴文本。'; }
  };
  $('#ocrParse').onclick = async () => {
    const text = $('#ocrText').value;
    if (!text.trim()) { alert('请先识别或粘贴文本'); return; }
    const { questions } = await api('POST', '/api/admin/resources/' + rid + '/parse-text', { text });
    showParsePreview(questions, rid, r);
  };
}
function showParsePreview(questions, rid, r) {
  const m = state.meta;
  const panel = document.createElement('div');
  panel.className = 'card';
  panel.innerHTML = `<h3>解析预览：自动识别 ${questions.length} 题</h3>
    <div class="muted mb">请核实每题分类（年级/专题/题型/难度），可修改后批量入库。</div>
    <div id="qEdit"></div>
    <div class="right"><button class="btn success" id="commitBtn">确认入库 ${questions.length} 题</button></div>`;
  $('#upList').prepend(panel);
  $('#qEdit').innerHTML = questions.map((q, i) => `<div class="question" data-i="${i}">
    <div class="qmeta">题 ${i + 1}</div>
    <div style="white-space:pre-wrap;margin-bottom:6px">${esc(q.content)}</div>
    <div class="row" style="gap:8px">
      <select data-f="grade_id">${opt(m.grades, q.grade_id, '年级')}</select>
      <select data-f="topic_id">${opt(m.topics, q.topic_id, '专题')}</select>
      <select data-f="type_id">${opt(m.types, q.type_id, '题型')}</select>
      <select data-f="difficulty_id">${opt(m.difficulties, q.difficulty_id, '难度')}</select>
    </div>
    <textarea data-f="solution" placeholder="解析" style="margin-top:6px">${esc(q.solution)}</textarea></div>`).join('');
  if (r && r.grade_id) questions.forEach((q, i) => { if (!q.grade_id) $(`#qEdit [data-i="${i}"] [data-f="grade_id"]`).value = r.grade_id; });
  $('#commitBtn').onclick = async () => {
    const out = questions.map((q, i) => {
      const blk = $(`#qEdit [data-i="${i}"]`);
      return { content: q.content, grade_id: blk.querySelector('[data-f="grade_id"]').value || null, topic_id: blk.querySelector('[data-f="topic_id"]').value || null, type_id: blk.querySelector('[data-f="type_id"]').value || null, difficulty_id: blk.querySelector('[data-f="difficulty_id"]').value || null, solution: blk.querySelector('[data-f="solution"]').value };
    });
    await api('POST', '/api/admin/resources/' + rid + '/commit', { questions: out });
    alert('入库完成，题库已更新！'); loadResList();
  };
}

/* ============================================================ *
 *  通用 OCR 工具：把现有拍照/识别能力做成可复用的小组件
 *  用法：attachOcrToTextarea('k_desc', { append: true })
 *    会在该 textarea 上方插入 [📷拍照] [📁上传图片] 状态文字，
 *    点击拍照按钮弹出 video + 快门；点击上传按钮选图片；OCR 结果追加（或替换）到 textarea。
 * ============================================================ */
function ocrAvailable() { return typeof Tesseract !== 'undefined'; }

// iOS Safari 仅在安全上下文（https 或 localhost）才暴露 getUserMedia；
// 局域网用 http://<IP> 访问时，必须改用 <input type="file" capture> 调起原生相机。
// 该函数判断「能否用 JS 实时预览摄像头」——不能时一律走原生相机通道。
function camSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
}

async function ocrRecognizeBlob(blob, onProgress) {
  if (!ocrAvailable()) throw new Error('当前页面未加载 OCR 组件（需联网加载 tesseract.js）');
  const { data: { text } } = await Tesseract.recognize(blob, 'chi_sim+eng', { logger: m => { if (m && m.status === 'recognizing text' && onProgress) onProgress(m.progress); } });
  return text;
}

function appendToTextarea(ta, text) {
  if (!text) return;
  const t = (ta.value || '').replace(/\s+$/, '');
  ta.value = (t ? t + '\n' : '') + text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
}

function attachOcrToTextarea(textareaId, opts = {}) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  const { append = true, label = '拍照/上传识别 → 自动填入下方' } = opts;
  // 工具栏：拍照走 capture 调原生相机（iOS 局域网 http 也能用），上传走相册
  const bar = document.createElement('div');
  bar.className = 'ocr-toolbar';
  bar.innerHTML = `<button type="button" class="btn ghost" data-act="cam">📷 拍照识别</button>
    <button type="button" class="btn ghost" data-act="file">📁 上传图片</button>
    <input type="file" accept="image/*" capture="environment" style="display:none" data-act="campick" aria-label="拍照">
    <input type="file" accept="image/*" style="display:none" data-act="filepick" aria-label="选择图片">
    <span class="ocr-status">${esc(label)}</span>
    <button type="button" class="btn sm ghost" data-act="replace" title="默认追加；点击切换为替换模式" style="margin-left:auto">${append ? '追加模式' : '替换模式'}</button>`;
  ta.parentNode.insertBefore(bar, ta);

  // 小弹窗：视频预览 + 拍照 + 缩略图
  const panel = document.createElement('div');
  panel.className = 'ocr-mini-panel';
  panel.style.display = 'none';
  panel.innerHTML = `<div class="muted" style="font-size:12px">📷 拍照后将自动识别文字并填入下方</div>
    <video autoplay playsinline webkit-playsinline muted></video>
    <div class="row">
      <button type="button" class="btn sm" data-act="shot">📸 快门拍照</button>
      <button type="button" class="btn sm ghost" data-act="cancel">取消</button>
    </div>
    <img alt="预览">
    <div class="ocr-status"></div>`;
  ta.parentNode.insertBefore(panel, ta);

  const status = bar.querySelector('.ocr-status');
  const pStatus = panel.querySelector('.ocr-status');
  const video = panel.querySelector('video');
  const img = panel.querySelector('img');
  const camFile = bar.querySelector('[data-act="campick"]');
  const libFile = bar.querySelector('[data-act="filepick"]');
  let mode = append ? 'append' : 'replace';
  let stream = null;

  const stopCam = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; };
  const setStatus = (s) => { status.textContent = s; pStatus.textContent = s; };

  const handleBlob = async (blob) => {
    setStatus('正在识别中…（首次约需下载中文字库）');
    img.src = URL.createObjectURL(blob);
    img.style.display = '';
    try {
      const text = await ocrRecognizeBlob(blob, p => setStatus('识别中…' + Math.round(p * 100) + '%'));
      const clean = (text || '').trim();
      if (mode === 'append') { appendToTextarea(ta, clean); setStatus('✓ 已识别 ' + clean.length + ' 字，已追加。可继续拍照/上传叠加识别。'); }
      else { ta.value = clean; setStatus('✓ 已替换为识别文字（' + clean.length + ' 字）。'); }
      panel.style.display = 'none'; stopCam();
    } catch (e) {
      setStatus('✗ 识别失败：' + e.message + '。可手动粘贴文字。');
    }
  };

  bar.querySelector('[data-act="cam"]').onclick = async () => {
    // 非安全上下文（如局域网 http）直接调原生相机，避免 iOS 拒绝 getUserMedia
    if (!camSupported()) { camFile.click(); return; }
    panel.style.display = ''; img.style.display = 'none'; video.style.display = '';
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = stream; setStatus('摄像头已就绪，点击"快门拍照"。'); }
    catch (e) { setStatus('无法打开摄像头：' + e.message + '。改用「上传图片」。'); panel.style.display = 'none'; libFile.click(); }
  };
  bar.querySelector('[data-act="file"]').onclick = () => libFile.click();
  camFile.onchange = () => { const f = camFile.files && camFile.files[0]; if (f) handleBlob(f); camFile.value = ''; };
  libFile.onchange = () => { const f = libFile.files && libFile.files[0]; if (f) handleBlob(f); libFile.value = ''; };
  bar.querySelector('[data-act="replace"]').onclick = (ev) => {
    mode = mode === 'append' ? 'replace' : 'append';
    ev.target.textContent = mode === 'append' ? '追加模式' : '替换模式';
    ev.target.title = '当前为' + (mode === 'append' ? '追加' : '替换') + '模式；点击切换';
  };
  panel.querySelector('[data-act="shot"]').onclick = () => {
    const cv = document.createElement('canvas');
    cv.width = video.videoWidth || 1280; cv.height = video.videoHeight || 960;
    cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
    cv.toBlob(b => { stopCam(); video.style.display = 'none'; handleBlob(b); }, 'image/jpeg');
  };
  panel.querySelector('[data-act="cancel"]').onclick = () => { stopCam(); panel.style.display = 'none'; setStatus('已取消'); };
}

/* ---------- 手动新增 ---------- */
function addView(c) {
  if (!gate(c)) return;
  const m = state.meta;
  c.innerHTML = `<div class="page-title">手动新增内容</div>
    <div class="page-sub">支持逐条录入，也支持"批量上传知识点"（每行一条，便于快速丰富知识体系）。<br>
    📌 <b>本页面支持拍照 / 上传文件：</b>每个文本框上方都有「📷 拍照识别」「📁 上传图片」按钮，拍照或选择图片后可调用浏览器端 OCR（中英文）把识别出的文字自动填入对应文本框（追加或替换均可），适合用手机快速录入板书、教材原题等。</div>
    <div class="grid cols-3">
      <div class="card"><h3>新增知识点</h3>
        <label class="field"><span>年级</span><select id="k_grade">${opt(m.grades)}</select></label>
        <label class="field"><span>所属章节</span><select id="k_chap">${chaptersOpt()}</select></label>
        <label class="field"><span>名称</span><input id="k_name"></label>
        <label class="field"><span>讲解（可拍照 / 上传图片 → OCR 自动填入）</span><textarea id="k_desc"></textarea></label>
        <label class="field"><span>例题（可拍照 / 上传图片 → OCR 自动填入）</span><textarea id="k_ex"></textarea></label>
        <label class="field"><span>解析（可拍照 / 上传图片 → OCR 自动填入）</span><textarea id="k_sol"></textarea></label>
        <button class="btn success" id="k_save">保存知识点</button>
      </div>
      <div class="card"><h3>新增专题</h3>
        <label class="field"><span>名称</span><input id="t_name"></label>
        <label class="field"><span>描述（可拍照 / 上传图片）</span><textarea id="t_desc"></textarea></label>
        <label class="field"><span>讲义（可拍照 / 上传图片）</span><textarea id="t_lec"></textarea></label>
        <button class="btn success" id="t_save">保存专题</button>
      </div>
      <div class="card"><h3>新增单题</h3>
        <label class="field"><span>年级</span><select id="q_grade">${opt(m.grades)}</select></label>
        <label class="field"><span>专题</span><select id="q_topic">${opt(m.topics)}</select></label>
        <label class="field"><span>知识点</span><select id="q_kp">${opt(m.knowledgePoints)}</select></label>
        <label class="field"><span>题型</span><select id="q_type">${opt(m.types)}</select></label>
        <label class="field"><span>难度</span><select id="q_diff">${opt(m.difficulties)}</select></label>
        <label class="field"><span>题干（可拍照 / 上传图片 → OCR 自动填入）</span><textarea id="q_content"></textarea></label>
        <label class="field"><span>解析（可拍照 / 上传图片 → OCR 自动填入）</span><textarea id="q_sol"></textarea></label>
        <button class="btn success" id="q_save">保存题目</button>
      </div>
    </div>
    <div class="card">
      <h3>批量上传知识点</h3>
      <div class="page-sub">每行一条，用竖线"|"分隔：年级|章节|名称|讲解（章节可留空）。系统按年级+章节自动归入对应章节。</div>
      <div id="kpBatchBar"></div>
      <label class="field"><span>或直接粘贴文本</span>
        <textarea id="kp_batch" style="min-height:130px" placeholder="高一|匀变速直线运动|平抛运动|水平方向匀速、竖直方向自由落体的合成&#10;高二|电场|电场线 电势能|切线表方向、疏密表强弱&#10;高三|圆周运动的应用|临界问题|绳模型最高点 v≥√(gr)"></textarea></label>
      <button class="btn success" id="kp_batch_btn">解析并批量新增</button>
      <div class="muted mt" style="font-size:12px">例：高二|电路|电功率与串并联|串联电流相等、并联电压相等，P=UI=I²R=U²/R</div>
    </div>`;
  // 给本页面所有需要 OCR 的文本框挂上"拍照/上传"工具栏
  attachOcrToTextarea('k_desc', { label: '把"讲解"拍照上传，识别后自动追加' });
  attachOcrToTextarea('k_ex', { label: '把"例题"拍照上传，识别后自动追加' });
  attachOcrToTextarea('k_sol', { label: '把"解析"拍照上传，识别后自动追加' });
  attachOcrToTextarea('t_desc', { label: '把"描述"拍照上传，识别后自动追加' });
  attachOcrToTextarea('t_lec', { label: '把"讲义"拍照上传，识别后自动追加' });
  attachOcrToTextarea('q_content', { label: '把"题干"拍照上传，识别后自动追加' });
  attachOcrToTextarea('q_sol', { label: '把"解析"拍照上传，识别后自动追加' });
  // 批量知识点上方挂一个更醒目的"拍照录入"按钮
  const batchBar = document.getElementById('kpBatchBar');
  if (batchBar) {
    batchBar.innerHTML = `<div class="ocr-toolbar">
      <button type="button" class="btn warn" id="kpBatchCam">📷 拍照录入（OCR → 自动按行填入下方）</button>
      <button type="button" class="btn ghost" id="kpBatchFile">📁 上传图片识别</button>
      <input type="file" id="kpBatchCamPick" accept="image/*" capture="environment" style="display:none" aria-label="拍照">
      <input type="file" id="kpBatchFilePick" accept="image/*" style="display:none" aria-label="选择图片">
      <span class="ocr-status">适合一页教材/板书含多条知识点时一次性录入</span>
    </div>
    <div id="kpBatchPanel" class="ocr-mini-panel" style="display:none">
      <div class="muted" style="font-size:12px">拍照后会自动识别并把内容写入下方文本框，每行一条</div>
      <video autoplay playsinline webkit-playsinline muted></video>
      <div class="row"><button type="button" class="btn sm" id="kpBatchShot">📸 快门</button>
        <button type="button" class="btn sm ghost" id="kpBatchCancel">取消</button></div>
      <img alt="预览">
      <div class="ocr-status"></div>
    </div>`;
    const video = batchBar.querySelector('#kpBatchPanel video');
    const img = batchBar.querySelector('#kpBatchPanel img');
    const pStatus = batchBar.querySelector('#kpBatchPanel .ocr-status');
    const status = batchBar.querySelector('.ocr-status');
    const camFile = batchBar.querySelector('#kpBatchCamPick');
    const libFile = batchBar.querySelector('#kpBatchFilePick');
    let stream = null;
    const stop = () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } video.srcObject = null; };
    const handle = async (blob) => {
      img.src = URL.createObjectURL(blob); img.style.display = '';
      status.textContent = '正在识别中…'; pStatus.textContent = '正在识别中…（首次约需下载中文字库）';
      try {
        const text = await ocrRecognizeBlob(blob, p => { pStatus.textContent = '识别中…' + Math.round(p * 100) + '%'; });
        const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const ta = document.getElementById('kp_batch');
        // 自动补一个默认的"高一|未归类|"前缀，防止年级缺失
        const safe = lines.map(l => /\|/.test(l) ? l : ('高一|未归类|未命名|' + l)).join('\n');
        appendToTextarea(ta, safe);
        status.textContent = '✓ 已识别 ' + lines.length + ' 行，请确认格式后点击「解析并批量新增」';
        pStatus.textContent = '✓ 已写入 ' + lines.length + ' 行到下方文本框';
        batchBar.querySelector('#kpBatchPanel').style.display = 'none'; stop();
      } catch (e) { status.textContent = '✗ 识别失败：' + e.message; pStatus.textContent = '✗ 失败：' + e.message; }
    };
    batchBar.querySelector('#kpBatchCam').onclick = async () => {
      if (!camSupported()) { camFile.click(); return; }
      const p = batchBar.querySelector('#kpBatchPanel'); p.style.display = ''; img.style.display = 'none'; video.style.display = '';
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = stream; }
      catch (e) { status.textContent = '无法打开摄像头：' + e.message + '。改用「上传图片」。'; p.style.display = 'none'; libFile.click(); }
    };
    batchBar.querySelector('#kpBatchFile').onclick = () => libFile.click();
    camFile.onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) handle(f); e.target.value = ''; };
    libFile.onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) handle(f); e.target.value = ''; };
    batchBar.querySelector('#kpBatchShot').onclick = () => {
      const cv = document.createElement('canvas');
      cv.width = video.videoWidth || 1280; cv.height = video.videoHeight || 960;
      cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
      cv.toBlob(b => { stop(); video.style.display = 'none'; handle(b); }, 'image/jpeg');
    };
    batchBar.querySelector('#kpBatchCancel').onclick = () => { stop(); batchBar.querySelector('#kpBatchPanel').style.display = 'none'; };
  }
  $('#k_save').onclick = async () => { await api('POST', '/api/admin/knowledge-points', { grade_id: $('#k_grade').value, chapter_id: $('#k_chap').value, name: $('#k_name').value, description: $('#k_desc').value, example: $('#k_ex').value, example_solution: $('#k_sol').value }); alert('已保存'); state.meta = await api('GET', '/api/meta'); addView(c); };
  $('#t_save').onclick = async () => { await api('POST', '/api/admin/topics', { name: $('#t_name').value, description: $('#t_desc').value, lecture: $('#t_lec').value }); alert('已保存'); state.meta = await api('GET', '/api/meta'); addView(c); };
  $('#q_save').onclick = async () => { await api('POST', '/api/admin/questions', { grade_id: $('#q_grade').value, topic_id: $('#q_topic').value, knowledge_point_id: $('#q_kp').value, type_id: $('#q_type').value, difficulty_id: $('#q_diff').value, content: $('#q_content').value, solution: $('#q_sol').value }); alert('已保存'); };
  $('#kp_batch_btn').onclick = () => batchAddKp(c);
}

async function batchAddKp(c) {
  const text = $('#kp_batch').value.trim();
  if (!text) { alert('请先粘贴知识点内容'); return; }
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let ok = 0, fail = 0;
  for (const line of lines) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) { fail++; continue; }
    const [g, ch, name, desc] = parts;
    const grade = state.meta.grades.find(x => x.name === g);
    if (!grade) { fail++; continue; }
    let chapter_id = null;
    if (ch) {
      for (const ng of state.nav || []) for (const cc of ng.chapters) if (cc.name === ch && ng.grade.name === g) chapter_id = cc.id;
    }
    try {
      await api('POST', '/api/admin/knowledge-points', { grade_id: grade.id, chapter_id, name, description: desc || '', example: '', example_solution: '' });
      ok++;
    } catch (e) { fail++; }
  }
  alert(`批量新增完成：成功 ${ok} 条，跳过/失败 ${fail} 条。`);
  state.meta = await api('GET', '/api/meta');
  addView(c);
}
function chaptersOpt() {
  let html = '<option value="">未归类</option>';
  if (state.nav) for (const g of state.nav) for (const ch of g.chapters) html += `<option value="${ch.id}">${esc(g.grade.name)} / ${esc(ch.name)}</option>`;
  return html;
}

/* ---------- 学生管理 ---------- */
async function studentsView(c) {
  if (!gate(c)) return;
  const { students } = await api('GET', '/api/students');
  const m = state.meta;
  c.innerHTML = `<div class="page-title">学生档案管理</div>
    <button class="btn mb" id="addStu">+ 新建学生</button><div id="stuForm"></div>
    <div class="grid cols-3" id="stuCards"></div>`;
  $('#stuCards').innerHTML = students.map(s => `<div class="card"><h3>${esc(s.name)}</h3>
    <div class="muted">${m.grades.find(g => g.id == s.grade_id)?.name || ''} · ${esc(s.school_name || '')}</div>
    <p>${esc(s.overall_desc || '')}</p>
    <button class="btn sm danger" data-del="${s.id}">删除</button></div>`).join('');
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('确认删除？')) { await api('DELETE', '/api/admin/students/' + b.dataset.del); studentsView(c); } });
  $('#addStu').onclick = () => {
    $('#stuForm').innerHTML = `<div class="card"><h3>新建学生</h3>
      <div class="row"><label class="field"><span>姓名</span><input id="s_name"></label><label class="field"><span>年级</span><select id="s_grade">${opt(m.grades)}</select></label></div>
      <div class="row"><label class="field"><span>学校</span><input id="s_school"></label><label class="field"><span>梯队</span><select id="s_tier">${opt(state.tiers || m.tiers)}</select></label></div>
      <label class="field"><span>整体情况</span><textarea id="s_desc"></textarea></label>
      <div class="right"><button class="btn success" id="s_save">保存</button></div></div>`;
    $('#s_save').onclick = async () => { await api('POST', '/api/admin/students', { name: $('#s_name').value, grade_id: $('#s_grade').value, school_name: $('#s_school').value, school_tier_id: $('#s_tier').value, overall_desc: $('#s_desc').value, weak_topics: [] }); alert('已保存'); studentsView(c); };
  };
}

/* ---------- 错题管理 ---------- */
async function errorsView(c) {
  if (!gate(c)) return;
  const { students } = await api('GET', '/api/students');
  c.innerHTML = `<div class="page-title">错题管理</div>
    <label class="field"><span>选择学生</span><select id="e_stu">${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
    <div id="eList"></div>`;
  $('#e_stu').onchange = () => load(c, $('#e_stu').value);
  if (students[0]) load(c, students[0].id);
}
async function load(c, sid) {
  const { errors } = await api('GET', '/api/students/' + sid + '/errors');
  $('#eList').innerHTML = `<h3 class="mt">错题（${errors.length}）</h3>` + errors.map(e => `<div class="question"><div class="qmeta">${state.meta.topics.find(t => t.id == e.topic_id)?.name || ''} ${e.error_reason ? `<span class="tag">${esc(e.error_reason)}</span>` : ''}</div>
    <div>${esc(e.content).replace(/\n/g, '<br>')}</div><button class="btn sm danger" data-del="${e.id}">删除</button></div>`).join('');
  $$('[data-del]').forEach(b => b.onclick = async () => { await api('DELETE', '/api/admin/errors/' + b.dataset.del); load(c, sid); });
}

/* ---------- 成绩管理 ---------- */
async function scoresView(c) {
  if (!gate(c)) return;
  const { students } = await api('GET', '/api/students');
  c.innerHTML = `<div class="page-title">成绩管理</div>
    <label class="field"><span>选择学生</span><select id="s_stu">${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><div id="sList"></div>`;
  $('#s_stu').onchange = () => loadS(c, $('#s_stu').value);
  if (students[0]) loadS(c, students[0].id);
}
async function loadS(c, sid) {
  const { scores } = await api('GET', '/api/students/' + sid + '/scores');
  $('#sList').innerHTML = `<h3 class="mt">成绩（${scores.length}）</h3>` + (scores.length ? `<table><tr><th>测试</th><th>日期</th><th>得分</th><th>备注</th><th></th></tr>${scores.map(s => `<tr><td>${esc(s.exam_name)}</td><td>${esc(s.exam_date)}</td><td>${s.score}/${s.full_score}</td><td>${esc(s.note || '')}</td><td><button class="btn sm danger" data-del="${s.id}">删</button></td></tr>`).join('')}</table>` : '<p class="muted">暂无</p>');
  $$('[data-del]').forEach(b => b.onclick = async () => { await api('DELETE', '/api/admin/scores/' + b.dataset.del); loadS(c, sid); });
}

/* ---------- 组卷历史 ---------- */
async function papersView(c) {
  if (!gate(c)) return;
  const { papers } = await api('GET', '/api/papers');
  c.innerHTML = `<div class="page-title">组卷历史</div>
    <table><tr><th>ID</th><th>标题</th><th>模式</th><th>生成时间</th><th>操作</th></tr>${
    papers.map(p => `<tr><td>${p.id}</td><td>${esc(p.title)}</td><td>${esc(p.mode)}</td><td>${esc(p.created_at)}</td>
      <td><button class="btn sm" data-view="${p.id}">查看</button></td></tr>`).join('')}</table><div id="pView"></div>`;
  $$('[data-view]').forEach(b => b.onclick = async () => {
    const p = await api('GET', '/api/papers/' + b.dataset.view);
    const qs = JSON.parse(p.content || '[]');
    $('#pView').innerHTML = `<div class="card"><h3>${esc(p.title)}</h3>${qs.map((q, i) => `<div class="question"><div class="qmeta">第 ${i + 1} 题</div><div>${esc(q.content || q.content).replace(/\n/g, '<br>')}</div>${q.solution ? `<div class="qsol">${esc(q.solution)}</div>` : ''}</div>`).join('')}</div>`;
  });
}

/* ---------- 题库管理：浏览 / 复制 / 编辑 / 隐藏解析 ---------- */
async function bankView(c) {
  if (!gate(c)) return;
  const m = state.meta;
  c.innerHTML = `<div class="page-title">题库管理</div>
    <div class="page-sub">点击任意题目可查看详情：复制题干/解析、隐藏解析、复制为新题、编辑修改。</div>
    <div class="card">
      <div class="row">
        <select id="b_grade">${opt(m.grades, '', '全部年级')}</select>
        <select id="b_topic">${opt(m.topics, '', '全部专题')}</select>
        <select id="b_type">${opt(m.types, '', '全部题型')}</select>
        <select id="b_diff">${opt(m.difficulties, '', '全部难度')}</select>
        <input id="b_search" placeholder="搜索题干关键词" style="flex:2">
        <button class="btn" id="b_search_btn">查询</button>
        <button class="btn ghost" id="b_reset">重置</button>
      </div>
    </div>
    <div id="bankList"></div>`;
  const load = async () => {
    const q = new URLSearchParams();
    const g = $('#b_grade').value; if (g) q.set('grade', g);
    const t = $('#b_topic').value; if (t) q.set('topic', t);
    const ty = $('#b_type').value; if (ty) q.set('type', ty);
    const d = $('#b_diff').value; if (d) q.set('difficulty', d);
    const s = $('#b_search').value.trim(); if (s) q.set('search', s);
    q.set('limit', '100');
    const { questions } = await api('GET', '/api/questions?' + q.toString());
    $('#bankList').innerHTML = `<div class="muted mb">共 ${questions.length} 题</div>` + (questions.length ? questions.map(q => `<div class="question clickable" data-qid="${q.id}">
      <div class="qmeta">#${q.id} ${m.grades.find(g => g.id == q.grade_id)?.name || ''} · ${m.topics.find(t => t.id == q.topic_id)?.name || ''} · ${m.types.find(t => t.id == q.type_id)?.name || ''} · ${m.difficulties.find(d => d.id == q.difficulty_id)?.name || ''}</div>
      <div class="qcontent">${esc(q.content).slice(0, 220).replace(/\n/g, ' ')}${q.content.length > 220 ? '…' : ''}</div>
    </div>`).join('') : '<p class="muted">暂无题目</p>');
    $$('#bankList .question').forEach(el => el.onclick = () => openQuestionDetail(el.dataset.qid));
  };
  $('#b_search_btn').onclick = load;
  $('#b_search').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  $('#b_reset').onclick = () => { ['b_grade', 'b_topic', 'b_type', 'b_diff', 'b_search'].forEach(id => $('#' + id).value = ''); load(); };
  load();
}
async function openQuestionDetail(id) {
  const { question: q } = await api('GET', '/api/questions/' + id);
  const m = state.meta;
  const dn = (arr, v) => (arr.find(x => x.id == v)?.name || '');
  const modal = $('#qDetail');
  modal.innerHTML = `<h3>题目详情 <span class="muted" style="font-size:12px">#${q.id}</span></h3>
    <div class="qmeta mb">${dn(m.grades, q.grade_id)} · ${dn(m.topics, q.topic_id)} · ${dn(m.types, q.type_id)} · ${dn(m.difficulties, q.difficulty_id)} ${q.knowledge_point_id ? '· 知识点 ' + dn(m.knowledgePoints, q.knowledge_point_id) : ''}</div>
    <div id="qdView">
      <div class="qcontent" id="qdContent" style="white-space:pre-wrap;background:#fafcff;padding:10px;border-radius:8px">${esc(q.content)}</div>
      <div class="qsol" id="qdSol" style="white-space:pre-wrap">${esc(q.solution || '（无解析）')}</div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-act="copyContent">复制题干</button>
        <button class="btn sm" data-act="copySol">复制解析</button>
        <button class="btn sm" data-act="copyAll">复制全文</button>
        <button class="btn sm ghost" data-act="toggleSol">隐藏解析</button>
        ${state.admin ? '<button class="btn sm warn" data-act="edit">编辑</button><button class="btn sm ghost" data-act="duplicate">复制为新题</button><button class="btn sm danger" data-act="del">删除</button>' : ''}
      </div>
    </div>
    <div id="qdEdit" style="display:none"></div>`;
  $('#qDetailModal').style.display = 'flex';
  let solHidden = false;
  modal.querySelector('[data-act="toggleSol"]').onclick = (e) => { solHidden = !solHidden; $('#qdSol').style.display = solHidden ? 'none' : ''; e.target.textContent = solHidden ? '显示解析' : '隐藏解析'; };
  modal.querySelector('[data-act="copyContent"]').onclick = () => copyText(q.content);
  modal.querySelector('[data-act="copySol"]').onclick = () => copyText(q.solution || '');
  modal.querySelector('[data-act="copyAll"]').onclick = () => copyText('【题干】\n' + q.content + '\n\n【解析】\n' + (q.solution || ''));
  if (state.admin) {
    modal.querySelector('[data-act="duplicate"]').onclick = async () => { await api('POST', '/api/admin/questions', { content: q.content, solution: q.solution, grade_id: q.grade_id, topic_id: q.topic_id, type_id: q.type_id, difficulty_id: q.difficulty_id, knowledge_point_id: q.knowledge_point_id }); alert('已复制为新题'); $('#qDetailModal').style.display = 'none'; };
    modal.querySelector('[data-act="del"]').onclick = async () => { if (confirm('确认删除该题？')) { await api('DELETE', '/api/admin/questions/' + q.id); alert('已删除'); $('#qDetailModal').style.display = 'none'; } };
    modal.querySelector('[data-act="edit"]').onclick = () => showEditForm(q, m);
  }
}
function showEditForm(q, m) {
  const kpOpts = (sel) => '<option value="">未归类</option>' + m.knowledgePoints.filter(k => !q.grade_id || k.grade_id == q.grade_id).map(k => `<option value="${k.id}" ${k.id == sel ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
  $('#qdEdit').innerHTML = `<div class="field"><span>题干</span><textarea id="e_content" style="min-height:120px">${esc(q.content)}</textarea></div>
    <div class="field"><span>解析</span><textarea id="e_solution" style="min-height:100px">${esc(q.solution || '')}</textarea></div>
    <div class="row" style="gap:8px">
      <select id="e_grade">${opt(m.grades, q.grade_id, '年级')}</select>
      <select id="e_topic">${opt(m.topics, q.topic_id, '专题')}</select>
      <select id="e_type">${opt(m.types, q.type_id, '题型')}</select>
      <select id="e_diff">${opt(m.difficulties, q.difficulty_id, '难度')}</select>
    </div>
    <div class="field"><span>知识点</span><select id="e_kp">${kpOpts(q.knowledge_point_id)}</select></div>
    <div class="right" style="margin-top:8px"><button class="btn success" id="e_save">保存</button> <button class="btn ghost" id="e_cancel">取消</button></div>`;
  $('#qdView').style.display = 'none'; $('#qdEdit').style.display = '';
  $('#e_cancel').onclick = () => { $('#qdView').style.display = ''; $('#qdEdit').style.display = 'none'; };
  $('#e_save').onclick = async () => {
    await api('PUT', '/api/admin/questions/' + q.id, {
      content: $('#e_content').value, solution: $('#e_solution').value,
      grade_id: $('#e_grade').value || null, topic_id: $('#e_topic').value || null,
      type_id: $('#e_type').value || null, difficulty_id: $('#e_diff').value || null,
      knowledge_point_id: $('#e_kp').value || null
    });
    alert('已保存'); $('#qDetailModal').style.display = 'none';
  };
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => alert('已复制到剪贴板')).catch(() => fallbackCopy(t));
  } else fallbackCopy(t);
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); alert('已复制到剪贴板'); } catch { alert('复制失败，请手动选择文本'); }
  document.body.removeChild(ta);
}

/* ---------- 文本提取：知识点 + 习题 ---------- */
async function extractView(c) {
  if (!gate(c)) return;
  const m = state.meta;
  c.innerHTML = `<div class="page-title">文本提取 · 知识点与习题</div>
    <div class="page-sub">粘贴教材、讲义或试卷的一段文本，系统自动识别涉及的<b>知识点</b>并<b>拆分习题</b>；可逐条编辑后一键入库。</div>
    <div class="card">
      <textarea id="exText" style="min-height:160px" placeholder="在此粘贴文本（例如一段物理专题讲义，含若干习题）"></textarea>
      <div class="right" style="margin-top:8px"><button class="btn" id="exRun">提取知识点与习题</button></div>
    </div>
    <div id="exResult"></div>`;
  $('#exRun').onclick = async () => {
    const text = $('#exText').value;
    if (!text.trim()) { alert('请先粘贴文本'); return; }
    const { knowledgePoints, questions } = await api('POST', '/api/extract', { text });
    $('#exResult').innerHTML = `<div class="card"><h3>识别到的知识点（${knowledgePoints.length}）</h3>` +
      (knowledgePoints.length ? knowledgePoints.map(k => `<span class="tag">${esc(k.name)}</span>`).join(' ') : '<span class="muted">未匹配到已有知识点（不影响习题入库）</span>') + `</div>
      <div class="card"><h3>拆分习题（${questions.length}）</h3><div id="exQ"></div>
        <div class="right" style="margin-top:8px"><button class="btn success" id="exSaveAll">全部入库</button></div></div>`;
    const typeDefault = (name) => name === '选择题' ? 1 : name === '填空题' ? 2 : name === '实验题' ? 4 : 3;
    $('#exQ').innerHTML = questions.map((q, i) => `<div class="question" data-i="${i}">
      <div class="qmeta">习题 ${i + 1} ${q.typeName ? '<b>' + esc(q.typeName) + '</b>' : ''}</div>
      <textarea data-f="content" style="min-height:80px">${esc(q.content)}</textarea>
      <textarea data-f="solution" placeholder="解析" style="min-height:60px">${esc(q.solution)}</textarea>
      <div class="row" style="gap:8px;margin-top:6px">
        <select data-f="grade_id">${opt(m.grades, '', '年级')}</select>
        <select data-f="topic_id">${opt(m.topics, '', '专题')}</select>
        <select data-f="type_id">${opt(m.types, typeDefault(q.typeName), '题型')}</select>
        <select data-f="difficulty_id">${opt(m.difficulties, '', '难度')}</select>
      </div>
      <div class="right" style="margin-top:6px"><button class="btn sm success" data-save="${i}">入库此题</button></div>
    </div>`).join('');
    $$('#exQ [data-save]').forEach(b => b.onclick = async () => {
      const blk = $(`#exQ [data-i="${b.dataset.save}"]`);
      await api('POST', '/api/admin/questions', {
        content: blk.querySelector('[data-f="content"]').value,
        solution: blk.querySelector('[data-f="solution"]').value,
        grade_id: blk.querySelector('[data-f="grade_id"]').value || null,
        topic_id: blk.querySelector('[data-f="topic_id"]').value || null,
        type_id: blk.querySelector('[data-f="type_id"]').value || null,
        difficulty_id: blk.querySelector('[data-f="difficulty_id"]').value || null
      });
      b.textContent = '已入库 ✓'; b.disabled = true;
    });
    $('#exSaveAll').onclick = async () => {
      for (const blk of $$('#exQ .question')) {
        await api('POST', '/api/admin/questions', {
          content: blk.querySelector('[data-f="content"]').value,
          solution: blk.querySelector('[data-f="solution"]').value,
          grade_id: blk.querySelector('[data-f="grade_id"]').value || null,
          topic_id: blk.querySelector('[data-f="topic_id"]').value || null,
          type_id: blk.querySelector('[data-f="type_id"]').value || null,
          difficulty_id: blk.querySelector('[data-f="difficulty_id"]').value || null
        });
      }
      alert('全部入库完成');
    };
  };
}

/* ---------- 登录 ---------- */
function bindLogin() {
  $('#loginBtn').addEventListener('click', () => { if (!state.admin) openLogin(); });
  // Tab 切换
  $$('.login-tab').forEach(t => t.addEventListener('click', () => {
    $$('.login-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    const tab = t.dataset.tab;
    $('#panePwd').style.display = tab === 'pwd' ? '' : 'none';
    $('#paneSms').style.display = tab === 'sms' ? '' : 'none';
    $('#lgErr').textContent = '';
  }));
  // 密码登录
  $('#lgSubmit').addEventListener('click', async () => {
    try { await api('POST', '/api/login', { username: $('#lgUser').value, password: $('#lgPwd').value }); location.reload(); }
    catch (e) { $('#lgErr').textContent = e.message; }
  });
  // 获取验证码
  let smsTimer = null;
  $('#smsSend').addEventListener('click', async (e) => {
    const phone = $('#smsPhone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { $('#lgErr').textContent = '请输入正确的 11 位手机号'; return; }
    $('#lgErr').textContent = '';
    try {
      const r = await api('POST', '/api/sms/send', { phone });
      $('#smsTip').textContent = r.demo && r.devCode ? `演示验证码：${r.devCode}（生产环境将短信下发）` : (r.message || '验证码已发送');
      // 60 秒倒计时
      let left = 60; const btn = e.target;
      btn.disabled = true;
      const tick = () => { btn.textContent = `${left}s 后重发`; if (left-- <= 0) { clearInterval(smsTimer); btn.disabled = false; btn.textContent = '获取验证码'; } };
      tick(); smsTimer = setInterval(tick, 1000);
    } catch (err) { $('#lgErr').textContent = err.message; }
  });
  // 验证码登录
  $('#smsSubmit').addEventListener('click', async () => {
    const phone = $('#smsPhone').value.trim();
    const code = $('#smsCode').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { $('#lgErr').textContent = '请输入正确的手机号'; return; }
    if (!/^\d{6}$/.test(code)) { $('#lgErr').textContent = '请输入 6 位验证码'; return; }
    $('#lgErr').textContent = '';
    try { await api('POST', '/api/login/phone', { phone, code }); location.reload(); }
    catch (e) { $('#lgErr').textContent = e.message; }
  });
  $('#loginModal').addEventListener('click', (e) => { if (e.target.id === 'loginModal') $('#loginModal').style.display = 'none'; });
}
function openLogin() { $('#lgErr').textContent = ''; $('#loginModal').style.display = 'flex'; }

init();
