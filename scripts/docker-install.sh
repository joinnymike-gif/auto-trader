#!/usr/bin/env bash
#
# Clodds 一键 Docker 部署 / One-command Docker deploy
#
#   bash scripts/docker-install.sh
#
# 做三件事：装 Docker（缺失时）→ 准备 .env → 构建并启动容器。
# Installs Docker if missing, prepares .env, then builds and starts the container.
#
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

info() { printf '\033[0;34m[INFO]\033[0m %s\n' "$1"; }
ok()   { printf '\033[0;32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m[WARN]\033[0m %s\n' "$1"; }
die()  { printf '\033[0;31m[ERROR]\033[0m %s\n' "$1" >&2; exit 1; }

# --- 1. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  [ "$(uname -s)" = "Linux" ] || die "未检测到 Docker。macOS/Windows 请先安装 Docker Desktop。"
  info "未检测到 Docker，正在通过 get.docker.com 安装（需要 root 权限）..."
  curl -fsSL https://get.docker.com | sh || die "Docker 安装失败"
  ok "Docker 安装完成"
fi

docker compose version >/dev/null 2>&1 || die "需要 Docker Compose v2（命令 'docker compose'）。"
docker info >/dev/null 2>&1 || die "Docker 守护进程未运行。Linux: sudo systemctl start docker（或把当前用户加入 docker 组后重新登录）。"

# --- 2. .env -----------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  ok "已根据 .env.example 生成 .env"
fi

get_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }
set_env() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  if grep -qE "^${key}=" .env; then
    awk -v k="$key" -v v="$value" '
      !done && index($0, k "=") == 1 { print k "=" v; done=1; next }
      { print }
    ' .env > "$tmp" && mv "$tmp" .env
  else
    rm -f "$tmp"
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# LLM Key：DeepSeek 或 Anthropic 二选一
if [ -z "$(get_env DEEPSEEK_API_KEY)" ] && [ -z "$(get_env ANTHROPIC_API_KEY)" ]; then
  if [ -t 0 ]; then
    read -r -p "DeepSeek API Key（直接回车则改填 Anthropic）: " llm_key
    if [ -n "$llm_key" ]; then
      set_env DEEPSEEK_API_KEY "$llm_key"
    else
      read -r -p "Anthropic API Key: " anthropic_key
      [ -n "$anthropic_key" ] && set_env ANTHROPIC_API_KEY "$anthropic_key"
    fi
  fi
fi
if [ -z "$(get_env DEEPSEEK_API_KEY)" ] && [ -z "$(get_env ANTHROPIC_API_KEY)" ]; then
  die "请先在 .env 中填写 DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY，然后重新运行。"
fi

# WebChat Token：远程访问必备，缺失则自动生成
if [ -z "$(get_env WEBCHAT_TOKEN)" ]; then
  generated=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-32)
  set_env WEBCHAT_TOKEN "$generated"
  ok "已生成 WEBCHAT_TOKEN: $generated"
  warn "Mac 端 Clodds.app 首次连接时需要输入这个 Token，请自行保存。"
fi

# --- 3. 构建并启动 ------------------------------------------------------------
info "正在构建镜像并启动容器（首次构建约 5-15 分钟）..."
docker compose up -d --build

info "等待网关就绪..."
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:18789/health >/dev/null 2>&1; then
    ok "网关已就绪：http://127.0.0.1:18789/webchat/"
    echo
    docker compose ps
    echo
    echo "查看日志 / logs:    docker compose logs -f"
    echo "停止 / stop:        docker compose down"
    echo "更新 / update:      git pull && docker compose up -d --build"
    exit 0
  fi
  sleep 5
done

warn "等待超时，网关可能仍在启动。请查看日志：docker compose logs -f"
exit 1
