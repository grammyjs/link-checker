import { tty } from "https://deno.land/x/cliffy@v1.0.0-rc.2/ansi/tty.ts";

export function overwriteLastLine(...message: unknown[]) {
  if (Deno.isatty(Deno.stdout.rid)) {
    tty.eraseLine();
    console.log(...message);
    tty.cursorUp();
  } else {
    console.log(...message);
  }
}
