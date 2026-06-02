LingCrawl is a web scraper API. The directory you have access to is a monorepo:
 - `apps/api` has the actual API and worker code
 - `apps/js-sdk`, `apps/python-sdk`, and `apps/rust-sdk` are various SDKs

## 启动项目

```bash
docker compose up -d
```

该命令会启动所有服务：api、redis、rabbitmq、nuq-postgres、playwright-service、searxng。SearXNG 配置文件位于 `apps/api/searxng-settings.yml`。

## 二次开发指南

### 项目结构

- `apps/api` — 核心 API 和 Worker 代码（主要开发区域）
- `apps/js-sdk` / `apps/python-sdk` / `apps/rust-sdk` — 各语言 SDK
- `docker-compose.yml` — 一键启动所有服务

### 开发流程

1. 先写端到端测试（项目里叫 `snips`）
2. 写代码实现功能
3. 用 `pnpm harness jest ...` 跑测试
4. 提 PR 让 CI 验证

### 常见二次开发方向

- **新增抓取功能** — 新的页面解析方式、数据提取逻辑
- **扩展 API 端点** — 在 `apps/api` 中添加新路由
- **集成其他 AI 模型** — 替换或扩展 LLM 调用
- **修改 Worker 处理逻辑** — 调整任务队列和处理流程
- **自部署/私有化配置** — 调整环境变量和基础设施配置

When making changes to the API, here are the general steps you should take:
1. Write some end-to-end tests that assert your win conditions, if they don't already exist
  - 1 happy path (more is encouraged if there are multiple happy paths with significantly different code paths taken)
  - 1+ failure path(s)
  - Generally, E2E (called `snips` in the API) is always preferred over unit testing.
  - In the API, always use `scrapeTimeout` from `./lib` to set the timeout you use for scrapes.
  - These tests will be ran on a variety of configurations. You should gate tests in the following manner:
    - If it requires fire-engine: `!process.env.TEST_SUITE_SELF_HOSTED`
    - If it requires AI: `!process.env.TEST_SUITE_SELF_HOSTED || process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL`
2. Write code to achieve your win conditions
3. Run your tests using `pnpm harness jest ...`
  - `pnpm harness` is a command that gets the API server and workers up for you to run the tests. Don't try to `pnpm start` manually.
  - The full test suite takes a long time to run, so you should try to only execute the relevant tests locally, and let CI run the full test suite.
4. Push to a branch, open a PR, and let CI run to verify your win condition.
Keep these steps in mind while building your TODO list.

---

## Karpathy AI 编码指南

四条核心原则用于减少 AI 编码中的常见错误。倾向于谨慎而非速度。

### 1. 编码前思考

不要假设。不要隐藏困惑。呈现权衡。

- **明确说明假设** — 不确定时询问，不要默默猜测然后执行。
- **呈现多种解释** — 存在歧义时把选项摆出来让用户选择。
- **适时提出异议** — 存在更简单方案时说出来。
- **困惑时停下来** — 指出不清楚的地方并请求澄清。

### 2. 简洁优先

用最少的代码解决问题。不做推测性实现。

- 不添加需求之外的功能（YAGNI）
- 不为一次性代码创建抽象层
- 不添加未要求的"灵活性"或"可配置性"
- 不为不可能发生的场景做错误处理
- 如果写了 200 行发现 50 行就能搞定，重写它

自检标准：资深工程师会觉得这过于复杂吗？如果是，简化。

### 3. 精准修改

只碰必须碰的。只清理自己造成的混乱。

- 不要"顺便改进"相邻的代码、注释或格式
- 不要重构没坏的东西
- 匹配现有代码风格，即使你偏好不同的写法
- 注意到无关的死代码时提一下，但不要删除它
- 删除因你的改动而变得无用的导入/变量/函数（你制造的混乱你清理）
- 不要删除预先存在的死代码，除非被要求

检验标准：每一行修改都应该能直接追溯到用户的请求。

### 4. 目标驱动执行

定义成功标准。循环验证直到达成。

- 将模糊指令转化为可验证的目标（例如"修复 bug" → "编写能重现 bug 的测试，然后让它通过"）
- 多步骤任务列出简短计划，每步附带验证标准
- 给目标而不是给指令，让 AI 能独立循环执行直到达成

---

## 回复规范

每次回答的最后都要添加 `ok`。

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.