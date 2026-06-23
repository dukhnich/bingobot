/**
 * prompts.ts — user-invoked guided workflows (surface as slash commands in Claude Code).
 *
 * Each prompt returns a single user message that instructs Claude HOW to use our tools
 * (search_questions, get_question) and resources (gotquestions://methodology[/{slug}], …/pack/{id})
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
        request: z
          .string()
          .describe(
            'Свободный запрос, напр. «анализ вопросов об Ипполите и амазонках» или ' +
              "«Византия, просмотри 5 страниц». Тему и при необходимости глубину просмотра " +
              "модель извлекает из текста сама.",
          ),
      },
    },
    ({ request }) =>
      userMessage(
        `Проанализируй тему по запросу: «${request}».\n\n` +
          `0. Разбери запрос: выдели САМУ ТЕМУ анализа и, если указана, глубину просмотра ` +
          `(сколько страниц по 40; по умолчанию 3). Если тема не ясна или слишком широка, чтобы ` +
          `искать осмысленно, задай один короткий уточняющий вопрос; иначе сразу действуй.\n` +
          `1. Выдели предмет анализа и его лексические варианты (разные формы слова, имена, ` +
          `синонимы) и сделай один или несколько вызовов search_questions по этим вариантам ` +
          `(по умолчанию до 3 страниц по 40, либо столько, сколько указано в запросе).\n` +
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
        request: z
          .string()
          .describe(
            'Свободный запрос, напр. «вопросы про космос по авторам» или «сравни Бороду и ' +
              'Науменко на тему Византии». Тему и (необязательно) список авторов модель ' +
              "извлекает из текста сама.",
          ),
      },
    },
    ({ request }) =>
      userMessage(
        `Сгруппируй вопросы по авторам по запросу: «${request}».\n\n` +
          `0. Разбери запрос: выдели ТЕМУ поиска и, если они перечислены, КОНКРЕТНЫХ авторов ` +
          `(имена или id), которых надо сравнить. Если тема не ясна — задай один короткий ` +
          `уточняющий вопрос; иначе действуй.\n` +
          `1. Если заданы конкретные авторы — для каждого вызови search_questions с фильтром ` +
          `author=<имя или id> и темой, затем сравни их между собой. Иначе найди вопросы по теме ` +
          `(search_questions, limit 40, до ~120) и сгруппируй по авторам.\n` +
          `2. ${RELEVANCE}\n` +
          `3. Для каждого автора: число вопросов в выборке, их id-примеры, общие темы и ` +
          `особенности стиля. Если список авторов задан — сравни именно их подходы; иначе выдели ` +
          `авторов, которые чаще всего пишут на эту тему, и сравни их подходы.`,
      ),
  );

  server.registerPrompt(
    "make_quiz",
    {
      title: "Собрать мини-пакет по теме",
      description: "Assemble a short themed quiz, optionally targeting a difficulty (trueDL 0–10).",
      argsSchema: {
        request: z
          .string()
          .describe(
            'Свободный запрос, напр. «5 вопросов про Древний Рим средней сложности» или ' +
              '«мини-пакет про кино, hard». Тему, число вопросов и сложность модель извлекает ' +
              "из текста сама.",
          ),
      },
    },
    ({ request }) =>
      userMessage(
        `Составь мини-пакет вопросов ЧГК по запросу: «${request}».\n\n` +
          `0. Разбери запрос: выдели ТЕМУ пакета, число вопросов (по умолчанию 5) и желаемую ` +
          `сложность (easy/medium/hard или индекс trueDL 0–10), если она указана. Если тема не ` +
          `ясна — задай один короткий уточняющий вопрос; иначе действуй.\n` +
          `   Если сложность задана: используй индекс trueDL (0–10, где меньше = легче) через ` +
          `minTrueDL/maxTrueDL в search_questions. Ориентир: easy ≈ 0–3, medium ≈ 3–7, hard ≈ ` +
          `7–10; числовой диапазон 0–10 используй напрямую.\n` +
          `1. Используй search_questions (и get_question для полного текста при необходимости); ` +
          `оставляй только вопросы, действительно относящиеся к теме.\n` +
          `2. Отбери разнообразные и интересные вопросы — указанной сложности, если она задана, ` +
          `иначе разной.\n` +
          `3. Оформи так: сначала текст вопроса (и раздатка, если есть) — БЕЗ ответа; затем ` +
          `отдельно «Ответ / Зачёт / Комментарий / Источник».\n` +
          `4. Если у вопроса есть инструкции ведущему (editorialNotes), приведи их — они могут ` +
          `быть частью механики вопроса.`,
      ),
  );

  server.registerPrompt(
    "profile_source",
    {
      title: "Профиль автора / редактора / пакета",
      description:
        "Profile a person (author or editor) or a pack from a free-form request: typical " +
        "techniques, favourite themes and sources, typical complexity and style — graded " +
        "against the methodology handbook. Infers kind/target/topic from the request itself " +
        "and asks the user to clarify only when an essential detail is missing or ambiguous.",
      argsSchema: {
        request: z
          .string()
          .describe(
            'Свободный запрос, напр. «редактор П.Полухин», «профиль автора Павел Полухин», ' +
              '«пакет 4922» или просто «Полухин». Роль (author/editor/pack), цель и тему ' +
              "модель извлекает из текста сама.",
          ),
      },
    },
    ({ request }) =>
      userMessage(
        `Составь профиль источника по запросу: «${request}».\n\n` +
          `0. Сначала разбери запрос и определи параметры:\n` +
          `   - KIND — что профилируем: author (автор), editor (редактор) или pack (пакет/тур);\n` +
          `   - TARGET — имя человека, числовой id персоны или id пакета;\n` +
          `   - QUERY — необязательная тема, если просят сузить.\n` +
          `   Эвристики: «автор/пишет/сочинил» → author; «редактор/составил/отредактировал» → ` +
          `editor; «пакет/тур/пак» либо одинокий числовой id без роли → pack; имя без явной ` +
          `роли по умолчанию считай ПЕРСОНОЙ.\n` +
          `   Если KIND нельзя определить уверенно (дано только имя, и неясно — автор это или ` +
          `редактор) ИЛИ TARGET неоднозначен/не находится — НЕ угадывай вслепую: задай ` +
          `пользователю один короткий уточняющий вопрос. Для персоны по имени можешь быстро ` +
          `проверить обе роли через search_questions (author= и editor=) и спросить, какую брать, ` +
          `показав, сколько вопросов нашлось в каждой. Если всё однозначно — переходи к сбору ` +
          `без лишних вопросов.\n` +
          `1. Собери вопросы:\n` +
          `   - персона: search_questions с фильтром author=TARGET или editor=TARGET (по id — ` +
          `точно; по имени — нестрого, имя ищется и при пустом query), limit 40, при ` +
          `необходимости несколько страниц (page=2, 3…);\n` +
          `   - пакет: прочитай ресурс gotquestions://pack/TARGET — это все вопросы пакета.\n` +
          `   Если по имени ничего не нашлось, попробуй другие написания (только фамилия, полное ` +
          `имя, инициалы без точки/с пробелом) и сообщи, какой вариант сработал.\n` +
          `2. Прочитай УКАЗАТЕЛЬ gotquestions://methodology — оглавление пособия Вашкулата с ` +
          `краткими аннотациями приёмов; обычно его уже достаточно как рубрики. Открывай ` +
          `полные разделы gotquestions://methodology/{slug} выборочно — только для 2–3 ` +
          `приёмов, ключевых для этого источника (чтобы привести точное определение или ` +
          `примеры), либо когда аннотации в указателе не хватает. Полное пособие целиком не ` +
          `читай — оно слишком велико.\n` +
          `3. Охарактеризуй:\n` +
          `   - типичные приёмы и структуры вопросов;\n` +
          `   - любимые темы и области знаний;\n` +
          `   - излюбленные источники;\n` +
          `   - типичную сложность (complexity и trueDL);\n` +
          `   - стиль формулировок, использование раздаток и инструкций ведущему.\n` +
          `4. Сделай выводы, подкрепляя каждый конкретными примерами (id вопросов).`,
      ),
  );
}
