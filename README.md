# Link Checker

A tool for going through
[grammY documentation source](https://github.com/grammyjs/website) and reporting
broken links.

---

To use the tool locally, clone the
[grammY website repository](https://github.com/grammyjs/website) and go to the
`site/docs/` directory and run the following:

```sh
> deno run --allow-read --allow-net \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/main.ts
```
