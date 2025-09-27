# 多阶段构建，生成更小的生产镜像
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制包管理文件
COPY package*.json ./

# 安装所有依赖
RUN npm install

# 复制源代码
COPY . .

# 构建应用程序
RUN npm run build

# 生产阶段
FROM node:18-alpine AS production

# 设置工作目录
WORKDIR /app

# 安装简单的 HTTP 服务器
RUN npm install -g serve

# 从构建阶段复制构建好的应用程序
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# 暴露端口
EXPOSE 3000

# 启动应用程序
CMD ["serve", "-s", "dist", "-l", "3000"]
