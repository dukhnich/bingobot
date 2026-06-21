/**
 * client.ts — typed accessors over flight.ts for the data we expose via MCP.
 *
 * This is the "MCP Server -> gotquestions.online" call layer: each function fetches a
 * public route (anonymously) and returns the raw question object(s). Normalization into
 * a clean, display-friendly shape happens in types.ts; here we just fetch + collect.
 */

import { fetchFlight, parseQuestions, type RawQuestion } from "./flight.js";

/** Default search page size; the site accepts up to 40 via `limit`. */
export const PAGE_SIZE = 20;
export const MAX_LIMIT = 40;

/**
 * Search filters (verified against live data). All optional; omitted params fall back to
 * the site's defaults (search text+answer+comment, complexity 0..100, etc.).
 *
 * `editor`/`author` accept EITHER a name (fuzzy substring match) OR a numeric person id
 * (exact — e.g. author=267 returns only Максим Мерзляков, whereas "Мерзляков" also catches
 * Роман Мерзляков). They work even with an empty query, which powers author/editor
 * profiling.
 */
export interface SearchOptions {
  page?: number;
  /** Page size, capped at MAX_LIMIT (40). */
  limit?: number;
  editor?: string | number;
  author?: string | number;
  /** Complexity range 0..100 (maps to fromD/toD; sets uD=false so the range applies). */
  minComplexity?: number;
  maxComplexity?: number;
  /** Date-played range, "YYYY-MM-DD" (maps to startPlayed/endPlayed). */
  playedFrom?: string;
  playedTo?: string;
  /** Which fields the text query matches. If ANY is set, all four are sent explicitly. */
  inText?: boolean;
  inAnswer?: boolean;
  inComment?: boolean;
  inSource?: boolean;
}

export interface SearchResult {
  query: string;
  page: number;
  limit: number;
  /** Total matches across all pages (Elasticsearch `count`), or null if not found. */
  total: number | null;
  questions: RawQuestion[];
  hasMore: boolean;
}

export interface Pack {
  id: number | null;
  title: string | null;
  questions: RawQuestion[];
}

/** One question by id (from /question/{id}). Throws if nothing parses. */
export async function getQuestion(id: number): Promise<RawQuestion> {
  const questions = parseQuestions(await fetchFlight(`/question/${id}`));
  const q = questions.find((x) => x.id === id) ?? questions[0];
  if (!q) throw new Error(`No question found for id ${id}`);
  return q;
}

/** Build the /search query string from a query + options (only sets what's provided). */
function buildSearchParams(query: string, opts: SearchOptions): URLSearchParams {
  const limit = Math.min(opts.limit ?? PAGE_SIZE, MAX_LIMIT);
  const qp = new URLSearchParams({
    search: query,
    page: String(opts.page ?? 1),
    limit: String(limit),
  });
  if (opts.editor !== undefined) qp.set("editor", String(opts.editor));
  if (opts.author !== undefined) qp.set("author", String(opts.author));
  if (opts.minComplexity !== undefined || opts.maxComplexity !== undefined) {
    qp.set("fromD", String(opts.minComplexity ?? 0));
    qp.set("toD", String(opts.maxComplexity ?? 100));
    qp.set("uD", "false"); // exclude questions with no complexity so the range is meaningful
  }
  if (opts.playedFrom) qp.set("startPlayed", opts.playedFrom);
  if (opts.playedTo) qp.set("endPlayed", opts.playedTo);
  const fieldSet =
    opts.inText !== undefined ||
    opts.inAnswer !== undefined ||
    opts.inComment !== undefined ||
    opts.inSource !== undefined;
  if (fieldSet) {
    qp.set("textSearch", String(opts.inText ?? true));
    qp.set("ansSearch", String(opts.inAnswer ?? true));
    qp.set("commSearch", String(opts.inComment ?? true));
    qp.set("sourceSearch", String(opts.inSource ?? true));
  }
  return qp;
}

/**
 * Full-text question search (from /search).
 *
 * The query param is `search` (NOT `text` — `text` returns unfiltered results capped at
 * 10000). Cyrillic is URL-encoded via URLSearchParams, which also avoids the 400 the edge
 * returns for raw non-ASCII query strings. The real total sits in the results wrapper as
 * `"count":<n>,"highlights"`.
 */
export async function search(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult> {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? PAGE_SIZE, MAX_LIMIT);
  const payload = await fetchFlight(
    `/search?${buildSearchParams(query, opts).toString()}`,
  );
  const questions = parseQuestions(payload);
  const m = /"count":(\d+),"highlights"/.exec(payload);
  const total = m ? Number(m[1]) : null;
  const hasMore = total !== null ? page * limit < total : questions.length >= limit;
  return { query, page, limit, total, questions, hasMore };
}

/** A whole pack / tournament with all its questions (from /pack/{id}). */
export async function getPack(id: number): Promise<Pack> {
  const questions = parseQuestions(await fetchFlight(`/pack/${id}`));
  const first = questions[0];
  return {
    id: typeof first?.packId === "number" ? (first.packId as number) : id,
    title: typeof first?.packTitle === "string" ? (first.packTitle as string) : null,
    questions,
  };
}
