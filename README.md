<div align="right"><sub><a href="./README.en.md">English</a>&nbsp;&nbsp;|&nbsp;&nbsp;<b>简体中文</b></sub></div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/hero-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/hero-light.svg">
  <img src="./assets/hero-light.svg" width="880" alt="mcp-conform — 中立的跨客户端 MCP 一致性校验工具">
</picture>

<p><sub>mcp-conform 是中立的跨客户端 <b>MCP</b> 一致性校验工具，一条命令输出每客户端的行为 + Zero-Touch OAuth 校验矩阵。</sub></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/SuperMarioYL/mcp-conform/releases"><img src="https://img.shields.io/github/v/release/SuperMarioYL/mcp-conform?color=0071E3" alt="Latest release"></a>
  <a href="https://github.com/SuperMarioYL/mcp-conform/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/SuperMarioYL/mcp-conform/ci.yml?branch=main&label=ci" alt="CI status"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node >= 20">
  <img src="https://img.shields.io/badge/MCP-ready-5E5CE6" alt="MCP-ready">
  <img src="https://img.shields.io/badge/Cursor%20%C2%B7%20Gemini-roadmap-3B5B82" alt="Cursor / Gemini on roadmap">
</p>

**痛点 → 解法：你只有「在 Cursor 能跑、在 Claude Code 不行」的传闻，没有证据；mcp-conform 用一条 `npx` 命令把任意 MCP server 跑过行为 + OAuth 校验，给你一张可发布的每客户端一致性矩阵。**

`awesome-mcp-servers`（[punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)，89k★）解决了「发现」，Zero-Touch OAuth 规范定义了「企业级鉴权」，但两者之间没有任何工具去**断言**某个 server 真的跨客户端正确实现了规范。这块空地没人占——而它天然属于一个谁都不偏袒的中立工具：没有哪个客户端厂商有动力去认证「自己和竞品行为一致」。mcp-conform 就站在这个位置。

## 目录

- [架构](#架构)
- [安装与快速开始](#安装与快速开始)
- [用法](#用法)
- [Demo](#demo)
- [对比 awesome-mcp-servers](#对比-awesome-mcp-servers)
- [路线图](#路线图)
- [许可证](#许可证)

<h2 id="架构"><img src="https://api.iconify.design/tabler:topology-star-3.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 架构</h2>

单个 Node CLI，一个进程（外加被 spawn 出的 server 子进程）。`runner` 编排：选适配器 → 通过 stdio 启动目标 server → 跑 `spec/*` 纯校验函数 → 收集结果 → `report/*` 渲染矩阵并写徽章。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/atlas-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/atlas-light.svg">
  <img src="./assets/atlas-light.svg" width="880" alt="架构：CLI → runner → stdio 启动目标 MCP server → spec 校验 × client 适配器 → 一致性矩阵 + 徽章">
</picture>

核心 primitive 是**一致性矩阵**：一张以 `(client, axis, check_id)` 为键的类型化报告。`axis ∈ {behavior, auth}`，`status ∈ {pass, fail, skip, n/a}`，失败时带上具体断言名。这是个真正的新名词——今天没有任何东西能在单张类型化报告里断言「跨客户端行为一致」。

<h2 id="安装与快速开始"><img src="https://api.iconify.design/tabler:rocket.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 安装与快速开始</h2>

无需安装，直接用 `npx` 跑内置 echo fixture（冷启动到首个结果 3 条命令以内）：

```bash
git clone https://github.com/SuperMarioYL/mcp-conform && cd mcp-conform
npm install && npm run build
npx mcp-conform run node ./dist/fixtures/echo-server/server.js --badge
```

<details><summary>示例输出</summary>

```text
mcp-conform — conformance matrix (spec 0.1)
server: node ./dist/fixtures/echo-server/server.js  [stdio]

Client       behavior  auth
-------------------------------
Claude Code  ✓ pass    ~ skip
Cursor*      - n/a     - n/a
Gemini*      - n/a     - n/a

All applicable checks passed (n/a = adapter stubbed, skip = optional).

* = adapter stubbed (returns n/a) — real adapter lands in a later release.
```

`--badge` 会额外写出 `badge.svg` / `badge.json`，可直接贴进你自己的 README。
</details>

<h2 id="用法"><img src="https://api.iconify.design/tabler:terminal-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 用法</h2>

唯一子命令是 `run`，后面跟「如何启动你的 server」的完整命令：

```bash
# 1. 跑你自己的 server（任意可执行命令，stdio 传输）
npx mcp-conform run node ./my-mcp-server.js

# 2. 输出稳定 JSON，接进 CI 断言
npx mcp-conform run node ./my-mcp-server.js --json

# 3. 写出徽章 + 完整报告，贴进 README / 提交进仓库
npx mcp-conform run node ./my-mcp-server.js --badge --report

# 4. 跑 Zero-Touch OAuth 的活体 discovery 探测（HTTP 资源），让 auth 列变成真实 pass/fail
npx mcp-conform run node ./my-mcp-server.js --base-url https://api.example.com/mcp
```

| 选项 | 作用 |
| --- | --- |
| `--json` | 打印类型化矩阵 JSON（替代彩色表），适合 CI |
| `--badge [dir]` | 写出 `badge.svg` + `badge.json` |
| `--report [path]` | 写出完整 `report.json` |
| `--cwd <dir>` | 被 spawn server 的工作目录 |
| `--timeout <ms>` | 握手超时（默认 15000） |
| `--base-url <url>` | HTTP 资源 base URL，跑 Zero-Touch OAuth discovery 探测（Protected Resource Metadata + `WWW-Authenticate`）。省略时（stdio）auth 列为 `skip` |

退出码：任意 `fail` → 退出 `1`（CI 红）；`n/a` 与 `skip` 不会让 CI 失败。更多见 [`examples/`](./examples/)。

<h2 id="demo"><img src="https://api.iconify.design/tabler:photo.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> Demo</h2>

![demo](assets/demo.gif)

> 30 秒走完 happy path：`npx mcp-conform run` → stdio 启动 → 握手/tools 绿 → OAuth 黄（可选）→ 渲染 client × {behavior, auth} 矩阵 → 写徽章、退出 0。

<h2 id="对比-awesome-mcp-servers"><img src="https://api.iconify.design/tabler:git-compare.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 对比 awesome-mcp-servers</h2>

诚实对比 [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)——它不是竞品，而是 mcp-conform 紧挨着站的那个目录：

| 维度 | awesome-mcp-servers | mcp-conform |
| --- | :---: | :---: |
| 发现 / 收录的 server 数量 | ✓（89k★ 的策展广度） | — |
| 实际运行 server 并断言行为 | — | ✓ |
| Zero-Touch OAuth 校验 | — | ✓（discovery / 元数据 / challenge 形状） |
| 每客户端一致性矩阵 + 徽章 | — | ✓ |
| 真实适配器覆盖 | 不适用 | partial（仅 Claude Code 实装；Cursor / Gemini 返回 `n/a`） |

它在「广度」上完胜——一个策展 README 永远比一个测试工具收录更多 server。mcp-conform 不抢这块，它补的是「这个 server 真的跨客户端合规吗」的那个动作。

<h2 id="路线图"><img src="https://api.iconify.design/tabler:map-2.svg?color=%230071E3&width=24" height="22" align="absmiddle" alt=""> 路线图</h2>

- [x] **m1 · 跑通校验集** — `run` 经 stdio 启动 server，跑握手 + tools 校验，打印 pass/fail。
- [x] **m2 · 输出一致性矩阵** — Claude Code 适配器 + OAuth discovery 校验，彩色 client × {auth, behavior} 矩阵 + `badge.svg` / `report.json`。
- [x] **m3 · 标准 fixture** — 内置 echo fixture，一条命令复现绿矩阵。
- [x] **v0.2 · 活体 OAuth discovery 探测** — `--base-url <url>` 让 auth 列从 `skip` 变成真实的 pass/fail（v0.1 写了校验但 CLI 从未把 base URL 接进去）。
- [x] **v0.2 · 版本单一来源** — `clientInfo.version` 与 `--version` 统一从 `VERSION` 文件读取，不再硬编码。
- [ ] **更深的 OAuth** — 在 discovery/shape 之上走端到端 token grant。
- [ ] **真实 Cursor / Gemini 适配器** — MCP 协议在 stdio 上是 client 无关的，所以「真实」Cursor 适配器会和 Claude Code 跑同一批校验、只多一列而非多一项检查；待出现「客户端在协议层有差异」的真实需求再做。

## 许可证

[MIT](./LICENSE)。欢迎提 issue 或 PR：发现某个 server 在某客户端下行为不一致，或想加一个新客户端适配器，开个 issue 描述复现命令即可。

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
