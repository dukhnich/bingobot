/**
 * tools.ts — the MCP tools. This is the "CallToolRequest -> CallToolResult" layer:
 * each tool validates its input (zod), calls the client.ts data layer, and returns
 * formatted text. Registered on the server in index.ts.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as gq from "./client.js";
import {
  normalizeQuestion,
  formatQuestion,
  formatQuestionBrief,
} from "./types.js";

const text = (s: string): CallToolResult => ({ content: [{ type: "text", text: s }] });
const errorText = (s: string): CallToolResult => ({
  content: [{ type: "text", text: s }],
  isError: true,
});

/** Accept either a name (fuzzy) or a numeric person id (exact). */
const personFilter = z.union([z.string(), z.number().int()]);

export function registerTools(server: McpServer): void {
  server.registerTool(
    "search_questions",
    {
      title: "Поиск вопросов ЧГК",
      description:
        "Full-text search over the gotquestions.online ЧГК question database. " +
        "Returns a page of matches (id, text, answer, authors, complexity, pack). " +
        "Filter by editor/author (name OR numeric person id), complexity range (0–100), " +
        "and date played. The author/editor filters work even with an empty query — e.g. " +
        "search('', {author: 267}) returns all questions by that person. Use get_question " +
        "for the full text + comment + source + editorial notes of a specific id.",
      inputSchema: {
        query: z
          .string()
          .default("")
          .describe("Search text; may be empty when filtering by author/editor"),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(gq.MAX_LIMIT).optional().describe("Page size, max 40"),
        editor: personFilter.optional().describe("Editor name (fuzzy) or person id (exact)"),
        author: personFilter.optional().describe("Author name (fuzzy) or person id (exact)"),
        minComplexity: z.number().min(0).max(100).optional(),
        maxComplexity: z.number().min(0).max(100).optional(),
        playedFrom: z.string().optional().describe('Date played from, "YYYY-MM-DD"'),
        playedTo: z.string().optional().describe('Date played to, "YYYY-MM-DD"'),
      },
    },
    async ({ query, ...opts }) => {
      try {
        const res = await gq.search(query, opts);
        if (res.questions.length === 0) {
          return text(`Ничего не найдено по запросу «${query}».`);
        }
        const header =
          `Найдено: ${res.total ?? "?"} · страница ${res.page}` +
          (res.hasMore ? " · есть ещё (увеличьте page)" : "");
        const body = res.questions
          .map((raw) => formatQuestionBrief(normalizeQuestion(raw)))
          .join("\n\n");
        return text(`${header}\n\n${body}`);
      } catch (e) {
        return errorText(`Ошибка поиска: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_question",
    {
      title: "Вопрос ЧГК по id",
      description:
        "Fetch one ЧГК question by its numeric id, with full text, answer, accepted/" +
        "rejected answers, comment, source, authors/editors, and any editorial reader " +
        "instructions (which can be part of the question's mechanics).",
      inputSchema: {
        id: z.number().int().positive().describe("Question id, e.g. 442892"),
      },
    },
    async ({ id }) => {
      try {
        const q = normalizeQuestion(await gq.getQuestion(id));
        return text(formatQuestion(q));
      } catch (e) {
        return errorText(`Не удалось получить вопрос ${id}: ${(e as Error).message}`);
      }
    },
  );
}
