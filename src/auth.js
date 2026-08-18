/**
 * 鉴权工具：基于 express-session 的简单管理员登录态 + 密码哈希。
 */
const crypto = require('crypto');
const db = require('./db');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(calc));
}

function ensureAdmin(username, password, phone) {
  // 管理员账号密码可由环境变量注入（云端部署务必修改默认密码！）
  username = username || process.env.ADMIN_USER || 'admin';
  password = password || process.env.ADMIN_PASS || 'admin123';
  phone = phone || process.env.ADMIN_PHONE || '13800138000';
  const exist = db.prepare('SELECT id FROM admins WHERE username=?').get(username);
  if (!exist) {
    db.prepare('INSERT INTO admins (username, password, phone) VALUES (?,?,?)').run(username, hashPassword(password), phone);
    console.log(`[init] 已创建默认管理员账号: ${username} / ${password}（手机 ${phone}）`);
  } else {
    // 兼容旧库：若已有管理员但未绑定手机，补全默认手机，便于验证码登录演示
    db.prepare(`UPDATE admins SET phone = ? WHERE username = ? AND (phone IS NULL OR phone = '')`).run(phone, username);
  }
}

// 按手机号查找管理员
function getAdminByPhone(phone) {
  if (!phone) return null;
  return db.prepare('SELECT * FROM admins WHERE phone=?').get(phone);
}

// 仅管理员可访问
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) return next();
  return res.status(401).json({ error: '需要管理员登录' });
}

module.exports = { hashPassword, verifyPassword, ensureAdmin, requireAdmin, getAdminByPhone };
