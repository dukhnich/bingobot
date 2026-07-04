---
name: method-discovery
description: >
  Runbook for the method-discovery investigation: harvest pack ids from the question
  database, run parallel pack-scanner waves (pilot → calibration gate → wide wave),
  then cluster/validate/write up new приёмы for the methodology extension. Trigger on:
  "discovery wave", "scan packs", "method discovery", "поиск новых приёмов".
---

# Method discovery — orchestrator runbook

Goal: find question-writing devices NOT covered by the ~38 приёмы of the methodology
handbook, and write them up as `data/methodology-extension.md` («Часть 4»).
All intermediate state lives on disk under `data/investigation/` — every phase is
resumable from the filesystem alone; no state is kept in conversation context.

Artifacts:

```
data/investigation/packs.jsonl           # Phase A output: one line per distinct pack
data/investigation/scan-log.jsonl        # append-only progress + calibration records
data/investigation/cards/pack-<id>.jsonl # one file per scanned pack (scanner output)
data/investigation/clusters.md           # Phase D: proto-methods
data/investigation/validation.md         # Phase D: novelty verdicts
```

## Phase A — harvest pack ids

Run in the main session with `mcp__chgk__search_questions` directly.

1. Sweep half-year windows from 2015-01-01 to the current date:
   `search_questions(query="", limit=40, playedFrom=<start>, playedTo=<end>, page=P)`.
   Hits from one pack arrive adjacent, so for each window read SPREAD pages — 1, 4, 7,
   10 — not consecutive ones, to maximise distinct packs per call.
2. Stratified extra sweeps: repeat each window with trueDL bands
   `maxTrueDL=3`, `minTrueDL=3&maxTrueDL=6`, `minTrueDL=6` (pages 1 and 4 suffice).
   Record which band a pack was seen in.
3. From each brief hit parse: `Пак: [<id>] <title>`, `Сыграно: YYYY-MM-DD`,
   `Тип: <...>`, `Авторы: <...>`.
4. Dedupe by pack_id (across ALL windows and bands; keep first occurrence, merge bands).
   Append one line per NEW pack to `packs.jsonl`:

   {"pack_id":6213,"title":"Сова бьян","played":"2025-02-17","tournament_types":["Синхрон"],"trueDL_band":"3-6","window":"2025H1","authors_sample":["Павел Казначеев"],"mono_author":null}

   `mono_author`: true only if all sampled hits of the pack share one author (cheap
   proxy; the scanner sees the real author list later). `trueDL_band`: "0-3"|"3-6"|"6-10"|"?".
5. Target: ≥150 distinct packs spread over years 2015–2025, all three DL bands, both
   Синхрон and очный/фестивальный types, and some mono-author packs.

## Phase B — scan waves

1. Compute the unscanned set: packs in `packs.jsonl` with no
   `data/investigation/cards/pack-<id>.jsonl`. (Filesystem = source of truth →
   idempotent re-runs, safe resume.)
2. Select the next stratified batch (spread years/bands/types; don't take 4 packs from
   one series). Launch **pack-scanner** agents (see `.claude/agents/pack-scanner.md`),
   **max 4 in parallel** — courtesy to the live site. Each gets: pack id + absolute
   output path.
3. After each batch, validate every output file: exists, every line JSON-parses, line 1
   is pack_summary, counts sum to n_questions. Append to `scan-log.jsonl`:
   {"type":"scan","pack_id":6213,"status":"ok","wave":"pilot","ts":"2026-07-04T12:00:00"}
   Retry a failed pack once; persistent failures get status "failed" — log and move on,
   never block the wave.
4. **Pilot rule:** the first wave is exactly ~12 stratified packs, INCLUDING 2 packs
   scanned twice (duplicate output to `cards/pack-<id>-b.jsonl`, excluded from later
   phases) for agreement measurement. After the pilot: STOP. Run the calibration gate
   before any wide wave.

## Phase C — calibration gate (between pilot and wide wave)

Compute over all pilot pack_summary lines (jq/node one-liners):
- **Card rate** = (variant+unknown)/n_questions per pack. Healthy: 2–12%, mostly variant.
- If >15% unknown on average → the scanner invents novelty: tighten RUBRIC_DISCIPLINE
  (in `src/prompts.ts` AND `.claude/agents/pack-scanner.md` — same wording), re-pilot 3
  packs.
- If ~0 cards across all 12 packs → too strict: loosen («variant заслуживает карточки,
  если подтип узнаваем»), re-pilot 3 packs.
- **Agreement**: for the 2 double-scanned packs, ≥60% of flagged question ids should
  coincide between the two runs. Below that — the rubric is ambiguous; tighten wording.
Record the decision:
{"type":"calibration","card_rate":0.07,"unknown_rate":0.02,"agreement":0.7,"decision":"proceed","ts":"…"}

Wide wave: 60–100 packs in batches of 4 (Phase B loop), committing cards in chunks.

## Phase D — clustering, validation, write-up (main/strongest model)

1. **Clustering** (`clusters.md`): merge all cards (`jq -s`); pre-bucket by
   (closest_known, signals); inside buckets cluster by MECHANISM similarity — never by
   topic. Per proto-method: working name, one-paragraph mechanism, member question/pack
   ids, distinct-pack count, distinct author groups, earliest/latest played dates.
   **Novelty threshold:** keep only proto-methods with ≥5 independent examples across
   ≥3 packs AND ≥3 distinct author groups. Singletons → appendix «наблюдения».
2. **Validation** (`validation.md`), per surviving proto-method:
   - read the 2–3 nearest FULL handbook sections (`gotquestions://methodology/{slug}`);
     if honestly reducible to one — demote to «подтип X»;
   - targeted `search_questions` for more instances (mechanism-typical lexemes, replace
     markers, handout markers), including a `playedTo: 2016-01-01` probe: if the device
     was already common before the handbook era, label it «пропущенный приём», not
     «новый» (keep both, labelled);
   - seed hypotheses about suspected recent trends may be used HERE and only here —
     never in scan waves.
3. **Write-up** (`data/methodology-extension.md`): few-shot on 2–3 full existing
   sections as style exemplars (определение → как распознать → как брать → 2–4
   разобранных примера со ссылками). Format contract (parsed by resources.ts):
   - line 1: `# Часть 4. Новые приёмы (2015–2025)`
   - each method: `## Название приёма`, then `> однострочная аннотация для указателя`,
     then the full section text;
   - demoted subtypes go into a closing section «Развитие известных приёмов».
