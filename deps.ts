export { default as MarkdownIt } from "https://esm.sh/markdown-it@13.0.1";
export { HTMLDocument } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
export * as colors from "https://deno.land/std@0.193.0/fmt/colors.ts";
export { parse } from "https://deno.land/std@0.193.0/flags/mod.ts";

import { tty } from "https://deno.land/x/cliffy@v1.0.0-rc.2/ansi/tty.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

export function overwrite(...message: unknown[]) {
  if (Deno.isatty(Deno.stdout.rid)) {
    tty.eraseLine();
    console.log(...message);
    tty.cursorUp();
  } else {
    console.log(...message);
  }
}

export const domParser = new DOMParser();
