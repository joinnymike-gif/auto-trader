<p align="center">
  <img src="./assets/logo.png" alt="Clodds Logo" width="240">
</p>

<h1 align="center">auto-trader (Clodds)</h1>

<p align="center">
  <strong>自托管的 AI 交易终端：预测市场 · 加密货币 · 永续合约</strong><br>
  <strong>Self-hosted AI trading terminal for prediction markets, crypto & perpetual futures</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/typescript-5.3-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/LLM-DeepSeek%20%7C%20Claude-8A2BE2" alt="DeepSeek | Claude">
  <img src="https://img.shields.io/badge/macOS-native%20GUI-black" alt="macOS GUI">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT"></a>
</p>

<p align="center">
  <a href="#-本-fork-新增功能--whats-new-in-this-fork">新增功能 / What's New</a> •
  <a href="#-快速开始--quick-start">快速开始 / Quick Start</a> •
  <a href="#-预测市场纸面套利--paper-arbitrage">纸面套利 / Paper Arbitrage</a> •
  <a href="#-功能总览--feature-overview">功能总览 / Features</a> •
  <a href="#-文档--documentation">文档 / Docs</a>
</p>

---

本项目基于开源项目 [alsk1992/CloddsBot](https://github.com/alsk1992/CloddsBot)（Clodds = Claude + Odds）二次开发。它是一个运行在你自己机器上的 AI 交易终端：通过 WebChat、Telegram、Discord 等聊天渠道，用自然语言查询行情、分析套利、管理仓位并执行交易。

This project is a fork of [alsk1992/CloddsBot](https://github.com/alsk1992/CloddsBot) (Clodds = Claude + Odds). It is an AI trading terminal that runs on your own machine: chat through WebChat, Telegram, Discord and more to query markets, analyze arbitrage, manage positions and execute trades in natural language.

> [!WARNING]
> 交易有风险。本项目不构成任何投资建议。实盘前请务必先用纸面交易（paper trading）和 dry-run 模式验证。
>
> Trading involves risk. Nothing here is financial advice. Validate with paper trading and dry-run mode before going live.

---

## ✨ 本 Fork 新增功能 / What's New in This Fork

| 功能 / Feature | 说明 / Description |
|---|---|
| **DeepSeek LLM 接入**<br>DeepSeek LLM support | 新增 OpenAI 兼容适配器，把 Anthropic Messages 接口（含流式 SSE 与 tool calling）转换为 DeepSeek Chat Completions，整个 Agent 系统可直接跑在 DeepSeek 上。<br>An OpenAI-compatible adapter translates the Anthropic Messages interface (incl. SSE streaming and tool calls) to DeepSeek Chat Completions, so the whole agent stack runs on DeepSeek. |
| **macOS 原生桌面应用**<br>Native macOS GUI | Swift + WKWebView 编写的 `Clodds.app`：自动启动本机网关，或连接远程 VPS 上的网关；菜单栏常驻、一键诊断与重启。<br>`Clodds.app` built with Swift + WKWebView: starts the local gateway or connects to one on a remote VPS; lives in the menu bar, one-click Doctor and restart. |
| **预测市场数学套利扫描器**<br>Dutch Book arbitrage scanner | 扫描 Polymarket 二元市场中 “YES 卖价 + NO 卖价 < $1” 的无风险定价错误，逐档计算订单簿深度与 VWAP。**不消耗任何 LLM Token**，无需 API Key。<br>Scans Polymarket binary markets for “YES ask + NO ask < $1” mispricings, walking orderbook depth with VWAP. **Zero LLM tokens**, no API key required. |
| **纸面套利执行引擎**<br>Paper arbitrage executor | 基于本地 SQLite 的 $10,000 虚拟账户，记录双腿持仓、锁定利润并模拟结算。<br>SQLite-backed $10,000 virtual account that records both legs, locks in profit and simulates settlement. |
| **7×24 自动扫描**<br>24/7 auto scanning | 通过命令行（`npm run arb:paper -- --watch`）或聊天命令（`/arb paper auto start`）持续扫描并自动纸面下单。<br>Continuous scanning with automatic paper execution via CLI (`npm run arb:paper -- --watch`) or chat (`/arb paper auto start`). |
| **诊断与修复**<br>Doctor & fixes | `clodds doctor` 可校验 DeepSeek Key；修复 Telegram 配对授权与热重载同步问题。<br>`clodds doctor` validates the DeepSeek key; fixes Telegram pairing authorization and hot-reload sync. |

---

## 🚀 快速开始 / Quick Start

**环境要求 / Requirements:** Node.js ≥ 22；macOS GUI 另需 Xcode Command Line Tools（`xcode-select --install`）。
Node.js ≥ 22; the macOS GUI additionally needs Xcode Command Line Tools.

```bash
git clone https://github.com/joinnymike-gif/auto-trader.git
cd auto-trader
npm install
cp .env.example .env      # 填入 DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY / fill in a key
npm run build
npm start                 # WebChat → http://localhost:18789/webchat
```

也可以运行交互式向导 / Or run the interactive setup wizard:

```bash
node dist/cli/index.js onboard
```

> 执行 `npm link` 后即可全局使用 `clodds` 命令。npm 上的 `clodds` 包是上游版本，**不包含**本 Fork 的新增功能。
>
> Run `npm link` to get the global `clodds` command. The `clodds` package on npm is upstream and does **not** include this fork's additions.

### 大模型配置 / LLM Configuration

| 变量 / Variable | 默认值 / Default | 说明 / Description |
|---|---|---|
| `DEEPSEEK_API_KEY` | – | DeepSeek Key（[获取 / get one](https://platform.deepseek.com/api_keys)） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 任意 OpenAI 兼容端点 / any OpenAI-compatible endpoint |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 / model name |
| `ANTHROPIC_API_KEY` | – | Claude Key（[获取 / get one](https://console.anthropic.com)） |
| `LLM_PROVIDER` | `auto` | `auto` / `deepseek` / `anthropic` |

**自动选择顺序 / Auto-detection order:**

1. `LLM_PROVIDER=deepseek` → DeepSeek
2. 设置了 `DEEPSEEK_API_KEY` → DeepSeek / `DEEPSEEK_API_KEY` is set → DeepSeek
3. `ANTHROPIC_API_KEY` 以 `sk-` 开头但不是 `sk-ant-` → 视为 DeepSeek Key / starts with `sk-` but not `sk-ant-` → treated as a DeepSeek key
4. 其他情况 → Claude / otherwise → Claude

> 想使用 Claude 时，请保持 `DEEPSEEK_API_KEY` 为空。
> To use Claude, leave `DEEPSEEK_API_KEY` empty.

`.env` 会先从 `~/.clodds/.env` 加载，再从当前目录加载；数据默认保存在 `~/.clodds/`（SQLite）。
`.env` is loaded from `~/.clodds/.env` first, then the current directory; data lives in `~/.clodds/` (SQLite) by default.

---

## 🖥️ macOS 桌面应用 / macOS Desktop App

```bash
npm run gui          # 首次自动构建 Clodds.app 并打开 / builds Clodds.app on first run, then opens it
npm run build:gui    # 强制重新构建 / force rebuild
```

- **两种模式 / Two modes**：本机模式启动时探测 `http://localhost:18789/health`，未运行则执行 `node dist/index.js start` 并轮询（最长 25 秒）；远程模式只连接 VPS 上的网关，见[下文](#连接远程-vps--remote-vps-mode)。
  Local mode probes `/health` and, if needed, starts `node dist/index.js start` (polls up to 25 s); remote mode only connects to a gateway on a VPS — see below.
- **菜单栏常驻 / Menu bar tray**：关闭窗口后仍在菜单栏运行，可显示网关状态、新建对话、在浏览器打开、运行 Doctor、重启网关。退出 App 会停止它启动的网关。
  Keeps running in the menu bar after the window closes; shows gateway status, new chat, open in browser, Doctor, restart. Quitting stops the gateway it started.
- **原生体验 / Native feel**：完整的 ⌘C/⌘V/⌘Z 编辑菜单、工具栏、外部链接用系统浏览器打开（界面语言为中文）。
  Full ⌘C/⌘V/⌘Z edit menu, toolbar, external links open in the default browser (menus are in Chinese).
- **项目目录 / Project directory**（本机模式 / local mode）：依次读取 `CLODDS_PROJECT_DIR` → `.app` 所在目录 → 构建时写入的项目路径。
  Resolved from `CLODDS_PROJECT_DIR` → the folder containing the `.app` → the project path baked in at build time.

构建脚本使用 `swiftc`、`sips`、`iconutil` 和临时签名（ad-hoc codesign），生成的 `Clodds.app` 已被 `.gitignore` 忽略。
The build script uses `swiftc`, `sips`, `iconutil` and ad-hoc codesigning; the generated `Clodds.app` is gitignored.

### 连接远程 VPS / Remote VPS mode

网关跑在 VPS 上 7×24 运行，Mac 上的 Clodds.app 只负责连接和显示。
Run the gateway 24/7 on a VPS and use Clodds.app on your Mac as the client.

**1. 在 VPS 上启动网关 / Start the gateway on the VPS**（Linux + Node.js ≥ 22；systemd / Docker 部署见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)）

```bash
git clone https://github.com/joinnymike-gif/auto-trader.git && cd auto-trader
npm install && cp .env.example .env   # 填 LLM Key 并设置 WEBCHAT_TOKEN / set an LLM key and WEBCHAT_TOKEN
npm run build && npm start
```

**2. 选择访问方式（任选其一）/ Choose how to reach it (pick one)**

- **HTTPS 反向代理 / HTTPS reverse proxy**（nginx / Caddy，见 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)）→ 地址 / URL：`https://clodds.example.com`
- **SSH 隧道，不开放端口 / SSH tunnel, no open port** → 在 Mac 上保持运行 / keep this running on the Mac，地址 / URL：`http://127.0.0.1:18789`

  ```bash
  ssh -N -L 18789:127.0.0.1:18789 user@your-vps
  ```

**3. 在 App 中填写地址 / Set the address in the app**

菜单 **服务 → 网关设置（本机 / 远程 VPS）...**，填入地址并保存；留空即切回本机模式。首次连接时 WebChat 会弹窗要求输入 `WEBCHAT_TOKEN`，之后自动记住。
Menu **服务 → 网关设置（本机 / 远程 VPS）...**: enter the URL and save; leave it empty to switch back to local mode. On first connect WebChat asks for `WEBCHAT_TOKEN` and remembers it.

也可以用命令行设置 / Or set it from the command line:

```bash
defaults write com.clodds.desktop gatewayURL https://clodds.example.com
```

远程模式下 App 不会在本机启动网关；“重启 / 重新连接网关” 只会重新连接，诊断需在 VPS 上运行 `node dist/cli/index.js doctor`。
In remote mode the app never starts a local gateway; “restart / reconnect” only reconnects, and Doctor has to be run on the VPS.

> [!CAUTION]
> 网关可以直接下单。不要用明文 HTTP 把 18789 端口暴露到公网：请使用 HTTPS 或 SSH 隧道，设置 `WEBCHAT_TOKEN`，并用防火墙限制端口（见 [docs/VPS_SECURITY.md](./docs/VPS_SECURITY.md)）。
>
> The gateway can place trades. Never expose port 18789 over plain HTTP: use HTTPS or an SSH tunnel, set `WEBCHAT_TOKEN`, and firewall the port (see [docs/VPS_SECURITY.md](./docs/VPS_SECURITY.md)).

---

## 📐 预测市场纸面套利 / Paper Arbitrage

### 原理 / How it works

二元预测市场中，YES 和 NO 必有一方在结算时每份支付 $1。若两边最优卖价之和小于 $1，同时买入等量 YES 和 NO 即可锁定利润：

In a binary prediction market exactly one of YES/NO pays $1 per share at resolution. If the best asks sum to less than $1, buying equal shares of both locks in a profit:

```
YES ask $0.48 + NO ask $0.49 = $0.97 < $1.00
买入 / buy 100 YES + 100 NO = $97  →  结算 / payout $100  →  +$3 (3.09% ROI)
```

扫描器流程 / Scanner pipeline:

1. 从 Polymarket Gamma API 拉取按成交量排序的活跃二元市场（成交量 ≥ $500）
   Fetch active binary markets from the Polymarket Gamma API, sorted by volume (volume ≥ $500)
2. 并发（6 路）从 CLOB API 获取 YES/NO 两侧订单簿
   Fetch both YES/NO orderbooks from the CLOB API (6 concurrent)
3. 同步逐档吃单，直到边际价格和 > `1 − 最小利润率`、预算用尽或流动性耗尽
   Walk both ask ladders together until the marginal pair price exceeds `1 − minEdge`, the budget is spent, or liquidity runs out
4. 以 VWAP 复核利润，过滤成本 < $1 的机会，按 ROI 排序
   Re-check profit at VWAP, drop opportunities under $1 cost, sort by ROI

> [!NOTE]
> 纸面模拟未计入手续费、Gas、两腿之间的成交滑点与时间差（leg risk）。实盘收益会低于模拟值。
>
> The simulation ignores fees, gas, and slippage/timing between the two legs (leg risk). Live results will be lower.

### 命令行 / CLI

```bash
npm run arb:paper                                   # 扫描一次并纸面下单 / scan once and paper-trade
npm run arb:paper -- --dry-run                      # 只扫描不下单 / scan only
npm run arb:paper -- --watch --interval 10          # 每 10 秒持续扫描 / scan every 10 s
npm run arb:paper -- --size 200 --min-profit 0.5    # 每笔 $200，最低 0.5% 利润 / $200 per arb, min 0.5% edge
npm run arb:paper -- --test                         # 端到端模拟测试 / end-to-end simulated test
npm run arb:paper -- --status                       # 查看虚拟账户 / show virtual account
npm run arb:paper -- --settle <recordId>            # 模拟结算 / simulate settlement
npm run arb:paper -- --reset                        # 重置为 $10,000 / reset to $10,000
```

| 参数 / Flag | 默认 / Default | 说明 / Description |
|---|---|---|
| `--size` | `100` | 每个套利机会的最大预算（USD）/ max budget per opportunity (USD) |
| `--min-profit` | `0.1` | 最低利润率（%）/ minimum edge (%) |
| `--interval` | `10` | `--watch` 轮询间隔（秒）/ polling interval in seconds |

### 聊天命令 / Chat commands（WebChat / Telegram …）

```
/arb paper status                              # 虚拟余额与套利盈亏 / balance & arbitrage PnL
/arb paper scan                                # 扫描并对前 5 个机会纸面下单 / scan & paper-trade top 5
/arb paper test                                # 模拟 Dutch Book 全流程 / simulated Dutch Book test
/arb paper positions                           # 列出持仓 / list positions
/arb paper reset                               # 重置账户 / reset account
/arb paper auto start [interval=15] [size=100] [minEdge=0.2]   # 后台 7×24 扫描 / 24/7 background scan
/arb paper auto status                         # 后台扫描统计 / scanner metrics
/arb paper auto stop                           # 停止后台扫描 / stop background scan
```

---

## 🧭 功能总览 / Feature Overview

以下能力继承自上游 CloddsBot，数量均按当前代码统计。
The capabilities below are inherited from upstream CloddsBot; counts reflect the current code.

| 类别 / Category | 内容 / What's included |
|---|---|
| **聊天渠道 / Channels (19)** | WebChat、Telegram、Discord、Slack、WhatsApp、Teams、Matrix、Signal、iMessage、BlueBubbles、LINE、Google Chat、Mattermost、Nextcloud Talk、Nostr、Twitch、Tlon、Zalo、Voice |
| **预测市场 / Prediction markets** | 可交易 / Trading：Polymarket、Kalshi、Betfair、Smarkets、Drift、Opinion.xyz、Predict.fun<br>数据 / Data：Manifold、Metaculus、PredictIt、AgentBets |
| **永续合约 / Perpetual futures (7)** | Binance (125x)、Bybit (100x)、Hyperliquid (50x)、MEXC (200x)、Drift、Lighter、Percolator（Solana 链上 / on-chain） |
| **Solana DeFi** | Jupiter、Raydium、Orca、Meteora、Kamino、MarginFi、Solend、Pump.fun、Bags.fm；Jito MEV 保护 / MEV protection |
| **EVM DeFi** | Uniswap V3、1inch、Odos、PancakeSwap、Virtuals、Clanker、Veil、ENS（ETH / Base / Arbitrum / Optimism / Polygon / BSC）；Flashbots MEV 保护 |
| **套利与策略 / Arbitrage & strategies** | 平台内、跨平台、组合套利（[arXiv:2508.03474](https://arxiv.org/abs/2508.03474)）、语义市场匹配、加密 HFT、背离策略、做市、DCA、TWAP、条件单 / 括号单、智能路由、跟单、巨鲸追踪、Pump.fun 多钱包 Swarm |
| **风控 / Risk** | 熔断器、VaR/CVaR、波动率状态识别、压力测试、Kelly 仓位、每日亏损上限、紧急停止 / circuit breaker, VaR/CVaR, volatility regimes, stress tests, Kelly sizing, daily loss limits, kill switch |
| **AI** | 大模型 / LLMs：DeepSeek、Claude、OpenAI、Gemini、Groq、Together、Fireworks、Bedrock、Ollama；Agent 工具 18 个（浏览器、Docker、Shell、文件、Git、邮件、SQL…）；LanceDB 语义记忆 |
| **Skills** | 121 个内置技能，按需懒加载 / 121 bundled skills, lazy-loaded (`/skills`) |
| **MCP** | 把技能暴露为 MCP 工具（[src/mcp](./src/mcp)）；`clodds mcp list/add/remove/test` 管理外部 MCP 服务 / exposes skills as MCP tools; `clodds mcp …` manages external MCP servers |
| **安全 / Security** | AES-256-GCM 凭据加密、代码扫描、诈骗地址库、交易前校验、GoPlus 代币审计、审计日志 / encrypted credentials, code scanner, scam DB, pre-trade validation, token audits, audit logs |
| **交易账本 / Trade ledger** | 决策留痕、置信度校准、SHA-256 完整性哈希、可锚定到 Solana/Polygon/Base / decision audit trail, calibration, integrity hashes, on-chain anchoring |
| **数据 / Data** | 实时订单簿、K 线、Tick 录制、特征工程、另类数据（恐慌贪婪、资金费率、Reddit 情绪）、新闻、FRED、NOAA 天气 |
| **其他 / Other** | Bittensor 挖矿、x402 USDC 支付、Wormhole 跨链、Cron / Webhook 自动化、Rust 快速广播模块（`rust/fast-broadcast`）、10 种界面语言 / 10 UI languages |

### 架构 / Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  界面 / Interfaces                                              │
│  macOS Clodds.app · WebChat · Telegram · Discord · … · CLI · MCP│
└──────────────────────────────┬─────────────────────────────────┘
                               │ HTTP / WebSocket :18789
┌──────────────────────────────┴─────────────────────────────────┐
│  网关 / Gateway   认证 · 限流 · 会话 · REST API                 │
└──────────────────────────────┬─────────────────────────────────┘
┌──────────────────────────────┴─────────────────────────────────┐
│  Agent 层 / Agents   LLM 客户端（DeepSeek ⇄ Claude 适配器）      │
│                     Skills · Tools · Memory                    │
└──────────────────────────────┬─────────────────────────────────┘
┌──────────────────────────────┴─────────────────────────────────┐
│  策略与风控 / Strategy & Risk                                    │
│  套利扫描（含零 Token Dutch Book）· 风控引擎 · 执行 · 纸面交易     │
└──────┬───────────────┬───────────────┬───────────────┬─────────┘
   预测市场          Solana DeFi       EVM DeFi        永续合约
 Prediction mkts                                     Perp futures
                               │
┌──────────────────────────────┴─────────────────────────────────┐
│  存储 / Storage   SQLite · LanceDB · PostgreSQL（可选 / optional）│
└────────────────────────────────────────────────────────────────┘
```

---

## ⌨️ 常用 CLI / Common CLI

```bash
clodds start          # 启动网关 / start the gateway
clodds gui            # 启动 macOS 桌面应用 / launch the macOS app
clodds onboard        # 交互式配置向导 / setup wizard
clodds repl           # 本地交互式 REPL / local REPL
clodds doctor         # 系统诊断（含 DeepSeek Key 校验）/ diagnostics (incl. DeepSeek key check)
clodds secure         # 安全加固 / security hardening
clodds locale set zh  # 切换语言 / change language
clodds pairing list telegram   # 查看待审批的配对请求 / pending pairing requests
```

完整命令见 / Full reference: [docs/USER_GUIDE.md](./docs/USER_GUIDE.md)

---

## 🛠️ 开发 / Development

```bash
npm run dev          # 热重载 / hot reload
npm test             # 运行测试（42 个测试文件）/ run tests (42 test files)
npm run typecheck    # 类型检查 / type check
npm run build        # 构建 / build
npm run ci           # typecheck + test + build
docker compose up --build
```

本 Fork 新增代码 / Code added in this fork:

| 路径 / Path | 作用 / Purpose |
|---|---|
| [src/agents/llm-client.ts](./src/agents/llm-client.ts) | DeepSeek 适配器与提供商自动检测 / DeepSeek adapter & provider detection |
| [src/arbitrage/prediction-scanner.ts](./src/arbitrage/prediction-scanner.ts) | Dutch Book 扫描器 / Dutch Book scanner |
| [src/arbitrage/paper-executor.ts](./src/arbitrage/paper-executor.ts) | 纸面执行与结算 / paper execution & settlement |
| [scripts/paper-arbitrage.ts](./scripts/paper-arbitrage.ts) | 套利命令行 / arbitrage CLI runner |
| [desktop/macos/main.swift](./desktop/macos/main.swift) | macOS 原生应用 / native macOS app |
| [scripts/build-mac-app.sh](./scripts/build-mac-app.sh) | App 构建脚本 / app build script |
| [tests/unit/deepseek-adapter.test.ts](./tests/unit/deepseek-adapter.test.ts)、[tests/unit/prediction-arbitrage.test.ts](./tests/unit/prediction-arbitrage.test.ts) | 对应单元测试 / unit tests |

---

## 📚 文档 / Documentation

| 文档 / Document | 内容 / Content |
|---|---|
| [User Guide](./docs/USER_GUIDE.md) | 命令与使用流程 / commands & workflows |
| [Quick Start](./docs/QUICK_START.md) | 快速上手 / getting started |
| [Architecture](./docs/ARCHITECTURE.md) | 系统设计 / system design |
| [Trading](./docs/TRADING.md) | 执行、机器人、风控 / execution, bots, safety |
| [Risk Management](./docs/RISK_MANAGEMENT.md) | 风控引擎 / risk engine |
| [Opportunity Finder](./docs/OPPORTUNITY_FINDER.md) | 套利机会发现 / arbitrage discovery |
| [API Reference](./docs/API_REFERENCE.md) · [OpenAPI](./docs/openapi.yaml) | HTTP / WebSocket 接口 / endpoints |
| [Deployment](./docs/DEPLOYMENT.md) · [VPS Security](./docs/VPS_SECURITY.md) | 部署与服务器加固 / deployment & hardening |
| [Skills Catalog](./docs/SKILLS_CATALOG.md) | 技能列表 / skill list |

---

## 📄 许可证 / License

MIT — 见 / see [LICENSE](./LICENSE)。上游项目 / Upstream: [alsk1992/CloddsBot](https://github.com/alsk1992/CloddsBot)。
