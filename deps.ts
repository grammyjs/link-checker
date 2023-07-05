export { extname, join } from "https://deno.land/std@0.192.0/path/mod.ts";
export { default as MarkdownIt } from "https://esm.sh/markdown-it@13.0.1";
export { default as anchorPlugin } from "https://esm.sh/markdown-it-anchor@8.6.7";
export { slugify } from "https://esm.sh/@mdit-vue/shared@0.12.0";
export { DOMParser, HTMLDocument } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
export * as colors from "https://deno.land/std@0.192.0/fmt/colors.ts";
export { parse } from "https://deno.land/std@0.192.0/flags/mod.ts";

import { tty } from "https://deno.land/x/cliffy@v1.0.0-rc.1/ansi/tty.ts";

// deno-lint-ignore no-explicit-any
export function overwrite(...message: any[]) {
  if (Deno.isatty(Deno.stdout.rid)) {
    tty.eraseLine();
    console.log(...message);
    tty.cursorUp();
  } else {
    console.log(...message);
  }
}
