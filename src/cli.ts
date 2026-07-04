/**
 * cli.ts — tiny read-only CLI over the same data the MCP server serves.
 *
 * Exists for the method-discovery pipeline: pack-scanner subagents run in contexts
 * where MCP resource tools may be unavailable, so they read the methodology and packs
 * with plain `node build/cli.js …` instead. Output is byte-identical to the MCP
 * resources.
 *
 *   node build/cli.js index            # methodology index (TOC + glosses)
 *   node build/cli.js section <slug>   # one full handbook section
 *   node build/cli.js pack <id>        # whole pack as markdown
 *   node build/cli.js question <id>    # one question as markdown
 */

import { methodologyIndex, methodologySections } from "./resources.js";
import * as gq from "./client.js";
import { normalizeQuestion, formatQuestion } from "./types.js";

const USAGE = "usage: node build/cli.js index | section <slug> | pack <id> | question <id>";

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  switch (cmd) {
    case "index":
      console.log(methodologyIndex());
      return;
    case "section": {
      const { bySlug } = methodologySections();
      const sec = arg ? bySlug.get(arg) : undefined;
      if (!sec) {
        console.error(`Раздел «${arg ?? ""}» не найден. Доступные slug:`);
        for (const s of bySlug.keys()) console.error(`- ${s}`);
        process.exit(1);
      }
      console.log(sec.text);
      return;
    }
    case "pack": {
      const pack = await gq.getPack(Number(arg));
      const header = `# ${pack.title ?? "Пакет"} (id ${pack.id})\n\nВопросов: ${pack.questions.length}`;
      const body = pack.questions
        .map((raw) => formatQuestion(normalizeQuestion(raw)))
        .join("\n\n---\n\n");
      console.log(`${header}\n\n${body}`);
      return;
    }
    case "question":
      console.log(formatQuestion(normalizeQuestion(await gq.getQuestion(Number(arg)))));
      return;
    default:
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
