import { doc, DocNode, JsDoc, JsDocTag, JsDocTagKind, Location } from "./deps/deno_doc.ts";
import { MarkdownIt } from "./deps/markdown-it/mod.ts";
import { parseLink, parseMarkdownContent } from "./utilities.ts";

export interface Link {
  location: Location;
  anchor?: string;
  tag?: JsDocTagKind;
  name?: string;
}

interface HasJSDoc {
  jsDoc?: JsDoc;
  location: Location;
  name?: string;
}

const mdit = MarkdownIt({ html: true, linkify: true });

export async function findLinks(module: string) {
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

function stripLinksFromJSDoc(doc: string) {
  return parseMarkdownContent(mdit, doc).links;
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
