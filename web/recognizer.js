/* Mikajy recogniser heuristics: everything that turns raw per-glyph guesses into mathematics.
 * Pure functions on plain objects; no DOM, canvas or storage, so they can be tested in Node.
 *
 * A glyph `g` is {c: [{c, p}, ...] (candidates, best first), i: chosen index, b: bbox {x0,y0,x1,y1,w,h},
 *                 locked?: true when the user picked it by tapping}.
 * Screen coordinates: y grows downwards.
 */
const Recognizer = (() => {
  'use strict';
  const ch = g => g.c[g.i].c;
  const isLetter = c => /^[a-z]$/.test(c);

  /* ---- Glyph metrics (shared with ink.js) ----------------------------------------------------
   * HR: height of the glyph relative to its font size; letters without ascenders are "x-height". DS: descent below the line. */
  const HR = {'(': .88, ')': .88, a: .38, c: .38, e: .38, n: .34, o: .37, s: .43, g: .6, l: .67, i: .53, t: .56, 'π': .4, '!': .6,
    x: .38, p: .6, q: .6, r: .34, u: .34};
  const DS = {g: .2, p: .2, q: .2, '(': .13, ')': .13};

  /* ---- Function words ------------------------------------------------------------------------
   * Letters the CNN knows: a c e g i l n o s t h b. Letters it does not know (x p q r u) are matched
   * through look-alikes; in "exp" the x is the multiplication-shaped glyph. */
  const WORDS = ['sinh', 'cosh', 'tanh', 'asin', 'acos', 'atan', 'sqrt', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'exp', 'log', 'ln', 'abs'];
  const KNOWN = new Set('acegilnostbh'.split(''));
  const LOOKALIKE = {
    s: ['5', '$'], i: ['1', 'l', '!', '7'], l: ['1', 'i', '!', '/'], n: ['h', 'm'], o: ['0', 'a', 'c'], a: ['o', '9', 'g'],
    c: ['e', '(', 'o'], t: ['+', 'f'], e: ['c', 'o', 'a'], g: ['9'], h: ['n', 'b', '4'], b: ['6', 'h'],
    x: ['*'], p: ['g', '9', 'o'], q: ['g', '9'], r: ['n', 'i', '1', 's'], u: ['n', 'o', 'a']
  };
  const FUZZY_P = .25;   // weight of a look-alike reading relative to its own probability

  /** Probability that glyph `g` is the letter `ltr`, and whether it was a look-alike reading. */
  function letterScore(g, ltr) {
    const direct = g.c.find(o => o.c === ltr && o.p > .002);
    if (direct) return {p: direct.p, fuzzy: false};
    let best = 0;
    for (const alt of LOOKALIKE[ltr] || []) {
      const o = g.c.find(q => q.c === alt && q.p > .03);
      if (o && o.p > best) best = o.p;
    }
    // Letters outside the model's classes can only ever be read as look-alikes, so that is not "fuzzy".
    return best ? {p: best * FUZZY_P, fuzzy: KNOWN.has(ltr)} : null;
  }

  /** Re-reads runs of glyphs as function names (sin, cos, ln, exp...) when the candidates allow it. */
  function wordfix(A) {
    const n = A.length, used = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      let best = null;
      // A 0 after digits continues the number (320 × ..., not 32·exp): it does not start a word as an o, c or e.
      if (i > 0 && A[i - 1].b && /[0-9]/.test(ch(A[i - 1])) && A[i].c[0].c === '0' && A[i].c[0].p >= .3) continue;
      for (const w of WORDS) {
        if (i + w.length > n) continue;
        let score = 1, fuzzy = 0, ok = true;
        const budget = w.length >= 4 ? 1 : w.length === 3 ? 1 : 0;
        for (let j = 0; j < w.length; j++) {
          const g = A[i + j];
          if (g.locked || used[i + j]) { ok = false; break; }
          const s = letterScore(g, w[j]);
          const top = g.c[0];
          // A confidently read digit/operator is not part of a word (the x of "exp" is the one exception).
          if (!s || (top.p > .9 && top.c !== w[j] && !isLetter(top.c) && !(w[j] === 'x' && top.c === '*'))) { ok = false; break; }
          score *= s.p;
          if (s.fuzzy && ++fuzzy > budget) { ok = false; break; }
        }
        if (ok && (!best || w.length > best.w.length || (w.length === best.w.length && score > best.score))) best = {w, score};
      }
      if (best && best.score > 1e-6) {
        for (let j = 0; j < best.w.length; j++) {
          const g = A[i + j], ltr = best.w[j];
          let k = g.c.findIndex(o => o.c === ltr);
          if (k < 0) { g.c.push({c: ltr, p: Math.max(.002, letterScore(g, ltr).p)}); k = g.c.length - 1; }
          g.i = k; g.word = true; used[i + j] = true;
        }
        i += best.w.length - 1;
      }
    }
    // Lone letters: the only letter that means something on its own is the constant e.
    A.forEach((g, k) => {
      if (used[k] || g.locked || !g.b) return;
      const c = ch(g);
      if (!isLetter(c) || c === 'x') return;   // x stands on its own: it is the unknown
      const e = g.c.find(o => o.c === 'e');
      if (c !== 'e' && e && e.p >= .12 && e.p >= .25 * g.c[g.i].p) { g.i = g.c.indexOf(e); return; }   // cursive e read as c / o
      if (c === 'e' && g.c[g.i].p > .5) return;
      const j = g.c.findIndex(o => !isLetter(o.c) && o.p > .01);
      if (j >= 0) g.i = j;
    });
    // The base of an exponent is a number, a bracket or a constant: a lone o/c/a there is a cursive e.
    A.forEach((g, k) => {
      if (g.locked || !g.b || g.word || !A[k + 1] || !A[k + 1].sup || g.sup) return;
      const e = g.c.find(o => o.c === 'e');
      if ('coa'.includes(ch(g)) && e && e.p > .02) g.i = g.c.indexOf(e);
    });
  }

  /* ---- Cursive: splitting one connected stroke into letters ---------------------------------- */
  /** Points spaced `step` apart along the polyline. */
  function resample(s, step) {
    const o = [s[0]];
    let acc = 0, a = s[0];
    for (let i = 1; i < s.length; i++) {
      const b = s[i];
      let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + d >= step) {
        const t = (step - acc) / d;
        a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        o.push(a);
        d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc = 0;
      }
      acc += d; a = b;
    }
    return o;
  }
  const extent = s => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of s) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return {x0, y0, x1, y1, w: x1 - x0, h: y1 - y0};
  };

  /**
   * Indices (into `s`) where a cursive stroke plausibly passes from one letter to the next: the pen is
   * at its lowest (the writing line) while travelling to the right. Returns [] for strokes that are
   * not wide enough to hold several letters.
   */
  function ligatureCuts(s) {
    if (s.vin || s.length < 12) return [];
    const b = extent(s);
    if (b.h < 18 || b.w < 1.5 * b.h) return [];
    const p = resample(s, 3);
    if (p.length < 12) return [];
    const win = Math.max(3, Math.round(.1 * b.w / 3)), cuts = [];
    for (let i = win; i < p.length - win; i++) {
      const y = p[i][1];
      if (y < b.y0 + .6 * b.h) continue;                                    // only near the writing line
      let valley = true;
      for (let j = i - win; j <= i + win && valley; j++) if (p[j][1] > y + .001 && j !== i) valley = false;
      if (!valley || p[i + win][0] - p[i - win][0] < .04 * b.w) continue;    // travelling rightwards
      if (p[i][0] < b.x0 + .2 * b.h || p[i][0] > b.x1 - .2 * b.h) continue;  // not at the very ends
      const last = cuts[cuts.length - 1];
      if (last && p[i][0] - last.x < .35 * b.h) { if (y > last.y) { last.x = p[i][0]; last.y = y; last.p = i; } continue; }
      cuts.push({x: p[i][0], y, p: i});
    }
    // Map resampled positions back to the original points by x/y proximity.
    return cuts.slice(0, 6).map(c => {
      let best = 0, bd = Infinity;
      for (let k = 0; k < s.length; k++) { const d = Math.hypot(s[k][0] - p[c.p][0], s[k][1] - p[c.p][1]); if (d < bd) { bd = d; best = k; } }
      return best;
    }).filter((k, i, a) => k > 2 && k < s.length - 3 && (i === 0 || k > a[i - 1] + 2));
  }

  /** Pieces of `s` cut at the given point indices (neighbouring pieces share their joint point). */
  function cutAt(s, cuts) {
    const out = [];
    let from = 0;
    for (const k of cuts) { out.push(s.slice(from, k + 1)); from = k; }
    out.push(s.slice(from));
    return out;
  }

  const WORD_BONUS = Math.log(12), SPLIT_PENALTY = Math.log(.6), SPLIT_MARGIN = .7;
  const WORD_SET = new Set(WORDS);
  /** True when the top-3 readings of consecutive pieces can spell a known function word. */
  function spellsWord(pieces) {
    const spell = (k, acc) => k === pieces.length ? WORD_SET.has(acc) :
      pieces[k].cands.slice(0, 3).some(o => spell(k + 1, acc + o.c));
    return pieces.length >= 2 && spell(0, '');
  }
  /** Subsets of cut positions, smallest first. */
  function* subsets(n) { for (let m = 0; m < 1 << n; m++) yield [...Array(n).keys()].filter(i => m >> i & 1); }

  /**
   * Decides whether a connected stroke is one symbol or several joined letters/digits.
   * `classify(strokes)` resolves to the candidate list [{c, p}] (best first) for those strokes drawn as one glyph.
   * Every segmentation into pieces is scored by the recogniser's own confidence in each piece, with a
   * prior against splitting, a penalty for slivers and a bonus when the pieces spell a function word.
   * Resolves to an array of strokes (the original, when splitting is not clearly better).
   */
  async function segmentStroke(s, classify) {
    const cuts = ligatureCuts(s);
    if (!cuts.length) return [s];
    const cache = new Map();
    const read = async (a, z) => {                       // piece between cut slots a..z (-1 = start, cuts.length = end)
      const key = a + ':' + z;
      if (!cache.has(key)) {
        const from = a < 0 ? 0 : cuts[a], to = z >= cuts.length ? s.length - 1 : cuts[z];
        const piece = s.slice(from, to + 1), e = extent(piece);
        const cands = piece.length < 4 ? [{c: '.', p: 1e-3}] : await classify([piece]);
        cache.set(key, {piece, cands, w: e.w, h: e.h, score: Math.log(Math.max(1e-4, cands[0].p))});
      }
      return cache.get(key);
    };
    const whole = await read(-1, cuts.length);
    const full = extent(s);
    let best = {score: whole.score, pieces: [whole]};
    const baseline = whole.score;
    for (const pick of subsets(cuts.length)) {
      if (!pick.length) continue;
      const slots = [-1, ...pick, cuts.length], pieces = [];
      let score = 0;
      for (let k = 0; k + 1 < slots.length; k++) {
        const r = await read(slots[k], slots[k + 1]);
        // Slivers (cut inside a letter) and still-wide pieces are unlikely letters.
        const sliver = r.w < .22 * full.h || r.h < .25 * full.h;
        score += r.score + (sliver ? Math.log(.2) : 0) + (r.w > 1.6 * full.h ? Math.log(.5) : 0);
        pieces.push(r);
      }
      score += pick.length * SPLIT_PENALTY + (spellsWord(pieces) ? WORD_BONUS : 0);
      if (score > best.score + (best.pieces.length === 1 ? SPLIT_MARGIN : 0)) best = {score, pieces};
    }
    if (best.pieces.length === 1 || best.score < baseline + SPLIT_MARGIN) return [s];
    return best.pieces.map(r => r.piece);
  }

  /* ---- Grouping strokes into symbols -----------------------------------------------------------
   * Which strokes of one zone (the line, a numerator, a denominator, an exponent) form one symbol. The test
   * between two strokes is symmetric and every pair is compared, so the result does not depend on the order
   * the strokes were drawn in: the second bar of = may come after the 3 that follows it, the dot of an i
   * before its stem, the dots of ÷ before their bar. */
  /** Does stroke `s` (box `b`) belong with the stroke `qs` whose box is `q`? `vin` marks a root sign. */
  function partOf(s, b, q, qVin, ref, qs) {
    const tiny = b.w < .2 * ref && b.h < .2 * ref, qTiny = q.w < .2 * ref && q.h < .2 * ref;
    const bar = q.w > 2.5 * Math.max(q.h, 1), stem = q.h > 1.3 * q.w && q.h > 25;
    // The side margin scales with the other stroke, except for a tall thin one (a bracket, a 1) next to something much
    // shorter: there its height says nothing about how far its symbol reaches sideways ("(1" are two symbols).
    const m = qVin ? 0 : .18 * (stem && !tiny && q.h > 1.5 * b.h ? Math.max(q.w, b.w, 30) : Math.max(q.h, q.w, 30));
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const dotA = tiny && stem && cy < q.y0 && q.y0 - cy < .7 * q.h, dotB = tiny && stem && cy > q.y1 + .1 * q.h && cy - q.y1 < .6 * q.h;
    // A flag or bar drawn from a stem (the top of a 5) belongs to it: it starts where the stem's stroke ends. A stroke
    // that merely starts next to the stem is the next symbol (a cursive x after a 2, an × written tight against a 3,
    // the 1 after a tall "(").
    const p0 = s[0], r = .12 * q.h + 4;
    const touch = stem && !tiny && b.w > .2 * q.h && (b.h < .6 * q.h || cx <= q.x1 + .1 * q.h) &&
      p0[0] >= q.x0 - r && p0[0] <= q.x1 + r && p0[1] >= q.y0 - r && p0[1] <= q.y1 + r &&
      (!qs || [qs[0], qs[qs.length - 1]].some(p => Math.abs(p[0] - p0[0]) < r && Math.abs(p[1] - p0[1]) < r));
    // Same column is not enough: two symbols stacked one above the other (in nested fractions) stay apart. The
    // bars of = may be far apart for their (zero) height, but not for their width.
    const gap = Math.max(0, b.y0 - q.y1, q.y0 - b.y1), close = gap < Math.max(.5 * Math.max(b.h, q.h), .8 * Math.max(b.w, q.w));
    return touch || (cx >= q.x0 - m && cx <= q.x1 + m && (tiny ? bar || qTiny || dotA || dotB : close));
  }
  /** Groups strokes into symbols: [{s: strokes in drawing order, b: box, tiny, x}], in the order of each symbol's first
   *  stroke. `x` marks a cursive x written as two arcs back to back. */
  function groupStrokes(S) {
    const bs = S.map(extent), ref = Math.max(40, ...bs.map(b => Math.max(b.w, b.h)));
    const up = S.map((_, i) => i), root = i => { while (up[i] !== i) i = up[i] = up[up[i]]; return i; };
    for (let i = 0; i < S.length; i++)
      for (let j = 0; j < i; j++)
        if (partOf(S[i], bs[i], bs[j], !!S[j].vin, ref, S[j]) || partOf(S[j], bs[j], bs[i], !!S[i].vin, ref, S[i]) || cursiveX(S[i], S[j]))
          up[root(i)] = root(j);
    const G = new Map();
    S.forEach((s, i) => { const k = root(i); if (!G.has(k)) G.set(k, []); G.get(k).push(i); });
    return [...G.values()].map(ix => {
      const b = extent(ix.flatMap(i => [[bs[i].x0, bs[i].y0], [bs[i].x1, bs[i].y1]]));
      return {s: ix.map(i => S[i]), b, tiny: b.w < .2 * ref && b.h < .2 * ref, x: ix.length === 2 && cursiveX(S[ix[0]], S[ix[1]])};
    });
  }

  /* ---- Cursive x: two arcs back to back, )( ------------------------------------------------------
   * The model has no x class: a cursive x drawn in two strokes is read as ")" and "(" unless the two are recognised
   * as one symbol. Closing-then-opening brackets ")(" are told apart by their shape: brackets are tall and thin and
   * the pair is much taller than wide; the arcs of an x are rounder and together roughly as wide as tall. */
  /** 'r' for an arc bulging to the right like ")", 'l' for one bulging left like "(", otherwise null. */
  function arcSide(s) {
    if (s.vin || s.length < 5) return null;
    const b = extent(s);
    if (b.h < 14 || b.w < .12 * b.h || b.w > 1.1 * b.h) return null;
    const a = s[0], z = s[s.length - 1];
    if (Math.abs(a[1] - z[1]) < .55 * b.h) return null;                        // runs from top to bottom (either way)
    let path = 0, iR = 0, iL = 0;
    for (let k = 1; k < s.length; k++) path += Math.abs(s[k][1] - s[k - 1][1]);
    if (path > 1.5 * b.h) return null;                                          // no loop, no zigzag
    s.forEach((p, k) => { if (p[0] > s[iR][0]) iR = k; if (p[0] < s[iL][0]) iL = k; });
    const mid = p => p[1] > b.y0 + .2 * b.h && p[1] < b.y1 - .2 * b.h, near = x => Math.abs(x) <= .45 * b.w;
    if (mid(s[iR]) && near(a[0] - b.x0) && near(z[0] - b.x0) && b.x1 - Math.max(a[0], z[0]) > .4 * b.w) return 'r';
    if (mid(s[iL]) && near(b.x1 - a[0]) && near(b.x1 - z[0]) && Math.min(a[0], z[0]) - b.x0 > .4 * b.w) return 'l';
    return null;
  }
  /** Are strokes `p` and `q` (in either order) the two arcs of a cursive x, ")" on the left touching "(" on the right? */
  function cursiveX(p, q) {
    let L = extent(p), R = extent(q);
    if ((L.x0 + L.x1) > (R.x0 + R.x1)) { [p, q] = [q, p]; [L, R] = [R, L]; }
    if (arcSide(p) !== 'r' || arcSide(q) !== 'l') return false;
    const h = Math.max(L.h, R.h), u = extent([[L.x0, L.y0], [L.x1, L.y1], [R.x0, R.y0], [R.x1, R.y1]]);
    const overlap = Math.min(L.y1, R.y1) - Math.max(L.y0, R.y0), gap = R.x0 - L.x1;
    return Math.min(L.h, R.h) > .55 * h && overlap > .6 * Math.min(L.h, R.h) && gap < .3 * h && gap > -.45 * h &&
      u.w >= .65 * u.h && Math.min(L.w / L.h, R.w / R.h) >= .22;
  }

  return Object.freeze({ch, HR, DS, WORDS, wordfix, resample, extent, ligatureCuts, cutAt, segmentStroke, groupStrokes, arcSide, cursiveX});
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Recognizer;
