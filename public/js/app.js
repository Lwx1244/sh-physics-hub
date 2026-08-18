/* 上海高中物理平台 —— 前台交互 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

const state = { nav: null, tiers: [], topics: [], meta: null, admin: null, active: null };

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

/* ---------------- 移动端：抽屉式侧边栏 + 回顶 ---------------- */
function bindMobileShell() {
  const sb = $('#sidebar');
  const tg = $('#menuToggle');
  if (tg && sb) {
    tg.addEventListener('click', () => {
      sb.classList.toggle('open');
      document.body.classList.toggle('drawer-open', sb.classList.contains('open'));
    });
    // 点击抽屉外区域自动关闭
    document.body.addEventListener('click', (e) => {
      if (!sb.classList.contains('open')) return;
      if (sb.contains(e.target) || tg.contains(e.target)) return;
      sb.classList.remove('open');
      document.body.classList.remove('drawer-open');
    });
  }
  // 回顶
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
  try {
    const [navRes, metaRes, meRes] = await Promise.all([api('GET', '/api/nav'), api('GET', '/api/meta'), api('GET', '/api/me')]);
    state.nav = navRes.nav; state.tiers = navRes.tiers; state.topics = navRes.topics;
    state.meta = metaRes; state.admin = meRes.admin;
    renderSidebar();
    renderLoginState();
    bindMobileShell();
  } catch (e) { $('#sidebar').innerHTML = `<div class="empty">加载失败: ${esc(e.message)}</div>`; }
}

/* ---------------- 侧边导航树 ---------------- */
function renderSidebar() {
  const el = $('#sidebar');
  let html = '';
  // 前 4 个年级菜单
  for (const g of state.nav) {
    html += `<div class="menu-group">
      <div class="menu-title" data-toggle><span>${esc(g.grade.name)}</span><span class="caret">▶</span></div>
      <div class="sub">
        <div class="leaf" data-view="grade-kp" data-grade="${g.grade.id}">📘 知识点大全</div>
        <div class="leaf" data-view="grade-topic" data-grade="${g.grade.id}">📗 专题训练</div>
      </div></div>`;
  }
  // 独立入口
  html += `<div class="menu-group">
    <div class="menu-title" data-toggle><span>🏫 上海名校试卷库</span><span class="caret">▶</span></div>
    <div class="sub" id="tierSub">
      ${state.tiers.map(t => `<a data-view="papers" data-tier="${t.id}">${esc(t.name)}</a>`).join('')}
    </div></div>`;
  html += `<div class="menu-group">
    <div class="menu-title" data-view="group"><span>🧩 智能专题组卷系统</span></div></div>`;
  // 学生反馈与错题管理
  html += `<div class="menu-group">
    <div class="menu-title" data-toggle><span>👤 学生反馈与错题管理</span><span class="caret">▶</span></div>
    <div class="sub">
      <a data-view="students">学生档案库</a>
      <a data-view="error-entry">错题录入</a>
      <a data-view="score-entry">训练成绩录入</a>
      <a data-view="expand">错题定向拓展出题</a>
      <a data-view="report">学情数据分析报表</a>
    </div></div>`;
  el.innerHTML = html;

  $$('.menu-title', el).forEach(t => {
    t.addEventListener('click', () => {
      const sub = t.parentElement.querySelector('.sub');
      if (sub) { t.classList.toggle('open'); sub.classList.toggle('open'); }
      const view = t.dataset.view;
      if (view) route(view, {});
    });
  });
  $$('.leaf, .sub a', el).forEach(a => {
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      $$('.sub a, .leaf', el).forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      route(a.dataset.view, a.dataset);
      // 手机端：点击后自动收起抽屉
      const sb = $('#sidebar');
      if (sb && sb.classList.contains('open')) {
        sb.classList.remove('open');
        document.body.classList.remove('drawer-open');
      }
    });
  });
}

function route(view, ds = {}) {
  const c = $('#content');
  const titles = {
    'grade-kp': '知识点大全', 'grade-topic': '专题训练', 'papers': '上海名校试卷库',
    'group': '智能专题组卷系统', 'students': '学生档案库', 'error-entry': '错题录入',
    'score-entry': '训练成绩录入', 'expand': '错题定向拓展出题', 'report': '学情数据分析报表'
  };
  c.innerHTML = `<div class="page-title">${titles[view] || ''}</div><div class="page-sub">加载中…</div>`;
  const map = {
    'grade-kp': () => gradeKpView(ds.grade), 'grade-topic': () => gradeTopicView(ds.grade),
    'papers': () => papersView(ds.tier), 'group': groupView, 'students': studentListView,
    'error-entry': errorEntryView, 'score-entry': scoreEntryView, 'expand': expandView, 'report': reportView
  };
  (map[view] || (() => c.innerHTML = '<div class="empty">敬请期待</div>'))();
}

/* ---------------- 知识点大全 ---------------- */
async function gradeKpView(gradeId) {
  const c = $('#content');
  const kps = state.meta.knowledgePoints.filter(k => String(k.grade_id) === String(gradeId));
  const grade = state.nav.find(g => String(g.grade.id) === String(gradeId)).grade;
  if (!kps.length) { c.innerHTML = `<div class="page-title">${esc(grade.name)} · 知识点大全</div><div class="empty">暂无知识点，管理员可在后台新增。</div>`; return; }
  c.innerHTML = `<div class="page-title">${esc(grade.name)} · 知识点大全</div>
    <div class="page-sub">点击知识点查看讲解、例题与解析</div>
    <div class="grid cols-4" id="kpCards"></div>
    <div id="kpDetail"></div>`;
  $('#kpCards').innerHTML = kps.map(k => `<div class="tier-folder" data-kp="${k.id}">📌 ${esc(k.name)}</div>`).join('');
  $$('#kpCards .tier-folder').forEach(card => card.addEventListener('click', () => loadKp(card.dataset.kp)));
}
async function loadKp(id) {
  const kp = await api('GET', '/api/knowledge-points/' + id);
  $('#kpDetail').innerHTML = `<div class="card">
    <h3>${esc(kp.name)}</h3>
    <p>${esc(kp.description || '（暂无讲解）')}</p>
    ${kp.example ? `<div class="question"><div class="qmeta"><b>例题</b></div>${esc(kp.example).replace(/\n/g, '<br>')}</div>` : ''}
    ${kp.example_solution ? `<div class="question"><div class="qmeta"><b>解析</b></div>${esc(kp.example_solution).replace(/\n/g, '<br>')}</div>` : ''}
  </div>`;
  $('#kpDetail').scrollIntoView({ behavior: 'smooth' });
}

/* ---------------- 专题训练 ---------------- */
async function gradeTopicView(gradeId) {
  const c = $('#content');
  const grade = state.nav.find(g => String(g.grade.id) === String(gradeId)).grade;
  c.innerHTML = `<div class="page-title">${esc(grade.name)} · 专题训练</div>
    <div class="page-sub">选择专题查看讲义与专项练习</div>
    <div class="grid cols-4" id="tpCards"></div>
    <div id="tpDetail"></div>`;
  $('#tpCards').innerHTML = state.topics.map(t => `<div class="tier-folder" data-tp="${t.id}">🧩 ${esc(t.name)}</div>`).join('');
  $$('#tpCards .tier-folder').forEach(card => card.addEventListener('click', () => loadTopic(card.dataset.tp)));
}
async function loadTopic(id) {
  const t = await api('GET', '/api/topics/' + id);
  const exCount = t.exercises ? t.exercises.length : 0;
  const ex = (t.exercises || []).map(q => `<div class="question clickable" data-qid="${q.id}">
    <div class="qmeta">${tags(q)} <span class="muted">· 点击查看 / 复制 / 编辑</span></div>
    <div>${esc(q.content).replace(/\n/g, '<br>')}</div>
    ${q.solution ? `<div class="qsol"><b>解析：</b>${esc(q.solution).replace(/\n/g, '<br>')}</div>` : ''}
  </div>`).join('') || '<p class="muted">该专题暂无习题，管理员上传试卷或手动录入后可自动归入。</p>';
  $('#tpDetail').innerHTML = `<div class="card">
    <h3>${esc(t.name)} · 专题讲义</h3>
    <div style="white-space:pre-wrap">${esc(t.lecture || t.description || '（暂无讲义）')}</div>
  </div>
  <div class="card">
    <div class="flex-between">
      <h3 style="margin:0">专项练习题（${exCount}）</h3>
      ${exCount ? `<div>
        <button class="btn sm" id="tpDlWord">⬇ 整卷下载 Word</button>
        <button class="btn sm" id="tpDlText">⬇ 整卷下载 文本</button>
      </div>` : ''}
    </div>
    ${exCount ? `<p class="muted" style="font-size:12px">整卷下载会将全部 ${exCount} 道题列于前，解析统一附在卷末。</p>` : ''}
    ${ex}
  </div>`;
  if (exCount) {
    const items = (t.exercises || []).map(q => ({ content: q.content, solution: q.solution || '', type_id: q.type_id, difficulty_id: q.difficulty_id, grade_id: q.grade_id, topic_id: q.topic_id }));
    $('#tpDlWord').onclick = () => downloadWord(t.name + ' 专项练习题', items);
    $('#tpDlText').onclick = () => downloadText(t.name + ' 专项练习题', items);
  }
  $('#tpDetail').scrollIntoView({ behavior: 'smooth' });
}
function tags(q) {
  const m = state.meta;
  const tn = m.types.find(t => t.id === q.type_id)?.name || '';
  const dn = m.difficulties.find(d => d.id === q.difficulty_id)?.name || '';
  const gn = m.grades.find(g => g.id === q.grade_id)?.name || '';
  return [gn, tn, dn].filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join('');
}

/* ---------------- 名校试卷库 ---------------- */
async function papersView(tierId) {
  const c = $('#content');
  const res = await api('GET', '/api/resources' + (tierId ? '?tier=' + tierId : ''));
  const tiers = tierId ? [state.tiers.find(t => t.id == tierId)] : state.tiers;
  let html = `<div class="page-title">上海名校试卷库</div><div class="page-sub">原版试卷 PDF 在线预览 / 下载</div>`;
  html += `<div class="grid cols-4 mb">${state.tiers.map(t => `<div class="tier-folder" data-t="${t.id}" style="${String(t.id)===String(tierId)?'border-color:var(--primary)':''}">📁 ${esc(t.name)}</div>`).join('')}</div>`;
  html += `<div id="paperList"></div>`;
  c.innerHTML = html;
  $$('.tier-folder[data-t]').forEach(d => d.addEventListener('click', () => papersView(d.dataset.t)));
  renderPaperList(res.resources, tierId);
}
async function renderPaperList(resources, tierId) {
  const box = $('#paperList');
  if (!resources.length) { box.innerHTML = '<div class="empty">该分类暂无试卷，管理员可上传。</div>'; return; }
  box.innerHTML = `<div class="grid cols-3">${resources.map(r => {
    const tier = state.tiers.find(t => t.id == r.tier_id);
    return `<div class="card">
      <h3>📄 ${esc(r.title)}</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">${tier ? esc(tier.name) : ''} · ${esc(r.original_filename || '')} · ${r.parsed ? '已拆分入库' : '未拆分'}</div>
      <div class="row">
        <button class="btn sm" data-prev="${r.id}">预览</button>
        <a class="btn sm ghost" href="/uploads/${esc(r.file_path)}" target="_blank">下载</a>
        ${state.admin ? `<button class="btn sm warn" data-parse="${r.id}">两步解析入库</button>` : ''}
      </div>
      <div data-pframe="${r.id}" style="display:none;margin-top:10px"></div>
    </div>`;
  }).join('')}</div>`;
  $$('[data-prev]', box).forEach(b => b.addEventListener('click', () => {
    const f = $(`[data-pframe="${b.dataset.prev}"]`, box);
    f.style.display = f.style.display === 'none' ? 'block' : 'none';
    f.innerHTML = `<iframe class="pdf-frame" src="/uploads/${esc(resources.find(r => r.id == b.dataset.prev).file_path)}"></iframe>`;
  }));
  $$('[data-parse]', box).forEach(b => b.addEventListener('click', () => parseFlow(b.dataset.parse)));
}

/* 两步入库：解析 -> 预览 -> 确认 */
async function parseFlow(rid) {
  if (!state.admin) { alert('请先登录管理员'); return; }
  const r = await api('GET', '/api/resources/' + rid);
  const { questions } = await api('POST', '/api/admin/resources/' + rid + '/parse');
  const m = state.meta;
  const box = $('#paperList');
  const panel = document.createElement('div');
  panel.className = 'card';
  panel.innerHTML = `<h3>解析预览（第 2 步：确认题目分类后入库）</h3>
    <div class="muted mb">系统自动识别 ${questions.length} 道题，请核实分类，可修改后批量入库。</div>
    <div id="qEdit"></div>
    <div class="right"><button class="btn success" id="commitBtn">确认入库（${questions.length}题）</button></div>`;
  box.prepend(panel);
  const qEdit = $('#qEdit', panel);
  qEdit.innerHTML = questions.map((q, i) => `
    <div class="question" data-i="${i}">
      <div class="qmeta">题 ${i + 1}</div>
      <div style="white-space:pre-wrap;margin-bottom:6px">${esc(q.content)}</div>
      <div class="row" style="gap:8px">
        <select data-f="grade_id">${opt(m.grades, q.grade_id, 'grade')}</select>
        <select data-f="topic_id">${opt(m.topics, q.topic_id, 'topic')}</select>
        <select data-f="type_id">${opt(m.types, q.type_id, 'type')}</select>
        <select data-f="difficulty_id">${opt(m.difficulties, q.difficulty_id, 'diff')}</select>
      </div>
      <textarea data-f="solution" placeholder="答案解析" style="margin-top:6px">${esc(q.solution)}</textarea>
    </div>`).join('');
  // 默认填充：依据资源年级/梯队，类型按启发式
  questions.forEach((q, i) => {
    const blk = qEdit.querySelector(`[data-i="${i}"]`);
    if (r.grade_id && !q.grade_id) blk.querySelector('[data-f="grade_id"]').value = r.grade_id;
  });
  $('#commitBtn', panel).addEventListener('click', async () => {
    const out = questions.map((q, i) => {
      const blk = qEdit.querySelector(`[data-i="${i}"]`);
      return {
        content: q.content,
        grade_id: blk.querySelector('[data-f="grade_id"]').value || null,
        topic_id: blk.querySelector('[data-f="topic_id"]').value || null,
        type_id: blk.querySelector('[data-f="type_id"]').value || null,
        difficulty_id: blk.querySelector('[data-f="difficulty_id"]').value || null,
        solution: blk.querySelector('[data-f="solution"]').value
      };
    });
    await api('POST', '/api/admin/resources/' + rid + '/commit', { questions: out });
    alert('已入库 ' + out.length + ' 题，题库已更新！');
    papersView(r.tier_id);
  });
}
function opt(list, sel, kind) {
  const def = kind === 'topic' ? '选择专题' : kind === 'type' ? '选择题型' : kind === 'diff' ? '选择难度' : '选择年级';
  return `<option value="">${def}</option>` + list.map(x => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}

/* ---------------- 智能专题组卷系统（调题 / 在线编辑 / 下载） ---------------- */
function nameOf(arr, id) { return (arr.find(x => x.id == id) || {}).name || ''; }
function saveBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/* 将题目数组渲染为 Word 兼容 HTML（解析统一放在卷末） */
function paperToWordHtml(title, items) {
  const qBlock = items.map((it, i) => `<p style="margin:6px 0"><b>${i + 1}.</b> ${esc(it.content).replace(/\n/g, '<br>')}</p>`).join('');
  const aBlock = items.map((it, i) => `<p style="margin:6px 0"><b>${i + 1}.</b> ${esc(it.content).replace(/\n/g, '<br>')}<br><span style="color:#1d4ed8">解析：${esc(it.solution || '').replace(/\n/g, '<br>')}</span></p>`).join('');
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${esc(title)}</title></head>
<body><h1 style="text-align:center">${esc(title)}</h1>
<h2>一、题目</h2>${qBlock}
<h2>二、参考答案与解析</h2>${aBlock}</body></html>`;
}
function downloadWord(title, items) {
  const html = paperToWordHtml(title, items);
  saveBlob(new Blob(['﻿' + html], { type: 'application/msword' }), (title || 'paper') + '.doc');
}
function downloadText(title, items) {
  let s = (title || 'paper') + '\n\n一、题目\n';
  items.forEach((it, i) => { s += (i + 1) + '. ' + it.content + '\n'; });
  s += '\n二、参考答案与解析\n';
  items.forEach((it, i) => { s += (i + 1) + '. ' + it.content + '\n解析：' + (it.solution || '') + '\n'; });
  saveBlob(new Blob([s], { type: 'text/plain;charset=utf-8' }), (title || 'paper') + '.txt');
}
function printPaperBuilder(title, items) {
  const w = window.open('', '_blank');
  w.document.write(`<html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:"Microsoft YaHei";padding:30px;max-width:820px;margin:auto}h1{text-align:center;border-bottom:1px solid #ccc;padding-bottom:8px}h2{margin-top:24px}@media print{.nop{display:none}}</style></head>
    <body><h1>${esc(title)}</h1><h2>一、题目</h2>${items.map((it, i) => `<p><b>${i + 1}.</b> ${esc(it.content).replace(/\n/g, '<br>')}</p>`).join('')}
    <h2>二、参考答案与解析</h2>${items.map((it, i) => `<p><b>${i + 1}.</b> ${esc(it.content).replace(/\n/g, '<br>')}<br><i>解析：${esc(it.solution || '').replace(/\n/g, '<br>')}</i></p>`).join('')}
    <button class="nop" onclick="window.print()">打印</button></body></html>`);
  w.document.close();
}

let builder = { title: '', items: [] };
let builderEditing = -1;

function groupView() {
  const c = $('#content');
  const m = state.meta;
  builder = { title: '自定义专题训练卷', items: [] };
  builderEditing = -1;
  c.innerHTML = `<div class="page-title">智能专题组卷系统</div>
    <div class="page-sub">从已有题库筛选 / 搜索题目加入试卷，可在线编辑、排序、增删自定义题，最后导出 Word / 文本 / 打印 PDF（解析统一附在卷末）。</div>
    <div class="grid cols-2">
      <div class="card">
        <h3>① 从题库选取题目</h3>
        <div class="row">
          <select id="b_grade">${opt(m.grades, '', '全部年级')}</select>
          <select id="b_topic">${opt(m.topics, '', '全部专题')}</select>
        </div>
        <div class="row">
          <select id="b_type">${opt(m.types, '', '全部题型')}</select>
          <select id="b_diff">${opt(m.difficulties, '', '全部难度')}</select>
        </div>
        <label class="field"><span>搜索题干关键词</span><input id="b_search" placeholder="如：圆周运动、动量、折射"></label>
        <div class="right" style="margin-top:4px">
          <button class="btn" id="b_search_btn">搜索题库</button>
          <input id="smartN" type="number" value="10" min="1" max="50" style="width:70px;flex:0 0 auto"> 题
          <button class="btn ghost" id="b_smart">智能抽题</button>
        </div>
        <div id="builderBank" class="mt"></div>
      </div>
      <div class="card">
        <h3>② 组卷与编辑</h3>
        <label class="field"><span>试卷标题</span><input id="paperTitle" value="自定义专题训练卷"></label>
        <div class="right" style="margin-bottom:8px">
          <button class="btn sm" id="addCustom">+ 添加自定义题</button>
          <button class="btn sm ghost" id="clearPaper">清空</button>
        </div>
        <div id="paperList"></div>
        <div class="flex-between mt">
          <div>
            <button class="btn sm success" id="savePaper">保存试卷</button>
            <button class="btn sm" id="dlWord">⬇ Word</button>
            <button class="btn sm" id="dlText">⬇ 文本</button>
            <button class="btn sm" id="dlPrint">🖨 打印</button>
          </div>
          <span class="muted" id="paperCount"></span>
        </div>
      </div>
    </div>`;
  $('#b_search_btn').onclick = builderSearch;
  $('#b_search').addEventListener('keydown', e => { if (e.key === 'Enter') builderSearch(); });
  $('#b_smart').onclick = builderSmart;
  $('#addCustom').onclick = () => {
    builder.items.push({ id: null, content: '', solution: '', type_id: null, difficulty_id: null, grade_id: null, topic_id: null, custom: true });
    builderEditing = builder.items.length - 1; builderRender();
  };
  $('#clearPaper').onclick = () => { if (confirm('确认清空当前试卷？')) { builder.items = []; builderRender(); } };
  $('#paperTitle').addEventListener('input', e => builder.title = e.target.value);
  $('#savePaper').onclick = builderSave;
  $('#dlWord').onclick = () => downloadWord(builder.title, builder.items);
  $('#dlText').onclick = () => downloadText(builder.title, builder.items);
  $('#dlPrint').onclick = () => printPaperBuilder(builder.title, builder.items);
  builderRender();
}

function builderFilterQuery() {
  const q = new URLSearchParams();
  if ($('#b_grade').value) q.set('grade', $('#b_grade').value);
  if ($('#b_topic').value) q.set('topic', $('#b_topic').value);
  if ($('#b_type').value) q.set('type', $('#b_type').value);
  if ($('#b_diff').value) q.set('difficulty', $('#b_diff').value);
  const s = $('#b_search').value.trim(); if (s) q.set('search', s);
  return q;
}

async function builderSearch() {
  const q = builderFilterQuery(); q.set('limit', '100');
  try {
    const { questions } = await api('GET', '/api/questions?' + q.toString());
    const box = $('#builderBank');
    if (!questions.length) { box.innerHTML = '<p class="muted">未找到匹配题目，请放宽条件。</p>'; return; }
    box.innerHTML = `<div class="muted mb">匹配 ${questions.length} 题（点击"加入试卷"）</div>` + questions.map(qq => {
      const tags = [nameOf(state.meta.grades, qq.grade_id), nameOf(state.meta.topics, qq.topic_id), nameOf(state.meta.types, qq.type_id), nameOf(state.meta.difficulties, qq.difficulty_id)].filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join(' ');
      return `<div class="question" style="padding:8px 10px;margin-bottom:6px">
        <div class="qmeta">${tags}</div>
        <div class="qcontent" style="font-size:13px">${esc(qq.content).slice(0, 160).replace(/\n/g, ' ')}${qq.content.length > 160 ? '…' : ''}</div>
        <div class="right" style="margin-top:4px"><button class="btn sm" data-add="${qq.id}">加入试卷</button></div></div>`;
    }).join('');
    $$('#builderBank [data-add]').forEach(b => b.onclick = () => builderAddFromBank(Number(b.dataset.add)));
  } catch (e) { alert(e.message); }
}

async function builderAddFromBank(id) {
  const { question: q } = await api('GET', '/api/questions/' + id);
  builder.items.push({ id: q.id, content: q.content, solution: q.solution || '', type_id: q.type_id, difficulty_id: q.difficulty_id, grade_id: q.grade_id, topic_id: q.topic_id });
  builderRender();
  $('#paperList').scrollIntoView({ behavior: 'smooth' });
}

async function builderSmart() {
  const q = builderFilterQuery(); q.set('limit', '200');
  try {
    const { questions } = await api('GET', '/api/questions?' + q.toString());
    if (!questions.length) { alert('未匹配到题目，请放宽筛选条件'); return; }
    const n = Math.min(Number($('#smartN').value) || 10, questions.length);
    const pool = [...questions];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.slice(0, n).forEach(qq => builder.items.push({ id: qq.id, content: qq.content, solution: qq.solution || '', type_id: qq.type_id, difficulty_id: qq.difficulty_id, grade_id: qq.grade_id, topic_id: qq.topic_id }));
    builderRender();
  } catch (e) { alert(e.message); }
}

function builderRender() {
  const box = $('#paperList');
  $('#paperCount').textContent = `共 ${builder.items.length} 题`;
  if (!builder.items.length) { box.innerHTML = '<p class="muted">试卷为空，请从左侧题库加入题目，或点击"添加自定义题"。</p>'; return; }
  const m = state.meta;
  box.innerHTML = builder.items.map((it, i) => {
    const tags = [nameOf(m.grades, it.grade_id), nameOf(m.topics, it.topic_id), nameOf(m.types, it.type_id), nameOf(m.difficulties, it.difficulty_id)].filter(Boolean).map(x => `<span class="tag">${esc(x)}</span>`).join(' ');
    if (builderEditing === i) {
      return `<div class="question" data-i="${i}" style="border-color:var(--primary)">
        <div class="qmeta">第 ${i + 1} 题 ${tags} ${it.custom ? '<span class="tag">自定义</span>' : ''}</div>
        <textarea id="e_c" style="min-height:90px;margin-bottom:6px">${esc(it.content)}</textarea>
        <textarea id="e_s" placeholder="解析" style="min-height:60px;margin-bottom:6px">${esc(it.solution)}</textarea>
        <div class="row" style="gap:8px">
          <select id="e_t">${opt(m.types, it.type_id, '题型')}</select>
          <select id="e_d">${opt(m.difficulties, it.difficulty_id, '难度')}</select>
        </div>
        <div class="right" style="margin-top:6px"><button class="btn sm success" id="e_save">保存</button> <button class="btn sm ghost" id="e_cancel">取消</button></div>
      </div>`;
    }
    return `<div class="question" data-i="${i}">
      <div class="qmeta">第 ${i + 1} 题 ${tags} ${it.custom ? '<span class="tag">自定义</span>' : ''}
        <span style="float:right">
          <button class="btn sm ghost" data-up="${i}">↑</button>
          <button class="btn sm ghost" data-down="${i}">↓</button>
          <button class="btn sm" data-edit="${i}">编辑</button>
          <button class="btn sm danger" data-del="${i}">删除</button>
        </span>
      </div>
      <div class="qcontent">${esc(it.content).replace(/\n/g, '<br>')}</div>
      ${it.solution ? `<div class="qsol">解析：${esc(it.solution).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`;
  }).join('');
  $$('#paperList [data-edit]').forEach(b => b.onclick = () => { builderEditing = Number(b.dataset.edit); builderRender(); });
  $$('#paperList [data-del]').forEach(b => b.onclick = () => { builder.items.splice(Number(b.dataset.del), 1); builderRender(); });
  $$('#paperList [data-up]').forEach(b => b.onclick = () => { const i = Number(b.dataset.up); if (i > 0) { [builder.items[i - 1], builder.items[i]] = [builder.items[i], builder.items[i - 1]]; builderRender(); } });
  $$('#paperList [data-down]').forEach(b => b.onclick = () => { const i = Number(b.dataset.down); if (i < builder.items.length - 1) { [builder.items[i + 1], builder.items[i]] = [builder.items[i], builder.items[i + 1]]; builderRender(); } });
  const es = $('#e_save'); if (es) es.onclick = () => { const i = builderEditing; builder.items[i].content = $('#e_c').value; builder.items[i].solution = $('#e_s').value; builder.items[i].type_id = $('#e_t').value || null; builder.items[i].difficulty_id = $('#e_d').value || null; builder.items[i].custom = true; builderEditing = -1; builderRender(); };
  const ec = $('#e_cancel'); if (ec) ec.onclick = () => { builderEditing = -1; builderRender(); };
}

async function builderSave() {
  if (!state.admin) { alert('请先登录管理员账号后再保存试卷'); return; }
  if (!builder.items.length) { alert('试卷为空，无法保存'); return; }
  try {
    const r = await api('POST', '/api/papers/save', {
      title: builder.title || '自定义专题训练卷',
      questions: builder.items.map(it => ({ content: it.content, solution: it.solution, type_id: it.type_id, difficulty_id: it.difficulty_id, grade_id: it.grade_id, topic_id: it.topic_id }))
    });
    alert('试卷已保存（ID ' + r.paperId + '），可在后台"组卷历史"查看。');
  } catch (e) { alert(e.message); }
}

/* 渲染生成的试卷（含预览/打印，用于错题拓展等） */
function renderPaper(questions, title, paperId) {
  const box = $('#genResult');
  const list = questions.map((q, i) => `<div class="question">
    <div class="qmeta">第 ${i + 1} 题 ${q.gradeName ? `<b>${esc(q.gradeName)}</b>` : ''} ${q.topicName ? `<b>${esc(q.topicName)}</b>` : ''} ${q.typeName ? `<b>${esc(q.typeName)}</b>` : ''} ${q.difficultyName ? `<b>${esc(q.difficultyName)}</b>` : ''}</div>
    <div>${esc(q.content).replace(/\n/g, '<br>')}</div>
    ${q.solution ? `<div class="qsol"><b>答案/解析：</b>${esc(q.solution).replace(/\n/g, '<br>')}</div>` : ''}
  </div>`).join('') || '<p class="muted">未匹配到题目，请放宽筛选条件。</p>';
  box.innerHTML = `<div class="card">
    <div class="flex-between"><h3>${esc(title)}（共 ${questions.length} 题）</h3>
      <div><button class="btn sm" id="printBtn">🖨 打印 / 下载</button></div></div>
    ${list}</div>`;
  $('#printBtn').addEventListener('click', () => printPaper(questions, title));
}

function printPaper(questions, title) {
  const w = window.open('', '_blank');
  const body = questions.map((q, i) => `<p><b>${i + 1}.</b> ${esc(q.content).replace(/\n/g, '<br>')}<br><i>答案：${esc(q.solution || '').replace(/\n/g, '<br>')}</i></p>`).join('');
  w.document.write(`<html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>body{font-family:"Microsoft YaHei";padding:30px;max-width:800px;margin:auto}h1{text-align:center;border-bottom:1px solid #ccc;padding-bottom:8px}i{color:#1d4ed8}@media print{.nop{display:none}}</style></head>
    <body><h1>${esc(title)}</h1>${body}<button class="nop" onclick="window.print()">打印</button></body></html>`);
  w.document.close();
}

/* ---------------- 学生档案库 ---------------- */
async function studentListView() {
  const c = $('#content');
  const { students } = await api('GET', '/api/students');
  let html = `<div class="page-title">学生档案库</div>
    <div class="page-sub">管理每位学生的学情档案、错题与成绩</div>`;
  if (state.admin) html += `<button class="btn mb" id="addStu">+ 新建学生档案</button><div id="stuForm"></div>`;
  if (!students.length) html += '<div class="empty">暂无学生档案，管理员可新建。</div>';
  html += `<div class="grid cols-3" id="stuCards"></div><div id="stuActions"></div>`;
  c.innerHTML = html;
  $('#stuCards').innerHTML = students.map(s => {
    const tier = state.tiers.find(t => t.id == s.school_tier_id);
    const grade = state.meta.grades.find(g => g.id == s.grade_id);
    let weak = []; try { weak = JSON.parse(s.weak_topics || '[]'); } catch {}
    const weakNames = weak.map(id => state.topics.find(t => t.id == id)?.name).filter(Boolean);
    return `<div class="card">
      <h3>👤 ${esc(s.name)}</h3>
      <div class="muted" style="font-size:12px">${grade ? esc(grade.name) : ''} · ${esc(s.school_name || '')} ${tier ? '（' + esc(tier.name) + '）' : ''}</div>
      <p style="font-size:13px">${esc(s.overall_desc || '暂无描述')}</p>
      ${weakNames.length ? `<div>薄弱专题：${weakNames.map(n => `<span class="tag">${esc(n)}</span>`).join('')}</div>` : ''}
      <div class="row mt">
        <button class="btn sm" data-report="${s.id}">学情报表</button>
        <button class="btn sm warn" data-err="${s.id}">录入错题</button>
        <button class="btn sm" data-score="${s.id}">录入成绩</button>
        <button class="btn sm ghost" data-expand="${s.id}">拓展出题</button>
        ${state.admin ? `<button class="btn sm danger" data-del="${s.id}">删除</button>` : ''}
      </div></div>`;
  }).join('');
  $$('[data-report]').forEach(b => b.addEventListener('click', () => reportView(b.dataset.report)));
  $$('[data-err]').forEach(b => b.addEventListener('click', () => errorEntryView(b.dataset.err)));
  $$('[data-score]').forEach(b => b.addEventListener('click', () => scoreEntryView(b.dataset.score)));
  $$('[data-expand]').forEach(b => b.addEventListener('click', () => expandView(b.dataset.expand)));
  $$('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('确认删除该学生及其错题、成绩？')) return;
    await api('DELETE', '/api/admin/students/' + b.dataset.del);
    studentListView();
  }));
  if (state.admin) $('#addStu').addEventListener('click', () => stuForm());
}
function stuForm(preset) {
  const m = state.meta;
  $('#stuForm').innerHTML = `<div class="card">
    <h3>新建学生档案</h3>
    <div class="row">
      <label class="field"><span>姓名</span><input id="s_name" value="${preset ? esc(preset.name) : ''}"></label>
      <label class="field"><span>年级</span><select id="s_grade">${opt(m.grades)}</select></label>
    </div>
    <div class="row">
      <label class="field"><span>高中学校</span><input id="s_school" placeholder="如：上海中学"></label>
      <label class="field"><span>学校梯队</span><select id="s_tier">${opt(state.tiers)}</select></label>
    </div>
    <label class="field"><span>整体学习情况</span><textarea id="s_desc"></textarea></label>
    <label class="field"><span>薄弱专题（可多选）</span><div class="chips" id="s_weak">${m.topics.map(t => `<span class="chip" data-id="${t.id}">${esc(t.name)}</span>`).join('')}</div></label>
    <div class="right"><button class="btn success" id="s_save">保存档案</button></div>
  </div>`;
  $$('#s_weak .chip').forEach(ch => ch.addEventListener('click', () => ch.classList.toggle('on')));
  $('#s_save').addEventListener('click', async () => {
    const weak = $$('#s_weak .chip.on').map(c => Number(c.dataset.id));
    await api('POST', '/api/admin/students', {
      name: $('#s_name').value, grade_id: $('#s_grade').value || null,
      school_name: $('#s_school').value, school_tier_id: $('#s_tier').value || null,
      overall_desc: $('#s_desc').value, weak_topics: weak
    });
    alert('已保存'); $('#stuForm').innerHTML = ''; studentListView();
  });
}

/* ---------------- 错题录入 ---------------- */
async function errorEntryView(presetStudent) {
  const c = $('#content');
  if (!state.admin) { c.innerHTML = '<div class="empty">错题录入为管理员功能，请先登录。</div>'; return; }
  const { students } = await api('GET', '/api/students');
  const m = state.meta;
  c.innerHTML = `<div class="page-title">错题录入</div>
    <div class="page-sub">选择学生，录入错题并绑定知识点 / 专题 / 题型 / 错误原因</div>
    <div class="card">
      <div class="row">
        <label class="field"><span>选择学生</span><select id="e_stu">${students.map(s => `<option value="${s.id}" ${String(s.id) === String(presetStudent) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>错题来源</span><input id="e_src" placeholder="试卷名 / 习题册 / 专题卷"></label>
      </div>
      <label class="field"><span>题干（可粘贴文本）</span><textarea id="e_content"></textarea></label>
      <label class="field"><span>错题图片 / PDF（可选）</span><input type="file" id="e_img"></label>
      <div class="row">
        <label class="field"><span>知识点</span><select id="e_kp">${opt(m.knowledgePoints)}</select></label>
        <label class="field"><span>专题</span><select id="e_topic">${opt(m.topics)}</select></label>
        <label class="field"><span>题型</span><select id="e_type">${opt(m.types)}</select></label>
        <label class="field"><span>难度</span><select id="e_diff">${opt(m.difficulties)}</select></label>
      </div>
      <label class="field"><span>错误原因</span><select id="e_reason">
        <option value="概念不清">概念不清</option><option value="计算失误">计算失误</option>
        <option value="审题错误">审题错误</option><option value="方法不当">方法不当</option><option value="其他">其他</option></select></label>
      <div class="right"><button class="btn success" id="e_save">保存错题</button></div>
    </div>
    <div id="eList"></div>`;
  if (presetStudent) loadErrorList(presetStudent);
  $('#e_stu').addEventListener('change', () => loadErrorList($('#e_stu').value));
  $('#e_save').addEventListener('click', async () => {
    const fd = new FormData();
    fd.append('student_id', $('#e_stu').value);
    fd.append('source_name', $('#e_src').value);
    fd.append('content', $('#e_content').value);
    fd.append('knowledge_point_id', $('#e_kp').value || '');
    fd.append('topic_id', $('#e_topic').value || '');
    fd.append('type_id', $('#e_type').value || '');
    fd.append('difficulty_id', $('#e_diff').value || '');
    fd.append('error_reason', $('#e_reason').value);
    const f = $('#e_img').files[0]; if (f) fd.append('image', f);
    await api('POST', '/api/admin/errors', fd);
    alert('错题已录入'); $('#e_content').value = ''; loadErrorList($('#e_stu').value);
  });
}
async function loadErrorList(sid) {
  const { errors } = await api('GET', '/api/students/' + sid + '/errors');
  $('#eList').innerHTML = `<h3 class="mt">该生错题（${errors.length}）</h3>` + (errors.length ? errors.map(e => {
    const tn = state.topics.find(t => t.id == e.topic_id)?.name;
    const kn = state.meta.knowledgePoints.find(k => k.id == e.knowledge_point_id)?.name;
    return `<div class="question"><div class="qmeta">${tn ? `<b>${esc(tn)}</b>` : ''} ${kn ? `<b>${esc(kn)}</b>` : ''} ${e.error_reason ? `<span class="tag">${esc(e.error_reason)}</span>` : ''}</div>
      <div>${esc(e.content).replace(/\n/g, '<br>')}</div>
      ${e.image_path ? `<a href="/uploads/${esc(e.image_path)}" target="_blank">查看图片</a>` : ''}
      ${state.admin ? `<button class="btn sm danger" data-edel="${e.id}">删除</button>` : ''}</div>`;
  }).join('') : '<p class="muted">暂无错题</p>');
  $$('[data-edel]').forEach(b => b.addEventListener('click', async () => { await api('DELETE', '/api/admin/errors/' + b.dataset.edel); loadErrorList(sid); }));
}

/* ---------------- 训练成绩录入 ---------------- */
async function scoreEntryView(presetStudent) {
  const c = $('#content');
  if (!state.admin) { c.innerHTML = '<div class="empty">成绩录入为管理员功能，请先登录。</div>'; return; }
  const { students } = await api('GET', '/api/students');
  const m = state.meta;
  c.innerHTML = `<div class="page-title">训练成绩录入</div>
    <div class="page-sub">录入每次练习 / 测试成绩，含专题、题型分项得分，用于学情趋势分析</div>
    <div class="card">
      <div class="row">
        <label class="field"><span>选择学生</span><select id="sc_stu">${students.map(s => `<option value="${s.id}" ${String(s.id) === String(presetStudent) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field"><span>测试名称</span><input id="sc_name" placeholder="如：高二期中"></label>
        <label class="field"><span>测试日期</span><input type="date" id="sc_date"></label>
      </div>
      <div class="row">
        <label class="field"><span>满分</span><input type="number" id="sc_full" value="100"></label>
        <label class="field"><span>实际得分</span><input type="number" id="sc_score" value="0"></label>
      </div>
      <label class="field"><span>各专题得分（分项：每项 专题 + 得分 + 满分）</span><div id="sc_topic"></div><button class="btn sm ghost" id="sc_addTopic">+ 添加专题分项</button></div>
      <label class="field"><span>各题型得分</span><div id="sc_type"></div><button class="btn sm ghost" id="sc_addType">+ 添加题型分项</button></label>
      <label class="field"><span>文字备注 / 学习建议</span><textarea id="sc_note"></textarea></label>
      <div class="right"><button class="btn success" id="sc_save">保存成绩</button></div>
    </div>
    <div id="scList"></div>`;
  const topicRow = () => `<div class="row sc-tr" style="gap:8px;margin-bottom:6px"><select class="sc-tid">${opt(m.topics)}</select><input class="sc-s" type="number" placeholder="得分"><input class="sc-f" type="number" placeholder="满分"></div>`;
  const typeRow = () => `<div class="row sc-tr" style="gap:8px;margin-bottom:6px"><select class="sc-tid">${opt(m.types)}</select><input class="sc-s" type="number" placeholder="得分"><input class="sc-f" type="number" placeholder="满分"></div>`;
  const addRows = (box, rowFn) => { $(box).insertAdjacentHTML('beforeend', rowFn()); };
  addRows('#sc_topic', topicRow); addRows('#sc_type', typeRow);
  $('#sc_addTopic').addEventListener('click', () => addRows('#sc_topic', topicRow));
  $('#sc_addType').addEventListener('click', () => addRows('#sc_type', typeRow));
  $('#sc_save').addEventListener('click', async () => {
    const collect = (box) => $$(box + ' .sc-tr').map(r => ({
      id: Number(r.querySelector('.sc-tid').value), score: Number(r.querySelector('.sc-s').value) || 0, full: Number(r.querySelector('.sc-f').value) || 0
    })).filter(x => x.id);
    const body = {
      student_id: $('#sc_stu').value, exam_name: $('#sc_name').value, exam_date: $('#sc_date').value,
      full_score: Number($('#sc_full').value), score: Number($('#sc_score').value),
      topic_scores: collect('#sc_topic'), type_scores: collect('#sc_type'), kp_scores: [], difficulty_scores: [], note: $('#sc_note').value
    };
    await api('POST', '/api/admin/scores', body);
    alert('成绩已保存'); loadScoreList($('#sc_stu').value);
  });
  if (presetStudent) loadScoreList(presetStudent);
  $('#sc_stu').addEventListener('change', () => loadScoreList($('#sc_stu').value));
}
async function loadScoreList(sid) {
  const { scores } = await api('GET', '/api/students/' + sid + '/scores');
  $('#scList').innerHTML = `<h3 class="mt">历史成绩（${scores.length}）</h3>` + (scores.length ? `<table><tr><th>测试</th><th>日期</th><th>得分/满分</th><th>正确率</th><th>备注</th><th></th></tr>${
    scores.map(s => `<tr><td>${esc(s.exam_name)}</td><td>${esc(s.exam_date)}</td><td>${s.score}/${s.full_score}</td><td>${s.full_score ? Math.round(s.score / s.full_score * 1000) / 10 + '%' : '-'}</td><td>${esc(s.note || '')}</td><td>${state.admin ? `<button class="btn sm danger" data-scdel="${s.id}">删</button>` : ''}</td></tr>`).join('')
  }</table>` : '<p class="muted">暂无成绩</p>');
  $$('[data-scdel]').forEach(b => b.addEventListener('click', async () => { await api('DELETE', '/api/admin/scores/' + b.dataset.scdel); loadScoreList(sid); }));
}

/* ---------------- 错题定向拓展出题 ---------------- */
async function expandView(presetStudent) {
  const c = $('#content');
  if (!state.admin) { c.innerHTML = '<div class="empty">该功能为管理员功能，请先登录。</div>'; return; }
  const { students } = await api('GET', '/api/students');
  c.innerHTML = `<div class="page-title">错题定向拓展出题</div>
    <div class="page-sub">① 错题重做：提取该生全部错题生成重做卷；② 同类拓展：按错题考点/题型/难度从大题库筛选全新巩固题</div>
    <div class="card">
      <label class="field"><span>选择学生</span><select id="x_stu">${students.map(s => `<option value="${s.id}" ${String(s.id) === String(presetStudent) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="row">
        <button class="btn" id="x_regen">① 错题重做卷</button>
        <button class="btn warn" id="x_expand">② 同类拓展巩固卷</button>
        <label class="field" style="flex:0 0 120px"><span>拓展题数</span><input type="number" id="x_count" value="10" min="1" max="50"></label>
      </div>
    </div>
    <div id="xResult"></div>`;
  $('#x_regen').addEventListener('click', async () => {
    const r = await api('POST', '/api/admin/errors/regenerate', { student_id: $('#x_stu').value });
    renderPaper(r.questions, r.title, r.paperId); $('#xResult').scrollIntoView();
  });
  $('#x_expand').addEventListener('click', async () => {
    const r = await api('POST', '/api/admin/errors/expand', { student_id: $('#x_stu').value, count: Number($('#x_count').value) });
    renderPaper(r.questions, r.title, r.paperId); $('#xResult').scrollIntoView();
    if (!r.questions.length) alert('该生错题暂无可匹配的拓展题目，建议先录入更多错题或在题库补充同考点题。');
  });
}

/* ---------------- 学情数据分析报表 ---------------- */
async function reportView(presetStudent) {
  const c = $('#content');
  const { students } = await api('GET', '/api/students');
  c.innerHTML = `<div class="page-title">学情数据分析报表</div>
    <div class="page-sub">基于成绩分项与错题本自动统计，识别薄弱考点</div>
    <div class="card"><label class="field"><span>选择学生</span><select id="r_stu">${students.map(s => `<option value="${s.id}" ${String(s.id) === String(presetStudent) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div>
    <div id="rBody"></div>`;
  $('#r_stu').addEventListener('change', () => loadReport($('#r_stu').value));
  if (presetStudent || students[0]) loadReport(presetStudent || students[0].id);
}
async function loadReport(sid) {
  const r = await api('GET', '/api/students/' + sid + '/report');
  const box = $('#rBody');
  if (!r || !r.student) { box.innerHTML = '<div class="empty">无数据</div>'; return; }
  const weakHtml = (r.weakTopics.length + r.weakKps.length)
    ? [...r.weakTopics.map(t => `<li><span class="pill bad">专题</span> ${esc(t.name)}（正确率偏低 / 错题 ${t.count || ''}）</li>`),
       ...r.weakKps.map(k => `<li><span class="pill bad">知识点</span> ${esc(k.name)}</li>`)].join('')
    : '<li class="muted">暂未发现明显薄弱点 🎉</li>';
  box.innerHTML = `
    <div class="grid cols-4 mb">
      <div class="card center"><h3>成绩记录</h3><div style="font-size:26px;font-weight:700">${r.totals.scoreRecords}</div></div>
      <div class="card center"><h3>错题总数</h3><div style="font-size:26px;font-weight:700;color:var(--warn)">${r.totals.errorCount}</div></div>
      <div class="card center"><h3>薄弱专题</h3><div style="font-size:26px;font-weight:700;color:var(--warn)">${r.weakTopics.length}</div></div>
      <div class="card center"><h3>薄弱知识点</h3><div style="font-size:26px;font-weight:700;color:var(--warn)">${r.weakKps.length}</div></div>
    </div>
    <div class="card"><h3>⚠️ 系统识别薄弱考点清单（教学参考）</h3><ul class="weak-list">${weakHtml}</ul>
      <button class="btn sm" id="expReport">导出报表(JSON)</button></div>
    <div class="grid cols-2">
      <div class="chart-box"><h3>各专题正确率(%)</h3><canvas id="cTopic"></canvas></div>
      <div class="chart-box"><h3>各题型正确率(%)</h3><canvas id="cType"></canvas></div>
      <div class="chart-box"><h3>各难度正确率(%)</h3><canvas id="cDiff"></canvas></div>
      <div class="chart-box"><h3>错误原因占比</h3><canvas id="cReason"></canvas></div>
      <div class="chart-box" style="grid-column:1/-1"><h3>历次成绩走势</h3><canvas id="cHist"></canvas></div>
    </div>`;
  drawBar('cTopic', r.topicSeries.map(t => t.name), r.topicSeries.map(t => t.rate), '正确率%');
  drawBar('cType', r.typeSeries.map(t => t.name), r.typeSeries.map(t => t.rate), '正确率%');
  drawBar('cDiff', r.diffSeries.map(t => t.name), r.diffSeries.map(t => t.rate), '正确率%');
  drawPie('cReason', r.reasonSeries.map(t => t.name), r.reasonSeries.map(t => t.count));
  drawLine('cHist', r.history.map(h => h.date), r.history.map(h => h.rate), '正确率%');
  $('#expReport').addEventListener('click', () => {
    const w = window.open('', '_blank');
    w.document.write(`<pre>${esc(JSON.stringify(r, null, 2))}</pre>`);
  });
}
function drawBar(id, labels, data, label) {
  if (!labels.length) { $(id)?.parentElement.insertAdjacentHTML('beforeend', '<p class="muted">暂无数据</p>'); return; }
  new Chart($(id), {
    type: 'bar',
    data: { labels, datasets: [{ label, data, backgroundColor: data.map(v => (v != null && v < 70) ? '#ef4444' : '#2563eb') }] },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
  });
}
function drawPie(id, labels, data) {
  if (!labels.length) { $(id)?.parentElement.insertAdjacentHTML('beforeend', '<p class="muted">暂无数据</p>'); return; }
  new Chart($(id), { type: 'pie', data: { labels, datasets: [{ data, backgroundColor: ['#2563eb', '#f59e0b', '#16a34a', '#ef4444', '#8b5cf6'] }] }, options: { responsive: true } });
}
function drawLine(id, labels, data, label) {
  if (!labels.length) { $(id)?.parentElement.insertAdjacentHTML('beforeend', '<p class="muted">暂无成绩走势数据</p>'); return; }
  new Chart($(id), { type: 'line', data: { labels, datasets: [{ label, data, borderColor: '#2563eb', fill: false }] }, options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } } });
}

/* ---------------- 前台题目详情（只读：复制 / 隐藏解析） ---------------- */
$('#content').addEventListener('click', (e) => {
  const el = e.target.closest('.question[data-qid]');
  if (el) openFrontDetail(el.dataset.qid);
});
$('#frontQModal').addEventListener('click', (e) => { if (e.target.id === 'frontQModal') $('#frontQModal').style.display = 'none'; });
async function openFrontDetail(id) {
  try {
    const { question: q } = await api('GET', '/api/questions/' + id);
    const m = state.meta || { grades: [], topics: [], types: [], difficulties: [], knowledgePoints: [] };
    const dn = (arr, v) => (arr.find(x => x.id == v)?.name || '');
    const metaLine = `${dn(m.grades, q.grade_id)} · ${dn(m.topics, q.topic_id)} · ${dn(m.types, q.type_id)} · ${dn(m.difficulties, q.difficulty_id)} ${q.knowledge_point_id ? '· ' + dn(m.knowledgePoints, q.knowledge_point_id) : ''}`;
    $('#frontQ').innerHTML = `<h3>题目 <span class="muted" style="font-size:12px">#${q.id}</span></h3>
      <div class="qmeta mb">${metaLine}</div>
      <div class="qcontent" id="fqContent" style="white-space:pre-wrap;background:#fafcff;padding:10px;border-radius:8px">${esc(q.content)}</div>
      <div class="qsol" id="fqSol" style="white-space:pre-wrap">${esc(q.solution || '（无解析）')}</div>
      <div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-a="copyContent">复制题干</button>
        <button class="btn sm" data-a="copySol">复制解析</button>
        <button class="btn sm" data-a="copyAll">复制全文</button>
        <button class="btn sm ghost" data-a="toggleSol">隐藏解析</button>
        ${state.admin ? '<button class="btn sm warn" data-a="edit">编辑</button><button class="btn sm danger" data-a="del">删除</button>' : ''}
      </div>
      <div id="fqEdit" style="display:none"></div>`;
    $('#frontQModal').style.display = 'flex';
    let hidden = false;
    $('#frontQ [data-a="toggleSol"]').onclick = (ev) => { hidden = !hidden; $('#fqSol').style.display = hidden ? 'none' : ''; ev.target.textContent = hidden ? '显示解析' : '隐藏解析'; };
    $('#frontQ [data-a="copyContent"]').onclick = () => copyFront(q.content);
    $('#frontQ [data-a="copySol"]').onclick = () => copyFront(q.solution || '');
    $('#frontQ [data-a="copyAll"]').onclick = () => copyFront('【题干】\n' + q.content + '\n\n【解析】\n' + (q.solution || ''));
    if (state.admin) {
      $('#frontQ [data-a="del"]').onclick = async () => { if (confirm('确认删除该题？')) { await api('DELETE', '/api/admin/questions/' + q.id); alert('已删除'); $('#frontQModal').style.display = 'none'; } };
      $('#frontQ [data-a="edit"]').onclick = () => frontEditForm(q, m);
    }
  } catch (e) { alert(e.message); }
}

function frontEditForm(q, m) {
  const kpOpts = '<option value="">未归类</option>' + m.knowledgePoints.filter(k => !q.grade_id || k.grade_id == q.grade_id).map(k => `<option value="${k.id}" ${k.id == q.knowledge_point_id ? 'selected' : ''}>${esc(k.name)}</option>`).join('');
  $('#fqEdit').innerHTML = `<hr style="margin:14px 0">
    <div class="field"><span>题干</span><textarea id="fe_c" style="min-height:110px">${esc(q.content)}</textarea></div>
    <div class="field"><span>解析</span><textarea id="fe_s" style="min-height:90px">${esc(q.solution || '')}</textarea></div>
    <div class="row" style="gap:8px">
      <select id="fe_grade">${opt(m.grades, q.grade_id, '年级')}</select>
      <select id="fe_topic">${opt(m.topics, q.topic_id, '专题')}</select>
      <select id="fe_type">${opt(m.types, q.type_id, '题型')}</select>
      <select id="fe_diff">${opt(m.difficulties, q.difficulty_id, '难度')}</select>
    </div>
    <div class="field"><span>知识点</span><select id="fe_kp">${kpOpts}</select></div>
    <div class="right" style="margin-top:8px"><button class="btn success" id="fe_save">保存修改</button> <button class="btn ghost" id="fe_cancel">取消</button></div>`;
  $('#fqEdit').style.display = '';
  $('#fe_cancel').onclick = () => { $('#fqEdit').style.display = 'none'; };
  $('#fe_save').onclick = async () => {
    await api('PUT', '/api/admin/questions/' + q.id, {
      content: $('#fe_c').value, solution: $('#fe_s').value,
      grade_id: $('#fe_grade').value || null, topic_id: $('#fe_topic').value || null,
      type_id: $('#fe_type').value || null, difficulty_id: $('#fe_diff').value || null,
      knowledge_point_id: $('#fe_kp').value || null
    });
    alert('已保存'); $('#frontQModal').style.display = 'none';
  };
}
function copyFront(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => alert('已复制')).catch(() => fallbackFront(t));
  else fallbackFront(t);
}
function fallbackFront(t) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); alert('已复制'); } catch { alert('复制失败，请手动选择'); } document.body.removeChild(ta); }

/* ---------------- 登录 ---------------- */
function renderLoginState() {
  const btn = $('#loginBtn');
  if (state.admin) btn.textContent = '退出(' + state.admin.username + ')';
  else btn.textContent = '管理员登录';
  btn.onclick = () => { if (state.admin) { api('POST', '/api/logout').then(() => location.reload()); } else openLogin(); };
}
function openLogin() {
  $('#loginErr').textContent = '';
  $('#loginModal').style.display = 'flex';
}
$('#loginBtn')?.addEventListener('click', () => { if (!state.admin) openLogin(); });
$('#lgSubmit').addEventListener('click', async () => {
  try {
    await api('POST', '/api/login', { username: $('#lgUser').value, password: $('#lgPwd').value });
    location.reload();
  } catch (e) { $('#lgErr').textContent = e.message; }
});
$('#loginModal').addEventListener('click', (e) => { if (e.target.id === 'loginModal') $('#loginModal').style.display = 'none'; });

init();
