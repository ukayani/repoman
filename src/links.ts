interface Link {
  rel: string;
  uri: string;
}

export class Links {
  #links: Map<string, Link>;

  public static parse(links: string): Links {
    const linkMap = parseLinks(links);
    return new Links(linkMap);
  }

  private constructor(links: Map<string, Link>) {
    this.#links = links;
  }

  public has(rel: string): boolean {
    return this.#links.has(rel);
  }

  public get(rel: string): string | undefined {
    const link = this.#links.get(rel);
    return link?.uri;
  }
}

function parseLinks(links?: string): Map<string, Link> {
  if (links) {
    return links
      .split(",")
      .map(parseLink)
      .reduce((acc, link) => {
        acc.set(link.rel, link);
        return acc;
      }, new Map<string, Link>());
  } else {
    return new Map<string, Link>();
  }
}

function parseLinkUri(uriComponent: string): string {
  return uriComponent.substring(1, uriComponent.length - 1);
}

function parseLinkRel(relComponent: string): string {
  const components = relComponent.split("=").map((s) => s.trim());
  if (components.length === 2) {
    const rel = components[1];
    return rel.substring(1, rel.length - 1);
  } else {
    throw new Error("Unable to parse rel");
  }
}

function parseLink(link: string): Link {
  const components = link.split(";").map((s) => s.trim());
  if (components.length === 2) {
    return {
      uri: parseLinkUri(components[0]),
      rel: parseLinkRel(components[1]),
    } as Link;
  } else {
    throw new Error("Unable to parse link");
  }
}
