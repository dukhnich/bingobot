/**
 * types.ts — the clean question model plus pure normalize/format helpers (no network).
 *
 * Turns the raw scraped objects from client.ts/flight.ts into a tidy, display-friendly
 * shape, and renders a question as Russian markdown for tool output.
 */

import type { RawQuestion } from "./flight.js";

const SITE = "https://gotquestions.online";

export interface Person {
  id: number;
  name: string;
}

export interface Question {
  id: number;
  number: number;
  /** Question text with editorial `[Для базы: …]` / `[Ведущему: …]` notes stripped. */
  question: string;
  /** Original text incl. editorial notes, in case the caller wants it. */
  rawQuestion: string;
  handout?: string;
  handoutImage?: string;
  answer: string;
  /** zachet — also-accepted answers. */
  accept?: string;
  /** nezachet — explicitly not accepted. */
  reject?: string;
  comment?: string;
  commentImage?: string;
  source?: string;
  authors: Person[];
  editors: Person[];
  tour?: { id: number; number: number; title: string };
  pack?: { id: number; title: string };
  /** Distinct tournament types (typeoft.title), e.g. ["Синхрон"]. */
  tournamentTypes: string[];
  /** Per-tournament complexity ratings (0..100), often empty. */
  complexity: number[];
  tags: string[];
  url: string;
}

/** Bracketed editorial instructions that aren't part of the question itself. */
const EDITORIAL =
  /\[\s*(?:Для базы|Ведущему|Ведущей|Чтецу|Чтице|Раздатка|Замечание|Внимание)[\s\S]*?\]\s*/g;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const undefIfEmpty = (s: string): string | undefined => (s.trim() ? s : undefined);

function absoluteImg(v: unknown): string | undefined {
  const s = str(v).trim();
  if (!s) return undefined;
  return s.startsWith("http") ? s : SITE + s;
}

function persons(v: unknown): Person[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({ id: Number(p.id), name: str(p.name) }))
    .filter((p) => p.name.length > 0);
}

function tournamentTypes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const titles = v
    .map((t) => (t as Record<string, unknown>)?.typeoft as Record<string, unknown>)
    .map((t) => str(t?.title))
    .filter(Boolean);
  return [...new Set(titles)];
}

/** Normalize one raw question object into the clean Question model. */
export function normalizeQuestion(raw: RawQuestion): Question {
  const id = Number(raw.id);
  const rawText = str(raw.text);
  const question = rawText.replace(EDITORIAL, "").trim();
  const tour = raw.tour as Record<string, unknown> | undefined;
  return {
    id,
    number: Number(raw.number) || 0,
    question: question || rawText,
    rawQuestion: rawText,
    handout: undefIfEmpty(str(raw.razdatkaText)),
    handoutImage: absoluteImg(raw.razdatkaPic),
    answer: str(raw.answer),
    accept: undefIfEmpty(str(raw.zachet)),
    reject: undefIfEmpty(str(raw.nezachet)),
    comment: undefIfEmpty(str(raw.comment)),
    commentImage: absoluteImg(raw.commentPic),
    source: undefIfEmpty(str(raw.source)),
    authors: persons(raw.authors),
    editors: persons(raw.editors),
    tour: tour
      ? { id: Number(tour.id), number: Number(tour.number) || 0, title: str(tour.title) }
      : undefined,
    pack:
      typeof raw.packId === "number"
        ? { id: raw.packId, title: str(raw.packTitle) }
        : undefined,
    tournamentTypes: tournamentTypes(raw.tournaments),
    complexity: Array.isArray(raw.complexity)
      ? (raw.complexity.filter((n) => typeof n === "number") as number[])
      : [],
    tags: Array.isArray(raw.tags) ? (raw.tags.filter((t) => typeof t === "string") as string[]) : [],
    url: `${SITE}/question/${id}`,
  };
}

const names = (people: Person[]): string => people.map((p) => p.name).join(", ");

/** Render a question as a compact Russian markdown block for tool output. */
export function formatQuestion(q: Question): string {
  const lines: string[] = [];
  const head = q.number ? `Вопрос ${q.number}` : "Вопрос";
  lines.push(`**${head}** (id ${q.id})`);
  if (q.handout) lines.push(`_Раздатка:_ ${q.handout}`);
  if (q.handoutImage) lines.push(`_Раздатка (картинка):_ ${q.handoutImage}`);
  lines.push("", q.question, "");
  lines.push(`**Ответ:** ${q.answer}`);
  if (q.accept) lines.push(`**Зачёт:** ${q.accept}`);
  if (q.reject) lines.push(`**Незачёт:** ${q.reject}`);
  if (q.comment) lines.push(`**Комментарий:** ${q.comment}`);
  if (q.source) lines.push(`**Источник:** ${q.source}`);

  const meta: string[] = [];
  if (q.authors.length) meta.push(`Автор(ы): ${names(q.authors)}`);
  if (q.editors.length) meta.push(`Редактор(ы): ${names(q.editors)}`);
  if (q.pack?.title) meta.push(`Пак: ${q.pack.title}`);
  if (q.complexity.length) meta.push(`Сложность: ${q.complexity.join(", ")}`);
  if (q.tournamentTypes.length) meta.push(`Тип: ${q.tournamentTypes.join(", ")}`);
  if (meta.length) lines.push("", meta.join(" · "));
  lines.push(q.url);
  return lines.join("\n");
}

/** One-line summary for search-result lists. */
export function formatQuestionLine(q: Question): string {
  const snippet = q.question.replace(/\s+/g, " ").slice(0, 100);
  const pack = q.pack?.title ? ` — _${q.pack.title}_` : "";
  return `• [${q.id}] ${snippet}${snippet.length >= 100 ? "…" : ""}${pack}`;
}
