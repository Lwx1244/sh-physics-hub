/**
 * 试卷智能解析：从 PDF/Word 提取文本，并按题号切分为单题，启发式识别题型、答案。
 * 解析结果返回给管理员做二次确认（两步入库第二步）。
 */
const { extractText: unpdfExtract } = require('unpdf');
const mammoth = require('mammoth');

async function extractText(buffer, fileType, originalName = '') {
  const lower = (originalName || '').toLowerCase();
  if (fileType === 'application/pdf' || lower.endsWith('.pdf')) {
    // unpdf 拒绝 Node Buffer（虽是 Uint8Array 子类），需拷贝为纯 Uint8Array
    const u8 = new Uint8Array(buffer.length);
    u8.set(buffer);
    const res = await unpdfExtract(u8);
    // unpdf 返回 text 可能是每页字符串数组或合并后的字符串
    const text = Array.isArray(res.text) ? res.text.join('\n') : (res.text || '');
    return text;
  }
  // docx / doc
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

const TYPE_KEYWORDS = [
  { id: 1, name: '选择题', kw: ['选择题', '单选', '不定项', '下列', '选项', 'A.', 'B.', 'C.', 'D.'] },
  { id: 4, name: '实验题', kw: ['实验', '探究', '测量', '仪器'] },
  { id: 3, name: '计算题', kw: ['计算', '求解', '求：', '如图', '多大', '为多少'] },
  { id: 2, name: '填空题', kw: ['填空', '横线', ' _____', '（ ）'] }
];

const ANSWER_MARKERS = ['解：', '解:', '答案：', '答案:', '答：', '答:', '解答：', '解答:', '【解析】', '解析：', '解析:', 'Answer:', 'Answer'];

function detectType(text) {
  let best = { id: 3, name: '计算题', score: 0 };
  for (const t of TYPE_KEYWORDS) {
    let s = 0;
    for (const k of t.kw) if (text.includes(k)) s += 1;
    if (s > best.score) best = { id: t.id, name: t.name, score: s };
  }
  return best.name;
}

function splitQuestions(text) {
  if (!text) return [];
  // 规范化换行
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 匹配题号：行首或数字后跟 . 、 ) 空格，例如 1. 1、 1) (1)
  const re = /(?:^|\n)\s*(?:(?:\(?\d+[\)\.、]|（\d+）)|(?:[一二三四五六七八九十]+[、．.]))\s+/g;
  const matches = [...normalized.matchAll(re)];
  if (matches.length === 0) {
    // 退而求其次：整段作为一份材料
    return [{ index: 1, raw: normalized.trim(), content: normalized.trim(), solution: '' }];
  }
  const questions = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length - matches[i][0].trimStart().length;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    let block = normalized.slice(start, end).trim();
    // 切分题干与答案
    let content = block, solution = '';
    for (const m of ANSWER_MARKERS) {
      const idx = block.indexOf(m);
      if (idx !== -1) {
        content = block.slice(0, idx).trim();
        solution = block.slice(idx).trim();
        break;
      }
    }
    const heading = matches[i][0].trim();
    questions.push({
      index: i + 1,
      heading,
      // block 已包含题号，直接使用，避免题号重复（如 “3. 3. ...”）
      content: block,
      solution
    });
  }
  return questions.filter(q => q.content.length > 0);
}

async function parseResource(buffer, fileType, originalName) {
  const text = await extractText(buffer, fileType, originalName);
  const questions = splitQuestions(text);
  return { textLength: text.length, questions };
}

/* ---------------------------------------------------------------
 * 知识点提取：依据已有知识库，从一段文本中识别涉及的知识点。
 * kps: [{id, name, grade_id, chapter_id}]
 * 返回匹配到的知识点（含置信度），按命中的关键词数量排序。
 * --------------------------------------------------------------- */
// 概念别名/同义词，提升中文教材文本匹配率
const KP_SYNONYMS = {
  '牛顿第一定律': ['惯性定律', '惯性'],
  '牛顿第二定律': ['牛顿运动定律', 'F=ma', 'F = ma', '加速度定律'],
  '牛顿第三定律': ['作用力与反作用力', '作用反作用'],
  '匀变速直线运动': ['直线运动', '速度公式', '位移公式', 'v-t图像', 'vt图像'],
  '自由落体运动': ['自由落体', 'g=9.8', 'g = 9.8'],
  '受力分析': ['受力', '弹力', '摩擦力', '受力平衡', '共点力平衡'],
  '共点力平衡': ['平衡条件', '三力平衡', '力的合成与分解'],
  '圆周运动': ['向心力', '向心加速度', '匀速圆周运动', '角速度', '线速度'],
  '万有引力定律': ['万有引力', '天体运动', '卫星', '开普勒', '第一宇宙速度'],
  '机械能守恒定律': ['机械能守恒', '动能定理', '重力势能', '动能'],
  '动量守恒定律': ['动量守恒', '动量', '碰撞', '反冲'],
  '机械振动': ['简谐运动', '弹簧振子', '单摆', '振幅', '周期'],
  '机械波': ['波速', '波长', '干涉', '衍射', '多普勒'],
  '气体实验定律': ['玻意耳定律', '查理定律', '盖吕萨克定律', '理想气体状态方程', 'pV', 'PV'],
  '库仑定律': ['库仑', '点电荷', '电场力'],
  '电场强度': ['电场', '电场线', '电势', '电势能', '电势差'],
  '恒定电流': ['欧姆定律', '闭合电路欧姆定律', '电阻', '电功率', '电动势'],
  '磁场': ['磁感应强度', '安培力', '洛伦兹力', '左手定则', '右手定则'],
  '电磁感应': ['法拉第电磁感应定律', '感应电动势', '楞次定律', '感应电流'],
  '交变电流': ['正弦交流电', '有效值', '峰值', '变压器', '磁通量'],
  '光的折射': ['折射率', '折射定律', '全反射', '临界角', '斯涅耳'],
  '光的干涉': ['双缝干涉', '薄膜干涉', '干涉条纹'],
  '原子结构': ['玻尔模型', '氢原子', '能级', '跃迁'],
  '原子核': ['衰变', '半衰期', '核反应', '质能方程', '核裂变', '核聚变', 'E=mc²'],
  '光电效应': ['光子', '逸出功', '爱因斯坦光电方程', '截止频率'],
  '运动的合成与分解': ['平抛运动', '运动的分解', '抛体'],
  '牛顿运动定律的应用': ['连接体', '超重', '失重'],
  '功和功率': ['功率', '平均功率', '瞬时功率', '牵引力']
};

function extractKnowledgePoints(text, kps) {
  if (!text || !kps) return [];
  const hits = new Map();
  for (const kp of kps) {
    const keys = [kp.name, ...(KP_SYNONYMS[kp.name] || [])];
    let score = 0;
    for (const key of keys) {
      if (key && text.includes(key)) score += key.length >= 2 ? 2 : 1;
    }
    if (score > 0) hits.set(kp.id, { id: kp.id, name: kp.name, grade_id: kp.grade_id, chapter_id: kp.chapter_id, score });
  }
  return [...hits.values()].sort((a, b) => b.score - a.score);
}

module.exports = { extractText, splitQuestions, parseResource, detectType, extractKnowledgePoints };
