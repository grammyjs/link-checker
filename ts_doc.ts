import { doc } from "https://deno.land/x/deno_doc@0.62.0/mod.ts";
import type { DocNode, JsDoc, JsDocTag, JsDocTagKind, Location } from "https://deno.land/x/deno_doc@0.62.0/types.d.ts";
import { checkExternalLink, parseMarkdownContent } from "./utilities.ts";
import { ExternalLinkIssue, Issue } from "./types.ts";

interface Link {
  location: Location;
  anchor?: string;
  tag?: string;
  name?: string;
}
type HasJSDoc = { jsDoc?: JsDoc; location: Location; name?: string };
type TSDocLinkIssue = (Issue & { loc: Link }) | (ExternalLinkIssue & { loc: Set<Link> });

console.log(await cli("https://deno.land/x/grammy@v1.17.1/mod.ts"));

async function cli(module: string) {
  const issues: TSDocLinkIssue[] = [];
  const links = await findLinks(module);

  for (const root in links) {
    const checked = await checkExternalLink(root);
    if (checked == null) {
      issues.push({ type: "no_response", reference: root, loc: links[root] });
      continue;
    }

    issues.push(...checked.issues.map((issue) => ({ ...issue, loc: links[root] })));

    if (checked.anchors == null) {
      delete links[root];
      continue;
    }

    for (const loc of links[root]) {
      if (loc.anchor == null || checked.anchors.has(loc.anchor)) continue;
      issues.push({ type: "missing_anchor", anchor: loc.anchor, reference: root, loc });
    }
  }

  return issues;
}

async function findLinks(module: string) {
  const docNodes = await doc(module);
  const jsDocNodes = stripSymbolsWithJSDocs(docNodes);
  const links: Record<string, Set<Link>> = {};

  for (const { jsDoc, location } of jsDocNodes) {
    if (jsDoc == null) continue;
    for (const href of stripLinksFromJSDoc(jsDoc.doc ?? "")) {
      const parsed = parseLink(href);
      links[parsed.root] ??= new Set();
      links[parsed.root].add({ location, anchor: parsed.anchor });
    }
    for (const { kind, href, name } of stripLinksFromJSDocTags(jsDoc.tags ?? [])) {
      const parsed = parseLink(href);
      links[parsed.root] ??= new Set();
      links[parsed.root].add({ location, anchor: parsed.anchor, tag: kind, name });
    }
  }

  return links;
}

function parseLink(href: string) {
  const url = new URL(href);
  const anchor = url.hash.substring(1) === "" ? undefined : url.hash.substring(1);
  url.hash = "";
  return { root: url.href, anchor };
}

function stripLinksFromJSDoc(doc: string) {
  return parseMarkdownContent(doc, { anchors: false }).links;
}

function stripLinksFromJSDocTags(tags: JsDocTag[]) {
  const links = new Set<{ kind: JsDocTagKind; href: string; name?: string }>();
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
          links.add({ kind: tag.kind, href, name });
        }
      }
    }
  }
  return links;
}

function stripSymbolsWithJSDocs(docNodes: DocNode[]) {
  let jsDocNodes: HasJSDoc[] = [];

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
