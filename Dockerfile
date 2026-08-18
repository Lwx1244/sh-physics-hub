# 上海高中物理平台 —— 容器化镜像
# 用法：
#   docker build -t sh-physics-hub .
#   docker run -d -p 3000:3000 \
#     -e DATABASE_URL=libsql://xxx.turso.io \
#     -e DATABASE_AUTH_TOKEN=xxxx \
#     -e ADMIN_PASS=你的强密码 \
#     -v sh-physics-uploads:/app/uploads \
#     sh-physics-hub
FROM node:22-alpine

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package*.json ./
RUN npm install --omit=dev

# 复制源码
COPY . .

# 确保启动脚本可执行
RUN chmod +x start.sh

EXPOSE 3000

# start.sh 会：安装校验 → 生成 .env（若无）→ 初始化数据库（幂等）→ 启动服务
CMD ["./start.sh"]
