// Runtime code generation in built JavaScript (CLAUDE.md § Security
// constraints), found on the AST rather than the raw text: a mention
// inside a string is fine, and the minifier's spelling (`(0,eval)`,
// `Reflect.construct(Function,…)`, `x["eval"]`) doesn't matter. Used by
// scripts/verify-dist.mjs on every dist-*/ .js file.
//
// Parser: Vite's own `parseSync` (Oxc, via rolldown), so no new
// dependency. Scope is not analysed: any reference to the names below
// fails, which is safe on minified output (the mangler never picks them).
import { parseSync } from 'vite';

// Global references that are code generation on their own.
const GLOBALS = new Set(['eval', 'Function']);
// Property names that reach eval or a Function constructor on any object
// (globalThis.eval, fn.constructor).
const PROPERTIES = new Set(['eval', 'Function', 'constructor']);

/** Static name of a member-expression property, or undefined. */
function propertyName(node) {
  const p = node.property;
  if (!node.computed) return p.type === 'Identifier' ? p.name : undefined;
  if (p.type === 'Literal' && typeof p.value === 'string') return p.value;
  if (p.type === 'TemplateLiteral' && p.expressions.length === 0) return p.quasis[0].value.cooked;
  return undefined;
}

/**
 * @param {string} code JavaScript source
 * @param {string} filename for the parser's language detection and messages
 * @returns {string[]} one line per finding; empty when clean
 */
export function findCodegen(code, filename) {
  const { program, errors } = parseSync(filename, code);
  if (errors.length) return errors.map((e) => `cannot parse: ${e.message}`);

  const found = [];
  const at = (node) => `offset ${node.start}`;
  const visit = (node, parent, key) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent, key);
      return;
    }
    if (node === null || typeof node !== 'object' || typeof node.type !== 'string') return;

    if (node.type === 'MemberExpression') {
      const name = propertyName(node);
      if (PROPERTIES.has(name)) found.push(`.${name} (${at(node)})`);
    } else if (node.type === 'Identifier' && GLOBALS.has(node.name)) {
      // Not a reference: a non-computed property or object/class key.
      const isPropertyName =
        (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) ||
        (/^(Property|MethodDefinition|PropertyDefinition)$/.test(parent?.type ?? '') &&
          key === 'key' &&
          !parent.computed);
      if (!isPropertyName) found.push(`${node.name} (${at(node)})`);
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (child && typeof child === 'object') visit(child, node, childKey);
    }
  };
  visit(program, null, null);
  return found;
}
