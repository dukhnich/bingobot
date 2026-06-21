/**
 * flight.ts — talk to gotquestions.online and decode its Next.js RSC "flight" payloads.
 *
 * The site server-renders question data into the page (no auth needed). Requesting a
 * route with the `RSC: 1` header returns the raw flight stream (text/x-component)
 * instead of HTML. Question objects look like:
 *
 *     {"id":442892,"number":0,"text":"$17","answer":"…","comment":"…", …}
 *
 * where long/duplicated strings (e.g. `text`) are hoisted into separate flight rows and
 * referenced as "$<hex>" (here `text` -> row `17`, stored as `17:T873,<2163 chars>`). We:
 *   1. build a map of those hoisted strings (T-chunks + plain string rows),
 *   2. extract every question object by brace-matching,
 *   3. resolve the "$<hex>" references.
 *
 * All scraping fragility lives in THIS file — if gotquestions.online changes its markup,
 * this is the only place to fix.
 */

const BASE = "https://gotquestions.online";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** A raw question object as embedded in the flight payload (post ref-resolution). */
export type RawQuestion = Record<string, unknown>;

/** Fetch a route as an RSC flight payload. `path` must start with "/". */
export async function fetchFlight(path: string): Promise<string> {
  const res = await fetch(BASE + path, {
    headers: { RSC: "1", "User-Agent": UA },
  });
  if (!res.ok) {
    throw new Error(`gotquestions.online ${path} -> HTTP ${res.status}`);
  }
  return await res.text();
}

/**
 * Map of flight row id -> hoisted string value (used to resolve "$<hex>" references).
 *
 * The flight stream is a sequence of rows `<hexId>:<tag><payload>`. Most rows end at a
 * newline, but a text row `T<hexLen>,<content>` declares an exact length and the NEXT
 * row follows immediately with no separating newline. So we can't split on "\n" — we
 * scan sequentially, consuming each `T` row's content by its declared length.
 *
 * Crucially, `hexLen` is a count of UTF-8 BYTES, not JS (UTF-16) characters — with
 * Cyrillic text (2 bytes/char) the two differ, so we advance byte-accurately.
 */
function utf8Len(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Char index reached by consuming `byteLen` UTF-8 bytes starting at char index `start`. */
function advanceBytes(s: string, start: number, byteLen: number): number {
  let bytes = 0;
  let i = start;
  while (i < s.length && bytes < byteLen) {
    const cp = s.codePointAt(i)!;
    bytes += utf8Len(cp);
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

function buildRefMap(s: string): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\n") {
      i++;
      continue;
    }
    const colon = s.indexOf(":", i);
    if (colon < 0) break;
    const id = s.slice(i, colon);
    if (!/^[0-9a-f]+$/.test(id)) {
      // Mis-stepped into content; resync to the next line.
      const nl = s.indexOf("\n", i);
      if (nl < 0) break;
      i = nl + 1;
      continue;
    }
    if (s[colon + 1] === "T") {
      // Text chunk: T<hexLen>,<content of exactly hexLen UTF-8 bytes>
      const comma = s.indexOf(",", colon + 2);
      const byteLen = parseInt(s.slice(colon + 2, comma), 16);
      const start = comma + 1;
      const end = advanceBytes(s, start, byteLen);
      map.set(id, s.slice(start, end));
      i = end;
    } else {
      // Other row: runs to the next newline. Keep plain string rows ("...").
      const nl = s.indexOf("\n", colon + 1);
      const end = nl < 0 ? s.length : nl;
      const raw = s.slice(colon + 1, end);
      if (raw[0] === '"') {
        try {
          map.set(id, JSON.parse(raw) as string);
        } catch {
          /* ignore malformed row */
        }
      }
      i = end + 1;
    }
  }
  return map;
}

/** Recursively replace "$<hex>" string references with their hoisted values. */
function resolveRefs(value: unknown, refMap: Map<string, string>): unknown {
  if (typeof value === "string") {
    const m = /^\$([0-9a-f]+)$/.exec(value);
    return m && refMap.has(m[1]) ? refMap.get(m[1]) : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, refMap));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveRefs(v, refMap);
    return out;
  }
  return value;
}

/**
 * Forward brace-match a JSON object starting at `start` (which must point at "{"),
 * respecting string literals and escapes. Returns the object's source slice, or null
 * if it is unterminated.
 */
function sliceObject(s: string, start: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (--depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Every question object embedded in a flight payload, de-duplicated by id and with
 * "$<hex>" references resolved. Works for /question/{id} (1), /search (a page) and
 * /pack/{id} (a whole tournament) — they all share the same object shape.
 */
export function parseQuestions(payload: string): RawQuestion[] {
  const refMap = buildRefMap(payload);
  const startRe = /\{"id":\d+,"number":\d+,"text":/g;
  const out: RawQuestion[] = [];
  const seen = new Set<number>();
  for (let m: RegExpExecArray | null; (m = startRe.exec(payload)); ) {
    const src = sliceObject(payload, m.index);
    if (!src) continue;
    // Advance past this object so nested objects aren't re-scanned as new starts.
    startRe.lastIndex = m.index + src.length;
    let obj: RawQuestion;
    try {
      obj = JSON.parse(src) as RawQuestion;
    } catch {
      continue;
    }
    obj = resolveRefs(obj, refMap) as RawQuestion;
    const id = obj.id;
    if (typeof id === "number" && !seen.has(id)) {
      seen.add(id);
      out.push(obj);
    }
  }
  return out;
}
