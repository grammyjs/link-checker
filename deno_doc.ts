import { doc } from "https://deno.land/x/deno_doc@0.62.0/mod.ts"

console.log(await getDenoDocSymbols("https://deno.land/x/grammy/mod.ts"))

export async function getDenoDocSymbols(module: string) {
  const docNodes = await doc(module);
  const symbols = new Set<string>();
  for (const node of docNodes) {
    if (node.kind === "import" || node.kind === "moduleDoc") continue;
    symbols.add(node.name);

  }
}
