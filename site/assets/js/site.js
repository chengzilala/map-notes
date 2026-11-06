/* 留个点 · 官网交互
   一个 rAF 循环 + 阻尼插值统一驱动：进度条 / 视差 / 逐字点亮 / sticky 缩放 / 光标柔光
   所有写入只碰 transform 与 opacity，滚动中不做布局读取；低动效偏好下退化为静态 */

(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(pointer: fine)').matches;

  var nav = document.getElementById('nav');
  var bar = document.getElementById('progressBar');
  var cue = document.getElementById('scrollCue');
  var glow = document.getElementById('cursorGlow');
  var heroMedia = document.querySelector('.hero-media');
  var heroBody = document.querySelector('.hero-body');
  var statement = document.querySelector('[data-words]');
  var featureEls = Array.prototype.slice.call(document.querySelectorAll('.feature'));
  var stepEls = Array.prototype.slice.call(document.querySelectorAll('[data-step]'));
  var rail = document.getElementById('pageRail');
  var railPath = document.getElementById('railPath');
  var railLight = document.getElementById('railLight');
  var railNodes = document.getElementById('railNodes');
  var railFill = document.getElementById('railFill');
  var railTrails = [document.getElementById('railTrail1'), document.getElementById('railTrail2')];
  var branchEls = Array.prototype.slice.call(document.querySelectorAll('.rail-branch-group'));
  var sectionEls = ['.statement', '.features', '.steps', '.privacy', '.finale'].map(function (sel) {
    return document.querySelector(sel);
  }).filter(Boolean);

  function clamp(n, min, max) {
    return n < min ? min : n > max ? max : n;
  }

  /* ---------- 逐字拆分（保留 <br> 与空格） ---------- */
  function splitChars(el, cls) {
    var spans = [];
    var count = 0;

    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var frag = document.createDocumentFragment();
          Array.prototype.slice.call(child.textContent).forEach(function (ch) {
            if (ch === ' ' || ch === '\n' || ch === '\t') {
              frag.appendChild(document.createTextNode(' '));
              return;
            }
            var s = document.createElement('span');
            s.className = cls;
            s.textContent = ch;
            if (cls === 'ch') s.style.setProperty('--i', count);
            count += 1;
            spans.push(s);
            frag.appendChild(s);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== 'BR') {
          walk(child);
        }
      });
    }

    walk(el);
    return spans;
  }

  var words = [];
  var title = document.querySelector('[data-split]');

  if (!reduce && title) {
    splitChars(title, 'ch');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        title.classList.add('in');
      });
    });
  }

  if (!reduce && statement) words = splitChars(statement, 'w');

  /* ---------- 入场观察 ---------- */
  if (reduce) {
    Array.prototype.slice.call(document.querySelectorAll('[data-reveal], .feature')).forEach(function (el) {
      el.classList.add('in');
    });
    stepEls.forEach(function (s) { s.classList.add('active'); });
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -2% 0px' });
    Array.prototype.slice.call(document.querySelectorAll('[data-reveal], .feature')).forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---------- 量一次，之后只读滚动位置 ---------- */
  var M = { vh: 0, max: 1, stTop: 0, stH: 1, feat: [], steps: [], railW: 0, nodes: [], branches: [] };
  var railLen = 0;

  function measure() {
    var y = window.scrollY || window.pageYOffset;
    M.vh = window.innerHeight;
    M.max = Math.max(1, document.documentElement.scrollHeight - M.vh);

    M.feat = featureEls.map(function (f) {
      var r = f.getBoundingClientRect();
      return { top: r.top + y, h: r.height };
    });

    if (statement) {
      var sr = statement.getBoundingClientRect();
      M.stTop = sr.top + y;
      M.stH = Math.max(1, sr.height);
    }

    M.steps = stepEls.map(function (s) {
      return s.getBoundingClientRect().top + y;
    });

    /* 路线：给每个区块打一个节点，光点走到这里就亮一个 */
    if (rail && railPath && railNodes) {
      railLen = railPath.getTotalLength();
      M.railW = rail.clientWidth;
      if (railFill) {
        railFill.style.strokeDasharray = railLen;
        railFill.style.strokeDashoffset = railLen;
      }
      M.nodes = [];
      railNodes.textContent = '';
      sectionEls.forEach(function (sec) {
        var top = sec.getBoundingClientRect().top + y;
        var p = clamp(top / M.max, 0, 1);
        var pt = railPath.getPointAtLength(railLen * p);
        var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', pt.x.toFixed(1));
        c.setAttribute('cy', pt.y.toFixed(1));
        c.setAttribute('r', '4.8');
        railNodes.appendChild(c);
        M.nodes.push({ el: c, p: p, on: false });
      });

      /* 支路：按它在路上的高度反算触发进度，光点路过时依次点亮 */
      M.branches = [];
      branchEls.forEach(function (g) {
        var targetY = parseFloat(g.getAttribute('data-y')) || 0;
        var bp = 1;
        var steps = 160;
        for (var i = 0; i <= steps; i += 1) {
          var q = i / steps;
          if (railPath.getPointAtLength(railLen * q).y >= targetY) {
            bp = q;
            break;
          }
        }
        var line = g.querySelector('.rail-branch-line');
        var len = line ? line.getTotalLength() : 0;
        if (line) {
          line.style.strokeDasharray = len;
          line.style.strokeDashoffset = len;
        }
        g.classList.remove('on');
        M.branches.push({ el: g, line: line, len: len, p: bp, on: false });
      });
    }
  }

  /* ---------- 阻尼状态 ---------- */
  var S = {
    progress: 0,
    heroY: 0,
    bodyP: 0,
    words: 0,
    feat: [],
    gx: 0,
    gy: 0
  };
  var T = {
    progress: 0,
    heroY: 0,
    bodyP: 0,
    words: 0,
    feat: [],
    gx: 0,
    gy: 0
  };

  var lastActive = -2;
  var lastSolid = null;
  var lastCue = null;
  var pointerOn = false;
  var raf = null;
  var lastTime = 0;

  function readTargets() {
    var y = window.scrollY || window.pageYOffset || 0;
    var vh = M.vh;

    T.progress = clamp(y / M.max, 0, 1);
    T.heroY = Math.min(y * 0.3, vh * 0.4);
    T.bodyP = clamp(y / (vh * 0.8), 0, 1);

    if (statement) {
      T.words = clamp((vh * 0.92 - (M.stTop - y)) / (vh * 0.78), 0, 1);
    }

    for (var i = 0; i < featureEls.length; i += 1) {
      var f = M.feat[i];
      var media = featureEls[i].querySelector('.feature-media');
      if (!f || !media) { T.feat[i] = { p: 0, shift: 0 }; continue; }
      var p = clamp((y - f.top + vh) / vh, 0, 1);
      var depth = parseFloat(media.dataset.parallax) || 0.12;
      var shift = clamp(-(f.top - y) * depth, -70, 70);
      T.feat[i] = { p: p, shift: shift };
    }
  }

  function writeFrame() {
    if (bar) bar.style.transform = 'scaleX(' + S.progress.toFixed(4) + ')';

    if (heroMedia) {
      heroMedia.style.transform = 'translate3d(0,' + S.heroY.toFixed(2) + 'px,0)';
    }
    if (heroBody) {
      heroBody.style.opacity = (1 - S.bodyP * 0.92).toFixed(3);
      heroBody.style.transform = 'translate3d(0,' + (S.bodyP * 46).toFixed(2) + 'px,0)';
    }

    if (words.length) {
      var target = S.words * (words.length + 5);
      for (var i = 0; i < words.length; i += 1) {
        var o = clamp((target - i) / 3, 0.16, 1);
        var key = o.toFixed(3);
        if (words[i].dataset.o !== key) {
          words[i].style.opacity = key;
          words[i].dataset.o = key;
        }
      }
    }

    for (var j = 0; j < featureEls.length; j += 1) {
      var media = featureEls[j].querySelector('.feature-media');
      var s = S.feat[j];
      if (!media || !s) continue;
      var scale = 1.16 - 0.12 * s.p;
      media.style.transform = 'translate3d(0,' + s.shift.toFixed(2) + 'px,0) scale(' + scale.toFixed(4) + ')';
    }

    if (glow && pointerOn) {
      glow.style.transform = 'translate3d(' + S.gx.toFixed(1) + 'px,' + S.gy.toFixed(1) + 'px,0)';
    }

    if (railLight && railLen && M.railW) {
      var p = S.progress;
      var rp = railPath.getPointAtLength(railLen * p);
      railLight.style.transform = 'translate3d(' + ((rp.x / 120) * M.railW).toFixed(1) + 'px,' + ((rp.y / 1000) * M.vh).toFixed(1) + 'px,0)';
      railLight.style.opacity = p > 0.004 ? '1' : '0';

      /* 路随滚动铺开：整条线从 0 画到实线 */
      if (railFill) railFill.style.strokeDashoffset = (railLen * (1 - p)).toFixed(1);

      /* 光点后面的两个拖尾，让「走」的感觉更明显 */
      for (var t = 0; t < railTrails.length; t += 1) {
        var el = railTrails[t];
        if (!el) continue;
        var tp = p - (t + 1) * 0.016;
        if (tp <= 0.002) {
          el.style.opacity = '0';
          continue;
        }
        var tp2 = railPath.getPointAtLength(railLen * tp);
        el.style.transform = 'translate3d(' + ((tp2.x / 120) * M.railW).toFixed(1) + 'px,' + ((tp2.y / 1000) * M.vh).toFixed(1) + 'px,0)';
        el.style.opacity = p > 0.01 ? '1' : '0';
      }

      if (M.nodes) {
        M.nodes.forEach(function (n) {
          var on = S.progress >= n.p;
          if (on !== n.on) {
            n.el.classList.toggle('on', on);
            n.on = on;
          }
        });
      }

      if (M.branches) {
        M.branches.forEach(function (b) {
          var bo = p >= b.p;
          if (bo !== b.on) {
            b.el.classList.toggle('on', bo);
            if (b.line) b.line.style.strokeDashoffset = bo ? 0 : b.len;
            b.on = bo;
          }
        });
      }
    }
  }

  function toggleStates() {
    var y = window.scrollY || window.pageYOffset || 0;
    var vh = M.vh;

    var solid = y > 80;
    if (nav && solid !== lastSolid) {
      nav.classList.toggle('is-solid', solid);
      lastSolid = solid;
    }

    var off = y > 120;
    if (cue && off !== lastCue) {
      cue.classList.toggle('is-off', off);
      lastCue = off;
    }

    var active = -1;
    for (var i = 0; i < M.steps.length; i += 1) {
      if (M.steps[i] - y < vh * 0.64) active = i;
    }
    if (active !== lastActive) {
      stepEls.forEach(function (el, k) {
        el.classList.toggle('active', k <= active);
      });
      lastActive = active;
    }
  }

  function frame(now) {
    raf = null;
    var dt = lastTime ? Math.min(48, now - lastTime) : 16;
    lastTime = now;

    /* 时间无关的阻尼：约 110ms 收敛，滚动停住后自然滑停 */
    var k = 1 - Math.exp(-dt / 110);
    var moving = false;

    readTargets();

    function ease(key) {
      var d = T[key] - S[key];
      if (Math.abs(d) > 0.0004) { moving = true; S[key] += d * k; }
      else S[key] = T[key];
    }

    if (!reduce) {
      ease('progress');
      ease('heroY');
      ease('bodyP');
      ease('words');

      for (var i = 0; i < T.feat.length; i += 1) {
        if (!S.feat[i]) S.feat[i] = { p: 0, shift: 0 };
        var dp = T.feat[i].p - S.feat[i].p;
        var ds = T.feat[i].shift - S.feat[i].shift;
        if (Math.abs(dp) > 0.0004 || Math.abs(ds) > 0.02) {
          moving = true;
          S.feat[i].p += dp * k;
          S.feat[i].shift += ds * k;
        } else {
          S.feat[i].p = T.feat[i].p;
          S.feat[i].shift = T.feat[i].shift;
        }
      }

      if (glow && pointerOn) {
        var gdx = T.gx - S.gx;
        var gdy = T.gy - S.gy;
        if (Math.abs(gdx) > 0.3 || Math.abs(gdy) > 0.3) {
          moving = true;
          S.gx += gdx * k;
          S.gy += gdy * k;
        } else {
          S.gx = T.gx;
          S.gy = T.gy;
        }
      }
    }

    writeFrame();
    toggleStates();

    if (moving) schedule();
    else lastTime = 0;
  }

  function schedule() {
    if (reduce || raf) return;
    raf = requestAnimationFrame(frame);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', function () { measure(); writeFrame(); schedule(); }, { passive: true });
  window.addEventListener('load', function () { measure(); writeFrame(); });
  setTimeout(function () { measure(); writeFrame(); }, 600);

  measure();
  readTargets();
  /* 首帧直接落位，避免页面初始从 0 动一下 */
  S.heroY = T.heroY;
  S.bodyP = T.bodyP;
  S.progress = T.progress;
  S.words = T.words;
  S.feat = T.feat.map(function (v) { return { p: v.p, shift: v.shift }; });
  writeFrame();
  toggleStates();

  /* ---------- 光标柔光（仅桌面） ---------- */
  if (fine && glow && !reduce) {
    window.addEventListener('pointermove', function (e) {
      T.gx = e.clientX;
      T.gy = e.clientY;
      if (!pointerOn) {
        pointerOn = true;
        S.gx = T.gx;
        S.gy = T.gy;
        glow.classList.add('on');
      }
      schedule();
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      pointerOn = false;
      glow.classList.remove('on');
    });
  }
})();
