# Link Checker

grammY's documentation contains a lot of links, like any other documentation.
This is a tool for checking and reporting broken links in grammY docs.
It can also suggest fixes and fix some of the broken ones by itself.
link-checker is designed specifically for grammY's documentation, taking care of special cases found in the documentation.
This tool can also check through JSDocs of other repositories containing code.

### Issues Covered

Link checker currently covers the following types of issues:

- Empty responses
- Non-OK responses
- Empty DOM contents
- Empty anchors
- Missing anchors
- Wrong file extensions on internal links
- Disallowed extensions
- Missing files
- Unknown types of links
- Redirections
- Better alternative available:
  - Inline API reference is available, but deno.land/x documentation is linked.

and warns you about the issues it cannot handle at all:

- Inaccessible websites:
  - Cloudflare protected websites

### Checking Documentation

To check for broken links in the [grammY documentation](https://github.com/grammyjs/website), clone the website repository and go
to the `site/docs/` directory and run the following:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/website_cli.ts [ROOT DIRECTORY]
```

> Assumes the current directory as the ROOT DIRECTORY if not specified.
> ROOT DIRECTORY is supposed to be `site/docs`.

Supported arguments:

- `--clean-url`

  Defaults to `false`.
  VitePress’ clean URL config option makes sure that the references to other local files doesn’t end with an extension.
  Specify this option if the configuration used in the website repository has this option enabled.
- `--index-file`

  Defaults to `README.md`.
  Index file of a directory.
- `--allow-ext-html`

  Defaults to `false`.
  Not needed if `--clean-url` is specified.
  Allows `.html` extension to be used to reference other local files.
- `--fix`

  Fix some of the broken links using this flag.
  Refer to ["Automatically fixing issues"](#automatically-fixing-issues).
- `--include-ref`

  Check files inside the /ref directory for issues.
  The /ref directory contains the generated API references of core and plugins.
  The sources of these documentation comes from other repositories, so they're not checked here by default.
  But in case, if you wanted to check these right in the website for some reason, toggle this flag.
- `--ignore-warnings`

  Ignore warning types while printing the issues.

### Automatically Fixing Issues

> [!CAUTION]
> The fix implementation isn't flawless and probably is buggy, so carefully review the changes before committing.
> Report any problems that you encounter by opening an issue in this repository.

Issues of the following types can be fixed automatically by using the `--fix` argument:

- Redirections: Replaces the link with the final redirected-to link.
- Missing anchors: Replaces the missing anchor, with the closest match found among all the anchors.
- Empty anchors: Gets rid of the empty anchors.
- Wrong extensions: In non-clean-url mode, changes .html to .md in relative links.
- Disallowed extensions: In clear-url mode, gets rid of extensions from relative links.

If the results auto-fix produces are wrong, please open an issue with enough details.

### GitHub Files

> [!IMPORTANT]
> **TLDR;** Set the environment variable `GITHUB_TOKEN` if the documents contains a lot of links to GitHub markup (README, for example) files.
> A fine-grained token with the default set of permissions will do.

When you run the CLIs as mentioned you should get a gentle reminder about an environment variable: `GITHUB_TOKEN`.
Here’s why: there might be links like,

- `https://github.com/OWNER/REPO/tree/dir#anchor`
- `https://github.com/OWNER/REPO/blob/file.rst#anchor`

in the documentation.

These types of links are assumed to be pointing to a GitHub repository’s directory README or a [supported markup](https://github.com/github/markup/blob/master/README.md#markups) file, because there is an anchor.
When normally fetched, their responses does not contain the actual content of that file, because the content is lazily loaded.
So for checking if the anchor is present, we fetch the content using the GitHub Content REST API.
And that is why we need a GitHub access token. If you only have a few such links, then you most likely don’t need the token.

For each repositories, `ceil(branches / 100)` number of API calls and for each file, an additional API call for the content, is made.

GitHub API root URL can also be changed if you prefer, by setting the `GITHUB_API_ROOT` environment variable.

### Launching in Debug Mode

> [!NOTE]
> Debug mode doesn't do much for now, but will be integrated to being more useful in the future, I hope.

As of now, launching in debug mode using `DEBUG` environment variable will cache issues to a file named `.link-checker` in the root directory.
This eliminates the need of having to regenerate issues everytime by going through each link.
Remember that the file is ONLY generated on debugging mode.
Caching issues have helped a lot in the development of `--fix`.
Also, useful to check what kind of issues are present, before --fixing them.
(See: ["Automatically fixing issues"](#automatically-fixing-issues))

## Checking JSDocs

> [!NOTE]
> Haven't tested or maintained in a while; expecting bugs.

Only the website repository has a special structure.
All the other repositories that under grammY organization has JSDocs in their code and some contains external links.
Only JSDocs of the exported members are checked. So, for checking broken links in those files:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/tsdoc_cli.ts \
  --module <MODULE>
```

Supported arguments:

- `--module`

  Relative path or absolute local or remote URL to the module entry point to check. For example,
  https://deno.land/x/grammy/mod.ts.

## Github Workflow

This repository also contains a Github workflow for checking for issues and reporting them in the corresponding Github repositories.

TODO: Explain how to configure the workflow.
