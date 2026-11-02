(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RingCollisionModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TAU = 2 * Math.PI;
  var DEFAULTS = { mA: 2, mB: 1, R: 1, v0: 3, e: 0.5, n: 1 };
  // Exact lap fractions stay private so models remain JSON-serializable. With
  // e=.2, n=40 the path exceeds 10^55 laps; reducing a floating-point angle
  // after that multiplication cannot recover the point's position.
  var exactModels = new WeakMap();
  function gcd(a, b) { a = a < 0n ? -a : a; while (b) { var r = a % b; a = b; b = r; } return a; }
  function rational(n, d) {
    if (d < 0n) { n = -n; d = -d; }
    var g = gcd(n, d); return { n: n / g, d: d / g };
  }
  function decimal(value) {
    var parts = String(value).toLowerCase().split('e');
    var exponent = Number(parts[1] || 0);
    var dot = parts[0].indexOf('.');
    var places = dot < 0 ? 0 : parts[0].length - dot - 1;
    var digits = BigInt(parts[0].replace('.', ''));
    var scale = places - exponent;
    return scale >= 0 ? rational(digits, 10n ** BigInt(scale)) : rational(digits * 10n ** BigInt(-scale), 1n);
  }
  function add(a, b) { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
  function sub(a, b) { return rational(a.n * b.d - b.n * a.d, a.d * b.d); }
  function mul(a, b) { return rational(a.n * b.n, a.d * b.d); }
  function div(a, b) { return rational(a.n * b.d, a.d * b.n); }
  var ZERO = rational(0n, 1n), ONE = rational(1n, 1n);
  function ratioNumber(a) {
    if (!a.n) return 0;
    var sign = a.n < 0n ? -1 : 1;
    var ns = (a.n < 0n ? -a.n : a.n).toString(), ds = a.d.toString();
    var nl = Math.min(16, ns.length), dl = Math.min(16, ds.length);
    return sign * Number(ns.slice(0, nl)) / Number(ds.slice(0, dl)) * Math.pow(10, ns.length - nl - ds.length + dl);
  }
  function lapAngle(a) {
    var rem = a.n % a.d;
    if (rem < 0n) rem += a.d;
    return TAU * ratioNumber({ n: rem, d: a.d });
  }

  function positiveFinite(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(name + ' must be a positive finite number.');
    }
  }

  function angle(value) {
    var wrapped = value % TAU;
    return wrapped < 0 ? wrapped + TAU : wrapped;
  }

  function speeds(params, index, M, V) {
    var power = Math.pow(params.e, index);
    var signedPower = index % 2 ? -power : power;
    return {
      // These forms preserve nonnegative speeds near the elastic limit.
      vA: (params.mA + params.mB * signedPower) / M * params.v0,
      vB: V * (1 - signedPower),
      relativeSpeed: -signedPower * params.v0
    };
  }

  function build(options) {
    if (options !== undefined && (options === null || typeof options !== 'object')) {
      throw new TypeError('Simulation parameters must be an object.');
    }
    var p = Object.assign({}, DEFAULTS, options || {});
    ['mA', 'mB', 'R', 'v0', 'e'].forEach(function (key) {
      positiveFinite(p[key], key);
    });
    if (!(p.mA > p.mB)) throw new RangeError('The problem requires mA > mB.');
    if (p.e > 1) throw new RangeError('The restitution coefficient must satisfy 0 < e <= 1.');
    if (!Number.isInteger(p.n) || p.n < 1 || p.n > 40) {
      throw new RangeError('n must be an integer from 1 to 40.');
    }

    var M = p.mA + p.mB;
    var L = TAU * p.R;
    var V = p.mA / M * p.v0;
    if (!Number.isFinite(M) || !Number.isFinite(L) || !Number.isFinite(V) || V <= 0) {
      throw new RangeError('The parameter scale exceeds floating-point limits.');
    }

    var alpha = p.mA / M;
    var beta = p.mB / M;
    var targetCollision = 2 * p.n + 1;
    var events = [];
    var segments = [];
    var time = 0;
    var massA = decimal(p.mA), massB = decimal(p.mB);
    var exact = { alpha: div(massA, add(massA, massB)), beta: div(massB, add(massA, massB)), segments: [] };
    var inverseE = div(ONE, decimal(p.e)), inversePower = ONE, qLaps = ZERO;

    for (var index = 1; index <= targetCollision; index += 1) {
      var gap = index % 2 ? 0 : L;
      var Q = V * time;
      // Reset only the exact event gap, not the accumulated distance. This is
      // the analytic 0, L, 0, L ... endpoint invariant and avoids drift.
      var sA = Q - beta * gap;
      var sB = Q + alpha * gap;
      var post = speeds(p, index, M, V);
      if (!Number.isFinite(post.vA) || !Number.isFinite(post.vB) || !Number.isFinite(post.relativeSpeed)) {
        throw new RangeError('The collision speed exceeds floating-point limits.');
      }
      var pre = index === 1 ? { vA: p.v0, vB: 0 } : events[index - 2];
      var event = {
        index: index,
        time: time,
        sA: sA,
        sB: sB,
        vA: post.vA,
        vB: post.vB,
        preVA: pre.vA,
        preVB: pre.vB,
        theta: lapAngle(sub(qLaps, gap ? exact.beta : ZERO)),
        thetaQ: lapAngle(qLaps),
        gap: gap,
        Q: Q,
        relativeSpeed: post.relativeSpeed
      };
      events.push(event);

      if (index < targetCollision) {
        inversePower = mul(inversePower, inverseE);
        var qAdvance = mul(exact.alpha, inversePower);
        var duration = L / (Math.pow(p.e, index) * p.v0);
        var endTime = time + duration;
        if (!Number.isFinite(duration) || !Number.isFinite(endTime) || endTime <= time || !Number.isFinite(V * endTime)) {
          throw new RangeError('The requested collision range exceeds floating-point limits.');
        }
        segments.push({
          index: index,
          startTime: time,
          endTime: endTime,
          duration: duration,
          sA0: sA,
          sB0: sB,
          vA: post.vA,
          vB: post.vB,
          relativeSpeed: post.relativeSpeed,
          turnsQ: ratioNumber(qAdvance),
          startGap: gap,
          endGap: index % 2 ? L : 0
        });
        exact.segments.push({ qStart: qLaps, qAdvance: qAdvance, startGap: gap ? ONE : ZERO, direction: index % 2 ? ONE : rational(-1n, 1n) });
        qLaps = add(qLaps, qAdvance);
        time = endTime;
      }
    }

    var model = {
      params: p,
      M: M,
      L: L,
      V: V,
      targetCollision: targetCollision,
      totalTime: time,
      events: events,
      segments: segments
    };
    exactModels.set(model, exact);
    return model;
  }

  function requireModel(model) {
    if (!model || !Array.isArray(model.events) || !model.events.length || !model.params) {
      throw new TypeError('Expected a model returned by RingCollisionModel.build().');
    }
  }

  function findEvent(model, time) {
    // Last event whose time is <= t. Exact times select the post-collision
    // state. No epsilon is used: even the preceding representable float is
    // kept on the previous segment.
    var low = 0;
    var high = model.events.length - 1;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (model.events[mid].time <= time) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  function compose(model, time, collisionIndex, sA, sB, gap, vA, vB, geometry, before, relativeSpeed) {
    var p = model.params;
    var alpha = p.mA / model.M;
    var beta = p.mB / model.M;
    var thetaA = geometry.thetaA;
    // Use the bounded relative arc rather than subtracting two huge angles.
    // At a collision both points are assigned exactly the same direction.
    var thetaB = geometry.thetaB;
    var thetaQ = geometry.thetaQ;
    var xA = p.R * Math.cos(thetaA);
    var yA = p.R * Math.sin(thetaA);
    var xB = p.R * Math.cos(thetaB);
    var yB = p.R * Math.sin(thetaB);
    var vCx = alpha * (-vA * Math.sin(thetaA)) + beta * (-vB * Math.sin(thetaB));
    var vCy = alpha * (vA * Math.cos(thetaA)) + beta * (vB * Math.cos(thetaB));
    var terminal = collisionIndex === model.targetCollision && !before;
    return {
      time: time,
      collisionIndex: collisionIndex,
      segmentIndex: terminal ? null : Math.max(1, collisionIndex),
      sA: sA,
      sB: sB,
      vA: vA,
      vB: vB,
      relativeSpeed: relativeSpeed,
      Q: model.V * time,
      V: model.V,
      gap: gap,
      thetaA: thetaA,
      thetaB: thetaB,
      thetaQ: thetaQ,
      xA: xA,
      yA: yA,
      xB: xB,
      yB: yB,
      xQ: p.R * Math.cos(thetaQ),
      yQ: p.R * Math.sin(thetaQ),
      vQx: -model.V * Math.sin(thetaQ),
      vQy: model.V * Math.cos(thetaQ),
      xC: alpha * xA + beta * xB,
      yC: alpha * yA + beta * yB,
      vCx: vCx,
      vCy: vCy,
      speedC: Math.hypot(vCx, vCy),
      finished: terminal,
      nextEventIndex: terminal ? null : collisionIndex + 1,
      atCollision: geometry.atCollision,
      beforeCollision: !!before
    };
  }

  function eventState(model, event) {
    var s = compose(model, event.time, event.index, event.sA, event.sB, event.gap,
      event.vA, event.vB, { thetaA: event.theta, thetaB: event.theta, thetaQ: event.thetaQ, atCollision: true },
      false, event.relativeSpeed);
    s.segmentOffset = s.finished ? null : event.index - 1;
    s.segmentFraction = s.finished ? 1 : 0;
    s.segmentTurnsQ = s.finished ? 0 : model.segments[event.index - 1].turnsQ;
    return s;
  }

  function fractionState(model, offset, fraction, time) {
    var segment = model.segments[offset];
    var exact = exactModels.get(model), row = exact.segments[offset];
    var f = decimal(fraction);
    var q = add(row.qStart, mul(row.qAdvance, f));
    var g = add(row.startGap, mul(row.direction, f));
    var a = sub(q, mul(exact.beta, g));
    var b = add(q, mul(exact.alpha, g));
    var gap = model.L * (segment.startGap === 0 ? fraction : 1 - fraction);
    var Q = model.V * time;
    var s = compose(model, time, offset + 1, Q - model.params.mB / model.M * gap,
      Q + model.params.mA / model.M * gap, gap, segment.vA, segment.vB,
      { thetaA: lapAngle(a), thetaB: lapAngle(b), thetaQ: lapAngle(q), atCollision: false }, false, segment.relativeSpeed);
    s.segmentOffset = offset;
    s.segmentFraction = fraction;
    s.segmentTurnsQ = segment.turnsQ;
    return s;
  }

  // offset is the zero-based index in model.segments. Fraction is the local
  // elapsed-time ratio, not a fraction of the potentially enormous total time.
  // Its decimal representation is used as an exact rational for phase sampling.
  function stateInSegment(model, offset, fraction) {
    requireModel(model);
    if (!Number.isInteger(offset) || offset < 0 || offset >= model.segments.length) {
      throw new RangeError('offset must identify an existing segment.');
    }
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
      throw new RangeError('fraction must be a finite number from 0 to 1.');
    }
    if (fraction === 0) return eventState(model, model.events[offset]);
    if (fraction === 1) return eventState(model, model.events[offset + 1]);
    var segment = model.segments[offset];
    return fractionState(model, offset, fraction, segment.startTime + segment.duration * fraction);
  }

  function stateAt(model, requestedTime) {
    requireModel(model);
    var numericTime = Number(requestedTime);
    if (Number.isNaN(numericTime)) throw new RangeError('Time must be a number.');
    var time = Math.max(0, Math.min(model.totalTime, numericTime));
    var offset = findEvent(model, time);
    var event = model.events[offset];

    if (time === event.time) {
      return eventState(model, event);
    }

    var segment = model.segments[offset];
    var fraction = Math.max(0, Math.min(1, (time - segment.startTime) / segment.duration));
    // Keep the index chosen by findEvent: a preceding representable time must
    // never jump to the next collision solely because this division rounds up.
    return fractionState(model, offset, fraction, time);
  }

  function beforeState(model, eventIndex) {
    requireModel(model);
    if (!Number.isInteger(eventIndex) || eventIndex < 1 || eventIndex > model.targetCollision) {
      throw new RangeError('eventIndex must identify an existing collision.');
    }
    var event = model.events[eventIndex - 1];
    var state = compose(model, event.time, event.index - 1,
      event.sA, event.sB, event.gap, event.preVA, event.preVB,
      { thetaA: event.theta, thetaB: event.theta, thetaQ: event.thetaQ, atCollision: true }, true,
      event.index === 1 ? -model.params.v0 : model.events[event.index - 2].relativeSpeed);
    state.segmentIndex = event.index === 1 ? null : event.index - 1;
    state.segmentOffset = event.index === 1 ? null : event.index - 2;
    state.segmentFraction = event.index === 1 ? 0 : 1;
    state.segmentTurnsQ = event.index === 1 ? 0 : model.segments[event.index - 2].turnsQ;
    state.nextEventIndex = event.index;
    return state;
  }

  return {
    build: build,
    stateAt: stateAt,
    stateInSegment: stateInSegment,
    beforeState: beforeState,
    defaults: Object.assign({}, DEFAULTS)
  };
});
