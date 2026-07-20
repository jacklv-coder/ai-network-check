# AI Network Check

> The network benchmark for AI developers.

AI Network Check 用来判断当前网络、代理节点或线路访问 AI 服务时的**连通性、延迟、稳定性和长连接能力**。

项目坚持一个原则：**只对已经真实测量的能力打分，不把普通 HTTPS 请求包装成“真实 Codex / Claude Code 测试”。**

## 1. 产品目标

用户打开在线网页后，可以快速回答：

- 当前代理能否访问常用 AI 服务？
- 哪条 Shadowrocket / Clash / Surge 路线更稳定？
- 当前线路的 P50、P95、失败率和抖动如何？
- 浏览器 HTTPS、WebSocket 长连接、真实 CLI 请求分别验证到了什么程度？
- 当前结果是否足以支持 ChatGPT、Codex、Claude、Gemini 等场景？

项目最终提供两种运行模式：

### 在线模式

部署到 GitHub Pages，检测由访问者浏览器发起，因此请求会经过访问者当前网络和代理线路。

在线模式可验证：

- AI 服务 HTTPS 基础连通性
- 端到端请求耗时
- 连续采样成功率
- P50 / P95 / 最大延迟
- 延迟抖动
- 当前公网出口 IP 与地区
- 不同路线的本地历史对比

在线模式不能验证：

- DNS、TCP、TLS、TTFB 分阶段耗时
- 不可读取的跨域 HTTP 状态和响应正文
- OpenAI / Anthropic 内部 WebSocket 协议
- 本机 Codex、Claude Code、Cursor 等真实 CLI 请求

### 本地专业模式

用户运行本地 Agent，例如：

```bash
npx ai-network-check
```

本地 Agent 启动 localhost 服务，由本机执行真实网络和工具检测：

- DNS / TCP / TLS / TTFB
- WebSocket 握手、心跳、保持与异常关闭
- `codex exec` 真实请求
- Claude Code 等 CLI 的真实请求
- 首次输出时间、完成时间、重试与退出状态

本地 Agent 不上传 API Key、登录令牌或命令输出中的敏感内容。

## 2. 核心架构

```text
┌─────────────────────────────────────────────────────────┐
│                    AI Network Check                     │
├──────────────────────────┬──────────────────────────────┤
│ GitHub Pages Web         │ Local Agent                  │
│                          │                              │
│ HTTPS benchmark          │ DNS / TCP / TLS / TTFB      │
│ Browser timing           │ WebSocket benchmark          │
│ Route history            │ Real CLI benchmark           │
│ Shareable report         │ localhost API                │
└──────────────┬───────────┴──────────────┬───────────────┘
               │                          │
               └──────── shared core ─────┘
                  catalog / metrics /
                  scoring / report schema
```

计划采用单仓库结构：

```text
ai-network-check/
├── apps/
│   ├── web/                 # GitHub Pages 在线版
│   └── agent/               # 本地专业检测服务
├── packages/
│   ├── core/                # 平台目录、统计、评分、报告模型
│   ├── web-benchmark/       # 浏览器 HTTPS 检测
│   ├── websocket-benchmark/ # 长连接检测
│   └── cli-benchmark/       # Codex / Claude Code 等真实检测
├── docs/
└── README.md
```

初期为了降低复杂度，会先从 `packages/core` 开始，再逐步建立 Web 与 Agent。

## 3. 模块边界

### Module A — AI Service Catalog

统一描述服务商、产品、检测目标和能力限制。

示例：

```ts
{
  provider: "openai",
  product: "chatgpt",
  checks: ["https"],
  limitations: ["opaque-response", "websocket-unverified"]
}
```

目录只描述“测什么”，不负责发起请求或计算分数。

### Module B — HTTPS Benchmark Engine

负责：

- 超时控制
- 缓存规避
- 多次采样
- 取消检测
- 单端点结果
- 平台聚合结果

### Module C — Metrics

纯函数计算：

- 成功率
- 平均值
- P50 / P95 / P99
- 最大值
- 标准差与抖动
- 超时和失败分类

### Module D — Scoring

评分必须分维度展示：

```text
HTTPS Connectivity
Latency
Stability
Realtime
Real Tool Test
```

未验证的维度显示 `Not verified`，不能按满分计入。

评分必须带置信级别：

- `browser-basic`：浏览器基础 HTTPS
- `browser-realtime`：浏览器 HTTPS + 公共长连接测试
- `local-network`：本地分阶段网络测试
- `local-real-tool`：真实 CLI / API 测试

### Module E — Report Schema

所有在线版和本地版结果使用可版本化 JSON：

```ts
interface BenchmarkReport {
  schemaVersion: number;
  mode: "web" | "local";
  confidence: string;
  route?: string;
  startedAt: string;
  completedAt: string;
  providers: ProviderResult[];
  limitations: string[];
}
```

### Module F — Web Application

核心交互只有三态：

1. 开始检测
2. 检测中
3. 检测结果

详细端点、曲线、出口网络、历史路线和限制说明放在结果下方。

### Module G — Local Agent

本地 Agent 只监听 loopback：

```text
127.0.0.1
::1
```

默认拒绝局域网访问，不开放远程命令执行接口。

## 4. 评分设计

### 在线基础评分

在线版只生成 **AI HTTPS Network Score**，不直接生成“Codex 真实可用分”。

建议初始权重：

| 维度 | 权重 |
|---|---:|
| 成功率 | 40% |
| P95 | 25% |
| 平均延迟 | 15% |
| 抖动 | 10% |
| 关键端点覆盖率 | 10% |

强制上限：

- 出现请求失败：最高 79
- 成功率低于 95%：最高 59
- 成功率低于 85%：最高 39
- 主端点完全不可连接：最高 20

阈值不是永久常量。后续应通过真实样本、平台差异和版本记录逐步校准。

### 本地真实评分

本地模式未来拆分：

| 维度 | 说明 |
|---|---|
| HTTPS | 基础请求质量 |
| Network Phases | DNS / TCP / TLS / TTFB |
| Realtime | WebSocket 握手与保持 |
| Streaming | 持续输出和断流 |
| Real Tool | Codex / Claude Code 真实执行 |

总分页面必须同时展示各维度，避免一个总分掩盖未验证项。

## 5. 数据与隐私

在线版：

- 不要求 API Key
- 不读取 AI 账号
- 历史结果默认存储在浏览器本地
- 不自动上传路线名称、IP 或测试数据

本地 Agent：

- 不返回完整令牌和环境变量
- 不持久化 CLI 敏感输出
- 执行命令使用固定白名单与固定参数
- Web UI 不能提交任意 Shell 命令
- localhost API 使用随机会话令牌与严格 Origin 校验

## 6. 技术选型

### Core

- TypeScript
- ESM
- 纯函数优先
- Node 内置测试运行器，降低早期依赖

### Web

计划使用：

- Vite
- TypeScript
- 原生 CSS 或轻量组件层
- GitHub Pages

### Local Agent

计划使用：

- Node.js + TypeScript
- localhost HTTP API
- `child_process.spawn` 执行固定白名单命令
- macOS / Windows / Linux 兼容层

## 7. 开发原则

每个独立模块单独提交，不一次性提交全部功能。

提交顺序：

1. `docs: add technical architecture and roadmap`
2. `feat: add AI service catalog module`
3. `feat: add benchmark metrics module`
4. `feat: add browser HTTPS benchmark engine`
5. `feat: add confidence-aware scoring module`
6. `feat: add versioned benchmark report schema`
7. `feat: add web benchmark workflow`
8. `feat: add route history and report export`
9. `feat: add localhost agent foundation`
10. `feat: add real Codex CLI benchmark`

每笔功能提交至少满足：

- 模块边界清晰
- 有测试或可重复验证方式
- 不把未实现能力显示为已验证
- 更新必要的类型与文档

## 8. 分阶段交付

### Phase 1 — Core Foundation

- AI 服务目录
- 指标统计
- 评分模型
- 报告 Schema

### Phase 2 — Web MVP

- 多平台 HTTPS 检测
- 三态交互
- 延迟曲线
- 路线历史
- GitHub Pages 发布

### Phase 3 — Realtime

- 公共 WebSocket 测试服务
- 握手、心跳、保持、断开与重连
- 明确区分公共长连接与 AI 内部协议

### Phase 4 — Local Agent

- localhost 服务
- 网络分阶段测试
- Codex 真实执行
- Claude Code 等插件式适配器

## 9. 当前状态

- [x] 技术架构与开发路线
- [ ] AI Service Catalog
- [ ] Metrics
- [ ] HTTPS Benchmark Engine
- [ ] Scoring
- [ ] Report Schema
- [ ] Web App
- [ ] Local Agent

## License

计划使用 MIT License。仓库正式发布前补充许可证文件。
