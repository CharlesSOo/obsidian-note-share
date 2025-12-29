import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const prod = process.argv[2] === "production";

// Path to Obsidian plugins folder
const obsidianPluginPath = join(
  homedir(),
  "Documents/obsidain_main/.obsidian/plugins/obsidian-note-share/main.js"
);

esbuild
  .build({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: [
      "obsidian",
      "electron",
      "@codemirror/autocomplete",
      "@codemirror/collab",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/search",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      ...builtins,
    ],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: prod ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
    minify: prod,
  })
  .then(() => {
    // Auto-deploy to Obsidian plugins folder
    try {
      copyFileSync("main.js", obsidianPluginPath);
      console.log(`Deployed to ${obsidianPluginPath}`);
    } catch (e) {
      console.log("Could not auto-deploy (Obsidian folder not found)");
    }
  })
  .catch(() => process.exit(1));
