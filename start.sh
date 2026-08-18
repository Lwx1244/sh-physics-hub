#!/usr/bin/env bash
# 上海高中物理平台 —— Linux / 云服务器一键启动脚本
# 用法：
#   chmod +x start.sh
#   ./start.sh                 # 前台运行（按 Ctrl+C 停止）
#   nohup ./start.sh > server.log 2>&1 &   # 后台常驻
set -e

cd "$(dirname "$0")"

echo "============================================"
echo "  上海高中物理平台 启动脚本"
echo "============================================"

# 1. 依赖安装（仅首次）
if [ ! -d node_modules ]; then
  echo "[1/3] 首次运行，安装依赖 (npm install) ..."
  npm install --omit=dev
else
  echo "[1/3] 依赖已存在，跳过安装"
fi

# 2. 生成 .env（若不存在）
if [ ! -f .env ]; then
  echo "[2/3] 未找到 .env，已从 .env.example 复制默认配置"
  cp .env.example .env
  echo "      ⚠️  默认管理员账号 admin / admin123 ，上线前请务必修改 .env 里的 ADMIN_PASS！"
else
  echo "[2/3] 已存在 .env，使用现有配置"
fi

# 3. 初始化数据库（幂等：已存在数据则自动跳过）
echo "[3/3] 初始化 / 校验数据库 (npm run seed) ..."
npm run seed

echo "--------------------------------------------"
echo "  启动服务中 ..."
echo "  前台首页 : http://localhost:3000/  (或你的服务器公网IP:3000)"
echo "  管理后台 : http://localhost:3000/admin"
echo "  按 Ctrl+C 停止；后台运行请用 nohup ./start.sh &"
echo "--------------------------------------------"
exec node src/server.js
