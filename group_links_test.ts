import { assert, assertFalse } from "./deps/std/assert.ts";
import { isGithubReadmeWithAnchorUrl } from "./group_links.ts";

Deno.test("isGithubReadmeWithAnchorUrl", async (t) => {
    const goodLinks = [
        "https://github.com/grammyjs/grammY#anchor",
        "https://github.com/grammyjs/grammY/tree/main#anchor",
        "https://github.com/grammyjs/grammY#readme", // it is ignored internally.
        "https://github.com/grammyjs/grammY/tree/main/src#anchor",
    ];
    for (const link of goodLinks) {
        await t.step(link + " (true)", () => {
            assert(isGithubReadmeWithAnchorUrl(new URL(link)));
        });
    }
    const badLinks = [
        "https://github.com/grammyjs/grammY",
        "https://github.com/grammyjs/grammY/blob/main/file.md#anchor",
        "https://github.com/grammyjs/grammY/tree#anchor",
    ];
    for (const link of badLinks) {
        await t.step(link + " (false)", () => {
            assertFalse(isGithubReadmeWithAnchorUrl(new URL(link)));
        });
    }
});
