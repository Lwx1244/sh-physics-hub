@echo off
chcp 65001 >nul
cd /d %~dp0
echo ============================================
echo   上海高中物理平台 本地启动脚本 (Windows)
echo ============================================

REM 1. 安装依赖（仅首次）
if not exist node_modules (
  echo [1/3] 首次运行，安装依赖 ...
  call npm install
) else (
  echo [1/3] 依赖已存在，跳过安装
)

REM 2. 生成 .env（若不存在）
if not exist .env (
  echo [2/3] 未找到 .env，已从 .env.example 复制默认配置
  copy .env.example .env >nul
  echo       [注意] 默认管理员 admin / admin123，上线前请修改 .env 的 ADMIN_PASS！
) else (
  echo [2/3] 已存在 .env，使用现有配置
)

REM 3. 初始化数据库（幂等）
echo [3/3] 初始化数据库 ...
call npm run seed

echo --------------------------------------------
echo   启动服务中，访问 http://localhost:3000/
echo   前台首页 /   管理后台 /admin
echo --------------------------------------------
node src/server.js
pause
