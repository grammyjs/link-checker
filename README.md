# Link Checker

A tool for going through grammY documentation source and other repositories' JSDocs, and reporting broken links and missing
anchors.

#### Checking Documentation

To check for broken links in [grammY's documentation source](https://github.com/grammyjs/website), clone the website repository and
go to the `site/docs/` directory and run the following:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/website_cli.ts [root directory='.']
```

Supports few arguments:

- `--clean-url`: Defaults to `false`. Vitepress's clean URL config option makes sure that the references to other local files
  doesn't end with an extension. Specify this option if the configuration used in the website repository has this option enabled.
- `--index-file`: Defaults to `README.md`. Index file of a directory.
- `--allow-ext-html`: Defaults to `false`. Not needed if `--clean-url` is specified. Allows `.html` extension to be used to
  reference other local files.

#### Checking JSDocs

Only the website repository has a special structure. All the other repositories that under grammY organization has JSDocs in their
code and some contains external links. Currently only the documentation of the exported members are checked. So, for checking
broken links in those files:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/ts_doc_cli.ts --module <MODULE>
```

Arguments:

- `--module`: Relative path or absolute local or remote URL to the module entry point to check. For example,
  https://deno.land/x/grammy/mod.ts.
