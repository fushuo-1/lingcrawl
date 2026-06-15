# ADR-0004: 集成 MinerU 云 API 作为 PDF OCR 引擎

## 状态

已接受

## 背景

LingCrawl 的 PDF 引擎当前只能处理文本型 PDF（TextBased）。系统已具备检测扫描件/图片型 PDF 的能力（Rust `pdf-inspector`），并预留了 `mode: "ocr"` 接口、`PDFOCRRequiredError` 错误类型、`pages_needing_ocr` 页面标记等空壳，但未集成任何 OCR 引擎。扫描件 PDF 只会返回错误提示。

需要选择一个 OCR 引擎并确定集成方案，使 LingCrawl 能处理扫描件和图片型 PDF。

## 决策

采用 MinerU 精准解析云 API 作为 PDF OCR 引擎，作为 PDF 引擎内部的子处理器集成。

### OCR 引擎选择

- **MinerU** — OpenDataLab 开源文档解析引擎，67.6k GitHub Stars
- 精准解析 API 目前免费，每日 1000 页高优先级额度，超出后降速不限制
- 支持 109 种语言 OCR，表格/公式/复杂版面识别
- 模型版本默认 `vlm`（视觉语言大模型），可配置切换 `pipeline`

### 集成方式

- **只接入 MinerU 精准解析云 API**（`https://mineru.net/api/v4`）
- 不自部署 MinerU Docker 容器，不引入 Python/GPU 依赖
- 通过环境变量 `MINERU_API_URL` 可切换到自部署实例（未来扩展）

### 架构定位

- **PDF 引擎内部子处理器** — 在 `engines/pdf/index.ts` 的 `scrapePDF()` 内部调用 MinerU
- 不创建独立的 waterfall 引擎，不新增 FeatureFlag
- 保持现有引擎选择算法不变

### 触发策略

- `mode="fast"` — 不变，扫描件直接抛 `PDFOCRRequiredError`
- `mode="auto"`（默认）— Rust 检测为 Scanned/ImageBased/Mixed 时自动调 MinerU
- `mode="ocr"` — 强制全量走 MinerU（即使文本型 PDF 也用 MinerU，精度更高）

### 调用流程

1. `scrapePDF()` 下载 PDF 到本地
2. Rust `processPdf()` 检测 PDF 类型
3. 根据 mode 和 PDF 类型决定是否调 MinerU
4. 调 MinerU 精准解析 API：`POST /api/v4/file-urls/batch` 获取签名上传 URL → PUT 上传文件
5. 轮询任务状态（间隔 3s，超时 120s）
6. 下载 zip 结果包，提取 `full.md` 和 `*_content_list.json`
7. `full.md` 作为 markdown 结果全量替换 Rust/pdfParse 输出
8. `content_list.json` 中 `table` 类型项映射为 `ExtractedTable[]`

### 文件传输

- 统一使用批量上传 API（`/api/v4/file-urls/batch`）的签名 PUT 上传方式
- 远程 URL PDF 和本地上传 PDF 都走同一流程（已下载到本地的文件直接上传）
- 不依赖 MinerU 服务器能否访问原始 URL

### 结果映射

- `full.md` → `PDFProcessorResult.markdown`（全量替换）
- `content_list.json` 中 `table` → `ExtractedTable[]`（结构化表格）
- 图片保留 markdown 中的路径引用，不提取 base64

### 错误处理

- MinerU 调用失败（超时/认证/配额/服务端错误）直接抛可序列化错误
- 不静默回退到 pdfParse — 用户选择 OCR 模式时应得到明确的错误反馈

### 不包含

- 自部署 MinerU Docker 容器
- 页面级 OCR 拼接（Mixed 类型全量发给 MinerU）
- 图片 base64 提取
- MinerU 轻量 Agent API（配额/精度限制）

## 理由

1. MinerU 精准解析 API 免费、无需 GPU、零运维，适合自部署场景的 OCR 需求
2. 精准解析 API 支持文件上传（签名 PUT），不依赖 MinerU 能否访问原始 PDF URL
3. 作为 PDF 引擎内部子处理器集成，改动范围最小 — 不碰 waterfall、不新增引擎/FeatureFlag
4. 三模式触发策略（fast/auto/ocr）完美契合已有的 `pdfModeSchema` 设计，填补了预留接口
5. 全量替换策略避免了页面级拼接的复杂性，MinerU 的版面分析是全局的
6. `vlm` 模型在 OmniDocBench 基准测试中超越 GPT-4o，精度有保障
