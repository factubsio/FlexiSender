import { resolve } from "path";
import { readFileSync, writeFileSync } from "fs";

const rootDir = import.meta.dir;
const srcDir = resolve(rootDir, "src");

const result = await Bun.build({
  entrypoints: [`${srcDir}/main.ts`],
  format: "esm",
  minify: true,
});

if (!result.success) {
  console.error("Build failed:");
  result.logs.forEach(l => console.error(l.message));
  process.exit(1);
}

const js = await result.outputs[0].text();
const html = readFileSync(resolve(rootDir, "index.html"), "utf-8");

// Replace the dev script tag with the inlined bundle
const out = html
  .replace(/<script src="\/app\.js" type="module"><\/script>/, `<script type="module">${js}</script>`)
  .replace(/<!-- DEV-RELOAD -->[\s\S]*?<!-- \/DEV-RELOAD -->/, '');

writeFileSync(resolve(rootDir, "dist", "flexisender.html"), out);
console.log("Built → dist/flexisender.html");
