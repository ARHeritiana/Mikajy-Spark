'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ink = require('../web/ink.js');
const Store = require('../web/storage.js');

const M = () => .5;                                  // every character half a font size wide
const box = (x0, y0, x1, y1) => Ink.box(x0, y0, x1, y1);
const g = (c, b) => Ink.glyph(c, {raw: b});
const text = seq => Ink.text(seq);
const typeset = seq => { Ink.layoutSeq(seq, 0, 100, 80, M); return seq; };

test('symbols are ordered by where they are written, not by when', () => {
  const seq = [];
  Ink.insert(seq, g('3', box(200, 56, 230, 100)), 80);
  Ink.insert(seq, g('1', box(0, 56, 30, 100)), 80);
  Ink.insert(seq, g('+', box(100, 70, 130, 90)), 80);
  assert.equal(text(seq), '1+3');
});

test('a raised, smaller symbol is an exponent; the next normal one returns to the line', () => {
  const seq = [];
  Ink.insert(seq, g('2', box(0, 56, 30, 100)), 80);
  Ink.insert(seq, g('3', box(35, 30, 50, 55)), 80);
  Ink.insert(seq, g('4', box(52, 32, 66, 57)), 80);
  Ink.insert(seq, g('+', box(80, 70, 100, 90)), 80);
  assert.equal(text(seq), '2³⁴+');
  assert.deepEqual(Ink.tokens(seq.slice(0, 2)), ['2', '^', '(', '34', ')']);
});

test('exponents are judged against the typeset base, as the user sees it', () => {
  const seq = typeset([g('2', box(0, 0, 10, 10))]);   // ink was tiny and elsewhere; it is now typeset at y 100, size 80
  const b = seq[0].box;
  Ink.insert(seq, g('3', box(b.x1 + 4, b.y0 - 20, b.x1 + 20, b.y0 + 5)), 80);
  assert.equal(seq[1].t, 'sup');
});

test('a root keeps its drawn reach before anything is under it, and takes what is written under its bar', () => {
  const seq = [], r = Ink.root([], 1.2);
  Object.assign(r, {raw: box(0, 20, 40, 100), bar: {x0: 30, x1: 130, top: 20, base: 100}});
  Ink.addRoot(seq, r, 80);
  typeset(seq);
  assert.ok(r.tvx - (r.tx + .5 * r.tsz) >= 1.2 * 80 - 1e-9, 'bar shorter than drawn');
  assert.throws(() => Ink.tokens(seq), /empty root/);
  const b = r.bar;
  Ink.insert(seq, g('4', box(b.x0 + 10, 60, b.x0 + 40, 100)), 80);
  Ink.insert(seq, g('+', box(b.x1 + 30, 70, b.x1 + 50, 90)), 80);
  assert.equal(text(seq), '√(4)+');
  assert.deepEqual(Ink.tokens(seq), ['√', '(', '4', ')', '+']);
});

test('a root drawn around typeset content takes it inside; a bare hook applies to the next number', () => {
  const seq = typeset([g('9', box(0, 0, 1, 1))]), q = seq[0].box;
  const r = Ink.root([], 1);
  Object.assign(r, {raw: box(q.x0 - 60, q.y0 - 20, q.x0 - 5, q.y1), bar: {x0: q.x0 - 10, x1: q.x1 + 20, top: q.y0 - 20, base: q.y1}});
  Ink.addRoot(seq, r, 80);
  assert.equal(text(seq), '√(9)');
  const hook = [Ink.root([], 0), Ink.glyph('1'), Ink.glyph('6')];
  typeset(hook);
  assert.deepEqual(Ink.tokens(hook), ['√', '16']);
  assert.ok(Math.abs(hook[0].tvx - hook[2].box.x1) < 1e-9, 'the hook draws its bar over the number');
});

test('fractions: bar with parts, a bar drawn under an expression, and parts written later', () => {
  const seq = [];
  assert.equal(Ink.addFraction(seq, box(0, 100, 100, 100), 80, false, false), null, 'a lone bar is a minus');
  const f = Ink.addFraction(seq, box(0, 100, 100, 100), 80, true, true);
  Ink.insert(seq, g('1', box(40, 50, 60, 95)), 80);
  Ink.insert(seq, g('4', box(40, 110, 60, 150)), 80);
  assert.equal(f.num.length + f.den.length, 2);
  assert.deepEqual(Ink.tokens(seq), ['(', '(', '1', ')', '/', '(', '4', ')', ')']);

  const line = typeset([Ink.glyph('2'), Ink.glyph('+'), Ink.glyph('4')]), u = Ink.unionOf(line);
  const bar = box(u.x0 - 4, u.y1 + 15, u.x1 + 4, u.y1 + 15);
  assert.ok(Ink.contentAbove(line, bar, 80));
  const fr = Ink.addFraction(line, bar, 80, false, false);
  assert.equal(text(line), '(2+4)/()');
  assert.throws(() => Ink.tokens(line), /incomplete fraction/);
  typeset(line);
  Ink.insert(line, g('3', box(fr.bar.x0 + 20, fr.bar.y + 20, fr.bar.x0 + 40, fr.bar.y + 60)), 80);
  assert.equal(text(line), '(2+4)/(3)');
});

test('a symbol written over a typeset symbol replaces it', () => {
  const seq = typeset([Ink.glyph('1'), Ink.glyph('+'), Ink.glyph('2')]), q = seq[2].box;
  const hit = Ink.overwritten(seq, box(q.x0 + 2, q.y0 - 2, q.x1 - 2, q.y1 + 2));
  assert.deepEqual(hit && [hit.seq === seq, hit.k], [true, 2]);
  assert.equal(Ink.overwritten(seq, box(q.x1 + 30, q.y0, q.x1 + 60, q.y1)), null);
});

test('erasing: only what is hit goes; a root sign leaves its radicand; empty parts go', () => {
  const seq = [Ink.glyph('1'), Ink.glyph('+'), Ink.root([Ink.glyph('4')], 1), Ink.sup([Ink.glyph('2')])];
  typeset(seq);
  const plus = seq[1].box, sign = Ink.signBox(seq[2]), two = seq[3].body[0].box;
  const at = q => (b => b.x0 === q.x0 && b.y0 === q.y0);
  assert.equal(Ink.erase(seq, at(plus)).length, 1);
  assert.equal(text(seq), '1√(4)²');
  Ink.erase(seq, at(sign));
  assert.equal(text(seq), '14²');
  Ink.erase(seq, at(two));
  assert.equal(text(seq), '14');
});

test('context: an operator after an operator is unlikely; words and the constant e are read', () => {
  const seq = [Ink.glyph('2'), Ink.glyph('+'), Ink.glyph([{c: '*', p: .5}, {c: '4', p: .45}], {fresh: true})];
  Ink.readAll(seq, true);
  assert.equal(Ink.ch(seq[2]), '4');
  const word = 'sin'.split('').map(c => Ink.glyph([{c, p: .9}]));
  Ink.readAll(word, true);
  assert.equal(Ink.tokens(word.concat(Ink.glyph('3'))).join(' '), 'sin 3');
});

test('trees survive storage; hostile or oversized trees are rejected; old flat history still opens', () => {
  const seq = [Ink.glyph('2'), Ink.sup([Ink.glyph('3')]), Ink.frac([Ink.glyph('1')], [Ink.glyph('4')]), Ink.root([Ink.glyph('9')], .8)];
  const saved = JSON.parse(JSON.stringify(Ink.serialize(seq)));
  const back = Ink.deserialize(Store.cleanTree(saved));
  assert.equal(text(back), text(seq));
  assert.equal(Store.cleanTree([{c: '1'}, {s: 'x'}]), null);
  assert.equal(Store.cleanTree([{c: '<img>'}]), null);
  let deep = [{c: '1'}];
  for (let i = 0; i < 12; i++) deep = [{s: deep}];
  assert.equal(Store.cleanTree(deep), null);
  assert.equal(Store.cleanTree(Array.from({length: 401}, () => ({c: '1'}))), null);   // more than 400 nodes
  const hist = Store.cleanHistory([{id: 'a', ts: 1, ans: '=8', text: '2³', tree: saved, junk: 1}, {id: 'b', ts: 1, ans: '=1', text: '1', tree: [{q: 1}]}]);
  assert.deepEqual(hist.map(h => h.id), ['a']);
  const legacy = [{c: '2'}, {c: '3', sup: 1}, {c: '+'}, {c: '§', fp: 'bar', fid: 'f'}, {c: '1', fp: 'n', fid: 'f'}, {c: '4', fp: 'd', fid: 'f'}, {c: '√', cover: 1}, {c: '9'}];
  assert.equal(text(Ink.fromLegacy(legacy)), '2³+(1)/(4)√(9)');
});

/* ---- Long expressions: fractions in fractions, roots over fractions, parts added later ---------------------------- */
const fracAt = (num, den, x0, x1, y) => Object.assign(Ink.frac(num, den), {bar: {x0, x1, y}, raw: box(x0, y - 4, x1, y + 4), ts: 80});

test('a fraction in a fraction is laid out clear of the outer bar, above and below', () => {
  const inner = () => Ink.frac([Ink.glyph('1')], [Ink.glyph('2')]);
  for (const [num, den] of [[[inner()], [Ink.glyph('4')]], [[Ink.glyph('4')], [inner()]]]) {
    const f = Ink.frac(num, den), seq = typeset([f]), y = f.bar.y;
    assert.ok(Ink.unionOf(f.num).y1 < y, 'numerator crosses the bar');
    assert.ok(Ink.unionOf(f.den).y0 > y, 'denominator crosses the bar');
    assert.equal(Ink.tokens(seq).join(''), num[0].t === 'frac' ? '((((1)/(2)))/(4))' : '((4)/(((1)/(2))))');
  }
});

test('a bar wider than a typeset fraction, under it, makes a fraction of the fraction; a short one under the denominator nests', () => {
  const outer = typeset([Ink.frac([Ink.glyph('1')], [Ink.glyph('2')])]), f = outer[0], u = Ink.unionOf(outer);
  Ink.addFraction(outer, box(u.x0 - 10, u.y1 + 15, u.x1 + 10, u.y1 + 17), 80, false, false);
  assert.equal(text(outer), '((1)/(2))/()');
  const inner = typeset([Ink.frac([Ink.glyph('1')], [Ink.glyph('2')])]), d = inner[0].den[0].box;
  Ink.addFraction(inner, box(d.x0 - 4, d.y1 + 8, d.x1 + 4, d.y1 + 10), 80, false, false);
  assert.equal(text(inner), '(1)/((2)/())');
  assert.ok(f.bar && Ink.contentAbove(typeset([Ink.frac([Ink.glyph('1')], [Ink.glyph('2')])]), box(0, 200, 10, 202), 80) === false);
});

test('fraction bars written together nest by width, in any order', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const seq = [], bars = [box(90, 310, 260, 310), box(120, 215, 220, 215)];
    for (const k of order.map(i => i).sort((i, j) => bars[j].w - bars[i].w)) Ink.addFraction(seq, bars[k], 130, true, true);
    for (const [c, b] of [['1', box(161, 144, 170, 200)], ['2', box(150, 234, 186, 290)], ['4', box(160, 330, 192, 400)]]) Ink.insert(seq, g(c, b), 130);
    assert.equal(text(seq), '((1)/(2))/(4)');
  }
});

test('a symbol written after a typeset numerator extends it; an = after the fraction does not', () => {
  const seq = typeset([Ink.frac([Ink.glyph('1')], [Ink.glyph('5')])]), f = seq[0], n = f.num[0].box;
  Ink.insert(seq, g('4', box(f.bar.x1 + 4, n.y0, f.bar.x1 + 4 + n.w, n.y1)), 80);
  assert.equal(text(seq), '(14)/(5)');
  typeset(seq);
  const B = seq[0].bar, eq = box(B.x1 + 25, B.y - 12, B.x1 + 60, B.y + 10);
  Ink.insert(seq, g('=', eq), 80);
  assert.equal(text(seq), '(14)/(5)=');
});

test('a root over a fraction reaches down to its denominator; a bar under the whole root makes a fraction of it', () => {
  const r = Ink.root([Ink.frac([Ink.glyph('1')], [Ink.glyph('4')])], 0), seq = typeset([r]);
  assert.ok(r.tbot >= Ink.unionOf(r.body).y1, 'the sign stops above the denominator');
  assert.ok(r.box.y1 >= Ink.unionOf(r.body).y1);
  const line = typeset([Ink.root([Ink.glyph('9')], 0), Ink.glyph('+'), Ink.glyph('1')]), u = Ink.unionOf(line);
  Ink.addFraction(line, box(u.x0 - 5, u.y1 + 15, u.x1 + 5, u.y1 + 17), 80, false, false);
  assert.equal(text(line), '(√(9)+1)/()');
  assert.equal(seq.length, 1);
});

test('the multiplication-shaped glyph: × between factors, x where no factor can stand', () => {
  const T = cs => Ink.tokens(cs.map(c => typeof c === 'string' ? Ink.glyph(c) : c));
  assert.deepEqual(T(['2', '*', Ink.root([Ink.glyph('4')], 1)]), ['2', '*', '√', '(', '4', ')']);
  assert.deepEqual(T(['2', Ink.sup([Ink.glyph('2')]), '*', '3']), ['2', '^', '(', '2', ')', '*', '3']);
  assert.deepEqual(T([Ink.frac([Ink.glyph('1')], [Ink.glyph('2')]), '*', '3']), ['(', '(', '1', ')', '/', '(', '2', ')', ')', '*', '3']);
  assert.deepEqual(T(['2', '*', '=', '6']), ['2', 'x', '=', '6']);
  const seq = typeset([Ink.glyph('2'), Ink.glyph('*')]);
  assert.equal(Ink.face(seq[1]), 'x');
  assert.equal(text(seq), '2x');
  assert.equal(Ink.face(typeset([Ink.glyph('2'), Ink.glyph('*'), Ink.glyph('3')])[1]), '*');
});

test('letters: a written x is the unknown; runs of letters split into names, e and x', () => {
  const T = s => Ink.tokens([...s].map(c => Ink.glyph(c)));
  assert.deepEqual(T('2x+1'), ['2', 'x', '+', '1']);
  assert.deepEqual(T('sinx'), ['sin', 'x']);
  assert.deepEqual(T('xe'), ['x', 'e']);
  assert.deepEqual(T('2ex'), ['2', 'e', 'x']);
  assert.throws(() => T('xq'), /unknown word/);
});
