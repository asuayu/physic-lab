(function () {
  'use strict';

  var api = window.RingCollisionModel;
  var root = document.getElementById('collision-lab');
  if (!root || !api) return;
  var ids = ['circle-svg', 'unfolded-svg', 'gap-svg', 'circle-caption', 'unfolded-caption',
    'status-label', 'collision-badge', 'stage-explanation', 'endpoint-note', 'play-btn',
    'reset-btn', 'prev-btn', 'next-btn', 'end-btn', 'timeline', 'time-label', 'duration-label',
    'rate', 'pause-collision', 'show-trail', 'show-vectors', 'v0', 'v0-value', 'ratio',
    'ratio-value', 'restitution', 'restitution-value', 'radius', 'radius-value', 'pairs',
    'va-value', 'vb-value', 'omega-value', 'vq-value', 'sa-value', 'sb-value', 'q-value',
    'gap-value', 'answer-value', 'relative-value', 'current-event', 'event-rows', 'plot-mode',
    'playback-mode', 'segment-timeline', 'segment-label', 'sampling-note'];
  var el = {};
  ids.forEach(function (id) {
    el[id] = document.getElementById(id);
    if (!el[id]) throw new Error('Missing interface control: ' + id);
  });
  var C = { A: '#2563b8', B: '#138174', center: '#8154ba', Q: '#c27520', ink: '#24354b',
    grid: '#dfe5eb', muted: '#758496', background: '#f6f8fa' };
  var model, time = 0, playing = false, beforeIndex = null, lastFrame = 0, raf = 0;
  var lastPaint = 0, flashUntil = 0, cursor = { offset: 0, fraction: 0 };

  function number(value, digits) {
    if (value !== 0 && (Math.abs(value) >= 100000 || Math.abs(value) < 0.001)) return value.toExponential(2);
    return value.toLocaleString('zh-CN', { maximumFractionDigits: digits === undefined ? 2 : digits });
  }
  function fixed(value, digits) { return number(value, digits === undefined ? 3 : digits); }
  function point(x, y) { return x.toFixed(2) + ',' + y.toFixed(2); }
  function pathLine(x1, y1, x2, y2, color, width, extra) {
    return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 +
      '" stroke="' + color + '" stroke-width="' + (width || 1.5) + '" ' + (extra || '') + '/>';
  }
  function txt(x, y, value, color, size, anchor, extra) {
    return '<text x="' + x + '" y="' + y + '" fill="' + (color || C.ink) + '" font-size="' +
      (size || 14) + '" text-anchor="' + (anchor || 'start') + '" ' + (extra || '') + '>' + value + '</text>';
  }
  function state() {
    return beforeIndex ? api.beforeState(model, beforeIndex) : api.stateInSegment(model, cursor.offset, cursor.fraction);
  }
  function cursorFromState(s) {
    cursor.offset = s.finished ? model.segments.length - 1 : Math.max(0, s.segmentOffset === null ? s.collisionIndex - 1 : s.segmentOffset);
    cursor.fraction = s.finished ? 1 : (s.segmentFraction || 0);
  }
  function setPlaying(value) {
    playing = value;
    lastFrame = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (playing) raf = requestAnimationFrame(frame);
  }
  function seek(value, before) {
    setPlaying(false);
    time = Math.max(0, Math.min(model.totalTime, value));
    cursorFromState(api.stateAt(model, time));
    beforeIndex = before || null;
    flashUntil = performance.now() + 700;
    render();
  }
  function rebuild(fromPreset) {
    setPlaying(false);
    if (fromPreset !== true) root.querySelectorAll('[data-preset]').forEach(function (b) {
      b.classList.remove('selected'); b.setAttribute('aria-pressed', 'false');
    });
    var n = Math.max(1, Math.min(40, Math.round(Number(el.pairs.value) || 1)));
    el.pairs.value = n;
    model = api.build({ mA: Number(el.ratio.value), mB: 1, R: Number(el.radius.value),
      v0: Number(el.v0.value), e: Number(el.restitution.value), n: n });
    time = 0;
    cursor = { offset: 0, fraction: 0 };
    beforeIndex = null;
    if (model.totalTime > 10000000) el['playback-mode'].value = 'interval';
    renderEvents();
    render();
  }
  function renderEvents() {
    var table = el['event-rows'].closest('table');
    if (table && table.tHead) {
      table.tHead.innerHTML = '<tr><th scope="col">碰撞</th><th scope="col">时刻 / s</th>' +
        '<th scope="col">碰点角度</th><th scope="col">碰后 vA / m·s⁻¹</th>' +
        '<th scope="col">碰后 vB / m·s⁻¹</th><th scope="col">对照</th></tr>';
    }
    el['event-rows'].innerHTML = model.events.map(function (event) {
      return '<tr data-row-event="' + event.index + '"><th scope="row"><button type="button" class="event-link" data-event="' +
        event.index + '" aria-label="跳转到第' + event.index + '次碰撞后">第 ' + event.index + ' 次</button></th>' +
        '<td>' + fixed(event.time) + '</td><td>' + number(event.theta * 180 / Math.PI, 1) + '°</td>' +
        '<td>' + fixed(event.vA) + '</td><td>' + fixed(event.vB) + '</td><td><button type="button" ' +
        'class="event-before" data-before="' + event.index + '" aria-label="查看第' + event.index + '次碰撞前的速率">看碰前</button></td></tr>';
    }).join('');
  }
  function circleView(s) {
    var cx = 280, cy = 219, radius = 151, scale = radius / model.params.R;
    function toXY(x, y) { return { x: cx + x * scale, y: cy + y * scale }; }
    var A = toXY(s.xA, s.yA), B = toXY(s.xB, s.yB), P = toXY(s.xQ, s.yQ);
    var near = Math.hypot(A.x - B.x, A.y - B.y) < 40;
    var parts = ['<title>圆环上的A、B与辅助点P</title><desc>蓝色圆点A和绿色方点B为真实物体。橙色空心菱形P仅把加权弧坐标Q映射到圆环：θP=Q/R模2π，切向速率V恒定。P不是物体，也不是质心。</desc>'];
    parts.push('<defs>');
    [['a', C.A], ['b', C.B], ['p', C.Q], ['ink', C.muted]].forEach(function (m) {
      parts.push('<marker id="circle-arrow-' + m[0] + '" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="' + m[1] + '"/></marker>');
    });
    parts.push('</defs><circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="#f7f9fb" stroke="#9eabb9" stroke-width="12"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + radius + '" fill="none" stroke="#dfe6ed" stroke-width="8"/>');
    parts.push(pathLine(cx - 185, cy, cx + 185, cy, C.grid, 1, 'stroke-dasharray="4 6"'));
    parts.push(pathLine(cx, cy - 185, cx, cy + 185, C.grid, 1, 'stroke-dasharray="4 6"'));
    if (el['show-trail'].checked && time > 0) {
      var sweep = Math.min(2 * Math.PI, model.V * time / model.params.R), points = [];
      for (var i = 0; i <= 100; i++) {
        var theta = s.thetaQ - sweep + sweep * i / 100;
        points.push(point(cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)));
      }
      parts.push('<polyline points="' + points.join(' ') + '" fill="none" stroke="' + C.Q + '" stroke-width="3" opacity=".43"/>');
    }
    parts.push(pathLine(cx, cy, cx + radius - 8, cy, C.muted, 1.2, 'stroke-dasharray="3 4"'));
    parts.push(txt(cx + radius / 2, cy - 10, 'R = ' + number(model.params.R) + ' m', C.muted, 12, 'middle'));
    parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="3.5" fill="' + C.ink + '"/>' + txt(cx - 12, cy + 22, 'O', C.ink, 14, 'end'));
    parts.push('<path d="M 431 139 A 173 173 0 0 1 451 197" fill="none" stroke="' + C.muted + '" stroke-width="1.6" marker-end="url(#circle-arrow-ink)"/>' + txt(465, 174, '顺时针', C.muted, 12));
    parts.push(pathLine(cx, cy, P.x, P.y, C.Q, 1.3, 'stroke-dasharray="5 5" opacity=".55"'));
    if (el['show-vectors'].checked) {
      var velocityScale = 51 / model.params.v0;
      [[A, s.thetaA, s.vA, C.A, 'a'], [B, s.thetaB, s.vB, C.B, 'b'], [P, s.thetaQ, model.V, C.Q, 'p']].forEach(function (v) {
        var vx = -v[2] * Math.sin(v[1]), vy = v[2] * Math.cos(v[1]);
        parts.push(pathLine(v[0].x, v[0].y, v[0].x + vx * velocityScale,
          v[0].y + vy * velocityScale, v[3], 2, 'marker-end="url(#circle-arrow-' + v[4] + ')"'));
      });
    }
    if (s.atCollision && performance.now() < flashUntil) parts.push('<circle cx="' + A.x + '" cy="' + A.y + '" r="23" fill="none" stroke="#d8a34c" stroke-width="2" opacity=".65"/>');
    parts.push('<g><title>A：速率 ' + fixed(s.vA) + ' m/s</title><circle cx="' + A.x + '" cy="' + A.y + '" r="11" fill="' + C.A + '" stroke="white" stroke-width="2.5"/></g>');
    parts.push('<g><title>B：速率 ' + fixed(s.vB) + ' m/s</title><rect x="' + (B.x - 8) + '" y="' + (B.y - 8) + '" width="16" height="16" rx="3" fill="' + C.B + '" stroke="white" stroke-width="2.5"/></g>');
    parts.push('<g><title>辅助点P：累计弧长Q，恒定切向速率V=' + fixed(model.V) + ' m/s；P不是实际质心</title><path d="M' + P.x + ',' + (P.y - 11) + ' L' + (P.x + 11) + ',' + P.y + ' L' + P.x + ',' + (P.y + 11) + ' L' + (P.x - 11) + ',' + P.y + ' Z" fill="none" stroke="' + C.Q + '" stroke-width="2.6"/></g>');
    [[A, s.thetaA, 'A', C.A], [B, s.thetaB, 'B', C.B], [P, s.thetaQ, 'P', C.Q]].forEach(function (v, i) {
      var lx, ly;
      if (near && i < 2) { lx = A.x + 30; ly = A.y + (i === 0 ? -27 : 16); }
      else if (i === 2 && Math.min(Math.hypot(P.x-A.x,P.y-A.y), Math.hypot(P.x-B.x,P.y-B.y)) < 35) { lx=P.x+30; ly=P.y+44; }
      else { lx=v[0].x+Math.cos(v[1])*27; ly=v[0].y+Math.sin(v[1])*27+5; }
      parts.push(txt(lx, ly, v[2], v[3], 16, 'middle', 'font-weight="700"'));
    });
    parts.push(txt(280, 412, 'P：把 Q 映射回圆环的辅助点', C.Q, 15, 'middle'));
    parts.push(txt(280, 437, 'θP = Q/R（mod 2π） · 恒定切向速率 V', C.muted, 13, 'middle'));
    el['circle-svg'].innerHTML = parts.join('');
  }

  function chartDomain(s) {
    var start = 0, end = model.totalTime;
    if (el['plot-mode'].value === 'segment') {
      var segIndex = beforeIndex ? Math.max(0, beforeIndex - 2) : Math.min(model.segments.length - 1, s.collisionIndex - 1);
      var seg = model.segments[segIndex];
      start = seg.startTime;
      end = seg.endTime;
    }
    var first = api.stateAt(model, start), last = api.stateAt(model, end);
    var ymin = Math.min(first.sA, first.sB, first.Q) / model.L;
    var ymax = Math.max(last.sA, last.sB, last.Q) / model.L;
    var span = Math.max(.05, ymax - ymin);
    return { start: start, end: end, ymin: Math.max(0, ymin - span * .07), ymax: ymax + span * .1 };
  }
  function pointsInDomain(domain) {
    var times = [domain.start];
    model.events.forEach(function (e) { if (e.time > domain.start && e.time < domain.end) times.push(e.time); });
    times.push(domain.end);
    return times.map(function (t) { return api.stateAt(model, t); });
  }
  function unfoldedView(s, d) {
    var left = 72, right = 752, top = 62, bottom = 390;
    var x = function (t) { return left + (t - d.start) / (d.end - d.start) * (right - left); };
    var y = function (lap) { return bottom - (lap - d.ymin) / (d.ymax - d.ymin) * (bottom - top); };
    var currentX = Math.max(left, Math.min(right, x(time)));
    var p = ['<title>A、B累计弧长与展开加权位置Q</title><desc>横轴为真实时间秒，纵轴为累计弧长除以周长。' +
      'A、B分段线性运动，Q始终沿直线。淡线是后续轨迹，实线显示已经走过的部分。</desc>',
      '<defs><clipPath id="chart-progress"><rect x="' + left + '" y="0" width="' + Math.max(0, currentX - left) + '" height="450"/></clipPath></defs>'];
    for (var i = 0; i <= 4; i++) {
      var tv = d.start + (d.end - d.start) * i / 4;
      var sv = d.ymin + (d.ymax - d.ymin) * i / 4;
      p.push(pathLine(x(tv), top, x(tv), bottom, C.grid, 1, 'stroke-dasharray="4 6"'));
      p.push(pathLine(left, y(sv), right, y(sv), C.grid, 1, 'stroke-dasharray="4 6"'));
      p.push(txt(x(tv), bottom + 24, number(tv), C.muted, 17, 'middle'));
      p.push(txt(left - 12, y(sv) + 5, number(sv), C.muted, 17, 'end'));
    }
    p.push(pathLine(left, top, left, bottom, C.muted, 1.2));
    p.push(pathLine(left, bottom, right, bottom, C.muted, 1.2));
    p.push(txt(left, 18, '累计弧长 / ℓ', C.muted, 16));
    p.push(txt(right, 439, '时间 t / s', C.muted, 16, 'end'));
    var states = pointsInDomain(d);
    [['sA', C.A, ''], ['sB', C.B, ''], ['Q', C.Q, 'stroke-dasharray="7 5"']].forEach(function (series) {
      var pts = states.map(function (st) { return point(x(st.time), y(st[series[0]] / model.L)); }).join(' ');
      p.push('<polyline points="' + pts + '" fill="none" stroke="' + series[1] + '" stroke-width="2.5" opacity=".2" ' + series[2] + '/>');
      p.push('<polyline points="' + pts + '" fill="none" stroke="' + series[1] + '" stroke-width="3" clip-path="url(#chart-progress)" ' + series[2] + '/>');
    });
    p.push(pathLine(currentX, top, currentX, bottom, C.muted, 1.2, 'stroke-dasharray="3 5"'));
    var lastLabel = -1000;
    model.events.forEach(function (event) {
      if (event.time < d.start || event.time > d.end) return;
      var ex = x(event.time);
      p.push('<g role="button" tabindex="0" class="plot-event" data-event="' + event.index + '" aria-label="跳转到第' + event.index + '次碰撞后"><title>第' + event.index + '次碰撞，t = ' + fixed(event.time) + ' s</title><circle cx="' + ex + '" cy="' + (bottom + 4) + '" r="8" fill="white" stroke="' + C.muted + '" stroke-width="1.5"/></g>');
      if (ex - lastLabel > 44 && ex < right - 30 || event.index === model.targetCollision) {
        p.push(txt(ex, top - 8, '第' + event.index + '次', C.muted, 15, event.index === model.targetCollision ? 'end' : 'middle'));
        lastLabel = ex;
      }
    });
    [['sA', C.A, 6], ['sB', C.B, 5], ['Q', C.Q, 4]].forEach(function (series) {
      var py = y(s[series[0]] / model.L);
      if (series[0] === 'sB') p.push('<rect x="' + (currentX - 5) + '" y="' + (py - 5) + '" width="10" height="10" rx="2" fill="' + series[1] + '" stroke="white" stroke-width="1.5"/>');
      else p.push('<circle cx="' + currentX + '" cy="' + py + '" r="' + series[2] + '" fill="' + series[1] + '" stroke="white" stroke-width="1.5"/>');
    });
    el['unfolded-svg'].innerHTML = p.join('');
  }
  function gapView(s, d) {
    var left = 72, right = 752, top = 24, bottom = 107;
    var x = function (t) { return left + (t - d.start) / (d.end - d.start) * (right - left); };
    var y = function (gap) { return bottom - gap / model.L * (bottom - top); };
    var states = pointsInDomain(d);
    var currentX = Math.max(left, Math.min(right, x(time)));
    var p = ['<title>展开坐标差：B累计比A多走多少圈</title><desc>坐标差在0和一个周长之间交替变化。奇数次碰撞为零，偶数次碰撞为一个周长。</desc>',
      '<defs><clipPath id="gap-progress"><rect x="' + left + '" y="0" width="' + Math.max(0, currentX - left) + '" height="150"/></clipPath></defs>'];
    [0, .5, 1].forEach(function (v) {
      var py = y(v * model.L);
      p.push(pathLine(left, py, right, py, C.grid, 1, 'stroke-dasharray="3 5"'));
      p.push(txt(left - 12, py + 5, v === 1 ? 'ℓ' : v === .5 ? '½ℓ' : '0', C.muted, 17, 'end'));
    });
    p.push(txt(left, 15, '展开差 sB − sA', C.muted, 16));
    var pts = states.map(function (st) { return point(x(st.time), y(st.gap)); }).join(' ');
    p.push('<polyline points="' + pts + '" fill="none" stroke="' + C.center + '" stroke-width="2.3" opacity=".2"/>');
    p.push('<polyline points="' + pts + '" fill="none" stroke="' + C.center + '" stroke-width="2.5" clip-path="url(#gap-progress)"/>');
    p.push('<circle cx="' + currentX + '" cy="' + y(s.gap) + '" r="5" fill="' + C.center + '" stroke="white" stroke-width="1.5"/>');
    p.push(txt(left, 140, '奇数次：0', C.center, 16));
    p.push(txt(right, 140, '偶数次：ℓ', C.muted, 16, 'end'));
    el['gap-svg'].innerHTML = p.join('');
  }
  function render() {
    var s = state();
    time = s.time;
    var shownIndex = beforeIndex || s.collisionIndex;
    var atEnd = s.finished && !beforeIndex;
    el['play-btn'].textContent = beforeIndex ? '发生碰撞' : playing ? '暂停' : atEnd ? '重新播放' : '播放';
    el['play-btn'].setAttribute('aria-pressed', String(playing));
    el['status-label'].textContent = beforeIndex ? '碰撞前' : atEnd ? '已到终点' : playing ? '播放中' : '已暂停';
    el['collision-badge'].textContent = '第 ' + shownIndex + ' 次碰撞' + (beforeIndex ? '前' : s.atCollision ? '刚后' : '后');
    el['current-event'].textContent = String(shownIndex);
    el['time-label'].textContent = fixed(time) + ' s';
    el['duration-label'].textContent = fixed(model.totalTime) + ' s';
    el.timeline.value = Math.round(time / model.totalTime * 10000);
    el.timeline.setAttribute('aria-valuetext', '当前 ' + fixed(time) + ' 秒，总时长 ' + fixed(model.totalTime) + ' 秒');
    el['prev-btn'].disabled = time === 0 && !beforeIndex;
    el['next-btn'].disabled = atEnd;
    el['end-btn'].disabled = atEnd;
    el['v0-value'].textContent = number(model.params.v0, 1) + ' m/s';
    el['ratio-value'].textContent = number(model.params.mA, 1) + ' : 1';
    el['restitution-value'].textContent = number(model.params.e, 2) + (model.params.e === 1 ? ' · 弹性对照' : '');
    el['radius-value'].textContent = number(model.params.R, 1) + ' m';
    [['va-value', s.vA], ['vb-value', s.vB], ['omega-value', model.V / model.params.R], ['vq-value', model.V],
      ['sa-value', s.sA], ['sb-value', s.sB], ['q-value', s.Q], ['gap-value', s.gap],
      ['relative-value', s.relativeSpeed]].forEach(function (item) { el[item[0]].textContent = fixed(item[1]); });
    el['answer-value'].textContent = fixed(model.events[model.events.length - 1].sB);
    if (beforeIndex) {
      el['stage-explanation'].textContent = '第 ' + beforeIndex + ' 次碰撞即将发生。查看碰前速率，再按“发生碰撞”对照碰后变化；位置保持连续。';
    } else if (atEnd) {
      el['stage-explanation'].textContent = '第 ' + model.targetCollision + ' 次碰撞完成。两球累计路程相同，均为 ' + fixed(s.sB) + ' m = ' + fixed(s.sB / model.L) + ' 圈。';
    } else {
      var next = model.events[s.collisionIndex];
      var fast = s.relativeSpeed > 0 ? 'B' : 'A';
      el['stage-explanation'].textContent = '第 ' + s.collisionIndex + ' → ' + (s.collisionIndex + 1) + ' 次碰撞：' + fast + ' 较快，相对速率 ' + fixed(Math.abs(s.relativeSpeed)) + ' m/s；距下一次还有 ' + fixed(next.time - time) + ' s。';
    }
    var exactEvent = beforeIndex ? model.events[beforeIndex - 1] : s.atCollision ? model.events[s.collisionIndex - 1] : null;
    if (exactEvent) {
      el['endpoint-note'].textContent = exactEvent.index % 2 ?
        '奇数次碰撞：sA = sB = Q，因此辅助点 P 也与 A、B 重合。P 仅作坐标辅助，不是质心。' :
        '偶数次碰撞：sB − sA = ℓ。两球在环上相遇，累计路程仍相差一整圈。';
    } else {
      el['endpoint-note'].textContent = '到第 ' + model.targetCollision + ' 次碰撞（奇数次），sA = sB = Q = VT。只改变 v₀，会改变用时，目标路程保持不变。';
    }
    el['endpoint-note'].classList.toggle('is-proved', atEnd);
    el['circle-caption'].textContent = 'Q = (mA·sA + mB·sB)/M，V = dQ/dt 恒定。P 将 Q 绕回圆环，是辅助点，不代表实际物体。';
    el['unfolded-caption'].textContent = el['plot-mode'].value === 'segment' ? '当前碰撞区间 · 纵轴以周长 ℓ = 2πR 为单位，横轴为真实时间。' : '全过程 · 淡线为后续运动，实线为已走过的部分；Q的斜率恒定。';
    var segmentOffset = beforeIndex ? Math.max(0, beforeIndex - 2) : cursor.offset;
    var segmentFraction = beforeIndex ? (beforeIndex === 1 ? 0 : 1) : cursor.fraction;
    el['segment-timeline'].value = Math.round(segmentFraction * 10000);
    el['segment-label'].textContent = '第 ' + (segmentOffset + 1) + ' → ' + (segmentOffset + 2) + ' 次碰撞 · ' + number(segmentFraction * 100, 1) + '%';
    el['segment-timeline'].setAttribute('aria-valuetext', el['segment-label'].textContent);
    el['sampling-note'].textContent = el['playback-mode'].value === 'interval' ?
      '区间压缩：1 倍时每段 6 秒。圆环按时刻采样，可能跳圈，不能据此判断实际转速。' :
      '真实时间播放；辅助点 P 的切向速率为 V，方向随位置改变。';
    root.dataset.segment = String(segmentOffset);
    root.dataset.fraction = String(segmentFraction);
    root.dataset.thetaP = String(s.thetaQ);
    root.dataset.relative = String(s.relativeSpeed);
    root.dataset.time = String(time);
    root.dataset.collision = String(shownIndex);
    root.dataset.before = String(!!beforeIndex);
    root.dataset.sa = String(s.sA); root.dataset.sb = String(s.sB); root.dataset.q = String(s.Q);
    root.dataset.gap = String(s.gap); root.dataset.finished = String(atEnd);
    // Preserve the interval and local fraction even when total time is huge.
    document.getElementById('collision-offset').value = cursor.offset;
    document.getElementById('collision-fraction').value = cursor.fraction;
    document.getElementById('collision-before').value = beforeIndex || 0;
    el['event-rows'].querySelectorAll('tr').forEach(function (row) {
      var selected = Number(row.dataset.rowEvent) === shownIndex;
      row.classList.toggle('current', selected);
      if (selected) row.setAttribute('aria-current', 'step'); else row.removeAttribute('aria-current');
    });
    circleView(s);
    var d = chartDomain(s);
    unfoldedView(s, d); gapView(s, d);
  }
  function advanceCursor() {
    if (cursor.offset < model.segments.length - 1) { cursor.offset += 1; cursor.fraction = 0; return false; }
    cursor.fraction = 1; return true;
  }
  function frame(now) {
    if (!playing) return;
    if (!lastFrame) lastFrame = now;
    var delta = Math.min(.12, Math.max(0, (now - lastFrame) / 1000)) * Number(el.rate.value);
    lastFrame = now;
    var remaining = delta;
    for (var steps = 0; remaining > 0 && steps < model.segments.length; steps++) {
      var duration = el['playback-mode'].value === 'interval' ? 6 : model.segments[cursor.offset].duration;
      var until = (1 - cursor.fraction) * duration;
      if (remaining >= until) {
        remaining -= until;
        var terminal = advanceCursor();
        flashUntil = now + 800;
        if (terminal || el['pause-collision'].checked) { playing = false; break; }
      } else {
        var nextFraction = cursor.fraction + remaining / duration;
        if (nextFraction === cursor.fraction && remaining > 0) {
          el['playback-mode'].value = 'interval';
          nextFraction = Math.min(1, cursor.fraction + remaining / 6);
        }
        cursor.fraction = nextFraction;
        remaining = 0;
      }
    }
    if (now - lastPaint > 30 || !playing) { render(); lastPaint = now; }
    if (playing) raf = requestAnimationFrame(frame); else raf = 0;
  }
  el['play-btn'].addEventListener('click', function () {
    if (beforeIndex) { beforeIndex = null; render(); return; }
    if (state().finished) { time = 0; cursor = { offset: 0, fraction: 0 }; }
    setPlaying(!playing); render();
  });
  el['reset-btn'].addEventListener('click', function () { seek(0); });
  el['end-btn'].addEventListener('click', function () { seek(model.totalTime); });
  el['next-btn'].addEventListener('click', function () {
    if (beforeIndex) { seek(time); return; }
    var next = model.events.find(function (event) { return event.time > time; });
    if (next) seek(next.time);
  });
  el['prev-btn'].addEventListener('click', function () {
    var previous = model.events.filter(function (event) { return event.time < time; }).pop();
    seek(previous ? previous.time : 0);
  });
  el.timeline.addEventListener('input', function () { seek(Number(el.timeline.value) / 10000 * model.totalTime); });
  el['segment-timeline'].addEventListener('input', function () {
    setPlaying(false);
    var offset = beforeIndex ? Math.max(0, beforeIndex - 2) : cursor.offset;
    beforeIndex = null;
    cursorFromState(api.stateInSegment(model, offset, Number(el['segment-timeline'].value) / 10000));
    render();
  });
  el['playback-mode'].addEventListener('change', function () { setPlaying(false); render(); });
  ['v0', 'ratio', 'restitution', 'radius'].forEach(function (id) { el[id].addEventListener('input', rebuild); });
  el.pairs.addEventListener('change', rebuild);
  ['show-trail', 'show-vectors', 'plot-mode'].forEach(function (id) { el[id].addEventListener('change', render); });
  function eventClick(event) {
    var button = event.target.closest('[data-event],[data-before]');
    if (!button) return;
    var index = Number(button.dataset.event || button.dataset.before);
    if (model.events[index - 1]) seek(model.events[index - 1].time, button.dataset.before ? index : null);
  }
  el['event-rows'].addEventListener('click', eventClick);
  el['unfolded-svg'].addEventListener('click', eventClick);
  el['unfolded-svg'].addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); eventClick(event); }
  });
  root.querySelectorAll('[data-preset]').forEach(function (button) {
    button.addEventListener('click', function () {
      var presets = { example: [3, 2, .5, 1, 1], elastic2: [3, 2, 1, 1, 3],
        elastic5: [3, 5, 1, 1, 3], dissipative: [3, 2, .7, 1, 2] };
      var p = presets[button.dataset.preset];
      if (!p) return;
      ['v0', 'ratio', 'restitution', 'radius', 'pairs'].forEach(function (id, i) { el[id].value = p[i]; });
      root.querySelectorAll('[data-preset]').forEach(function (b) {
        b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button));
      });
      rebuild(true);
    });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && playing) { setPlaying(false); render(); }
  });
  window.addEventListener('physicslab:state-restored', function (event) {
    var saved = event.detail && event.detail.values;
    if (!saved || !Object.prototype.hasOwnProperty.call(saved, 'collision-offset')) return;
    var offset = Number(saved['collision-offset']);
    var fraction = Number(saved['collision-fraction']);
    var before = Number(saved['collision-before']);
    if (!Number.isInteger(offset) || offset < 0 || offset >= model.segments.length ||
        !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return;
    setPlaying(false);
    cursor = { offset: offset, fraction: fraction };
    beforeIndex = Number.isInteger(before) && before > 0 && before <= model.targetCollision ? before : null;
    render();
  });
  rebuild(true);
})();
