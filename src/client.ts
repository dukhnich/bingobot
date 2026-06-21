/**
 * client.ts — typed accessors over flight.ts for the data we expose via MCP.
 *
 * This is the "MCP Server -> gotquestions.online" call layer: each function fetches a
 * public route (anonymously) and returns the raw question object(s). Normalization into
 * a clean, display-friendly shape happens in types.ts; here we just fetch + collect.
 */

import { fetchFlight, parseQuestions, type RawQuestion } from "./flight.js";

/** gotquestions.online returns 20 search hits per page. */
export const PAGE_SIZE = 20;

export interface SearchResult {
  query: string;
  page: number;
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

/**
 * Full-text question search (from /search).
 *
 * The query param is `search` (NOT `text` — `text` returns unfiltered results capped at
 * 10000). Cyrillic is URL-encoded via URLSearchParams, which also avoids the 400 the edge
 * returns for raw non-ASCII query strings. The real total sits in the results wrapper as
 * `"count":<n>,"highlights"`.
 */
export async function search(query: string, page = 1): Promise<SearchResult> {
  const qp = new URLSearchParams({ search: query, page: String(page) });
  const payload = await fetchFlight(`/search?${qp.toString()}`);
  const questions = parseQuestions(payload);
  const m = /"count":(\d+),"highlights"/.exec(payload);
  const total = m ? Number(m[1]) : null;
  const hasMore =
    total !== null ? page * PAGE_SIZE < total : questions.length >= PAGE_SIZE;
  return { query, page, total, questions, hasMore };
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
