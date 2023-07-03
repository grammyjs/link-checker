# Link Checker

A tool for going through grammY documentation source and other repositories' JSDocs, and reporting broken links and missing
anchors.

##### Checking Documentation

To check for broken links in [grammY's documentaion source](https://github.com/grammyjs/website), clone the website repository and
go to the `site/docs/` directory and run the following:

```sh
$ deno run --allow-read --allow-net \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/website.ts
```

##### Checking TSDocs

Only the website repository has a special structure. All the other repositories that under grammY organization has TSDocs in their
code and some contains external links and inline links to lines of other files and symbols. So, for checking broken links in them:

```sh
$ deno run --allow-read --allow-net \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/ts_doc.ts
```
