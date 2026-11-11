/**
 * A small, tolerant HTML scanner for the gate scripts. It is not a
 * conforming parser: it builds a tree that is good enough to answer "which
 * links sit inside the element with this id" on the pages this site builds,
 * without adding a dependency.
 *
 * Tolerances: comments and doctypes are skipped; `<script>`, `<style>`,
 * `<textarea>` and `<title>` are raw text; void elements never open a scope;
 * a stray end tag is ignored; an end tag closes every unclosed element above
 * its match (so an unclosed `<p>` or `<li>` nests instead of breaking).
 */
const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const rawTextTags = new Set(['script', 'style', 'textarea', 'title']);
const namedEntities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value) {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (match, decimal, hex, name) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return namedEntities[name.toLowerCase()] ?? match;
    },
  );
}

/** The index of the `>` that ends the tag opened at `from`, quotes respected. */
function tagEnd(html, from) {
  let quote = '';
  for (let index = from; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

function parseAttributes(source) {
  const attrs = {};
  const pattern =
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/**
 * Parse `html` into a tree. Every node is
 * `{ tag, attrs, children, parent, start, innerStart, innerEnd, end }`, the
 * offsets pointing into `html`. The root has tag `#root`.
 */
export function parseHtml(html) {
  const root = {
    tag: '#root',
    attrs: {},
    children: [],
    parent: null,
    start: 0,
    innerStart: 0,
    innerEnd: html.length,
    end: html.length,
  };
  let current = root;
  let index = 0;

  const close = (node, innerEnd, end) => {
    node.innerEnd = innerEnd;
    node.end = end;
  };

  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) break;

    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[open + 1] === '!' || html[open + 1] === '?') {
      const end = html.indexOf('>', open);
      index = end < 0 ? html.length : end + 1;
      continue;
    }

    if (html[open + 1] === '/') {
      const end = html.indexOf('>', open);
      if (end < 0) break;
      const name = html
        .slice(open + 2, end)
        .trim()
        .toLowerCase();
      let match = current;
      while (match !== root && match.tag !== name) match = match.parent;
      if (match !== root) {
        // Close everything left open above the match, then the match itself.
        for (let node = current; node !== match; node = node.parent) {
          close(node, open, open);
        }
        close(match, open, end + 1);
        current = match.parent;
      }
      index = end + 1;
      continue;
    }

    const name = html.slice(open + 1).match(/^[a-z][a-z0-9-]*/i)?.[0];
    if (!name) {
      // A bare "<" in text.
      index = open + 1;
      continue;
    }
    const end = tagEnd(html, open + 1 + name.length);
    if (end < 0) break;
    const tag = name.toLowerCase();
    const selfClosed = html[end - 1] === '/';
    const node = {
      tag,
      attrs: parseAttributes(
        html.slice(open + 1 + name.length, selfClosed ? end - 1 : end),
      ),
      children: [],
      parent: current,
      start: open,
      innerStart: end + 1,
      innerEnd: end + 1,
      end: end + 1,
    };
    current.children.push(node);
    index = end + 1;

    if (voidTags.has(tag)) continue;
    if (rawTextTags.has(tag)) {
      const closing = html.toLowerCase().indexOf(`</${tag}`, index);
      const innerEnd = closing < 0 ? html.length : closing;
      const closingEnd = closing < 0 ? -1 : html.indexOf('>', closing);
      close(node, innerEnd, closingEnd < 0 ? html.length : closingEnd + 1);
      index = node.end;
      continue;
    }
    current = node;
  }

  for (let node = current; node !== root; node = node.parent) {
    close(node, html.length, html.length);
  }
  return { root, html };
}

/** Every element below `node`, in document order. */
export function* descendants(node) {
  for (const child of node.children) {
    yield child;
    yield* descendants(child);
  }
}

export function findAll(node, predicate) {
  return [...descendants(node)].filter(predicate);
}

export function byId(document, id) {
  return findAll(document.root, (node) => node.attrs.id === id);
}

export function hasClass(node, className) {
  return (node.attrs.class ?? '').split(/\s+/).includes(className);
}

export function innerHtml(document, node) {
  return document.html.slice(node.innerStart, node.innerEnd);
}

/** The text inside `node`: tags dropped, entities decoded, spaces folded. */
export function textOf(document, node) {
  return decodeEntities(
    innerHtml(document, node)
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}
