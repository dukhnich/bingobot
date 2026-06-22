# chgk-mcp

An MCP server exposing the **«Что? Где? Когда?»** quiz-question database from
[gotquestions.online](https://gotquestions.online) — search, fetch, and analyse ЧГК
questions from Claude Code (or any MCP client).

No API key, no login: the data is read **anonymously** from gotquestions.online's
server-rendered pages (Next.js RSC payloads), so nothing expires.

## Setup

```bash
npm install
npm run build
```

The server is registered for this project in [`.mcp.json`](./.mcp.json). Open the project
in **Claude Code** and run `/mcp` — approve the `chgk` server. Tools/prompts then appear
(e.g. `/chgk:analyze_topic`).

To poke at it directly with the MCP Inspector:

```bash
npm run inspector        # UI at http://localhost:6274 (proxy :6277)
npm run inspector:stop   # kill the Inspector by port (leaves Claude Code's server alone)
```

## What it exposes

**Tools** (model-invoked)
- `search_questions` — full-text search with filters: `editor`/`author` (name **or**
  numeric id), `minComplexity`/`maxComplexity` (0–100), `minTrueDL`/`maxTrueDL` (0–10
  difficulty), `playedFrom`/`playedTo`, `page`/`limit` (≤40).
- `get_question` — one question by id, with answer, comment, source, authors/editors, and
  editorial reader-instructions.

**Resources** (app/user-read)
- `gotquestions://question/{id}`, `gotquestions://pack/{id}` — a question / a whole pack.
- `gotquestions://methodology` — Юрий Вашкулат's question-writing handbook (bundled text),
  used as the rubric for craft/style analysis.

**Prompts** (slash commands)
- `analyze_topic` — relevance-filter homonyms, cluster questions by recurring motif/fact.
- `group_by_author` — group/compare by author (optional author list).
- `make_quiz` — themed mini-quiz (optional difficulty → trueDL).
- `profile_source` — profile an author/editor/pack against the methodology.

## Architecture

```
index.ts        MCP server: registers tools + resources + prompts over stdio
  tools.ts      search_questions, get_question
  resources.ts  question/{id}, pack/{id}, methodology
  prompts.ts    analyze_topic, group_by_author, make_quiz, profile_source
  client.ts     typed accessors (getQuestion / search / getPack)
  flight.ts     fetch gotquestions.online + decode Next.js RSC payloads  <- the tricky bit
  types.ts      Question model + normalize/format
data/methodology.txt   bundled handbook (extracted from PDF)
```

`flight.ts` is the only scraping-fragile file: if gotquestions.online changes its markup,
fix it there.

## Regenerating the methodology text

```bash
curl -sL 'https://test-edu.tatar.ru/upload/storage/org2233/files/Metodichka-Vashkulat%20(1).pdf' -o method.pdf
pdftotext -enc UTF-8 -nopgbrk method.pdf data/methodology.txt
```
