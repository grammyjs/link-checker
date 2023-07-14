# Link Checker

A tool for going through grammY documentation source and other repositories' JSDocs, and reporting broken links and missing
anchors.

## Checking Documentation

To check for broken links in [grammY's documentation source](https://github.com/grammyjs/website), clone the website repository
and go to the `site/docs/` directory and run the following:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/website_cli.ts [ROOT DIRECTORY]
```

> Assumes the current directory as the ROOT DIRECTORY if none specified.

Supported arguments:

- `--clean-url`: Defaults to `false`. Vitepress's clean URL config option makes sure that the references to other local files
  doesn't end with an extension. Specify this option if the configuration used in the website repository has this option enabled.
- `--index-file`: Defaults to `README.md`. Index file of a directory.
- `--allow-ext-html`: Defaults to `false`. Not needed if `--clean-url` is specified. Allows `.html` extension to be used to
  reference other local files.

#### GitHub files

**TLDR;** Set the environment variable `GITHUB_TOKEN` if documents contains a lot of links to GitHub markup (README, for example)
files. A fine-grained token with the default set of permissions will do.

When you run the CLIs as mentioned you should get a gentle reminder about an environment variable: `GITHUB_TOKEN`. Here's why:
There might be links like https://github.com/OWNER/REPO/tree/dir#anchor or https://github.com/OWNER/REPO/blob/file.rst#anchor in
the documentation. These types of links are assumed to be pointing to a GitHub repository's directory README or a
[supported markup](https://github.com/github/markup/blob/master/README.md#markups) file, because there is an anchor. When normally
fetched, their responses does not contain the actual content of that file, because the content is lazily loaded. So for checking
if the anchor is present, we fetch the content using the GitHub Content REST API. And that is why we need a GitHub access token.
If you only have a few such links, then you most likely don't need the token.

## Checking JSDocs

Only the website repository has a special structure. All the other repositories that under grammY organization has JSDocs in their
code and some contains external links. Currently only the documentation of the exported members are checked. So, for checking
broken links in those files:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/ts_doc_cli.ts --module <MODULE>
```

Supported arguments:

- `--module`: Relative path or absolute local or remote URL to the module entry point to check. For example,
  https://deno.land/x/grammy/mod.ts.
