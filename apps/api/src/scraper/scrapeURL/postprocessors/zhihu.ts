import { load } from "cheerio";
import type { Meta } from "..";
import type { Postprocessor } from ".";
import type { EngineScrapeResult } from "../engines";

/**
 * Extract JSON content from <script id="js-initialData"> tag.
 */
function extractInitialData(html: string): Record<string, any> | null {
  const $ = load(html);
  const script = $("script#js-initialData");
  if (!script.length) return null;
  try {
    return JSON.parse(script.contents().first().text() ?? "null");
  } catch {
    return null;
  }
}

/**
 * Get entities from initialData.initialState.entities
 */
function getEntities(data: Record<string, any>): Record<string, any> {
  return data?.initialState?.entities ?? {};
}

/**
 * Convert Zhihu's HTML content fragment to plain Markdown text.
 *
 * Handles common Zhihu elements:
 *   - <p>, <br>, <h1-6>, <b>/<strong>, <i>/<em>
 *   - <img> (with data-original / data-actualsrc / src)
 *   - <a> (links), <blockquote>, <code>, <pre>
 *   - <ul>/<ol>/<li>, <figcaption>
 */
function htmlToMarkdown(contentHtml: string): string {
  const $ = load(contentHtml || "", { decodeEntities: false });

  const mdParts: string[] = [];

  function processNode(node: any, depth = 0): string {
    if (node.type === "text") {
      const text = (node.data ?? "").trim();
      return text;
    }

    if (node.type === "tag") {
      const tagName = node.tagName?.toLowerCase();
      const children = $(node).contents().toArray();

      if (tagName === "img") {
        const src = $(node).attr("data-original")
          || $(node).attr("data-actualsrc")
          || $(node).attr("src")
          || "";
        const alt = $(node).attr("alt") || "";
        return src ? `![${alt}](${src})` : "";
      }

      if (tagName === "br") return "\n";
      if (tagName === "hr") return "\n---\n";

      const inner = children.map((c: any) => processNode(c, depth)).join("");

      if (tagName === "p" || tagName === "div") {
        const trimmed = inner.trim();
        if (!trimmed) return "";
        return trimmed + "\n\n";
      }
      if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
        const level = parseInt(tagName[1]);
        return "#".repeat(level) + " " + inner.trim() + "\n\n";
      }
      if (tagName === "b" || tagName === "strong") return `**${inner.trim()}**`;
      if (tagName === "i" || tagName === "em") return `*${inner.trim()}*`;
      if (tagName === "u") return `__${inner.trim()}__`;
      if (tagName === "code") {
        // inline code
        return "`" + inner.trim() + "`";
      }
      if (tagName === "pre") {
        const codeText = $(node).text().trim();
        return "\n```\n" + codeText + "\n```\n\n";
      }
      if (tagName === "blockquote") {
        return "> " + inner.trim().replace(/\n\n/g, "\n> ") + "\n\n";
      }
      if (tagName === "li") {
        const bullet = $(node).parent().prop("tagName")?.toLowerCase() === "ol" ? "1. " : "- ";
        return bullet + inner.trim() + "\n";
      }
      if (tagName === "ul" || tagName === "ol") {
        return inner + "\n";
      }
      if (tagName === "figcaption") {
        return "*" + inner.trim() + "*\n\n";
      }
      if (tagName === "figure") {
        return inner.trim() + "\n\n";
      }
      if (tagName === "span") {
        return inner;
      }
      if (tagName === "a") {
        const href = $(node).attr("href");
        if (!href) return inner;
        // Skip javascript: links
        if (href.startsWith("javascript:")) return inner;
        return `[${inner}](${href})`;
      }
      if (tagName === "table") {
        // strip table, take only text
        return $(node).text().trim() + "\n\n";
      }

      // Default: just recurse
      return inner;
    }

    return "";
  }

  // Process all top-level children of <body>
  let rootNodes: any[];
  if ($("body").length) {
    rootNodes = $("body").contents().toArray();
  } else {
    // Wrap content in body if not present
    const wrappedHtml = $.html();
    rootNodes = load(wrappedHtml)("body").contents().toArray();
  }
  rootNodes.forEach((node: any) => {
    const md = processNode(node).trim();
    if (md) mdParts.push(md);
  });

  return (
    mdParts
      .join("\n")
      .replace(/\n{4,}/g, "\n\n")
      .trim() || ""
  );
}

export const zhihuPostprocessor: Postprocessor = {
  name: "zhihu",
  shouldRun: (_meta: Meta, url: URL, postProcessorsUsed?: string[]) => {
    if (postProcessorsUsed?.includes("zhihu")) return false;
    const hostname = url.hostname.replace(/^www\./, "");
    return hostname === "zhihu.com" || hostname === "zhuanlan.zhihu.com";
  },

  run: async (meta: Meta, engineResult: EngineScrapeResult) => {
    const html = engineResult.html;
    if (!html) {
      meta.logger.warn("Zhihu postprocessor: no HTML content to parse");
      return engineResult;
    }

    // Check for anti-bot challenge (zse-ck)
    if (html.includes("zse_ck") || html.includes("unhuman")) {
      meta.logger.warn(
        "Zhihu postprocessor: anti-bot challenge detected (zse-ck). " +
          "A valid Cookie (d_c0) is required. " +
          "Pass headers: { Cookie: 'd_c0=...' } in the scrape request.",
      );
      return engineResult;
    }

    const data = extractInitialData(html);
    if (!data) {
      meta.logger.warn("Zhihu postprocessor: no js-initialData found in page HTML");
      return engineResult;
    }

    const entities = getEntities(data);
    const urlPath = new URL(engineResult.url).pathname;

    let title = "";
    let markdownContent = "";
    let author = "";
    let voteup = 0;

    // Match article (专栏文章): /p/<id> or zhuanlan.zhihu.com/p/<id>
    const articleMatch = urlPath.match(/\/p\/(\d+)/);
    if (articleMatch) {
      const articleId = articleMatch[1];
      const articles = entities.articles ?? {};
      const article = articles[articleId];
      if (article) {
        title = article.title ?? "";
        const contentHtml = article.content ?? "";
        markdownContent = htmlToMarkdown(contentHtml);
        const authorObj = article.author ?? {};
        author = [authorObj.name, authorObj.urlToken]
          .filter(Boolean)
          .join(" / ");
        voteup = article.voteupCount ?? 0;
        meta.logger.info(`Zhihu postprocessor: extracted article "${title}" by ${author}`);
      } else {
        meta.logger.warn(`Zhihu postprocessor: article ${articleId} not found in initialData`);
      }
    }

    // Match answer (回答): /answer/<id> or /question/<qid>/answer/<aid>
    const answerMatch = urlPath.match(/\/answer\/(\d+)/);
    if (answerMatch) {
      const answerId = answerMatch[1];
      const answers = entities.answers ?? {};
      const answer = answers[answerId];
      if (answer) {
        const question = answer.question ?? {};
        title = question.title ?? "";
        const contentHtml = answer.content ?? "";
        markdownContent = htmlToMarkdown(contentHtml);
        const authorObj = answer.author ?? {};
        author = [authorObj.name, authorObj.urlToken]
          .filter(Boolean)
          .join(" / ");
        voteup = answer.voteupCount ?? 0;
        meta.logger.info(
          `Zhihu postprocessor: extracted answer to "${title}" by ${author}`,
        );
      } else {
        meta.logger.warn(`Zhihu postprocessor: answer ${answerId} not found in initialData`);
      }
    }

    // Match question (问题页): /question/<qid>
    const questionMatch = urlPath.match(/\/question\/(\d+)(?:\/|$)/);
    if (questionMatch && !answerMatch) {
      const questionId = questionMatch[1];
      const questions = entities.questions ?? {};
      const question = questions[questionId];
      if (question) {
        title = question.title ?? "";
        const detailHtml = question.detail ?? "";
        if (detailHtml) {
          markdownContent = htmlToMarkdown(detailHtml);
        }
        const authorObj = question.author ?? {};
        author = [authorObj.name, authorObj.urlToken]
          .filter(Boolean)
          .join(" / ");
        meta.logger.info(
          `Zhihu postprocessor: extracted question "${title}" by ${author}`,
        );
      } else {
        meta.logger.warn(
          `Zhihu postprocessor: question ${questionId} not found in initialData`,
        );
      }
    }

    // Build structured markdown
    if (title && markdownContent) {
      const headerParts: string[] = [];
      headerParts.push(`# ${title}`);
      if (author) headerParts.push(`> 作者: ${author}`);
      if (voteup > 0) headerParts.push(`> 赞同: ${voteup}`);
      headerParts.push("");

      const fullMarkdown = headerParts.join("\n") + "\n" + markdownContent;

      return {
        ...engineResult,
        markdown: fullMarkdown,
        postprocessorsUsed: [
          ...(engineResult.postprocessorsUsed ?? []),
          "zhihu",
        ],
      };
    }

    // If we found initialData but couldn't extract content, return original
    if (!title && !markdownContent) {
      meta.logger.warn(
        "Zhihu postprocessor: no matching content found in initialData entities",
      );
    }

    return engineResult;
  },
};