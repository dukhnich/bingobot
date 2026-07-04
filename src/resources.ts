/**
 * resources.ts — MCP resources the client can read by URI.
 *
 *   gotquestions://methodology          static  — index (TOC + 1-line gloss per приём)
 *   gotquestions://methodology/{slug}   static  — one section of the handbook, full text
 *   gotquestions://question/{id}        dynamic — one question as markdown
 *   gotquestions://pack/{id}            dynamic — a whole pack/tournament as markdown
 *
 * The handbook (~110k tokens) is too large to read whole, so we parse it once into its
 * natural sections (the приёмы from the Оглавление) and serve a small index plus on-demand
 * per-section drill-down. This grounds the profiling/quality analysis in real methodology
 * without flooding the model's context.
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

let rawCache: string | null = null;
function methodologyRaw(): string {
  if (rawCache === null) {
    try {
      rawCache = readFileSync(METHODOLOGY_PATH, "utf8");
    } catch {
      rawCache =
        "(Методическое пособие недоступно: data/methodology.txt не найден — запустите извлечение из PDF.)";
    }
  }
  return rawCache;
}

// ── methodology parsing: split the handbook into its приём-sections ──────────────
interface Section {
  slug: string;
  title: string;
  part: string;
  gloss: string;
  text: string;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};
const NUM_PREFIX = /^\d+(\.\d+)*\.\s*/;
const NUM_ONLY = /^\d+(\.\d+)*\.?$/;
const slugify = (t: string): string =>
  t
    .toLowerCase()
    .split("")
    .map((c) => (c in TRANSLIT ? TRANSLIT[c] : c))
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const normHeader = (s: string): string =>
  s.trim().replace(NUM_PREFIX, "").replace(/\.+$/, "").trim();

const GLOSS_SKIP = ["Автор", "Вопрос", "Ответ", "Комментарий", "Зачет", "Зачёт", "Источник", "(см"];
function gloss(bodyLines: string[]): string {
  for (const raw of bodyLines) {
    const s = raw.trim();
    if (
      s.length >= 40 &&
      /[а-яё]/.test(s) &&
      !GLOSS_SKIP.some((p) => s.startsWith(p)) &&
      !"-•\"".includes(s[0])
    ) {
      return s.length > 118 ? s.slice(0, 117) + "…" : s;
    }
  }
  return "";
}

let parsedCache: { sections: Section[]; bySlug: Map<string, Section> } | null = null;
export function methodologySections(): { sections: Section[]; bySlug: Map<string, Section> } {
  if (parsedCache) return parsedCache;
  const lines = methodologyRaw().split("\n");
  const part1 = "Часть 1. Стандартные ходы и приемы";
  const heads = lines.flatMap((l, i) => (l.trim() === part1 ? [i] : []));
  const tocStart = lines.findIndex((l) => l.trim() === "Оглавление");

  // The Оглавление lists titles; the body repeats them (the 2nd "Часть 1" line).
  if (heads.length < 2 || tocStart < 0) {
    parsedCache = { sections: [], bySlug: new Map() };
    return parsedCache;
  }
  const bodyStart = heads[1];

  // 1) canonical ordered (title, part) from the TOC
  const titles: { title: string; part: string }[] = [];
  let part = "";
  for (const l of lines.slice(tocStart + 1, bodyStart)) {
    const s = l.trim();
    if (!s) continue;
    if (s.startsWith("Часть ")) { part = s; continue; }
    if (NUM_ONLY.test(s)) continue;
    titles.push({ title: normHeader(s), part });
  }

  // 2) locate each title's header line in the body, sequentially (preserves order,
  //    tolerates numeric prefixes like "8.1." and avoids matching title words mid-text)
  const starts: (number | null)[] = [];
  let pos = bodyStart;
  for (const { title } of titles) {
    let found: number | null = null;
    for (let i = pos; i < lines.length; i++) {
      if (normHeader(lines[i]) === title) { found = i; break; }
    }
    starts.push(found);
    if (found !== null) pos = found + 1;
  }

  // 3) slice body between consecutive section starts
  const sections: Section[] = [];
  for (let i = 0; i < titles.length; i++) {
    const st = starts[i];
    if (st === null) continue;
    let end = lines.length;
    for (let j = i + 1; j < starts.length; j++) {
      if (starts[j] !== null) { end = starts[j]!; break; }
    }
    let slice = lines.slice(st, end);
    while (slice.length && (slice[slice.length - 1].trim() === "" || slice[slice.length - 1].trim().startsWith("Часть "))) {
      slice = slice.slice(0, -1);
    }
    const { title, part } = titles[i];
    sections.push({
      slug: slugify(title),
      title,
      part,
      gloss: gloss(slice.slice(1)),
      text: slice.join("\n"),
    });
  }

  const bySlug = new Map(sections.map((s) => [s.slug, s]));
  parsedCache = { sections, bySlug };
  return parsedCache;
}

// Curated one-line glosses per приём (slug → gloss), written from each section's text.
// The auto-extracted first line stays as a fallback if the handbook is regenerated and a
// slug changes or a new section appears.
const GLOSSES: Record<string, string> = {
  // Часть 1. Стандартные ходы и приемы
  "dekompoziciya": "Разбить вопрос на части и брать их по отдельности — последовательно или параллельно.",
  "redukciya-do-ochevidnogo": "Свести запутанную формулировку к простому очевидному ядру, отбросив лишнее.",
  "prosto-dobav-vody": "В коротком вопросе без ключевых слов мысленно добавить недостающее слово — и ответ проступает.",
  "polnyy-perebor": "Если есть «узкое место» с конечным набором (цвет, день недели, буква) — перебрать все варианты.",
  "poisk-singulyarnosti": "Зацепиться за слово/деталь, нарочито «выпадающую» из канвы вопроса, — она ведёт к ответу.",
  "vybor-otdelno-stoyaschey-versii": "Из множества похожих версий выбирать ту, что сильнее всех отличается от остальных.",
  "kopaem-s-dvuh-storon": "Раскручивать вопрос навстречу — от реалий и от формы, — пока концы не сойдутся.",
  "abbreviatura": "Сложить ответ из первых (иногда не первых) букв ключевых слов.",
  "perevod": "Ответ получается переводом слова/фразы с другого языка или обыгрывает иноязычное звучание.",
  // Часть 2. Некоторые методы
  "logika": "Выводить ответ строгой логической цепочкой из посылок вопроса.",
  "antilogika": "Искать нарочито нелогичный, абсурдный, «глупый» с точки зрения здравого смысла ответ.",
  "klyuchevoe-slovo": "Заметить слово/выражение, прямо намекающее на ответ; пропустишь намёк — не возьмёшь.",
  "vyhod-iz-ploskosti": "Отказаться от напрашивающегося хода и сменить плоскость — каламбур, второй смысл слова.",
  "standartnaya-associaciya": "Отвечать первой банальной ассоциацией: река — Волга, поэт — Пушкин, «где» — в Караганде.",
  "allyuziya": "Почувствовать сходство вопроса с известным произведением (кино, книга, мир) и оттолкнуться от него.",
  "obraznoe-myshlenie": "Зримо представить описанную сцену — ответ подскажет воображение.",
  "vopros-na-shkolu": "Вопрос проверяет конкретное школьное/общеизвестное знание, а не сообразительность.",
  "nul-princip-i-universum-princip": "Проверить крайние ответы: «ничто/нигде/никогда» или, наоборот, «всё/всегда/любой».",
  "otvet-v-voprose": "Вся нужная информация уже в тексте — ответ надо извлечь из самой формулировки.",
  "pushkin": "«Любимый ответ»: на русского поэта/писателя и многие неопределённые вопросы по умолчанию пробуй Пушкина.",
  "vnutrennie-realii": "Вопрос обыгрывает знатоцкий жаргон и реалии тусовки ЧГК — устойчивые выражения игроков.",
  "konyunktura": "Учитывать «модный» ответ момента: то, что у всех на слуху, часто и есть ответ.",
  "zaezzhennye-svyazki": "Распознавать штампованные ассоциативные связки, кочующие из вопроса в вопрос.",
  "otvechaem-po-formulirovke": "Не поняв сути, дать ответ по жёсткой концовке, которая не оставляет иных вариантов.",
  // Часть 3. Специфические вопросы
  "dopolnitelnaya-podskazka": "«Концептуальные» пакеты, где нужна не только информация вопроса, но и общая для турнира надстройка.",
  "chernyy-yaschik": "Слова «что в чёрном ящике» подсказывают: ответ — компактный предмет, который туда поместится.",
  "fiktivnyy-avtor": "Подставной «автор вопроса» / «с вами играет …» служит подсказкой или отсекает неверные версии.",
  "strannaya-fraza": "Необычная реплика ведущего перед вопросом может содержать подсказку.",
  "igrayuschiy-nomer": "Порядковый номер вопроса в пакете бывает частью механики (напр. 8-й — «про Пушкина»).",
  "tekstovoy-razdatochnyy-material": "Розданный на стол текст: его смысл и форма становятся частью вопроса.",
  "tekstovoy-razdatochnyy-material-gde-vazhen-ne-tolko-tekst": "Подсказка спрятана в оформлении раздатки (шрифт, вёрстка), а не в её содержании.",
  "graficheskiy-razdatochnyy-material": "Розданная картинка: опознать объект или заметить характерную деталь.",
  "blicy-i-duplety": "Связки коротких вопросов — по теме/источнику или с дополняющими друг друга ответами.",
  "logika-zameny": "Восстановить заменённое слово (ИКС, АЛЬФА…): замена обычно подобрана по сходству с оригиналом.",
  "eto-nado-znat": "О вопросах, требующих конкретного знания, которое логикой не раскрутить.",
  "malyy-dzhentlmenskiy-nabor": "Корпус «обязательных» книг и фильмов знатока: Стругацкие, Ильф и Петров, Булгаков, «Алиса»…",
  "neobhodimoe-znanie": "Вопросы, где без специфического знания шансов нет — его не угадать.",
  "hrestomatiynaya-klassika": "Хрестоматийные сюжеты и тексты, всплывающие в вопросах снова и снова.",
};

export function methodologyIndex(): string {
  const { sections } = methodologySections();
  if (!sections.length) return methodologyRaw(); // parse failed → fall back to raw text
  const out: string[] = [
    "# Методическое пособие (Ю. Вашкулат) — указатель",
    "",
    `Полный текст разбит на ${sections.length} разделов (приёмов). Прочитай этот указатель, ` +
      "затем читай ТОЛЬКО нужные разделы по URI `gotquestions://methodology/{slug}` " +
      "(обычно 2–4 раздела под замеченные приёмы). Полный текст пособия целиком читать не нужно.",
  ];
  let part = "";
  for (const s of sections) {
    if (s.part !== part) { part = s.part; out.push("", `## ${part}`); }
    out.push(`- **${s.title}** — \`gotquestions://methodology/${s.slug}\``);
    const g = GLOSSES[s.slug] ?? s.gloss;
    if (g) out.push(`  ${g}`);
  }
  return out.join("\n");
}

const firstId = (id: string | string[]): number =>
  Number(Array.isArray(id) ? id[0] : id);
const firstStr = (v: string | string[]): string => (Array.isArray(v) ? v[0] : v);

export function registerResources(server: McpServer): void {
  server.registerResource(
    "methodology",
    "gotquestions://methodology",
    {
      title: "Методическое пособие (Юрий Вашкулат) — указатель",
      description:
        "Index of the question-craft handbook: a table of contents (one приём per line with a " +
        "one-line gloss) plus the URI to read each section in full. A rubric for analysing " +
        "question craft, difficulty, and an editor's/author's style — read this first, then " +
        "drill into the relevant sections via gotquestions://methodology/{slug}.",
      mimeType: "text/markdown",
    },
    async (uri): Promise<ReadResourceResult> => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: methodologyIndex() }],
    }),
  );

  server.registerResource(
    "methodology-section",
    new ResourceTemplate("gotquestions://methodology/{slug}", { list: undefined }),
    {
      title: "Раздел методического пособия",
      description:
        "One section (приём) of the handbook in full, with its examples. Get the {slug} from " +
        "the gotquestions://methodology index.",
      mimeType: "text/markdown",
    },
    async (uri, { slug }): Promise<ReadResourceResult> => {
      const { bySlug } = methodologySections();
      const want = slugify(firstStr(slug));
      const sec = bySlug.get(want);
      const text = sec
        ? sec.text
        : `Раздел «${firstStr(slug)}» не найден. Доступные slug:\n` +
          [...bySlug.keys()].map((s) => `- ${s}`).join("\n");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
      };
    },
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
