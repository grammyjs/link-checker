import { DOMParser } from "./deps/deno_dom.ts";
import { anchorPlugin } from "./deps/markdown-it/anchor.ts";
import { MarkdownIt } from "./deps/markdown-it/mod.ts";
import { slugifyPlugin } from "./deps/markdown-it/slugify.ts";
import { basename, dirname, extname, join, relative, resolve } from "./deps/std/path.ts";
import { blue, dim, magenta } from "./deps/std/fmt.ts";

import { checkExternalUrl, isValidAnchor, transformURL } from "./fetch.ts";
import { Issue, MissingAnchorIssue } from "./types.ts";
import { getAnchors, parseLink, parseMarkdownContent } from "./utilities.ts";
import { findGroupedLinksIssues, GroupedLinksResolved, groupLinks, resolveGroupedLinks } from "./group_links.ts";
import { IGNORED_DIRECTORIES } from "./constants.ts";

const domParser = new DOMParser();

// markdown-it configured to generate similar results to the content
// generated by Vitepress' underlying markdown-it instance.
const mdit = MarkdownIt({
    html: true,
    linkify: true,
}).use(anchorPlugin, { slugify: slugifyPlugin });
mdit.linkify.set({ fuzzyLink: false });

export async function readMarkdownFiles(
    rootDirectory: string,
    options: {
        isCleanUrl: boolean;
        indexFile: string;
        allowHtmlExtension: boolean;
        includeRefDirectory: boolean;
    },
) {
    const issues: Record<string, Issue[]> = {};
    const allAnchors: Record<string, Set<string>> = {};
    const usedAnchors: Record<string, Record<string, Set<[anchor: string, reference: string]>>> = {};

    // Checker tries to avoid fetching the same link again. When ignoring the
    // fetching after the first time, those files with the reference won't
    // contain the issues of the link, if there's any. So, we store and push
    // those issues to the issues of the file before completely ignoring it.
    const externalLinkIssues: Record<string, Issue[]> = {};
    const resolvedGroupedLinks: GroupedLinksResolved = {
        githubRenderableFiles: {},
    };

    function isDirectoryIgnored(directory: string): boolean {
        // if (directory == "ref" && options.includeRefDirectory) return false;
        return IGNORED_DIRECTORIES.includes(directory);
    }

    async function readDirectoryFiles(directory: string) {
        for await (const entry of Deno.readDir(directory)) {
            if (!entry.isFile && !entry.isDirectory) continue;

            const filepath = join(directory, entry.name);

            if (entry.isDirectory) {
                if (isDirectoryIgnored(entry.name)) continue;
                await readDirectoryFiles(filepath);
                continue;
            }

            if (extname(entry.name) !== ".md") continue;
            console.log(dim(`${magenta("reading")} ${filepath}`));

            const parsed = await parseMarkdownFile(filepath);

            if (parsed.issues.length > 0) {
                issues[filepath] ??= [];
                issues[filepath].push(...parsed.issues);
            }

            // --- Anchors ---
            allAnchors[filepath] = parsed.anchors.all;

            if (parsed.anchors.used.size > 0) {
                usedAnchors[filepath] ??= {};
                usedAnchors[filepath][filepath] ??= new Set();
            }

            for (const anchor of parsed.anchors.used) {
                usedAnchors[filepath][filepath].add([anchor, "#" + anchor]);
            }

            // if this file resides under the "ref" section and if /ref reporting is not enabled, then continue.
            if ((basename(directory) === "ref" || basename(dirname(directory)) === "ref") && !options.includeRefDirectory) {
                continue; // no need for checking the status of the links inside "ref" files.
            }

            // --- Relative Links (Local files) ---
            for (const localLink of parsed.links.local) {
                const linkedFile = await checkRelativeLink(localLink, {
                    root: rootDirectory,
                    current: directory,
                }, {
                    indexFile: options.indexFile,
                    isCleanUrl: options.isCleanUrl,
                    allowHtmlExtension: options.allowHtmlExtension,
                });

                if (linkedFile.issues.length > 0) {
                    issues[filepath] ??= [];
                    issues[filepath].push(...linkedFile.issues);
                }

                if (linkedFile.anchor != null) {
                    if (linkedFile.anchor === "") {
                        issues[filepath] ??= [];
                        issues[filepath].push({ type: "empty_anchor", reference: localLink });
                        continue;
                    }
                    usedAnchors[linkedFile.path] ??= {};
                    usedAnchors[linkedFile.path][filepath] ??= new Set();
                    usedAnchors[linkedFile.path][filepath].add([linkedFile.anchor, localLink]);
                }
            }

            const groupedLinks = groupLinks(parsed.links.external);
            await resolveGroupedLinks(groupedLinks, resolvedGroupedLinks, { domParser });
            const groupedLinksIssues = findGroupedLinksIssues(groupedLinks, resolvedGroupedLinks);
            if (groupedLinksIssues.length > 0) {
                issues[filepath] ??= [];
                issues[filepath].push(...groupedLinksIssues);
            }

            // --- External Links ---
            for (const externalLink of groupedLinks.other) {
                const { root, anchor } = parseLink(externalLink);

                if (externalLinkIssues[root] != null && externalLinkIssues[root].length > 0) {
                    issues[filepath] ??= [];
                    issues[filepath].push(...externalLinkIssues[root]);
                }

                // Force to use new API references
                const url = new URL(root);
                if (url.host === "deno.land" && /\/x\/grammy[a-z0-9_]*@?\/.+/.test(url.pathname)) {
                    issues[filepath] ??= [];
                    issues[filepath].push({
                        type: "local_alt_available",
                        reference: externalLink,
                        reason: "Replace the remote API reference link with the native API reference.",
                    });
                }

                if (usedAnchors[root] != null) {
                    usedAnchors[root][filepath] ??= new Set();
                    if (anchor != null) {
                        usedAnchors[root][filepath].add([anchor, externalLink]);
                    }
                    continue;
                }

                usedAnchors[root] = {
                    [filepath]: new Set(anchor != null ? [[anchor, externalLink]] : []),
                };

                console.log(blue("fetch"), decodeURIComponent(transformURL(root)));
                const checkedExternalLink = await checkExternalUrl(root, { domParser });

                if (checkedExternalLink.issues.length > 0) {
                    externalLinkIssues[root] = checkedExternalLink.issues;
                    issues[filepath] ??= [];
                    issues[filepath].push(...checkedExternalLink.issues);
                }

                if (checkedExternalLink.anchors != null) {
                    allAnchors[root] = checkedExternalLink.anchors;
                }
            }
        }
    }

    await readDirectoryFiles(rootDirectory);

    const missingAnchors = findMissingAnchors(allAnchors, usedAnchors);
    for (const filepath in missingAnchors) {
        issues[filepath] ??= [];
        issues[filepath].push(...missingAnchors[filepath]);
    }

    return issues;
}

async function parseMarkdownFile(filepath: string) {
    const content = await Deno.readTextFile(filepath);
    const parsed = parseMarkdownContent(mdit, content);
    const document = domParser.parseFromString(parsed.html, "text/html")!;
    const allAnchors = getAnchors(document, { includeHref: false });

    const issues: Issue[] = [];
    const anchors = { all: allAnchors, used: new Set<string>() };
    const links = { external: new Set<string>(), local: new Set<string>() };

    for (const link of parsed.links) {
        if ((/^https?:/).test(link) && URL.canParse(link)) {
            links.external.add(link);
        } else if (link.startsWith(".") || link.startsWith("/")) {
            links.local.add(link);
        } else if (link.startsWith("#")) {
            anchors.used.add(link.slice(1));
        } else if (link.startsWith("mailto:")) {
            continue;
        } else {
            issues.push({ type: "unknown_link_format", reference: link });
        }
    }

    return { anchors, links, issues };
}

async function checkRelativeLink(
    localLink: string,
    dirInfo: { root: string; current: string },
    options: {
        indexFile: string;
        isCleanUrl: boolean;
        allowHtmlExtension: boolean;
    },
) {
    localLink = decodeURIComponent(localLink);
    const issues: Issue[] = [];
    const normalizedLocalLink = decodeURIComponent(
        localLink.startsWith("/") ? relative(resolve(dirInfo.current), resolve(join(dirInfo.root, "./", localLink))) : localLink,
    );
    let { root, anchor } = parseLink(normalizedLocalLink);

    if (options.isCleanUrl) {
        if (extname(root) === ".html") {
            issues.push({ type: "disallow_extension", reference: localLink, extension: "html" });
            root = root.slice(0, -4) + "md";
        } else if (extname(root) === ".md") {
            issues.push({ type: "disallow_extension", reference: localLink, extension: "md" });
        } else if (root.endsWith("/")) {
            root += options.indexFile;
        } else if ((!localLink.includes("#") && localLink.endsWith("/")) || localLink.includes("/#")) {
            root += "/" + options.indexFile;
        } else {
            root += ".md";
        }
    } else {
        if (extname(root) === ".html") {
            if (!options.allowHtmlExtension) {
                issues.push({ type: "wrong_extension", actual: ".html", expected: ".md", reference: localLink });
            }
            root = root.slice(0, -4) + "md";
        }
        if (extname(root) !== ".md") {
            if (!root.endsWith("/")) root += "/";
            root += options.indexFile;
        }
    }

    const path = join(dirInfo.current, root);
    try {
        if (root.includes("//")) {
            throw new Deno.errors.NotFound();
        }
        await Deno.lstat(path);
        return { anchor, issues, path };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            issues.push({
                type: "linked_file_not_found",
                filepath: resolve(path),
                reference: decodeURIComponent(localLink),
            });
            return { anchor, issues, path };
        }
        throw error;
    }
}

function findMissingAnchors(
    allAnchors: Record<string, Set<string>>,
    usedAnchors: Record<string, Record<string, Set<[anchor: string, reference: string]>>>,
): Record<string, MissingAnchorIssue[]> {
    const issues: Record<string, MissingAnchorIssue[]> = {};
    for (const link in usedAnchors) {
        const all = allAnchors[link] ?? new Set<string>();
        for (const fileWithAnchorMention in usedAnchors[link]) {
            for (const [anchor, reference] of usedAnchors[link][fileWithAnchorMention]) {
                if (isValidAnchor(all, link, anchor)) continue;
                issues[fileWithAnchorMention] ??= [];
                issues[fileWithAnchorMention].push({ type: "missing_anchor", anchor, reference, allAnchors: all });
            }
        }
    }
    return issues;
}
