/**
 * Structured-data extraction: the items on a page, not just the names of their
 * types.
 *
 * The crawl already recorded three numbers per page — how many JSON-LD blocks
 * there were, how many failed to parse, and the set of `@type` strings. That is
 * enough to say "structured data is present" and nothing else. It cannot say
 * whether a LocalBusiness carries an address, whether two pages claim the same
 * Organization under different `@id`s, or whether a breadcrumb's items are
 * ordered — which is the difference between reporting that markup exists and
 * auditing it.
 *
 * What this module records is a bounded projection, never the whole graph. An
 * audit of 300 pages must not turn into a copy of 300 sites' JSON-LD in our
 * database: values are truncated, nesting is summarised one level deep, and the
 * per-page item count is capped. The projection is chosen to answer the
 * questions the validator actually asks, and nothing beyond them.
 *
 * Microdata is read as well as JSON-LD. A site that marks up its address with
 * itemprop attributes is not a site without structured data, and treating it as
 * one would have been a false absence claim.
 */

/** Caps. A page that trips one of these is recorded as truncated rather than
 * silently shortened, because a partial inventory the reader believes is
 * complete is worse than a stated limit. */
export const SCHEMA_LIMITS = Object.freeze({
  itemsPerPage: 60,
  propsPerItem: 40,
  valueChars: 300,
  arraySample: 3
});

/** The properties worth keeping a value for. Everything else is recorded as
 * present-or-absent by key alone, which is all the validator needs and keeps a
 * page's markup from being copied wholesale into the audit. */
const VALUED_PROPS = new Set([
  '@id', 'name', 'url', 'position', 'telephone', 'email', 'priceRange',
  'streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry',
  'headline', 'datePublished', 'dateModified', 'image', 'logo', 'sameAs', 'inLanguage'
]);

function trim(value) {
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length > SCHEMA_LIMITS.valueChars ? `${s.slice(0, SCHEMA_LIMITS.valueChars)}…` : s;
}

/** One level of structure, then stop. `address` becomes its type and its key
 * list, which answers "is this address complete" without storing the address. */
function summariseValue(key, value) {
  if (value == null) return { kind: 'empty' };
  if (Array.isArray(value)) {
    return {
      kind: 'list',
      count: value.length,
      items: value.slice(0, SCHEMA_LIMITS.arraySample).map((v) => summariseValue(key, v))
    };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => k !== '@context').slice(0, SCHEMA_LIMITS.propsPerItem);
    const nested = {};
    for (const k of keys) {
      if (VALUED_PROPS.has(k) && (typeof value[k] === 'string' || typeof value[k] === 'number')) {
        nested[k] = trim(value[k]);
      }
    }
    return { kind: 'node', type: typeNames(value['@type'])[0] || '', keys, values: nested };
  }
  const text = trim(value);
  if (!text) return { kind: 'empty' };
  return VALUED_PROPS.has(key) ? { kind: 'value', value: text } : { kind: 'value' };
}

/** `@type` is a string or an array of them, and either may be absent. */
export function typeNames(type) {
  if (typeof type === 'string') return [type.trim()].filter(Boolean);
  if (Array.isArray(type)) return type.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Every node in a JSON-LD document, including the @graph form most CMS
 * plugins emit and the nested nodes inside a property value. */
function* walkNodes(value, path = '$', depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walkNodes(value[i], `${path}[${i}]`, depth + 1);
    return;
  }
  if (Array.isArray(value['@graph'])) {
    for (let i = 0; i < value['@graph'].length; i++) {
      yield* walkNodes(value['@graph'][i], `${path}.@graph[${i}]`, depth + 1);
    }
  }
  // An item is a node that says what it is, or one that carries data without
  // saying. A bare { '@id': '…' } is neither: it is a reference to a node
  // defined elsewhere in the same graph, which is how every @graph-shaped
  // document links its parts together. Treating references as items reported
  // 106 'item has no @type' errors against one real ten-page site whose markup
  // was correct — the validator would have been wrong more often than the sites.
  const keys = Object.keys(value).filter((k) => k !== '@context');
  const isReference = value['@type'] === undefined && keys.length === 1 && keys[0] === '@id';
  if (!isReference && (value['@type'] !== undefined || value['@id'] !== undefined)) yield { node: value, path };
  for (const [k, v] of Object.entries(value)) {
    if (k === '@graph' || k === '@context') continue;
    if (v && typeof v === 'object') yield* walkNodes(v, `${path}.${k}`, depth + 1);
  }
}

function itemFromNode(node, { format, path, blockIndex }) {
  const types = typeNames(node['@type']);
  const props = {};
  let propCount = 0;
  for (const [key, value] of Object.entries(node)) {
    if (key === '@context' || key === '@type') continue;
    if (propCount >= SCHEMA_LIMITS.propsPerItem) break;
    propCount++;
    props[key] = summariseValue(key, value);
  }
  return {
    format,
    blockIndex,
    path,
    // A node with no @type is itself a finding, so it is recorded rather than
    // dropped; '' is the honest value and the validator reads it as one.
    type: types[0] || '',
    extraTypes: types.slice(1),
    nodeId: typeof node['@id'] === 'string' ? trim(node['@id']) : '',
    name: typeof node.name === 'string' ? trim(node.name) : '',
    propKeys: Object.keys(props),
    props
  };
}

/**
 * Microdata, read from the DOM. Only itemscope roots are recorded as items;
 * their itemprops become the same shallow projection as a JSON-LD node so both
 * formats reach the validator in one shape.
 */
function microdataItems(document, limitRemaining) {
  const items = [];
  const roots = document.querySelectorAll('[itemscope][itemtype]');
  for (const root of roots) {
    if (items.length >= limitRemaining) break;
    // A nested itemscope is a property of its parent, not an item in its own
    // right; counting it separately would double-count the page's markup.
    if (root.parentElement?.closest('[itemscope]')) continue;
    const itemtype = String(root.getAttribute('itemtype') || '');
    const type = itemtype.split(/[\s]+/)[0].replace(/^https?:\/\/schema\.org\//i, '').trim();
    const props = {};
    const propKeys = [];
    for (const el of root.querySelectorAll('[itemprop]')) {
      if (el.closest('[itemscope]') !== root && el !== root) {
        const owner = el.parentElement?.closest('[itemscope]');
        if (owner && owner !== root) continue;
      }
      if (propKeys.length >= SCHEMA_LIMITS.propsPerItem) break;
      const key = String(el.getAttribute('itemprop') || '').trim();
      if (!key || propKeys.includes(key)) continue;
      propKeys.push(key);
      const raw = el.getAttribute('content') || el.getAttribute('href') || el.getAttribute('src') || el.textContent || '';
      const text = trim(raw);
      props[key] = text ? (VALUED_PROPS.has(key) ? { kind: 'value', value: text } : { kind: 'value' }) : { kind: 'empty' };
    }
    items.push({
      format: 'microdata',
      blockIndex: items.length,
      path: `itemscope[${items.length}]`,
      type,
      extraTypes: [],
      nodeId: trim(root.getAttribute('itemid') || ''),
      name: trim(props.name?.value || ''),
      propKeys,
      props
    });
  }
  return items;
}

/**
 * The structured data on one page.
 *
 * Returns the items plus the counts the crawl already reported, so the caller
 * has one source for both and they cannot disagree.
 */
export function collectSchemaItems(document) {
  const items = [];
  let blockCount = 0;
  let invalidCount = 0;
  const invalidBlocks = [];
  let truncated = false;

  const blocks = document.querySelectorAll('script[type="application/ld+json"]');
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    blockCount++;
    const raw = blocks[blockIndex].textContent || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      invalidCount++;
      // The reason is kept because "invalid JSON-LD" without it sends a
      // developer to read the whole block; the message names the character.
      invalidBlocks.push({ blockIndex, reason: trim(error?.message || 'JSON could not be parsed') });
      continue;
    }
    for (const { node, path } of walkNodes(parsed)) {
      if (items.length >= SCHEMA_LIMITS.itemsPerPage) { truncated = true; break; }
      items.push(itemFromNode(node, { format: 'json-ld', path, blockIndex }));
    }
    if (truncated) break;
  }

  if (!truncated && items.length < SCHEMA_LIMITS.itemsPerPage) {
    const micro = microdataItems(document, SCHEMA_LIMITS.itemsPerPage - items.length);
    items.push(...micro);
    if (items.length >= SCHEMA_LIMITS.itemsPerPage) truncated = true;
  }

  // A node with no @type whose @id resolves to a typed node in the same
  // document is a reference that happens to inline a property — Yoast writes
  // author as { '@id': …, name: … } beside a full Person under the same @id.
  // That is correct JSON-LD, and calling it an untyped item made the validator
  // wrong on every article page of a site whose markup was fine. Only a node
  // that resolves to nothing is genuinely missing its type.
  const typedIds = new Set(items.filter((i) => i.type && i.nodeId).map((i) => i.nodeId));
  const resolved = items.filter((i) => !(!i.type && i.nodeId && typedIds.has(i.nodeId)));
  items.length = 0;
  items.push(...resolved);

  const types = [...new Set(items.map((i) => i.type).filter(Boolean))];
  return {
    items,
    truncated,
    schemaBlockCount: blockCount,
    schemaInvalidCount: invalidCount,
    invalidBlocks,
    schemaTypes: types
  };
}
