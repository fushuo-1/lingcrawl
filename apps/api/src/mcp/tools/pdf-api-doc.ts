import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PDF_UPLOAD_API_DOC = `REST API: PDF 文件上传与文本提取

**重要：必须使用 IPv4 地址 (127.0.0.1)，不要使用 localhost**
localhost 在 Windows 上会走 IPv6 (::1)，被 wslrelay 劫持导致超时。

**端点 (Endpoint):**
POST http://127.0.0.1:${process.env.PORT || 3002}/api/pdf/upload

**Content-Type:** multipart/form-data

**参数 (Parameters):**
- file (required): PDF 文件二进制内容
- pages (optional): 页码范围, 例如 "1-5" 或 "3,7,12-20"
- includeTables (optional): 是否提取表格, 默认 false
- includeImages (optional): 是否提取图片, 默认 false
- mode (optional): 解析模式, 默认 "auto"
  - "fast": 仅文本提取, 扫描件/图片型 PDF 直接报错
  - "auto": 文本型 PDF 走快速提取, 扫描件/图片型/混合型自动触发 MinerU OCR
  - "ocr": 强制全量走 MinerU 高精度解析 (支持 OCR、表格识别、公式识别、复杂版面分析)

**限制 (Limits):**
- 单个 PDF 最大 100MB
- 最大并发上传数: 3

**返回 (Response):**
Content-Type: application/json
{
  "success": true | false,
  "markdown": "提取的文本内容...",
  "metadata": { "title": "...", "pageCount": 100, ... },
  "pageCount": 100,
  "error": "错误信息 (失败时)"
}

**Python 调用示例 (Python Example):**
import requests

with open("document.pdf", "rb") as f:
    response = requests.post(
        "http://127.0.0.1:3002/api/pdf/upload",
        files={"file": f},
        data={
            "pages": "1-10",
            "mode": "auto",
            "includeTables": "true"
        },
        timeout=180
    )
result = response.json()
if result.get("success"):
    text = result["markdown"]
    print(text)
else:
    print(f"Error: {result.get('error')}")

**cURL 调用示例 (cURL Example):**
curl -4 -X POST http://127.0.0.1:3002/api/pdf/upload \\
  -F "file=@document.pdf" \\
  -F "pages=1-5" \\
  -F "mode=auto"

**JavaScript / Node.js 调用示例 (JavaScript Example):**
const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

const form = new FormData();
form.append('file', fs.createReadStream('document.pdf'));
form.append('pages', '1-5');
form.append('mode', 'auto');

const response = await axios.post(
  'http://127.0.0.1:3002/api/pdf/upload',
  form,
  { headers: form.getHeaders(), maxContentLength: 100 * 1024 * 1024 }
);
const result = response.data;
if (result.success) {
  console.log(result.markdown);
}

**使用场景 (When to use):**
- 当需要从本地文件系统读取 PDF 文件
- 当 PDF 文件不在服务器挂载目录中
- 当 PDF 文件较大 (超过 MCP base64 参数限制)
- 当需要从外部 LLM/客户端读取 PDF
- 当需要 OCR 识别扫描件/图片型 PDF (使用 mode="ocr")

**关于 MinerU OCR:**
- OCR 引擎: MinerU 精准解析云 API (vlm 模型)
- 支持: 扫描件、图片型、混合型 PDF 的文本提取
- 能力: OCR (109 种语言)、表格识别、公式识别 (LaTeX)、复杂版面分析
- 超时: OCR 处理通常需要 10-60 秒, 建议 timeout 设为 180 秒
- 配置: 需要 MINERU_API_TOKEN 环境变量 (在 https://mineru.net/apiManage 获取)


**错误码 (Error Codes):**
- 400: 请求格式错误或文件不是 PDF
- 413: 文件超过 100MB 限制
- 500: 服务器内部错误
- 502: MinerU OCR 处理失败 (上游服务错误)
- 常见 OCR 错误:
  - MINERU_TOKEN_MISSING: 未配置 MINERU_API_TOKEN 环境变量
  - MINERU_DISABLED: MINERU_OCR_ENABLED 设为 false
  - MINERU_OCR_FAILED: MinerU API 调用失败 (超时/认证/配额/服务端错误)`;

export function registerPdfApiDocTool(server: McpServer) {
  server.tool(
    "pdf_upload_api_doc",
    "Get documentation for the REST API endpoint /api/pdf/upload. " +
      "Use this tool when you need to inform other LLMs or clients about how to call " +
      "the PDF upload API. Returns a complete reference including endpoint URL, " +
      "parameters, request/response format, code examples in Python/JavaScript/cURL, " +
      "size limits, and error codes. This tool does not perform any upload itself - " +
      "it only returns the API specification as documentation.",
    {
      format: z
        .enum(["markdown", "text", "json"])
        .optional()
        .default("markdown")
        .describe("Output format: 'markdown' (default), 'text', or 'json'"),
    },
    async ({ format }) => {
      if (format === "json") {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  endpoint: "POST /api/pdf/upload",
                  contentType: "multipart/form-data",
                  parameters: {
                    file: { type: "binary", required: true, description: "PDF file" },
                    pages: { type: "string", required: false, description: "Page range e.g. '1-5'" },
                    includeTables: { type: "boolean", required: false, default: false },
                    includeImages: { type: "boolean", required: false, default: false },
                    mode: { type: "string", enum: ["fast", "auto", "ocr"], required: false, default: "auto", description: "fast=text-only(fails on scanned), auto=auto-detect+OCR for scanned, ocr=force MinerU high-precision OCR" },
                  },
                  limits: { maxFileSize: "100MB", maxConcurrent: 3 },
                  response: {
                    success: "boolean",
                    markdown: "string",
                    metadata: "object",
                    pageCount: "number",
                    error: "string (on failure)",
                  },
                  examples: {
                    python: "import requests; requests.post('http://127.0.0.1:3002/api/pdf/upload', files={'file': open('doc.pdf','rb')}, data={'pages':'1-10'})",
                    curl: 'curl -4 -X POST http://127.0.0.1:3002/api/pdf/upload -F "file=@doc.pdf" -F "pages=1-5"',
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (format === "text") {
        // Strip markdown formatting for plain text
        const text = PDF_UPLOAD_API_DOC
          .replace(/\*\*/g, "")
          .replace(/`/g, "");
        return { content: [{ type: "text" as const, text }] };
      }

      // Default: markdown
      return {
        content: [{ type: "text" as const, text: PDF_UPLOAD_API_DOC }],
      };
    },
  );
}