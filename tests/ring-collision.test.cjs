'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// The browser UMD model is a .js asset in this ESM repository. Evaluate its
// CommonJS branch without changing the source or depending on Node's ESM interop.
const modelPath = path.join(__dirname, '../public/ring-collision/model.js');
const context = { module: { exports: {} }, RangeError, TypeError };
vm.runInNewContext(fs.readFileSync(modelPath, 'utf8'), context, { filename: modelPath });
const Model = context.module.exports;

let checks = 0;
function close(actual, expected, label, tolerance = 2e-10) {
  checks += 1;
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale,
    `${label}: ${actual} != ${expected}`);
}
function nextDown(value) {
  const values = new Float64Array([value]);
  const bits = new BigUint64Array(values.buffer);
  bits[0] -= 1n;
  return values[0];
}

// This recurrence uses the independently solved 1D collision equations,
// not the power formula used to build the model.
function independent(params) {
  const { mA: a, mB: b, R, v0, e, n } = params;
  const L = 2 * Math.PI * R;
  let va = v0, vb = 0, time = 0, sA = 0, sB = 0;
  const rows = [];
  for (let index = 1; index <= 2 * n + 1; index += 1) {
    const postA = ((a - e * b) * va + (1 + e) * b * vb) / (a + b);
    const postB = ((b - e * a) * vb + (1 + e) * a * va) / (a + b);
    rows.push({ index, time, sA, sB, vA: postA, vB: postB });
    va = postA; vb = postB;
    if (index <= 2 * n) {
      const duration = L / Math.abs(vb - va);
      time += duration;
      sA += va * duration;
      sB += vb * duration;
    }
  }
  return rows;
}

for (const mA of [1.1, 2, 5]) {
  for (const e of [0.4, 0.5, 0.9, 1]) {
    for (const n of [1, 2, 3]) {
      const model = Model.build({ mA, mB: 1, R: 1.3, v0: 3.2, e, n });
      const rows = independent(model.params);
      for (const [i, event] of model.events.entries()) {
        const row = rows[i];
        for (const key of ['time', 'sA', 'sB', 'vA', 'vB']) {
          close(event[key], row[key], `recurrence ${mA}/${e}/${n} ${i}.${key}`, 5e-9);
        }
        close(mA * event.vA + event.vB, mA * model.params.v0, 'tangential scalar');
        close(event.vB - event.vA,
          -e * (event.preVB - event.preVA), 'relative restitution');
        const post = Model.stateAt(model, event.time);
        assert.equal(post.collisionIndex, event.index);
        close(post.xA, post.xB, 'collision positions x');
        close(post.yA, post.yB, 'collision positions y');
        close(post.Q, model.V * event.time, 'weighted arc coordinate');
        const pre = Model.beforeState(model, event.index);
        close(pre.vA, event.preVA, 'beforeState A');
        close(pre.vB, event.preVB, 'beforeState B');
        close(pre.vCx, post.vCx, 'COM collision velocity x');
        close(pre.vCy, post.vCy, 'COM collision velocity y');
        if (i) {
          const justBefore = Model.stateAt(model, nextDown(event.time));
          assert.equal(justBefore.collisionIndex, event.index - 1,
            'the preceding float must not snap across a collision');
        }
      }
      for (const segment of model.segments) {
        const t = segment.startTime + segment.duration * 0.371;
        const state = Model.stateAt(model, t);
        close(state.sA, segment.sA0 + segment.vA * (t - segment.startTime), 'linear A');
        close(state.sB, segment.sB0 + segment.vB * (t - segment.startTime), 'linear B');
        close(state.Q, model.V * t, 'Q is linear');
        close(state.xC, (mA * state.xA + state.xB) / model.M, 'true C x');
        close(state.yC, (mA * state.yA + state.yB) / model.M, 'true C y');
        assert.ok(Math.hypot(state.xC, state.yC) <= model.params.R * (1 + 1e-12));
        assert.ok(state.gap >= 0 && state.gap <= model.L);
      }
      const end = Model.stateAt(model, model.totalTime);
      close(end.sA, end.sB, 'odd endpoint equal distances');
      close(end.sB, model.V * model.totalTime, 'endpoint center method');
      assert.equal(end.segmentIndex, null);
      assert.equal(end.nextEventIndex, null);
      assert.equal(end.finished, true);
    }
  }
}

const teaching = Model.build();
close(teaching.totalTime, 6 * teaching.L / teaching.params.v0, 'default total time');
close(teaching.events[1].sA, teaching.L, 'default second A');
close(teaching.events[1].sB, 2 * teaching.L, 'default second B');
close(teaching.events[2].sA, 4 * teaching.L, 'default third A');
close(teaching.events[2].sB, 4 * teaching.L, 'default third B');
const interior = Model.stateAt(teaching, teaching.segments[0].duration / 2);
assert.ok(Math.abs(interior.speedC - teaching.V) > 0.1,
  'true center speed must vary while Q speed remains constant');
close(interior.V, teaching.V, 'constant Q speed');

// Speed adjustment rescales time but preserves paths at equal progress.
const faster = Model.build({ v0: 6 });
close(faster.totalTime, teaching.totalTime / 2, 'v0 time scaling');
for (const fraction of [0, 0.17, 0.4, 0.87, 1]) {
  const a = Model.stateAt(teaching, teaching.totalTime * fraction);
  const b = Model.stateAt(faster, faster.totalTime * fraction);
  close(a.sA, b.sA, 'v0 invariant A path');
  close(a.sB, b.sB, 'v0 invariant B path');
  close(2 * a.vA, b.vA, 'v0 scales A speed');
  close(2 * a.vB, b.vB, 'v0 scales B speed');
}

// Elastic comparison: the two allowed ratios visit the expected three points.
for (const [mA, cycle] of [[2, [0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 0]],
  [5, [0, 2 / 3, 2 / 3, 1 / 3, 1 / 3, 0]]]) {
  const model = Model.build({ mA, e: 1, n: 3 });
  model.events.slice(0, 6).forEach((event, i) => {
    close(Math.cos(event.theta), Math.cos(2 * Math.PI * cycle[i]), 'elastic point x');
    close(Math.sin(event.theta), Math.sin(2 * Math.PI * cycle[i]), 'elastic point y');
  });
}

// Long, slowly converging speed differences remain finite and bounded in arc gap.
const long = Model.build({ e: 0.2, n: 8 });
const last = Model.stateAt(long, long.totalTime);
assert.ok(Number.isFinite(last.sB) && Number.isFinite(last.xC));
close(last.sB, long.L * 2 / 3 * (1 - 0.2 ** 16) / (0.2 ** 16 * 0.8), 'long endpoint sum');
for (const segment of long.segments) {
  const state = Model.stateAt(long, segment.startTime + segment.duration * 0.5);
  close(state.gap, long.L / 2, 'long relative arc bounded', 2e-8);
}

assert.equal(Model.stateAt(teaching, -100).time, 0);
assert.equal(Model.stateAt(teaching, Infinity).time, teaching.totalTime);
assert.equal(Model.stateAt(teaching, -Infinity).time, 0);
assert.throws(() => Model.stateAt(teaching, NaN), RangeError);
for (const invalid of [{ mA: 1 }, { mB: 0 }, { R: -1 }, { v0: 0 },
  { e: 0 }, { e: 1.01 }, { n: 0 }, { n: 41 }, { n: 1.5 }, { mA: Infinity }, { v0: '3' }]) {
  assert.throws(() => Model.build(invalid), RangeError);
}
assert.throws(() => Model.beforeState(teaching, 0), RangeError);
assert.throws(() => Model.beforeState(teaching, 4), RangeError);

// At 40 pairs the absolute lap count is far beyond the integer precision of
// a double. These expected phases follow independently from integer powers
// of five: Q/ℓ=(5^k-5)/6 at event k (mA:mB=2:1, e=1/5).
const forty = Model.build({ e: 0.2, n: 40 });
assert.equal(forty.events.length, 81);
assert.equal(forty.segments.length, 80);
assert.ok(Number.isFinite(forty.totalTime));
for (const event of forty.events) {
  close(event.theta, 0, '40-pair collision phase');
  close(event.thetaQ, event.index % 2 ? 0 : 2 * Math.PI / 3, '40-pair Q collision phase');
}
for (const offset of [0, 1, 38, 39, 78, 79]) {
  const middle = Model.stateInSegment(forty, offset, 0.5);
  close(middle.thetaA, Math.PI, 'huge-lap A midpoint');
  close(middle.thetaB, 0, 'huge-lap B midpoint');
  close(middle.thetaQ, 4 * Math.PI / 3, 'huge-lap auxiliary midpoint');
  close(middle.gap, forty.L / 2, 'local fraction preserves small arc gap');
  close(Math.hypot(middle.vQx, middle.vQy), forty.V, 'auxiliary speed is V');
  assert.equal(middle.segmentOffset, offset);
  assert.equal(middle.segmentFraction, 0.5);
  assert.equal(middle.relativeSpeed, forty.segments[offset].relativeSpeed);
  const first = Model.stateInSegment(forty, offset, 0);
  const after = Model.stateInSegment(forty, offset, 1);
  assert.equal(first.collisionIndex, offset + 1);
  assert.equal(after.collisionIndex, offset + 2);
  assert.equal(after.atCollision, true);
}
const nearEnd = Model.stateInSegment(forty, 79, 0.5);
assert.equal(nearEnd.vB - nearEnd.vA, 0, 'displayed double speeds eventually coincide');
assert.ok(nearEnd.relativeSpeed < 0, 'analytic speed difference remains nonzero');
assert.ok(nearEnd.segmentTurnsQ > 1e50, 'compressed playback must flag skipped revolutions');
assert.ok(Model.stateInSegment(forty, 79, 1).finished);

// The local API agrees with ordinary physical-time sampling where time is
// well resolved, and handles the elastic limit through the full 81st event.
for (const segment of teaching.segments) {
  const local = Model.stateInSegment(teaching, segment.index - 1, 0.371);
  const timed = Model.stateAt(teaching, segment.startTime + segment.duration * 0.371);
  for (const key of ['sA', 'sB', 'Q', 'xA', 'yA', 'xB', 'yB', 'xQ', 'yQ']) {
    close(local[key], timed[key], 'local API ' + key);
  }
}
const elasticForty = Model.build({ e: 1, n: 40 });
close(elasticForty.totalTime, 80 * elasticForty.L / 3, 'elastic 40-pair duration');
for (const bad of [-1, 80, 1.2]) assert.throws(() => Model.stateInSegment(forty, bad, 0.5), RangeError);
for (const bad of [-0.1, 1.1, NaN, Infinity, '0.5']) assert.throws(() => Model.stateInSegment(forty, 0, bad), RangeError);

// Independent closed geometric sum, using integer arithmetic rather than the
// model's event-by-event rational recurrence. Non-integer inverse restitution
// ratios prevent the all-collisions-at-zero special case from hiding errors.
function plusFraction(a, b) { return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]]; }
function phaseFraction([numerator, denominator]) {
  const remainder = (numerator % denominator + denominator) % denominator;
  return 2 * Math.PI * (Number(remainder) / Number(denominator));
}
function independentPhases(mA, mB, eNumerator, eDenominator, k, fractionNumerator, fractionDenominator) {
  const a = BigInt(mA), b = BigInt(mB), M = a + b;
  const en = BigInt(eNumerator), ed = BigInt(eDenominator), exponent = BigInt(k - 1);
  const qStart = en === ed ? [a * exponent, M]
    : [a * ed * (ed ** exponent - en ** exponent), M * (ed - en) * en ** exponent];
  const fn = BigInt(fractionNumerator), fd = BigInt(fractionDenominator);
  const qAdvance = [a * ed ** BigInt(k) * fn, M * en ** BigInt(k) * fd];
  const q = plusFraction(qStart, qAdvance);
  const gap = [k % 2 ? fn : fd - fn, fd];
  return {
    thetaA: phaseFraction(plusFraction(q, [-b * gap[0], M * gap[1]])),
    thetaB: phaseFraction(plusFraction(q, [a * gap[0], M * gap[1]])),
    thetaQ: phaseFraction(q),
  };
}
for (const [en, ed] of [[1, 5], [2, 5], [7, 10], [9, 10], [1, 1]]) {
  for (const mA of [2, 5]) {
    const model = Model.build({ mA, mB: 1, e: en / ed, n: 40 });
    assert.equal(model.targetCollision, 81);
    assert.ok(Number.isFinite(model.totalTime));
    for (const event of model.events) {
      assert.ok(event.vA >= 0 && event.vB >= 0);
      close(mA * event.vA + event.vB, mA * model.params.v0, '81-event angular momentum');
      const expected = independentPhases(mA, 1, en, ed, event.index, 0, 1);
      close(Math.cos(event.theta), Math.cos(expected.thetaA), '81-event independent collision cos');
      close(Math.sin(event.theta), Math.sin(expected.thetaA), '81-event independent collision sin');
      close(Math.cos(event.thetaQ), Math.cos(expected.thetaQ), '81-event independent auxiliary cos');
      close(Math.sin(event.thetaQ), Math.sin(expected.thetaQ), '81-event independent auxiliary sin');
      if (event.time > 0) {
        const previousFloat = Model.stateAt(model, nextDown(event.time));
        assert.equal(previousFloat.collisionIndex, event.index - 1);
        assert.equal(previousFloat.atCollision, false);
      }
    }
    for (const offset of [0, 18, 39, 60, 79]) {
      for (const [fn, fd] of [[1, 8], [371, 1000], [9, 10]]) {
        const state = Model.stateInSegment(model, offset, fn / fd);
        const expected = independentPhases(mA, 1, en, ed, offset + 1, fn, fd);
        for (const key of ['thetaA', 'thetaB', 'thetaQ']) {
          close(Math.cos(state[key]), Math.cos(expected[key]), 'huge-time independent cosine ' + key);
          close(Math.sin(state[key]), Math.sin(expected[key]), 'huge-time independent sine ' + key);
        }
        close(state.gap, model.L * ((offset + 1) % 2 ? fn / fd : 1 - fn / fd), 'huge-time bounded gap');
        close(Math.hypot(state.vQx, state.vQy), model.V, 'auxiliary speed independent of huge elapsed time');
        assert.ok(state.gap >= 0 && state.gap <= model.L);
      }
    }
  }
}

// Collision energy decreases by the standard reduced-mass loss. Keep these
// cases before double velocities become indistinguishable; the long-range
// analytic relativeSpeed invariant above covers that separate precision limit.
for (const e of [.2, .5, .9, 1]) {
  const model = Model.build({ mA: 3, mB: 1, e, n: 3 });
  for (const event of model.events) {
    const before = .5 * (3 * event.preVA ** 2 + event.preVB ** 2);
    const after = .5 * (3 * event.vA ** 2 + event.vB ** 2);
    const reducedMass = 3 / 4;
    const expectedLoss = .5 * reducedMass * (1 - e * e) * (event.preVA - event.preVB) ** 2;
    close(before - after, expectedLoss, 'inelastic collision energy loss', 1e-11);
    assert.ok(after <= before + 1e-12 * Math.max(1, before));
  }
}

// A finite result must not overflow merely because multiplication precedes
// division. Truly unrepresentable post-collision speeds still fail explicitly.
for (const options of [{ v0: 1e308 }, { mA: 1e308, mB: 5e307 }]) {
  const large = Model.build(options);
  for (const event of large.events) {
    assert.ok(Number.isFinite(event.vA) && Number.isFinite(event.vB));
    close(event.vA / large.params.v0,
      (large.params.mA / large.M) + (large.params.mB / large.M) * (event.index % 2 ? -1 : 1) * large.params.e ** event.index,
      'finite velocity under large parameter scales');
  }
}
assert.throws(() => Model.build({ v0: Number.MAX_VALUE, e: 1 }), RangeError);
console.log(`Model tests passed: ${checks} numerical comparisons, 36 base parameter combinations, 10 full 81-event cases, independent phase/energy/boundary checks.`);
