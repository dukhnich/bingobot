/**
 * prompts.ts — user-invoked guided workflows (surface as slash commands in Claude Code).
 *
 * Each prompt returns a single user message that instructs Claude HOW to use our tools
 * (search_questions, get_question) and resources (gotquestions://methodology, …/pack/{id})
 * to accomplish a task. The prompts don't fetch data themselves — they orchestrate.
 *
 * Two cross-cutting principles for the analysis prompts:
 *  - RELEVANCE FILTERING: search is lexical, so Claude must read each hit and keep only the
 *    intended sense, dropping homonyms (e.g. «река Амазонка» when the topic is the Amazon
 *    warriors), and report what it excluded.
 *  - COVERAGE: scan up to ~120 candidates (≈3 pages) or the full total if smaller, and state
 *    how many of N were examined so counts are honest.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

const userMessage = (text: string): GetPromptResult => ({
  messages: [{ role: "user", content: { type: "text", text } }],
});

const RELEVANCE =
  "ВАЖНО (релевантность): поиск лексический, поэтому прочитай текст и ответ каждого " +
  "найденного вопроса и оставь только те, что действительно относятся к теме в нужном " +
  "смысле. Отбрасывай омонимы и посторонние значения — например, для темы «амазонки/" +
  "Ипполита» отбрось «реку Амазонку» и «Ипполита из „Иронии судьбы“». В конце отдельно " +
  "перечисли, что ты исключил как ложные срабатывания.";

const COVERAGE =
  "Охват: используй search_questions с limit 40; просмотри до ~120 кандидатов (до 3 страниц) " +
  "или весь объём, если найдено меньше. В выводе укажи, сколько из общего числа (total) " +
  "вопросов ты реально проанализировал, чтобы числа были честными.";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "analyze_topic",
    {
      title: "Анализ темы: кластеры мотивов",
      description:
        "Analyse a subject across the question base: gather questions, filter out wrong-sense " +
        "homonyms, and cluster by the specific recurring motif/fact each question hinges on, " +
        "with a count and example ids per motif.",
      argsSchema: {
        query: z
          .string()
          .describe('Тема/запрос, напр. «анализ вопросов об Ипполите и амазонках»'),
        maxPages: z.string().optional().describe("Сколько страниц по 40 просмотреть (по умолч. 3)"),
      },
    },
    ({ query, maxPages }) =>
      userMessage(
        `Проанализируй тему: «${query}».\n\n` +
          `1. Выдели предмет анализа и его лексические варианты (разные формы слова, имена, ` +
          `синонимы) и сделай один или несколько вызовов search_questions по этим вариантам ` +
          `(до ${maxPages ?? 3} страниц по 40).\n` +
          `2. ${RELEVANCE}\n` +
          `3. Сгруппируй оставшиеся вопросы по КОНКРЕТНОМУ повторяющемуся мотиву/факту, на ` +
          `котором держится вопрос (а НЕ по широким областям знаний). Например для амазонок: ` +
          `«отрезанная грудь», «пояс Ипполиты», «кони», «Амазонки vs река Амазонка», ` +
          `«Ипполита-царица».\n` +
          `4. Для каждого мотива: число вопросов + id-примеры (со ссылками).\n` +
          `5. ${COVERAGE}\n` +
          `6. Заверши краткой сводкой: какие мотивы доминируют, и списком исключённых ` +
          `ложных срабатываний.`,
      ),
  );

  server.registerPrompt(
    "group_by_author",
    {
      title: "Сгруппировать вопросы по авторам",
      description:
        "Search questions on a topic (relevance-filtered) and group/compare by author. " +
        "Optionally restrict to a given list of authors to compare just them.",
      argsSchema: {
        query: z.string().describe("Тема/запрос для поиска"),
        authors: z
          .string()
          .optional()
          .describe("Необязательно: авторы через запятую (имена или id) — сравнить именно их"),
      },
    },
    ({ query, authors }) => {
      const focus = authors
        ? `Ограничься авторами: ${authors}. Для каждого из них вызови search_questions с ` +
          `фильтром author=<имя или id> и запросом «${query}», затем сравни их между собой.`
        : `Найди вопросы по запросу «${query}» (search_questions, limit 40, до ~120) и ` +
          `сгруппируй по авторам.`;
      return userMessage(
        `${focus}\n\n${RELEVANCE}\n\n` +
          `Для каждого автора: число вопросов в выборке, их id-примеры, общие темы и ` +
          `особенности стиля. ${authors ? "Сравни подходы перечисленных авторов." : "Выдели авторов, которые чаще всего пишут на эту тему, и сравни их подходы."}`,
      );
    },
  );

  server.registerPrompt(
    "make_quiz",
    {
      title: "Собрать мини-пакет по теме",
      description: "Assemble a short themed quiz, optionally targeting a difficulty (trueDL 0–10).",
      argsSchema: {
        theme: z.string().describe("Тема пакета"),
        count: z.string().optional().describe("Сколько вопросов (по умолчанию 5)"),
        difficulty: z
          .string()
          .optional()
          .describe("Необязательно: сложность — easy/medium/hard или индекс trueDL 0–10"),
      },
    },
    ({ theme, count, difficulty }) => {
      const diff = difficulty
        ? `Целевая сложность: «${difficulty}». Используй индекс trueDL (0–10, где меньше = легче) ` +
          `через minTrueDL/maxTrueDL в search_questions. Ориентир: easy ≈ 0–3, medium ≈ 3–7, ` +
          `hard ≈ 7–10; если задан числовой диапазон 0–10 — используй его напрямую.\n`
        : "";
      return userMessage(
        `Составь мини-пакет из ${count ?? 5} вопросов ЧГК на тему «${theme}».\n\n` +
          `${diff}` +
          `1. Используй search_questions (и get_question для полного текста при необходимости); ` +
          `оставляй только вопросы, действительно относящиеся к теме.\n` +
          `2. Отбери разнообразные и интересные вопросы${difficulty ? " указанной сложности" : " разной сложности"}.\n` +
          `3. Оформи так: сначала текст вопроса (и раздатка, если есть) — БЕЗ ответа; затем ` +
          `отдельно «Ответ / Зачёт / Комментарий / Источник».\n` +
          `4. Если у вопроса есть инструкции ведущему (editorialNotes), приведи их — они могут ` +
          `быть частью механики вопроса.`,
      );
    },
  );

  server.registerPrompt(
    "profile_source",
    {
      title: "Профиль автора / редактора / пакета",
      description:
        "Profile a person (author or editor) or a pack: typical techniques, favourite themes " +
        "and sources, typical complexity and style — graded against the methodology handbook.",
      argsSchema: {
        kind: z.enum(["author", "editor", "pack"]).describe("Что профилируем"),
        target: z
          .string()
          .describe("Имя или числовой id персоны (author/editor) либо id пакета"),
        query: z.string().optional().describe("Необязательно сузить тему"),
      },
    },
    ({ kind, target, query }) => {
      const gather =
        kind === "pack"
          ? `1. Прочитай ресурс gotquestions://pack/${target} — это все вопросы пакета.`
          : `1. Собери вопросы: search_questions с фильтром ${kind}=${JSON.stringify(target)} ` +
            `(по id — точно; по имени — нестрого), query=${query ? JSON.stringify(query) : '""'}, ` +
            `limit 40; при необходимости несколько страниц (page=2, 3…).`;
      return userMessage(
        `Составь профиль: ${kind} «${target}»${query ? ` (тема: «${query}»)` : ""}.\n\n` +
          `${gather}\n` +
          `2. Прочитай ресурс gotquestions://methodology (методическое пособие Вашкулата) и ` +
          `используй его как рубрику для оценки мастерства.\n` +
          `3. Охарактеризуй:\n` +
          `   - типичные приёмы и структуры вопросов;\n` +
          `   - любимые темы и области знаний;\n` +
          `   - излюбленные источники;\n` +
          `   - типичную сложность (complexity и trueDL);\n` +
          `   - стиль формулировок, использование раздаток и инструкций ведущему.\n` +
          `4. Сделай выводы, подкрепляя каждый конкретными примерами (id вопросов).`,
      );
    },
  );
}
