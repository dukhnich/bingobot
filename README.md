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
- `gotquestions://methodology` — index (TOC + 1-line gloss per приём) of Юрий Вашкулат's
  question-writing handbook; `gotquestions://methodology/{slug}` — one section in full.
  The handbook (~110k tokens) is parsed into sections so the rubric can be read selectively.

**Prompts** (slash commands)
- `analyze_topic` — relevance-filter homonyms, cluster questions by recurring motif/fact.
- `group_by_author` — group/compare by author (optional author list).
- `make_quiz` — themed mini-quiz (optional difficulty → trueDL).
- `profile_source` — profile an author/editor/pack against the methodology.
- `discover_methods` — residue analysis of one pack against the handbook's приёмы:
  classify every question's solving mechanism (known/variant/unknown), emit candidate
  cards for what doesn't fit.

## «Часть 4»: discovered methods

The handbook is ~10 years old, so the repo ran a **method-discovery pipeline** over the
database (95 packs / 4644 questions, 2015–2026): parallel `pack-scanner` subagents
(`.claude/agents/pack-scanner.md`) classified every question against the handbook rubric,
the residue was clustered/validated, and the surviving new приёмы were written up in
[`data/methodology-extension.md`](./data/methodology-extension.md) — served as
«Часть 4. Новые приёмы» in the same `gotquestions://methodology` index (5 new sections +
observations). The runbook lives in `.claude/skills/method-discovery/SKILL.md`;
intermediate artifacts (pack harvest, per-pack card JSONL, clustering, validation) are in
`data/investigation/`.

A read-only CLI mirrors the resources for subagent use:

```bash
node build/cli.js index            # methodology index (TOC + glosses, incl. Часть 4)
node build/cli.js section <slug>   # one full section
node build/cli.js pack <id>        # whole pack as markdown
node build/cli.js question <id>    # one question
```

## Architecture

```
index.ts        MCP server: registers tools + resources + prompts over stdio
  tools.ts      search_questions, get_question
  resources.ts  question/{id}, pack/{id}, methodology[/{slug}] (handbook split into sections)
  prompts.ts    analyze_topic, group_by_author, make_quiz, profile_source, discover_methods
  client.ts     typed accessors (getQuestion / search / getPack)
  flight.ts     fetch gotquestions.online + decode Next.js RSC payloads  <- the tricky bit
  types.ts      Question model + normalize/format
  cli.ts        read-only CLI over the same data (for subagents)
data/methodology.txt            bundled handbook (extracted from PDF)
data/methodology-extension.md   «Часть 4» — methods discovered by the pipeline
data/investigation/             pipeline artifacts (harvest, cards, clusters, validation)
```

`flight.ts` is the only scraping-fragile file: if gotquestions.online changes its markup,
fix it there.

## Regenerating the methodology text

```bash
curl -sL 'https://test-edu.tatar.ru/upload/storage/org2233/files/Metodichka-Vashkulat%20(1).pdf' -o method.pdf
pdftotext -enc UTF-8 -nopgbrk method.pdf data/methodology.txt
```
