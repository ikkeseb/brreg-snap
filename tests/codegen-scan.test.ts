import { describe, expect, it } from 'vitest';

import { findCodegen } from '../scripts/codegen-scan.mjs';

// verify:dist's check for runtime code generation in the built bundles
// (CLAUDE.md § Security constraints). It reads the AST, so a mention in
// a string is fine and a minifier's spelling doesn't matter.

describe('dist codegen scan', () => {
  it.each([
    ['eval call', 'eval(e)'],
    ['indirect eval', '(0,eval)(e)'],
    ['aliased eval', 'var x=eval;x(e)'],
    ['globalThis.eval', 'globalThis.eval(e)'],
    ["globalThis['eval']", 'globalThis["eval"](e)'],
    ['new Function', 'new Function("a","return a")'],
    ['Function call', 'Function(e)()'],
    ['Reflect.construct(Function, ...)', 'Reflect.construct(Function,[e])'],
    ['window.Function', 'new window.Function(e)'],
    ["self['Function']", 'self[`Function`](e)'],
    ['.constructor of a function', '(()=>{}).constructor(e)()'],
    ["['constructor'] of a function", '(function(){})["constructor"](e)()'],
  ])('flags %s', (_name, code) => {
    expect(findCodegen(code, 'x.js')).not.toEqual([]);
  });

  it.each([
    ['eval in a string', 'console.log("Use eval( for code")'],
    ['Function in a template', 'console.log(`new Function(x)`)'],
    ['a class constructor', 'var x=class extends Error{constructor(e){super(e)}}'],
    ['a property named like a method', 'var o={evaluate(){},functional:1};o.evaluate()'],
  ])('allows %s', (_name, code) => {
    expect(findCodegen(code, 'x.js')).toEqual([]);
  });

  it('fails closed on code it cannot parse', () => {
    expect(findCodegen('var = ;', 'x.js')).not.toEqual([]);
  });
});
