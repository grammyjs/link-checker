import { doc, DocNode, JsDoc, JsDocTag, JsDocTagKind, Location } from "./deps/deno_doc.ts";
import { DOMParser } from "./deps/deno_dom.ts";
import { MarkdownIt } from "./deps/markdown-it/mod.ts";
import { blue } from "./deps/std/fmt.ts";

import { transformURL } from "./fetch.ts";
import { findGroupedLinksIssues, GroupedLinksResolved, groupLinks, resolveGroupedLinks } from "./group_links.ts";
import { ExternalLinkIssue, Issue } from "./types.ts";
import { parseLink, parseMarkdownContent } from "./utilities.ts";
import { checkExternalUrl } from "./fetch.ts";

export interface TSDocLink {
  location: Location;
  anchor?: string;
  tag?: JsDocTagKind;
  name?: string;
}

interface WithJSDoc {
  jsDoc?: JsDoc;
  location: Location;
  name?: string;
}

export type TSDocLinkIssue =
  | (Issue & { loc: TSDocLink })
  | (ExternalLinkIssue & { loc: Set<TSDocLink> });

const domParser = new DOMParser();
const mdit = MarkdownIt({ html: true, linkify: true });

export async function findIssues(module: string) {
  const issues: TSDocLinkIssue[] = [];
  const linkLocations = await findLinks(module);
  const allAnchors: Record<string, Set<string>> = {};
  const resolvedGroupableLinks: GroupedLinksResolved = {
    githubRenderableFiles: {},
  };

  for (const href in linkLocations) {
    const { root, anchor } = parseLink(href);
    if (allAnchors[root] != null) {
      if (anchor != null && !allAnchors[root].has(anchor)) {
        issues.push({ type: "missing_anchor", anchor, loc: linkLocations[href], reference: root, allAnchors: allAnchors[root] });
      }
      continue;
    }

    const groupedLink = groupLinks(new Set([href])); // single!
    await resolveGroupedLinks(groupedLink, resolvedGroupableLinks, { domParser });
    for (const issue of findGroupedLinksIssues(groupedLink, resolvedGroupableLinks)) {
      issues.push({ ...issue, loc: linkLocations[href] });
    }

    if (groupedLink.other.size === 0) continue; // it was a groupable special link.
    console.log(blue("fetch"), decodeURIComponent(transformURL(root)));
    const checkedLink = await checkExternalUrl(root, { domParser });

    if (checkedLink.issues.length > 0) {
      issues.push(...checkedLink.issues.map((issue) => {
        return { ...issue, loc: linkLocations[href] };
      }));
    }

    allAnchors[root] = checkedLink.anchors ?? new Set();

    if (anchor != null && !allAnchors[root].has(anchor)) {
      for (const location of linkLocations[href]) {
        issues.push({ type: "missing_anchor", loc: location, reference: root, anchor, allAnchors: allAnchors[root] });
      }
    }
  }

  return issues;
}

async function findLinks(module: string) {
  const docNodes = await doc(module);
  const jsDocNodes = stripSymbolsWithJSDocs(docNodes);
  const linkLocations: Record<string, Set<TSDocLink>> = {};

  for (const { jsDoc, location } of jsDocNodes) {
    if (jsDoc == null) continue;
    for (const href of stripLinksFromJSDoc(jsDoc.doc ?? "")) {
      linkLocations[href] ??= new Set();
      linkLocations[href].add({ location });
    }
    for (const { tag, href, name } of stripLinksFromJSDocTags(jsDoc.tags ?? [])) {
      linkLocations[href] ??= new Set();
      linkLocations[href].add({ location, tag, name });
    }
  }

  return linkLocations;
}

function stripLinksFromJSDoc(doc: string) {
  return parseMarkdownContent(mdit, doc).links;
}

function stripLinksFromJSDocTags(tags: JsDocTag[]) {
  const links = new Set<{ tag: JsDocTagKind; href: string; name?: string }>();
  for (const tag of tags) {
    switch (tag.kind) {
      case "category":
      case "deprecated":
      case "example":
      case "callback":
      case "template":
      case "default":
      case "enum":
      case "extends":
      case "this":
      case "type":
      case "property":
      case "typedef":
      case "param":
      case "return": {
        if (tag.doc == null || tag.doc.trim() === "") break;
        const strippedLinks = stripLinksFromJSDoc(tag.doc);
        for (const href of strippedLinks) {
          let name: string | undefined = undefined;
          if (
            tag.kind === "property" || tag.kind === "callback" || tag.kind === "template" || tag.kind === "typedef" ||
            tag.kind === "param"
          ) {
            name = tag.name;
          } else if (tag.kind === "enum" || tag.kind === "extends" || tag.kind === "this" || tag.kind === "type") {
            name = tag.type;
          }
          links.add({ tag: tag.kind, href, name });
        }
      }
    }
  }
  return links;
}

function stripSymbolsWithJSDocs(docNodes: DocNode[]) {
  let jsDocNodes: WithJSDoc[] = [];

  for (const node of docNodes) {
    if (node.kind === "import") continue;
    if (node.jsDoc != null) jsDocNodes.push(node);

    if (node.kind === "interface") {
      jsDocNodes = jsDocNodes.concat(
        node.interfaceDef.methods.filter((method) => method.jsDoc != null),
        node.interfaceDef.properties.filter((prop) => prop.jsDoc != null),
        node.interfaceDef.callSignatures.filter((sig) => sig.jsDoc != null),
      );
    } else if (node.kind === "enum") {
      jsDocNodes = jsDocNodes.concat(node.enumDef.members.filter((member) => member.jsDoc != null));
    } else if (node.kind === "class") {
      jsDocNodes = jsDocNodes.concat(
        node.classDef.constructors.filter((constructor) => constructor.jsDoc != null),
        node.classDef.methods.filter((method) => method.jsDoc != null),
        node.classDef.properties.filter((prop) => prop.jsDoc != null),
      );
    } else if (node.kind === "namespace") {
      jsDocNodes = jsDocNodes.concat(stripSymbolsWithJSDocs(node.namespaceDef.elements));
    }
  }

  return jsDocNodes;
}
