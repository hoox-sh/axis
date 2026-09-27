/**
 * Copyright (c) 2026 HOOX · AXIS · hoox-sh
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type ConceptDoc, loadConcepts, markdownLinkTargets, resolveBundleLink } from './lint';

export type Hit = {
  id: string;
  path: string;
  type: string;
  title: string;
  description: string;
  resource: string;
  score: number;
};

function field(fm: ConceptDoc['frontmatter'], key: string): string {
  const value = fm[key];
  return typeof value === 'string' ? value : '';
}

/** Path and identifier pieces. `builtins` does not contain the term `ui`. */
function segments(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Stems of files listed under `# Files`. The extension is dropped so `ts`
 * is not a query term, and `index` is skipped because nearly every module has one.
 */
function fileStems(body: string): string[] {
  const heading = '\n# Files\n';
  const at = body.startsWith('# Files\n') ? '# Files\n'.length : body.indexOf(heading);
  if (at < 0) return [];
  const from = body.startsWith('# Files\n') ? at : at + heading.length;
  const rest = body.slice(from);
  const next = rest.indexOf('\n# ');
  const block = next < 0 ? rest : rest.slice(0, next);
  const stems: string[] = [];
  for (const line of block.matchAll(/^\* `([^`]+)`/gm)) {
    const stem = line[1].replace(/\.[^.]+$/, '');
    for (const seg of segments(stem)) {
      if (seg !== 'index') stems.push(seg);
    }
  }
  return stems;
}

function normalizeQuery(idOrPath: string): string {
  return idOrPath.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.md$/, '').replace(/\/$/, '');
}

export function searchConcepts(concepts: ConceptDoc[], terms: string[]): Hit[] {
  const needles = terms.map((term) => term.toLowerCase()).filter(Boolean);
  const hits: Hit[] = [];
  for (const concept of concepts) {
    const title = field(concept.frontmatter, 'title') || concept.id;
    const description = field(concept.frontmatter, 'description');
    const resource = field(concept.frontmatter, 'resource');
    const tags = Array.isArray(concept.frontmatter.tags) ? concept.frontmatter.tags.join(' ') : '';
    const idSegs = segments(concept.id);
    const resSegs = segments(resource);
    const titleSegs = segments(title);
    const descSegs = segments(description);
    const tagSegs = segments(tags);
    const fileSegs = fileStems(concept.body);
    let score = 0;
    for (const needle of needles) {
      const primary = segments(needle)[0] ?? '';
      if (!primary) continue;
      const raw = needle.toLowerCase();
      const id = concept.id.toLowerCase();
      const res = resource.toLowerCase();
      if (id === raw || res === raw || id === `code/${raw}`) score += 8;
      else if (resSegs.at(-1) === primary || idSegs.at(-1) === primary) score += 6;
      else if (resSegs.includes(primary) || idSegs.includes(primary)) score += 4;
      else if (titleSegs.includes(primary) || tagSegs.includes(primary)) score += 3;
      else if (fileSegs.includes(primary)) score += 2;
      else if (descSegs.includes(primary)) score += 1;
      else score -= 2;
    }
    if (needles.length === 0 || score > 0) {
      hits.push({
        id: concept.id,
        path: concept.path,
        type: field(concept.frontmatter, 'type') || 'Concept',
        title,
        description,
        resource,
        score,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, 12);
}

/**
 * Exact id / resource, otherwise the deepest directory concept that contains
 * the path. A file such as `src/ui/StatusBar.tsx` belongs to `src/ui`, not to
 * whichever module sorts first.
 */
function conceptById(concepts: ConceptDoc[], idOrPath: string): ConceptDoc | undefined {
  const id = normalizeQuery(idOrPath);
  const exact = concepts.find(
    (concept) =>
      concept.id === id ||
      concept.id === `code/${id}` ||
      concept.path === idOrPath ||
      concept.path === `${id}.md` ||
      field(concept.frontmatter, 'resource') === id,
  );
  if (exact) return exact;
  let best: ConceptDoc | undefined;
  let bestLen = -1;
  for (const concept of concepts) {
    const resource = field(concept.frontmatter, 'resource').replace(/\/$/, '');
    if (!resource) continue;
    if (id === resource || id.startsWith(`${resource}/`)) {
      if (resource.length > bestLen) {
        best = concept;
        bestLen = resource.length;
      }
    }
  }
  return best;
}

export function formatHits(hits: Hit[]): string {
  if (hits.length === 0) return 'No matching concepts.';
  return hits
    .map((hit) => `${hit.id}\n  ${hit.type} — ${hit.description || hit.title}\n  resource: ${hit.resource || hit.path}`)
    .join('\n');
}

export function renderContext(files: Map<string, string>, start: string, depth: number, maxChars: number): string {
  const concepts = loadConcepts(files);
  const names = new Set(files.keys());
  const root = conceptById(concepts, start) ?? searchConcepts(concepts, start.split(/[\s/]+/)).map((hit) => concepts.find((concept) => concept.id === hit.id))[0];
  if (!root) return `No concept for ${start}.`;
  const parts: string[] = [root.text.trim()];
  if (depth > 0) {
    const neighborIds: string[] = [];
    for (const target of markdownLinkTargets(root.body)) {
      const resolved = resolveBundleLink(root.path, target, names);
      if (!resolved || !names.has(resolved)) continue;
      const id = resolved.replace(/\.md$/, '');
      if (!neighborIds.includes(id)) neighborIds.push(id);
    }
    const blurbs: string[] = [];
    for (const id of neighborIds) {
      const neighbor = concepts.find((concept) => concept.id === id);
      if (!neighbor) continue;
      const title = field(neighbor.frontmatter, 'title') || id;
      const description = field(neighbor.frontmatter, 'description');
      blurbs.push(`* ${title} (\`/${neighbor.path}\`) — ${description}`);
    }
    if (blurbs.length > 0) {
      parts.push('', '# Linked concepts', '', ...blurbs);
    }
  }
  const text = parts.join('\n').trim();
  if (text.length <= maxChars) return `${text}\n`;
  return `${text.slice(0, maxChars).replace(/\s+\S*$/, '')}\n…\n`;
}

