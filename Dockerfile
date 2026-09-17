# syntax=docker/dockerfile:1

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# 原生模块（better-sqlite3 等）在缺少预编译产物时需要工具链
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# postinstall 会执行 scripts/ 下的修复脚本，必须先于 npm ci 复制
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
RUN npm ci --legacy-peer-deps

# 预下载向量模型：运行时 src/embeddings 固定读取 ./.transformers-cache
RUN mkdir -p .transformers-cache \
    && node -e "const{pipeline,env}=require('@xenova/transformers');env.cacheDir='./.transformers-cache';pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{quantized:true}).then(()=>console.log('Model cached')).catch(e=>console.error('Model cache failed:',e))"

COPY src ./src
RUN npm run build

# 只保留生产依赖，运行镜像因此不需要编译工具链
RUN npm prune --omit=dev --legacy-peer-deps

# ---------- runner ----------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV CLODDS_STATE_DIR=/data
ENV CLODDS_WORKSPACE=/data/workspace

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.transformers-cache ./.transformers-cache
COPY package.json ./
# WebChat 静态页面（gateway 从 dist/../public/webchat 提供服务）
COPY public ./public
# Lighter 交易所用到 scripts/lighter-bridge/bridge.py
COPY scripts ./scripts

# 以非 root 运行；/data 是数据卷（SQLite、备份、workspace）
RUN mkdir -p /data/workspace \
    && chown -R node:node /data /app/.transformers-cache
USER node

EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18789/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
