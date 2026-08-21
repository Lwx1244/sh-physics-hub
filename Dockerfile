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
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm","start"]
