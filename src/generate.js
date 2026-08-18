/**
 * 组卷与学情统计逻辑。
 */
const db = require('./db');

/**
 * 从题库按条件随机抽取题目，生成训练卷。
 * filters: { grades:[], topics:[], knowledgePoints:[], types:[], difficulties:[], count }
 */
function buildWhere(filters) {
  const where = [];
  const params = [];
  if (filters.grades && filters.grades.length) {
    where.push(`grade_id IN (${filters.grades.map(() => '?').join(',')})`);
    params.push(...filters.grades);
  }
  if (filters.topics && filters.topics.length) {
    where.push(`topic_id IN (${filters.topics.map(() => '?').join(',')})`);
    params.push(...filters.topics);
  }
  if (filters.knowledgePoints && filters.knowledgePoints.length) {
    where.push(`knowledge_point_id IN (${filters.knowledgePoints.map(() => '?').join(',')})`);
    params.push(...filters.knowledgePoints);
  }
  if (filters.types && filters.types.length) {
    where.push(`type_id IN (${filters.types.map(() => '?').join(',')})`);
    params.push(...filters.types);
  }
  if (filters.difficulties && filters.difficulties.length) {
    where.push(`difficulty_id IN (${filters.difficulties.map(() => '?').join(',')})`);
    params.push(...filters.difficulties);
  }
  return { where, params };
}

function generatePaper(filters = {}) {
  const { where, params } = buildWhere(filters);
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const all = db.prepare(`SELECT * FROM questions ${cond}`).all(...params);
  // 随机打乱
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  const count = Math.min(Number(filters.count) || 10, shuffled.length);
  const picked = shuffled.slice(0, count);
  return enrichQuestions(picked);
}

function enrichQuestions(list) {
  const gradeStmt = db.prepare('SELECT name FROM grades WHERE id=?');
  const kpStmt = db.prepare('SELECT name FROM knowledge_points WHERE id=?');
  const topicStmt = db.prepare('SELECT name FROM topics WHERE id=?');
  const typeStmt = db.prepare('SELECT name FROM question_types WHERE id=?');
  const diffStmt = db.prepare('SELECT name FROM difficulty WHERE id=?');
  return list.map(q => ({
    ...q,
    gradeName: q.grade_id ? gradeStmt.get(q.grade_id)?.name : '',
    kpName: q.knowledge_point_id ? kpStmt.get(q.knowledge_point_id)?.name : '',
    topicName: q.topic_id ? topicStmt.get(q.topic_id)?.name : '',
    typeName: q.type_id ? typeStmt.get(q.type_id)?.name : '',
    difficultyName: q.difficulty_id ? diffStmt.get(q.difficulty_id)?.name : ''
  }));
}

/**
 * 错题重做：直接返回该生全部错题内容。
 */
function regenerateErrors(studentId) {
  const rows = db.prepare('SELECT * FROM error_books WHERE student_id=? ORDER BY id').all(studentId);
  return rows.map(e => ({
    id: e.id,
    content: e.content,
    image_path: e.image_path,
    kpName: e.knowledge_point_id ? db.prepare('SELECT name FROM knowledge_points WHERE id=?').get(e.knowledge_point_id)?.name : '',
    topicName: e.topic_id ? db.prepare('SELECT name FROM topics WHERE id=?').get(e.topic_id)?.name : '',
    typeName: e.type_id ? db.prepare('SELECT name FROM question_types WHERE id=?').get(e.type_id)?.name : '',
    difficultyName: e.difficulty_id ? db.prepare('SELECT name FROM difficulty WHERE id=?').get(e.difficulty_id)?.name : ''
  }));
}

/**
 * 同类拓展出题：读取错题绑定的 知识点/专题/题型/难度，从大题库中筛选同条件的全新题目。
 */
function expandFromErrors(studentId, count = 10) {
  const errors = db.prepare('SELECT * FROM error_books WHERE student_id=?').all(studentId);
  if (!errors.length) return [];
  const kpIds = [...new Set(errors.map(e => e.knowledge_point_id).filter(Boolean))];
  const topicIds = [...new Set(errors.map(e => e.topic_id).filter(Boolean))];
  const typeIds = [...new Set(errors.map(e => e.type_id).filter(Boolean))];
  const diffIds = [...new Set(errors.map(e => e.difficulty_id).filter(Boolean))];
  const errorContents = new Set(errors.map(e => (e.content || '').trim()));

  // 优先：同一 知识点 + 题型 + 难度
  let candidates = db.prepare(`
    SELECT * FROM questions
    WHERE knowledge_point_id IN (${kpIds.map(() => '?').join(',')})
      AND type_id IN (${typeIds.map(() => '?').join(',')})
      AND difficulty_id IN (${diffIds.map(() => '?').join(',')})
  `).all(...kpIds, ...typeIds, ...diffIds);

  // 放宽：仅按 专题 + 题型
  if (candidates.length < count) {
    const more = db.prepare(`
      SELECT * FROM questions
      WHERE topic_id IN (${topicIds.map(() => '?').join(',')})
        AND type_id IN (${typeIds.map(() => '?').join(',')})
    `).all(...topicIds, ...typeIds);
    for (const m of more) if (!candidates.find(c => c.id === m.id)) candidates.push(m);
  }
  // 再放宽：仅按 知识点
  if (candidates.length < count) {
    const more = db.prepare(`SELECT * FROM questions WHERE knowledge_point_id IN (${kpIds.map(() => '?').join(',')})`).all(...kpIds);
    for (const m of more) if (!candidates.find(c => c.id === m.id)) candidates.push(m);
  }
  // 排除已经录入过的错题原文
  candidates = candidates.filter(c => !errorContents.has((c.content || '').trim()));
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  return enrichQuestions(shuffled.slice(0, count));
}

/**
 * 学情报表统计：基于成绩分项（topic/type/kp/difficulty）与错题本。
 */
function getReport(studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id=?').get(studentId);
  if (!student) return null;
  const scores = db.prepare('SELECT * FROM scores WHERE student_id=? ORDER BY exam_date').all(studentId);
  const errors = db.prepare('SELECT * FROM error_books WHERE student_id=?').all(studentId);

  const nameOf = (table, id) => (id ? db.prepare(`SELECT name FROM ${table} WHERE id=?`).get(id)?.name : '');

  function accumulate(rows, field) {
    const map = {};
    for (const r of rows) {
      let arr = [];
      try { arr = JSON.parse(r[field] || '[]'); } catch { arr = []; }
      for (const item of arr) {
        const id = item.id;
        if (!id) continue;
        if (!map[id]) map[id] = { id, score: 0, full: 0, count: 0 };
        map[id].score += Number(item.score) || 0;
        map[id].full += Number(item.full) || 0;
        map[id].count += 1;
      }
    }
    return map;
  }

  const topicMap = accumulate(scores, 'topic_scores');
  const typeMap = accumulate(scores, 'type_scores');
  const kpMap = accumulate(scores, 'kp_scores');
  const diffMap = accumulate(scores, 'difficulty_scores');

  const toSeries = (map, table) => Object.values(map).map(v => ({
    id: v.id,
    name: nameOf(table, v.id),
    score: v.score,
    full: v.full,
    count: v.count,
    rate: v.full > 0 ? Math.round((v.score / v.full) * 1000) / 10 : null
  })).filter(x => x.name);

  const topicSeries = toSeries(topicMap, 'topics');
  const typeSeries = toSeries(typeMap, 'question_types');
  const kpSeries = toSeries(kpMap, 'knowledge_points');
  const diffSeries = toSeries(diffMap, 'difficulty');

  // 错题按专题 / 原因 统计
  const errorByTopic = {};
  const reasonStats = {};
  const errorByKp = {};
  for (const e of errors) {
    if (e.topic_id) errorByTopic[e.topic_id] = (errorByTopic[e.topic_id] || 0) + 1;
    if (e.knowledge_point_id) errorByKp[e.knowledge_point_id] = (errorByKp[e.knowledge_point_id] || 0) + 1;
    const reason = e.error_reason || '未标注';
    reasonStats[reason] = (reasonStats[reason] || 0) + 1;
  }
  const errorTopicSeries = Object.entries(errorByTopic).map(([id, n]) => ({ id: Number(id), name: nameOf('topics', Number(id)), count: n }));
  const errorKpSeries = Object.entries(errorByKp).map(([id, n]) => ({ id: Number(id), name: nameOf('knowledge_points', Number(id)), count: n }));
  const reasonSeries = Object.entries(reasonStats).map(([name, n]) => ({ name, count: n }));

  // 成绩走势
  const history = scores.map(s => ({
    date: s.exam_date,
    name: s.exam_name,
    score: s.score,
    full: s.full_score,
    rate: s.full_score > 0 ? Math.round((s.score / s.full_score) * 1000) / 10 : null
  }));

  // 薄弱点识别（正确率 < 70% 或 错题数 >= 3）
  const weakTopics = topicSeries.filter(t => t.rate !== null && t.rate < 70)
    .concat(errorTopicSeries.filter(t => t.count >= 3 && !topicSeries.find(x => x.id === t.id)));
  const weakKps = kpSeries.filter(k => k.rate !== null && k.rate < 70)
    .concat(errorKpSeries.filter(k => k.count >= 3 && !kpSeries.find(x => x.id === k.id)));

  return {
    student,
    topicSeries,
    typeSeries,
    kpSeries,
    diffSeries,
    errorTopicSeries,
    errorKpSeries,
    reasonSeries,
    history,
    weakTopics: dedupe(weakTopics),
    weakKps: dedupe(weakKps),
    totals: {
      scoreRecords: scores.length,
      errorCount: errors.length
    }
  };
}

function dedupe(arr) {
  const seen = new Set();
  return arr.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
}

module.exports = { generatePaper, enrichQuestions, regenerateErrors, expandFromErrors, getReport };
