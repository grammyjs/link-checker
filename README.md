# Link Checker

A tool for going through grammY documentation source and other repositories’ JSDocs, and reporting broken links.

### Issues covered

Link checker currently covers the following types of issues:

- Redirections
- Empty responses
- Empty DOM contents
- Empty anchors
- Missing anchors
- Non-OK responses
- Wrong file extensions on internal links
- Disallowed extensions
- Unknown link types
- Missing files
- Better alternative available

and warns you about the issues it cannot handle at all:

- Inaccessible websites:
    - Cloudflare protected websites

## Checking Documentation

To check for broken links in the [grammY documentation](https://github.com/grammyjs/website), clone the website repository and go
to the `site/docs/` directory and run the following:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/website_cli.ts [ROOT DIRECTORY]
```

> Assumes the current directory as the ROOT DIRECTORY if not specified.

Supported arguments:

- `--clean-url`: Defaults to `false`. VitePress’ clean URL config option makes sure that the references to other local files
  doesn’t end with an extension. Specify this option if the configuration used in the website repository has this option enabled.
- `--index-file`: Defaults to `README.md`. Index file of a directory.
- `--allow-ext-html`: Defaults to `false`. Not needed if `--clean-url` is specified. Allows `.html` extension to be used to
  reference other local files.
- `--fix`: Refer to ["Automatically fixing issues"](#automatically-fixing-issues).

### Automatically fixing issues

Issues of the following types can be fixed automatically by using the `--fix` argument:

* Redirections: Replaces the link with the final redirected-to link.
* Missing anchors: Replaces the missing anchor, with the closest match found among all the anchors.
* Empty anchors: Gets rid of teh empty anchors.
* Wrong extensions: In non-clean-url mode, changes .html to .md in relative links.
* Disallowed extensions: In clear-url mode, gets rid of extensions from relative links.

**WARNING**: The fix implementation isn't flawless, so carefully review the changes before committing.

If the results auto-fix produces are wrong, please open an issue with enough details.

### GitHub files

TLDR; Set the environment variable `GITHUB_TOKEN` if documents contains a lot of links to GitHub markup (README, for example)
files. A fine-grained token with the default set of permissions will do.

When you run the CLIs as mentioned you should get a gentle reminder about an environment variable: `GITHUB_TOKEN`. Here’s why:
There might be links like `https://github.com/OWNER/REPO/tree/dir#anchor` or `https://github.com/OWNER/REPO/blob/file.rst#anchor`
in the documentation. These types of links are assumed to be pointing to a GitHub repository’s directory README or a
[supported markup](https://github.com/github/markup/blob/master/README.md#markups) file, because there is an anchor. When normally
fetched, their responses does not contain the actual content of that file, because the content is lazily loaded. So for checking
if the anchor is present, we fetch the content using the GitHub Content REST API. And that is why we need a GitHub access token.
If you only have a few such links, then you most likely don’t need the token.

### Launching in debug mode

Debug mode doesn't do much for now, but will be integrated to being more useful in the future, I hope.

As of now, launching in debug mode using `DEBUG` environment variable will cache issues to a file named `.link-checker` in the root directory.
This eliminates the need of having to regenerate issues everytime by going through each link. Also, the file is only generated on debugging mode.
Caching issues helps in the development of `--fix`. (See: ["Automatically fixing issues"](#automatically-fixing-issues))

## Checking JSDocs

NOTE: Haven't tested or maintained in a while; expecting bugs.

Only the website repository has a special structure. All the other repositories that under grammY organization has JSDocs in their
code and some contains external links. Only JSDocs of the exported members are checked. So, for checking broken links in those
files:

```sh
$ deno run --allow-env --allow-net --allow-read \
  https://raw.githubusercontent.com/grammyjs/link-checker/main/tsdoc_cli.ts --module <MODULE>
```

Supported arguments:

- `--module`: Relative path or absolute local or remote URL to the module entry point to check. For example,
  https://deno.land/x/grammy/mod.ts.

## Github workflow

This repository also contains a Github workflow for checking for issues and reporting them in the website's Github repository issue section.

TODO: Explain how to configure the workflow.

