// Icons und Codex-Dateien liegen neben den .ts-Quellen; tsc kopiert sie nicht
// mit, n8n erwartet sie aber neben der kompilierten .js im dist-Ordner.
import { cp, readdir, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ASSETS = /\.(svg|png|json)$/;

async function walk(dir) {
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) await walk(rel);
    else if (ASSETS.test(e.name)) {
      const target = join(ROOT, "dist", rel);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(ROOT, rel), target);
      console.log("  kopiert:", rel);
    }
  }
}
await walk("nodes");
