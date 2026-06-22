/**
 * resources.ts — MCP resources the client can read by URI.
 *
 *   gotquestions://methodology      static  — the editor's-craft handbook (bundled text)
 *   gotquestions://question/{id}    dynamic — one question as markdown
 *   gotquestions://pack/{id}        dynamic — a whole pack/tournament as markdown
 *
 * The methodology resource grounds the profiling/quality analysis in real methodology.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import * as gq from "./client.js";
import { normalizeQuestion, formatQuestion } from "./types.js";

// data/ sits next to build/ at the project root; this file runs from build/.
const HERE = dirname(fileURLToPath(import.meta.url));
const METHODOLOGY_PATH = join(HERE, "..", "data", "methodology.txt");

let methodologyCache: string | null = null;
function methodology(): string {
  if (methodologyCache === null) {
    try {
      methodologyCache = readFileSync(METHODOLOGY_PATH, "utf8");
    } catch {
      methodologyCache =
        "(Методическое пособие недоступно: data/methodology.txt не найден — запустите извлечение из PDF.)";
    }
  }
  return methodologyCache;
}

const firstId = (id: string | string[]): number =>
  Number(Array.isArray(id) ? id[0] : id);

export function registerResources(server: McpServer): void {
  server.registerResource(
    "methodology",
    "gotquestions://methodology",
    {
      title: "Методическое пособие (Юрий Вашкулат)",
      description:
        "Методическое пособие по составлению вопросов «Что? Где? Когда?». A rubric for " +
        "analysing question craft, difficulty, and an editor's/author's style and quality.",
      mimeType: "text/plain",
    },
    async (uri): Promise<ReadResourceResult> => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: methodology() }],
    }),
  );

  server.registerResource(
    "question",
    new ResourceTemplate("gotquestions://question/{id}", { list: undefined }),
    {
      title: "Вопрос ЧГК",
      description: "A single ЧГК question by id, as readable markdown.",
      mimeType: "text/markdown",
    },
    async (uri, { id }): Promise<ReadResourceResult> => {
      const q = normalizeQuestion(await gq.getQuestion(firstId(id)));
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatQuestion(q) }],
      };
    },
  );

  server.registerResource(
    "pack",
    new ResourceTemplate("gotquestions://pack/{id}", { list: undefined }),
    {
      title: "Пакет вопросов ЧГК",
      description: "A whole pack / tournament by id: all of its questions as markdown.",
      mimeType: "text/markdown",
    },
    async (uri, { id }): Promise<ReadResourceResult> => {
      const pack = await gq.getPack(firstId(id));
      const header = `# ${pack.title ?? "Пакет"} (id ${pack.id})\n\nВопросов: ${pack.questions.length}`;
      const body = pack.questions
        .map((raw) => formatQuestion(normalizeQuestion(raw)))
        .join("\n\n---\n\n");
      return {
        contents: [
          { uri: uri.href, mimeType: "text/markdown", text: `${header}\n\n${body}` },
        ],
      };
    },
  );
}
