import { red } from "./std/fmt.ts";

export function error(...data: unknown[]) {
    console.error(red("error") + ":", ...data);
}
