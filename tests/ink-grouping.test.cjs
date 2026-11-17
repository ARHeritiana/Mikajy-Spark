'use strict';
// Grouping strokes into symbols must not depend on the order the strokes were drawn in (web/recognizer.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../web/recognizer.js');

const dash = (x, y, w = 36) => [[x, y], [x + w / 2, y], [x + w, y]];
const stem = (x, y, h = 40) => [[x, y], [x, y + h / 2], [x, y + h]];
const dot = (x, y) => [[x, y], [x + 2, y + 2]];
const sets = G => G.map(g => g.s);

test('the two bars of = form one symbol even when another character is drawn between them', () => {
  const first = dash(20, 50), other = stem(160, 35), later = dash(20, 62);
  const G = R.groupStrokes([first, other, later]);
  assert.equal(G.length, 2);
  assert.deepEqual(sets(G), [[first, later], [other]]);
});

test('2 = 3 written bar, digit, bar, digit groups the same as in drawing order', () => {
  const two = stem(0, 40), top = dash(30, 55), three = stem(100, 40), bottom = dash(30, 67);
  const G = R.groupStrokes([two, top, three, bottom]);
  assert.deepEqual(sets(G), [[two], [top, bottom], [three]]);
});

test('a plus and a dotted i group whatever the stroke order', () => {
  const across = dash(20, 75), down = stem(38, 55), i = stem(120, 50), point = dot(119, 38);
  for (const order of [[point, across, i, down], [down, i, across, point], [i, point, down, across]]) {
    const G = R.groupStrokes(order);
    assert.equal(G.length, 2, `order ${order.indexOf(point)}`);
    assert.ok(G.every(g => g.s.length === 2));
  }
});

test('the dots of ÷ join their bar, including when the bar is drawn last', () => {
  const bar = dash(10, 55, 40), above = dot(29, 42), below = dot(29, 68);
  for (const order of [[above, below, bar], [bar, above, below], [above, bar, below]]) {
    const G = R.groupStrokes(order);
    assert.equal(G.length, 1);
    assert.equal(G[0].s.length, 3);
  }
});

test('separate characters stay separate, and each symbol keeps its strokes in drawing order', () => {
  const left = stem(12, 40), right = stem(152, 40), middle = stem(85, 40);
  assert.deepEqual(sets(R.groupStrokes([left, right, middle])), [[left], [right], [middle]]);
  const a = dash(20, 50), b = dash(20, 62);
  assert.deepEqual(sets(R.groupStrokes([b, a])), [[b, a]]);
});

test('a radicand that only sits next to a root sign is not merged into it', () => {
  const sign = [[0, 60], [10, 55], [25, 100], [45, 20]];
  sign.vin = {x0: 45, x1: 140};
  const four = stem(70, 40, 50);
  assert.equal(R.groupStrokes([sign, four]).length, 2);
  assert.equal(R.groupStrokes([four, sign]).length, 2);
});

test('the tiny flag is computed for the whole symbol', () => {
  const G = R.groupStrokes([stem(0, 0, 80), dot(200, 40)]);
  assert.deepEqual(G.map(g => g.tiny), [false, true]);
});

/* ---- Cursive x: two arcs back to back -------------------------------------------------------------------------- */
/** An arc from top to bottom bulging right (")", side 1) or left ("(", side -1), centred on (cx, cy). */
const arc = (cx, cy, rx, ry, side, n = 16) => Array.from({length: n + 1}, (_, k) => {
  const t = -Math.PI / 2 + Math.PI * k / n;
  return [cx + side * rx * Math.cos(t), cy + ry * Math.sin(t)];
});

test('a cursive x written as )( is one symbol, in either stroke order', () => {
  const left = arc(100, 100, 30, 36, 1), right = arc(160, 100, 30, 36, -1);
  assert.equal(R.arcSide(left), 'r');
  assert.equal(R.arcSide(right), 'l');
  assert.equal(R.cursiveX(left, right), true);
  for (const S of [[left, right], [right, left]]) {
    const G = R.groupStrokes(S);
    assert.equal(G.length, 1);
    assert.equal(G[0].x, true);
  }
});

test('tall thin brackets )( are not an x, and neither are arcs facing away from each other', () => {
  const close = arc(100, 100, 12, 50, 1), open = arc(130, 100, 12, 50, -1);
  assert.equal(R.cursiveX(close, open), false);
  assert.equal(R.cursiveX(arc(130, 100, 30, 36, 1), arc(100, 100, 30, 36, -1)), false);   // ( ) the other way round
  assert.equal(R.cursiveX(arc(100, 100, 30, 36, 1), arc(260, 100, 30, 36, -1)), false);  // far apart
});

test('symbols stacked in one column stay apart; a tall stroke that only starts near a stem is the next symbol', () => {
  const top = stem(100, 0, 45), below = stem(102, 90, 45);
  assert.equal(R.groupStrokes([top, below]).length, 2);
  const two = [[100, 0], [160, 0], [100, 100], [160, 100]], next = arc(180, 60, 14, 38, 1);   // a 2, then a ) of a cursive x
  next[0] = [166, 22];   // that starts right against the 2
  assert.equal(R.groupStrokes([two, next]).length, 2);
});
