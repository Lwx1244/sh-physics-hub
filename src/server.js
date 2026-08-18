/**
 * 上海高中物理平台 —— 后端服务
 * 前台浏览 + 管理员后台，含资料两步入库、智能组卷、学生/错题/成绩管理、学情报表。
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const db = require('./db');
const { ensureAdmin, verifyPassword, requireAdmin, getAdminByPhone } = require('./auth');
const sms = require('./sms');
const { parseResource, splitQuestions, detectType, extractKnowledgePoints } = require('./parse');
const { generatePaper, regenerateErrors, expandFromErrors, getReport } = require('./generate');

const app = express();
// 云端多通过反代（Nginx / Caddy / 平台负载均衡）访问，开启信任代理以正确获取客户端信息
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
// 上传文件目录：云端可用环境变量覆盖（如对象存储挂载目录 / 持久化卷）
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'sh-physics-hub-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, '..', 'public')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// 手机号脱敏：138****8000
function maskPhone(p) {
  if (!p) return '';
  return p.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

ensureAdmin();

/* ----------------------------- 鉴权 ----------------------------- */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
  if (!admin || !verifyPassword(password || '', admin.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.adminId = admin.id;
  req.session.adminName = admin.username;
  res.json({ ok: true, admin: { id: admin.id, username: admin.username, phone: maskPhone(admin.phone) } });
});

/* 获取管理员信息（含脱敏手机号） */
app.get('/api/me', (req, res) => {
  if (req.session && req.session.adminId) {
    const a = db.prepare('SELECT id,username,phone FROM admins WHERE id=?').get(req.session.adminId);
    if (a) return res.json({ admin: { id: a.id, username: a.username, phone: maskPhone(a.phone) } });
  }
  res.json({ admin: null });
});

/* 管理员账号设置：修改绑定手机 */
app.put('/api/admin/profile', requireAdmin, (req, res) => {
  const { phone } = req.body || {};
  if (!/^1[3-9]\d{9}$/.test(phone || '')) return res.status(400).json({ error: '手机号格式不正确' });
  const dup = db.prepare('SELECT id FROM admins WHERE phone=? AND id!=?').get(phone, req.session.adminId);
  if (dup) return res.status(400).json({ error: '该手机号已被其他管理员绑定' });
  db.prepare('UPDATE admins SET phone=? WHERE id=?').run(phone, req.session.adminId);
  res.json({ ok: true, phone: maskPhone(phone) });
});

/* -------- 短信验证码登录（手机号验证） -------- */
const smsStore = new Map(); // phone -> { code, expires, lastSent, attempts }
const SMS_TTL = 5 * 60 * 1000;     // 验证码有效期 5 分钟
const SMS_RESEND = 60 * 1000;      // 两次发送最小间隔 60 秒
const SMS_MAX_TRIES = 5;           // 单条验证码最大校验次数

app.post('/api/sms/send', async (req, res) => {
  const { phone } = req.body || {};
  if (!/^1[3-9]\d{9}$/.test(phone || '')) return res.status(400).json({ error: '请输入正确的 11 位手机号' });
  const now = Date.now();
  const prev = smsStore.get(phone);
  if (prev && now - prev.lastSent < SMS_RESEND) {
    const left = Math.ceil((SMS_RESEND - (now - prev.lastSent)) / 1000);
    return res.status(429).json({ error: `验证码已发送，请 ${left} 秒后再试` });
  }
  const code = sms.genCode();
  smsStore.set(phone, { code, expires: now + SMS_TTL, lastSent: now, attempts: 0 });
  const sent = await sms.sendSms(phone, code);
  if (!sent && !sms.REAL_PROVIDER) {
    // 演示模式：回传验证码，方便本地调试（生产接入真实网关后不再返回）
    return res.json({ ok: true, demo: true, devCode: code, ttl: SMS_TTL / 1000, message: '验证码已发送（演示模式，见服务端日志）' });
  }
  res.json({ ok: true, demo: false, ttl: SMS_TTL / 1000, message: '验证码已发送，请注意查收短信' });
});

app.post('/api/login/phone', (req, res) => {
  const { phone, code } = req.body || {};
  if (!/^1[3-9]\d{9}$/.test(phone || '')) return res.status(400).json({ error: '手机号格式不正确' });
  const entry = smsStore.get(phone);
  if (!entry || entry.expires < Date.now()) {
    smsStore.delete(phone);
    return res.status(401).json({ error: '验证码已过期，请重新获取' });
  }
  if (entry.attempts >= SMS_MAX_TRIES) {
    smsStore.delete(phone);
    return res.status(429).json({ error: '验证码尝试次数过多，请重新获取' });
  }
  if (entry.code !== String(code || '').trim()) {
    entry.attempts += 1;
    return res.status(401).json({ error: '验证码错误' });
  }
  const admin = getAdminByPhone(phone);
  if (!admin) {
    smsStore.delete(phone);
    return res.status(401).json({ error: '该手机号未绑定管理员账号' });
  }
  smsStore.delete(phone); // 一次性消费
  req.session.adminId = admin.id;
  req.session.adminName = admin.username;
  res.json({ ok: true, admin: { id: admin.id, username: admin.username, phone: maskPhone(admin.phone) } });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

/* --------------------------- 导航树 --------------------------- */
app.get('/api/nav', (req, res) => {
  const grades = db.prepare('SELECT id,name FROM grades ORDER BY sort_order').all();
  const tiers = db.prepare('SELECT id,name FROM school_tiers ORDER BY sort_order').all();
  const chapters = db.prepare('SELECT id,grade_id,name FROM chapters ORDER BY sort_order').all();
  const kps = db.prepare('SELECT id,grade_id,chapter_id,name FROM knowledge_points ORDER BY id').all();
  const topics = db.prepare('SELECT id,name,description FROM topics ORDER BY id').all();
  const nav = grades.map(g => ({
    grade: g,
    chapters: chapters.filter(c => c.grade_id === g.id).map(c => ({
      ...c,
      knowledgePoints: kps.filter(k => k.chapter_id === c.id)
    }))
  }));
  res.json({ nav, tiers, topics });
});

app.get('/api/meta', (req, res) => {
  res.json({
    grades: db.prepare('SELECT id,name FROM grades ORDER BY sort_order').all(),
    topics: db.prepare('SELECT id,name FROM topics ORDER BY id').all(),
    types: db.prepare('SELECT id,name FROM question_types ORDER BY sort_order').all(),
    difficulties: db.prepare('SELECT id,name FROM difficulty ORDER BY sort_order').all(),
    tiers: db.prepare('SELECT id,name FROM school_tiers ORDER BY sort_order').all(),
    knowledgePoints: db.prepare('SELECT id,name,grade_id,chapter_id FROM knowledge_points ORDER BY id').all()
  });
});

/* ----------------------- 知识点 / 专题 ----------------------- */
app.get('/api/knowledge-points/:id', (req, res) => {
  const kp = db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(req.params.id);
  if (!kp) return res.status(404).json({ error: '未找到' });
  res.json(kp);
});
app.get('/api/topics/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM topics WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '未找到' });
  const exercises = db.prepare('SELECT id,content,solution,type_id,difficulty_id,grade_id FROM questions WHERE topic_id=? ORDER BY id').all(t.id);
  res.json({ ...t, exercises });
});

/* ------------------------- 名校试卷库 ------------------------- */
app.get('/api/resources', (req, res) => {
  const { tier } = req.query;
  const rows = tier
    ? db.prepare('SELECT * FROM resources WHERE tier_id=? ORDER BY created_at DESC').all(Number(tier))
    : db.prepare('SELECT * FROM resources ORDER BY created_at DESC').all();
  const tiers = db.prepare('SELECT id,name FROM school_tiers').all();
  res.json({ resources: rows, tiers });
});
app.get('/api/resources/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  res.json(r);
});

/* ------------------------- 题库浏览 ------------------------- */
app.get('/api/questions', (req, res) => {
  const { topic, type, difficulty, grade, kp, search, limit } = req.query;
  const where = [], params = [];
  if (topic) { where.push('topic_id=?'); params.push(Number(topic)); }
  if (type) { where.push('type_id=?'); params.push(Number(type)); }
  if (difficulty) { where.push('difficulty_id=?'); params.push(Number(difficulty)); }
  if (grade) { where.push('grade_id=?'); params.push(Number(grade)); }
  if (kp) { where.push('knowledge_point_id=?'); params.push(Number(kp)); }
  if (search) { where.push('content LIKE ?'); params.push('%' + search + '%'); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(Number(limit) || 50, 500);
  const rows = db.prepare(`SELECT * FROM questions ${cond} ORDER BY id DESC LIMIT ${lim}`).all(...params);
  res.json({ questions: rows, total: rows.length });
});

// 单题详情（访客可读，用于复制/隐藏解析）
app.get('/api/questions/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: '未找到' });
  res.json({ question: q });
});

// 管理员编辑单题
app.put('/api/admin/questions/:id', requireAdmin, (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: '未找到' });
  const b = req.body || {};
  const fields = ['grade_id', 'chapter_id', 'knowledge_point_id', 'topic_id', 'type_id', 'difficulty_id', 'content', 'solution'];
  const sets = [], params = [];
  for (const f of fields) {
    if (b[f] !== undefined) {
      sets.push(`${f}=?`);
      params.push(f === 'content' || f === 'solution' ? (b[f] || '') : (b[f] ? Number(b[f]) : null));
    }
  }
  if (!sets.length) return res.json({ ok: true, id: q.id });
  params.push(q.id);
  db.prepare(`UPDATE questions SET ${sets.join(',')} WHERE id=?`).run(...params);
  res.json({ ok: true, id: q.id });
});

app.delete('/api/admin/questions/:id', requireAdmin, (req, res) => {
  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);
  if (!q) return res.status(404).json({ error: '未找到' });
  db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ===================== 管理员接口 ===================== */
/* ---- 资料上传：两步入库 ---- */
app.post('/api/admin/resources', requireAdmin, upload.single('file'), (req, res) => {
  const { title, tier_id, grade_id } = req.body;
  if (!req.file) return res.status(400).json({ error: '请上传文件' });
  const id = db.prepare(`INSERT INTO resources (title, tier_id, grade_id, file_path, original_filename, file_type, parsed, uploaded_by)
    VALUES (?,?,?,?,?,?,0,?)`).run(
    title || req.file.originalname,
    tier_id ? Number(tier_id) : null,
    grade_id ? Number(grade_id) : null,
    req.file.filename,
    req.file.originalname,
    req.file.mimetype,
    req.session.adminId
  ).lastInsertRowid;
  res.json({ ok: true, id, file: req.file.filename });
});

app.post('/api/admin/resources/:id/parse', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  const filePath = path.join(UPLOAD_DIR, r.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '原文件缺失' });
  const buffer = fs.readFileSync(filePath);
  parseResource(buffer, r.file_type, r.original_filename).then(result => {
    res.json({ ok: true, ...result });
  }).catch(e => res.status(500).json({ error: '解析失败: ' + e.message }));
});

// 解析文本（用于图片 OCR 结果 / 直接粘贴文本，两步法第二步）
app.post('/api/admin/resources/:id/parse-text', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  const text = (req.body && req.body.text) || '';
  if (!text.trim()) return res.status(400).json({ error: '文本为空' });
  const questions = splitQuestions(text).map(q => ({ ...q, type_id: null, difficulty_id: null, grade_id: r.grade_id || null, topic_id: null, knowledge_point_id: null }));
  res.json({ ok: true, textLength: text.length, questions });
});

// 文本提取：识别知识点 + 拆分习题（独立工具）
app.post('/api/extract', (req, res) => {
  const text = (req.body && req.body.text) || '';
  if (!text.trim()) return res.status(400).json({ error: '文本为空' });
  const kps = db.prepare('SELECT id,name,grade_id,chapter_id FROM knowledge_points').all();
  const knowledgePoints = extractKnowledgePoints(text, kps);
  const questions = splitQuestions(text).map((q, i) => ({
    index: i + 1, content: q.content, solution: q.solution,
    typeName: detectType(q.content), grade_id: null, topic_id: null, knowledge_point_id: null, difficulty_id: null
  }));
  res.json({ ok: true, knowledgePoints, questions, textLength: text.length });
});

app.post('/api/admin/resources/:id/commit', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: '未找到' });
  const list = req.body.questions || [];
  const ins = db.prepare(`INSERT INTO questions (resource_id, grade_id, chapter_id, knowledge_point_id, topic_id, type_id, difficulty_id, content, image_path, solution)
    VALUES (@resource_id,@grade_id,@chapter_id,@knowledge_point_id,@topic_id,@type_id,@difficulty_id,@content,@image_path,@solution)`);
  const tx = db.transaction((items) => {
    for (const it of items) {
      ins.run({
        resource_id: r.id,
        grade_id: it.grade_id ? Number(it.grade_id) : null,
        chapter_id: it.chapter_id ? Number(it.chapter_id) : null,
        knowledge_point_id: it.knowledge_point_id ? Number(it.knowledge_point_id) : null,
        topic_id: it.topic_id ? Number(it.topic_id) : null,
        type_id: it.type_id ? Number(it.type_id) : null,
        difficulty_id: it.difficulty_id ? Number(it.difficulty_id) : null,
        content: it.content || '',
        image_path: it.image_path || null,
        solution: it.solution || ''
      });
    }
  });
  tx(list);
  db.prepare('UPDATE resources SET parsed=1 WHERE id=?').run(r.id);
  res.json({ ok: true, inserted: list.length });
});

/* ---- 手动新增知识点 / 专题 / 题目 ---- */
app.post('/api/admin/knowledge-points', requireAdmin, (req, res) => {
  const { grade_id, chapter_id, name, description, example, example_solution } = req.body;
  if (!name) return res.status(400).json({ error: '名称必填' });
  const id = db.prepare('INSERT INTO knowledge_points (grade_id,chapter_id,name,description,example,example_solution) VALUES (?,?,?,?,?,?)')
    .run(grade_id ? Number(grade_id) : null, chapter_id ? Number(chapter_id) : null, name, description || '', example || '', example_solution || '').lastInsertRowid;
  res.json({ ok: true, id });
});
app.post('/api/admin/topics', requireAdmin, (req, res) => {
  const { name, description, lecture } = req.body;
  if (!name) return res.status(400).json({ error: '名称必填' });
  const id = db.prepare('INSERT INTO topics (name,description,lecture) VALUES (?,?,?)').run(name, description || '', lecture || '').lastInsertRowid;
  res.json({ ok: true, id });
});
app.post('/api/admin/questions', requireAdmin, (req, res) => {
  const { grade_id, chapter_id, knowledge_point_id, topic_id, type_id, difficulty_id, content, image_path, solution } = req.body;
  if (!content) return res.status(400).json({ error: '题干必填' });
  const id = db.prepare(`INSERT INTO questions (grade_id,chapter_id,knowledge_point_id,topic_id,type_id,difficulty_id,content,image_path,solution)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    grade_id ? Number(grade_id) : null, chapter_id ? Number(chapter_id) : null,
    knowledge_point_id ? Number(knowledge_point_id) : null, topic_id ? Number(topic_id) : null,
    type_id ? Number(type_id) : null, difficulty_id ? Number(difficulty_id) : null,
    content, image_path || null, solution || '').lastInsertRowid;
  res.json({ ok: true, id });
});

/* ---- 学生档案 ---- */
app.get('/api/students', (req, res) => {
  const rows = db.prepare('SELECT * FROM students ORDER BY id DESC').all();
  res.json({ students: rows });
});
app.post('/api/admin/students', requireAdmin, (req, res) => {
  const { name, grade_id, school_name, school_tier_id, overall_desc, weak_topics } = req.body;
  if (!name) return res.status(400).json({ error: '姓名必填' });
  const id = db.prepare(`INSERT INTO students (name,grade_id,school_name,school_tier_id,overall_desc,weak_topics)
    VALUES (?,?,?,?,?,?)`).run(
    name, grade_id ? Number(grade_id) : null, school_name || '', school_tier_id ? Number(school_tier_id) : null,
    overall_desc || '', weak_topics ? JSON.stringify(weak_topics) : null).lastInsertRowid;
  res.json({ ok: true, id });
});
app.put('/api/admin/students/:id', requireAdmin, (req, res) => {
  const { name, grade_id, school_name, school_tier_id, overall_desc, weak_topics } = req.body;
  db.prepare(`UPDATE students SET name=?,grade_id=?,school_name=?,school_tier_id=?,overall_desc=?,weak_topics=? WHERE id=?`)
    .run(name, grade_id ? Number(grade_id) : null, school_name || '', school_tier_id ? Number(school_tier_id) : null,
      overall_desc || '', weak_topics ? JSON.stringify(weak_topics) : null, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/students/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---- 错题 ---- */
app.get('/api/students/:id/errors', (req, res) => {
  const rows = db.prepare('SELECT * FROM error_books WHERE student_id=? ORDER BY id DESC').all(req.params.id);
  res.json({ errors: rows });
});
app.post('/api/admin/errors', requireAdmin, upload.single('image'), (req, res) => {
  const b = req.body;
  const id = db.prepare(`INSERT INTO error_books (student_id,source_name,content,image_path,knowledge_point_id,topic_id,type_id,difficulty_id,error_reason)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    Number(b.student_id), b.source_name || '', b.content || '', req.file ? req.file.filename : null,
    b.knowledge_point_id ? Number(b.knowledge_point_id) : null, b.topic_id ? Number(b.topic_id) : null,
    b.type_id ? Number(b.type_id) : null, b.difficulty_id ? Number(b.difficulty_id) : null, b.error_reason || '').lastInsertRowid;
  res.json({ ok: true, id });
});
app.delete('/api/admin/errors/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM error_books WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---- 成绩 ---- */
app.get('/api/students/:id/scores', (req, res) => {
  const rows = db.prepare('SELECT * FROM scores WHERE student_id=? ORDER BY exam_date').all(req.params.id);
  res.json({ scores: rows });
});
app.post('/api/admin/scores', requireAdmin, (req, res) => {
  const b = req.body;
  const id = db.prepare(`INSERT INTO scores (student_id,exam_name,exam_date,full_score,score,topic_scores,type_scores,kp_scores,difficulty_scores,note)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    Number(b.student_id), b.exam_name || '', b.exam_date || '', Number(b.full_score) || 0, Number(b.score) || 0,
    JSON.stringify(b.topic_scores || []), JSON.stringify(b.type_scores || []), JSON.stringify(b.kp_scores || []),
    JSON.stringify(b.difficulty_scores || []), b.note || '').lastInsertRowid;
  res.json({ ok: true, id });
});
app.delete('/api/admin/scores/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM scores WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

/* ---- 智能组卷（访客可用） ---- */
app.post('/api/generate', (req, res) => {
  const filters = req.body || {};
  const questions = generatePaper(filters);
  const title = filters.title || `专题训练卷_${new Date().toISOString().slice(0, 10)}`;
  const pid = db.prepare('INSERT INTO generated_papers (title,mode,config,content) VALUES (?,?,?,?)')
    .run(title, 'custom', JSON.stringify(filters), JSON.stringify(questions)).lastInsertRowid;
  res.json({ ok: true, paperId: pid, title, questions });
});

/* ---- 自建试卷保存（管理员）：存储组卷编辑器产出的试卷 ---- */
app.post('/api/papers/save', requireAdmin, (req, res) => {
  const { title, questions } = req.body || {};
  if (!title || !Array.isArray(questions) || !questions.length) {
    return res.status(400).json({ error: '请填写试卷标题，并至少包含一道题' });
  }
  const pid = db.prepare('INSERT INTO generated_papers (title,mode,config,content) VALUES (?,?,?,?)')
    .run(title, 'builder', JSON.stringify({}), JSON.stringify(questions)).lastInsertRowid;
  res.json({ ok: true, paperId: pid, title });
});

/* ---- 错题定向拓展 ---- */
app.post('/api/admin/errors/regenerate', requireAdmin, (req, res) => {
  const sid = req.body.student_id;
  if (!sid) return res.status(400).json({ error: '缺少学生' });
  const questions = regenerateErrors(Number(sid));
  const title = `错题重做卷_${new Date().toISOString().slice(0, 10)}`;
  const pid = db.prepare('INSERT INTO generated_papers (title,mode,config,content) VALUES (?,?,?,?)')
    .run(title, 'regenerate', JSON.stringify({ student_id: sid }), JSON.stringify(questions)).lastInsertRowid;
  res.json({ ok: true, paperId: pid, title, questions });
});
app.post('/api/admin/errors/expand', requireAdmin, (req, res) => {
  const sid = req.body.student_id;
  const count = Number(req.body.count) || 10;
  if (!sid) return res.status(400).json({ error: '缺少学生' });
  const questions = expandFromErrors(Number(sid), count);
  const title = `同类拓展巩固卷_${new Date().toISOString().slice(0, 10)}`;
  const pid = db.prepare('INSERT INTO generated_papers (title,mode,config,content) VALUES (?,?,?,?)')
    .run(title, 'expand', JSON.stringify({ student_id: sid, count }), JSON.stringify(questions)).lastInsertRowid;
  res.json({ ok: true, paperId: pid, title, questions });
});

/* ---- 学情报表 ---- */
app.get('/api/students/:id/report', (req, res) => {
  const report = getReport(Number(req.params.id));
  if (!report) return res.status(404).json({ error: '未找到学生' });
  res.json(report);
});

/* ---- 组卷历史 ---- */
app.get('/api/papers', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id,title,mode,created_at FROM generated_papers ORDER BY id DESC').all();
  res.json({ papers: rows });
});
app.get('/api/papers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM generated_papers WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: '未找到' });
  res.json(p);
});

/* -------- SPA 入口：非 /api 路由返回前台，/admin 返回后台 -------- */
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`上海高中物理平台已启动: http://localhost:${PORT}`);
  console.log(`前台: http://localhost:${PORT}    后台: http://localhost:${PORT}/admin`);
});
