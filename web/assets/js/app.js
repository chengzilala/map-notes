/* map-notes · 页面逻辑（原生 JS，无构建、无第三方库；地图 SDK 由配置决定是否加载） */
(function () {
  'use strict';

  var CFG = window.MN_CONFIG || {};
  var API = (CFG.API_BASE || '').replace(/\/$/, '');
  var RADIUS = CFG.DEFAULT_RADIUS || 3000;

  var SOURCE_NAMES = { amap: '高德', baidu: '百度' };
  var SOURCE_ORDER = ['amap', 'baidu'];
  var DISPLAY_KEY = 'mn-display';

  // 默认视角对齐高德 App 打开时（200 米比例）；点定位后对齐「我的位置」（25 米比例）
  // 注：曾用「容器放大 2 倍 + scale(0.5)」超采样提升手机 3x 屏清晰度，
  // 但 CSS transform 会让高德内部坐标与手指位置错位（缩放时点会漂移），已移除。
  var zoomDefault = function () { return CFG.MAP_ZOOM || 15; };
  var zoomMe = function () { return CFG.MAP_ZOOM_ME || 17; };

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    items: [],
    notes: {},
    notesReady: false,
    syncedAt: null,
    skipped: null,
    sourceFilter: 'all',
    sourceCounts: {},
    enabledSources: SOURCE_ORDER.slice(),
    showSourceLabel: true,
    pos: null,
    query: '',
    radiusOnly: true,
    selected: null,
    map: null,
    mapCentered: false,
    markers: [],
    meMarker: null,
    pickMode: false,
    detailPushed: false,
    closingDetail: false,
    pending: null,
    noteTimer: null,
    searchTimer: null,
    toastTimer: null,
    needLogin: false
  };

  /* ---------- 小工具 ---------- */

  function haversine(lng1, lat1, lng2, lat2) {
    var R = 6371008.8;
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function fmtDist(meters) {
    if (meters === null || meters === undefined) return '';
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function fmtDate(iso) {
    var full = fmtTime(iso);
    return full ? full.slice(0, 10) : '';
  }

  function fmtAge(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms) || ms < 0) return '';
    var hours = ms / 3600000;
    if (hours < 1) return '刚刚';
    if (hours < 24) return Math.round(hours) + ' 小时前';
    return Math.round(hours / 24) + ' 天前';
  }

  function toast(message, duration) {
    var el = $('toast');
    el.textContent = message;
    el.hidden = false;
    el.classList.add('is-show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
      setTimeout(function () { el.hidden = true; }, 200);
    }, duration || 4000);
  }

  function byId(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  /* ---------- 数据 ---------- */

  function sourcesOf(item) {
    var list = Array.isArray(item.sources) ? item.sources.slice() : [];
    if (!list.length && item.source) list = [item.source];
    if (!list.length) list = ['amap']; // 兼容 v1 数据：当时只有高德
    return list;
  }

  function sourceLabel(key) {
    return SOURCE_NAMES[key] || key;
  }

  function readLocalDisplay() {
    try {
      var data = JSON.parse(localStorage.getItem(DISPLAY_KEY) || 'null');
      return data && typeof data === 'object' ? data : null;
    } catch (e) {
      return null;
    }
  }

  function saveLocalDisplay(data) {
    try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(data)); } catch (e) {}
  }

  function applyDisplay(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.enabledSources)) {
      var enabled = data.enabledSources.filter(function (key) {
        return SOURCE_ORDER.indexOf(key) !== -1;
      });
      state.enabledSources = enabled.length ? enabled : SOURCE_ORDER.slice();
    }
    if (typeof data.showSourceLabel === 'boolean') {
      state.showSourceLabel = data.showSourceLabel;
    }
    if (data.currentFilter === 'all' || SOURCE_ORDER.indexOf(data.currentFilter) !== -1) {
      state.sourceFilter = data.currentFilter;
    }
  }

  function currentDisplay() {
    return {
      enabledSources: state.enabledSources.slice(),
      currentFilter: state.sourceFilter,
      showSourceLabel: state.showSourceLabel
    };
  }

  function persistDisplay() {
    var data = currentDisplay();
    saveLocalDisplay(data);
    fetch(API + '/api/display', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(function () {});
  }

  function loadDisplay() {
    applyDisplay(readLocalDisplay());
    return fetch(API + '/api/display', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        applyDisplay(data);
        saveLocalDisplay(currentDisplay());
      })
      .catch(function () {});
  }

  function computeSourceCounts() {
    var counts = {};
    state.items.forEach(function (item) {
      sourcesOf(item).forEach(function (key) {
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    state.sourceCounts = counts;
  }

  function sourceKeys() {
    var keys = [];
    SOURCE_ORDER.forEach(function (key) {
      if (state.sourceCounts[key]) keys.push(key);
    });
    Object.keys(state.sourceCounts).forEach(function (key) {
      if (keys.indexOf(key) === -1) keys.push(key);
    });
    return keys;
  }

  function enabledSourceKeys() {
    return sourceKeys().filter(function (key) {
      return state.enabledSources.indexOf(key) !== -1;
    });
  }

  function restoreSourceFilter() {
    var enabled = enabledSourceKeys();
    if (state.sourceFilter !== 'all' && enabled.indexOf(state.sourceFilter) === -1) {
      state.sourceFilter = 'all';
    }
  }

  function updateSourceFilter() {
    var wrap = $('sourceFilter');
    var keys = enabledSourceKeys();
    wrap.innerHTML = '';
    wrap.hidden = keys.length < 2;
    $('sourceBtn').hidden = sourceKeys().length < 2;
    if (keys.length < 2) return;

    var options = [{ key: 'all', label: '全部' }];
    keys.forEach(function (key) { options.push({ key: key, label: sourceLabel(key) }); });
    options.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mn-filter-btn' + (state.sourceFilter === opt.key ? ' is-active' : '');
      btn.setAttribute('data-source', opt.key);
      btn.textContent = opt.label;
      wrap.appendChild(btn);
    });
  }

  function renderSourceSettings() {
    var panel = $('sourceSettings');
    panel.innerHTML = '';

    var title = document.createElement('p');
    title.className = 'mn-set-title';
    title.textContent = '显示来源';
    panel.appendChild(title);

    sourceKeys().forEach(function (key) {
      var row = document.createElement('label');
      row.className = 'mn-set-row';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = state.enabledSources.indexOf(key) !== -1;
      input.setAttribute('data-source', key);
      var text = document.createElement('span');
      text.textContent = sourceLabel(key);
      row.appendChild(input);
      row.appendChild(text);
      panel.appendChild(row);
    });

    var labelRow = document.createElement('label');
    labelRow.className = 'mn-set-row';
    var labelInput = document.createElement('input');
    labelInput.type = 'checkbox';
    labelInput.id = 'showLabelToggle';
    labelInput.checked = state.showSourceLabel;
    var labelText = document.createElement('span');
    labelText.textContent = '显示来源标签';
    labelRow.appendChild(labelInput);
    labelRow.appendChild(labelText);
    panel.appendChild(labelRow);

    var hint = document.createElement('p');
    hint.className = 'mn-set-hint';
    hint.textContent = '至少保留一个来源；勾选即保存。';
    panel.appendChild(hint);
  }

  function matchesSource(item) {
    var sources = sourcesOf(item);
    var visible = false;
    for (var i = 0; i < sources.length; i++) {
      if (state.enabledSources.indexOf(sources[i]) !== -1) { visible = true; break; }
    }
    if (!visible) return false;
    if (state.sourceFilter === 'all') return true;
    return sources.indexOf(state.sourceFilter) !== -1;
  }

  function blockedByLogin(res) {
    return res.status === 401 || res.status === 403;
  }

  function showLoginWall() {
    state.needLogin = true;
    var wall = $('loginWall');
    if (wall) wall.hidden = false;
    document.body.classList.add('mn-locked');
  }

  function loadFavorites() {
    return fetch(API + '/api/favorites', { cache: 'no-store' })
      .then(function (res) {
        if (blockedByLogin(res)) {
          showLoginWall();
          throw new Error('需要登录');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var items = Array.isArray(data) ? data : (data.items || []);
        state.items = items.filter(function (item) {
          return item && item.id && typeof item.lng === 'number' && typeof item.lat === 'number';
        });
        state.syncedAt = data.syncedAt || null;
        state.skipped = (data.skipped && data.skipped.noCoord) ? data.skipped : null;
        computeSourceCounts();
        updateSyncMeta();
        return state.items.length;
      });
  }

  function updateSyncMeta() {
    var el = $('metaSync');
    if (!state.items.length) {
      el.textContent = '收藏数据为空';
      el.classList.remove('is-stale');
      return;
    }
    var age = fmtAge(state.syncedAt);
    var stale = false;
    if (state.syncedAt) {
      var hours = (Date.now() - new Date(state.syncedAt).getTime()) / 3600000;
      stale = hours > 72;
    }
    el.textContent = (stale ? '超过 3 天未同步' : (age ? '更新于 ' + age : '更新时间未知')) +
      ' · ' + state.items.length + ' 个点';
    el.classList.toggle('is-stale', stale);
    el.title = state.skipped && state.skipped.noCoord
      ? '另有 ' + state.skipped.noCoord + ' 条无坐标已跳过'
      : '';
  }

  function loadNotes() {
    return fetch(API + '/api/notes', { cache: 'no-store' })
      .then(function (res) {
        if (blockedByLogin(res)) {
          showLoginWall();
          throw new Error('需要登录');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.notes = (data && data.notes) || {};
        state.notesReady = true;
        $('dNote').disabled = false;
        setSaveState('idle');
      })
      .catch(function () {
        state.notesReady = false;
        $('dNote').disabled = true;
        setSaveState('off');
        if (state.needLogin) return;
        toast('备注服务未启动：请用 python3 tools/serve.py 打开页面，直接双击 html 无法保存备注', 7000);
      });
  }

  function doSave(pending) {
    if (!state.notesReady || !pending) return;
    setSaveState('saving');
    fetch(API + '/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pending.id, text: pending.text })
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function () {
      setSaveState('saved');
    }).catch(function () {
      setSaveState('error');
    });
  }

  function setSaveState(kind) {
    var dot = $('saveDot');
    var text = $('saveText');
    $('saveRow').hidden = kind === 'idle';
    dot.className = 'mn-dot mn-dot-' + kind;
    text.textContent = {
      idle: '',
      saved: '已保存',
      saving: '保存中…',
      error: '保存失败，检查服务后继续输入重试',
      off: '备注需要本地服务才能保存'
    }[kind] || '';
    $('detail').classList.toggle('is-error', kind === 'error' || kind === 'off');
  }

  function flushNote(useBeacon) {
    if (state.noteTimer) {
      clearTimeout(state.noteTimer);
      state.noteTimer = null;
    }
    if (!state.pending) return;
    var pending = state.pending;
    state.pending = null;
    if (useBeacon && navigator.sendBeacon && state.notesReady) {
      navigator.sendBeacon(
        API + '/api/notes',
        new Blob([JSON.stringify(pending)], { type: 'application/json' })
      );
    } else {
      doSave(pending);
    }
  }

  /* ---------- 筛选与渲染 ---------- */

  function noteTextOf(id) {
    var note = state.notes[id];
    return note && typeof note.text === 'string' ? note.text : '';
  }

  // 旧版备注的键是来源原始 id（如 B0FFHOELTS），现在条目 id 带来源前缀（amap:B0FFHOELTS）。
  // 直接用 item.id 找不到时，回退到 sourceIds 里的原始 id，避免旧备注「消失」。
  function itemNoteText(item) {
    if (!item) return '';
    var text = noteTextOf(item.id);
    if (text) return text;
    var ids = item.sourceIds || {};
    for (var key in ids) {
      if (!Object.prototype.hasOwnProperty.call(ids, key)) continue;
      text = noteTextOf(ids[key]);
      if (text) return text;
    }
    return '';
  }

  function matchesQuery(item) {
    var q = state.query.trim().toLowerCase();
    if (!q) return true;
    var hay = [item.name, item.address, itemNoteText(item)].concat(item.tags || []).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function distanceOf(item) {
    if (!state.pos) return null;
    return haversine(state.pos.lng, state.pos.lat, item.lng, item.lat);
  }

  function visibleItems() {
    var out = [];
    for (var i = 0; i < state.items.length; i++) {
      var item = state.items[i];
      if (!matchesSource(item)) continue;
      if (!matchesQuery(item)) continue;
      var dist = distanceOf(item);
      item._dist = dist;
      if (state.radiusOnly && dist !== null && dist > RADIUS) continue;
      out.push(item);
    }
    if (state.pos) {
      out.sort(function (a, b) { return a._dist - b._dist; });
    }
    return out;
  }

  function emptyHint() {
    if (!state.items.length) {
      return '还没有收藏数据。先在终端运行 python3 tools/sync_all.py，再刷新本页。';
    }
    if (state.sourceFilter !== 'all') {
      return '当前来源下没有地点。点上面的「全部」查看所有收藏。';
    }
    if (state.query.trim()) {
      return '没有匹配「' + state.query.trim() + '」的地点。';
    }
    if (!state.pos) {
      return '已显示全部收藏。点右上角 ◎ 定位，或在地图上点一下设定「我在这」。';
    }
    if (state.radiusOnly) {
      return '附近 ' + (RADIUS / 1000) + ' km 内没有收藏。点上面的「' + (RADIUS / 1000) + ' km 内」切换为全部。';
    }
    return '暂时没有可显示的地点。';
  }

  function renderList(keepScroll) {
    var list = $('list');
    var scrollTop = keepScroll ? list.scrollTop : 0;
    var items = visibleItems();
    var showSourceLabels = state.showSourceLabel && enabledSourceKeys().length > 1;
    list.innerHTML = '';

    items.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'mn-item' + (state.selected === item.id ? ' is-active' : '');
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');

      var main = document.createElement('div');
      main.className = 'mn-item-main';

      var name = document.createElement('p');
      name.className = 'mn-item-name';
      name.textContent = item.name;
      if (showSourceLabels) {
        sourcesOf(item).forEach(function (key) {
          var chip = document.createElement('span');
          chip.className = 'mn-src mn-src-' + key;
          chip.textContent = sourceLabel(key);
          name.appendChild(chip);
        });
      }
      main.appendChild(name);

      var preview = itemNoteText(item).split('\n')[0];
      var sub = document.createElement('p');
      sub.className = 'mn-item-sub';
      sub.textContent = preview || item.address || '还没有备注';
      if (!preview) sub.classList.add('is-muted');
      main.appendChild(sub);

      li.appendChild(main);

      var side = document.createElement('div');
      side.className = 'mn-item-side';
      if (item._dist !== null && item._dist !== undefined) {
        var dist = document.createElement('span');
        dist.className = 'mn-item-dist';
        dist.textContent = fmtDist(item._dist);
        side.appendChild(dist);
      }
      if (item.tags && item.tags.length) {
        var tag = document.createElement('span');
        tag.className = 'mn-item-tag';
        tag.textContent = item.tags[0];
        side.appendChild(tag);
      }
      li.appendChild(side);

      var open = function () { selectItem(item.id, true); };
      li.addEventListener('click', open);
      li.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });

      list.appendChild(li);
    });

    var countText;
    if (state.query.trim()) countText = '找到 ' + items.length + ' 个';
    else if (state.pos && state.radiusOnly) countText = '附近 ' + items.length + ' 个';
    else countText = '共 ' + items.length + ' 个';
    if (state.sourceFilter !== 'all') countText = sourceLabel(state.sourceFilter) + ' · ' + countText;
    $('listCount').textContent = countText;
    var radiusBtn = $('radiusBtn');
    var radiusOn = Boolean(state.pos) && state.radiusOnly;
    radiusBtn.textContent = radiusOn ? (RADIUS / 1000) + ' km 内' : '全部';
    radiusBtn.classList.toggle('is-off', !radiusOn);
    radiusBtn.title = state.pos ? '切换「附近 / 全部」' : '先定位后才能按距离筛选';

    var empty = $('empty');
    empty.hidden = items.length > 0;
    if (!items.length) empty.textContent = emptyHint();

    list.scrollTop = scrollTop;
    renderMarkers(items);
  }

  /* ---------- 详情与备注 ---------- */

  function selectItem(id, pan) {
    flushNote();
    var item = byId(id);
    if (!item) return;

    state.selected = id;
    var dist = distanceOf(item);
    $('dName').textContent = item.name;

    var meta = [];
    if (dist !== null) meta.push('距你 ' + fmtDist(dist));
    if (item.createdAt) meta.push('收藏于 ' + fmtDate(item.createdAt));
    if (state.showSourceLabel && enabledSourceKeys().length > 1) {
      meta.push('来源 ' + sourcesOf(item).map(sourceLabel).join(' + '));
    }
    $('dMeta').textContent = meta.join(' · ');

    var addr = $('dAddr');
    addr.textContent = item.address || '';
    addr.hidden = !item.address;

    var tags = $('dTags');
    tags.innerHTML = '';
    (item.tags || []).forEach(function (tag) {
      var chip = document.createElement('span');
      chip.className = 'mn-tag';
      chip.textContent = tag;
      tags.appendChild(chip);
    });
    tags.hidden = !(item.tags && item.tags.length);

    $('dNote').value = itemNoteText(item);
    autoGrow($('dNote'));
    var wasOpen = !$('detail').hidden;
    $('detail').hidden = false;
    document.body.classList.add('mn-detail-open');
    setSaveState(state.notesReady ? 'idle' : 'off');

    // 手机上按系统返回键应先回列表，而不是直接离开页面
    if (!wasOpen) {
      state.detailPushed = true;
      history.pushState({ mnDetail: id }, '');
    } else if (state.detailPushed) {
      history.replaceState({ mnDetail: id }, '');
    }

    renderMarkers();
    if (pan) focusPoint(item.lng, item.lat);
    markActiveListItem();
  }

  function closeDetail(fromPop) {
    flushNote();
    var wasOpen = !$('detail').hidden;
    $('detail').hidden = true;
    document.body.classList.remove('mn-detail-open');
    state.selected = null;
    renderList(true);
    markActiveListItem();
    if (wasOpen && !fromPop && state.detailPushed) {
      state.detailPushed = false;
      state.closingDetail = true;
      history.back();
    }
  }

  function autoGrow(el) {
    var max = Math.round(window.innerHeight * 0.36);
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  }

  function markActiveListItem() {
    var nodes = $('list').children;
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('is-active');
    }
    if (!state.selected) return;
    var items = visibleItems();
    for (var j = 0; j < items.length; j++) {
      if (items[j].id === state.selected && nodes[j]) {
        nodes[j].classList.add('is-active');
        break;
      }
    }
  }

  /* ---------- 地图 ---------- */

  function mapFallback(message) {
    var el = $('mapFallback');
    el.innerHTML = '';
    var title = document.createElement('strong');
    title.textContent = message;
    el.appendChild(title);
    var hint = document.createElement('span');
    hint.textContent = '地图不可用不影响列表、搜索与备注。';
    el.appendChild(hint);
    el.hidden = false;
  }

  function initMap() {
    if (!CFG.AMAP_KEY) {
      mapFallback('未配置高德 Key');
      return;
    }
    window._AMapSecurityConfig = { securityJsCode: CFG.AMAP_SECURITY_CODE || '' };
    var script = document.createElement('script');
    script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(CFG.AMAP_KEY);
    script.onload = function () { buildMap(); };
    script.onerror = function () { mapFallback('地图脚本加载失败（检查网络或 Key）'); };
    document.head.appendChild(script);
  }

  function buildMap() {
    if (!window.AMap) {
      mapFallback('地图初始化失败');
      return;
    }
    state.map = new AMap.Map('map', {
      zoom: zoomDefault(),
      center: [113.94, 22.55],
      viewMode: '2D',
      resizeEnable: true
    });
    state.map.on('click', function (event) {
      if (state.pickMode) {
        setPosition(event.lnglat.getLng(), event.lnglat.getLat(), 'pick');
        toast('已把这里设为「我在这」', 2500);
        return;
      }
      if (!$('detail').hidden) closeDetail();
    });
    centerMap();
    updateMeMarker();
    renderMarkers();
    if (!state.pos && $('metaPos').textContent.indexOf('无地图') !== -1) {
      $('metaPos').textContent = '未定位';
    }
  }

  // 把某个点摆到「没被底部卡片挡住」的可视区域中间。
  // 手机上下半屏被列表抽屉 / 详情卡盖住，直接 setCenter 会让点显得偏下。
  function focusPoint(lng, lat, zoom) {
    var map = state.map;
    if (!map) return;
    if (zoom) {
      map.setZoomAndCenter(zoom, [lng, lat], true);
    } else {
      map.setCenter([lng, lat], true);
    }
    if (window.innerWidth >= 900) return;

    // 只按「顶部搜索条下沿 → 底部卡片上沿」这段真正露出来的地图取中心
    var size = map.getSize();
    var h = size.getHeight();
    var topEl = document.querySelector('.mn-top');
    var top = topEl ? topEl.getBoundingClientRect().bottom : 0;
    var bottom = h;
    if (!$('detail').hidden) {
      bottom = $('detail').getBoundingClientRect().top;
    } else if ($('sheet').offsetHeight) {
      bottom = $('sheet').getBoundingClientRect().top;
    }
    var targetY = Math.round((top + bottom) / 2);
    targetY = Math.max(80, Math.min(h - 60, targetY));
    // 点已在容器正中；把「正中对称位置」的经纬度设为中心，点才会被抬到 targetY
    var mirrorY = h - targetY;
    map.setCenter(map.containerToLngLat(new AMap.Pixel(size.getWidth() / 2, mirrorY)), true);
  }

  function centerMap() {
    if (!state.map || state.mapCentered) return;
    if (state.pos) {
      state.map.setZoomAndCenter(zoomMe(), [state.pos.lng, state.pos.lat]);
    } else if (state.items.length) {
      state.map.setZoomAndCenter(zoomDefault(), [state.items[0].lng, state.items[0].lat]);
    } else {
      return;
    }
    state.mapCentered = true;
  }

  function renderMarkers(items) {
    if (!state.map) return;
    if (state.markers.length) {
      state.map.remove(state.markers);
      state.markers = [];
    }
    items = items || visibleItems();
    state.markers = items.map(function (item) {
      var marker = new AMap.Marker({
        position: [item.lng, item.lat],
        title: item.name,
        offset: new AMap.Pixel(-7, -7),
        content: '<div class="mn-pin' + (state.selected === item.id ? ' is-active' : '') + '"></div>'
      });
      marker.on('click', function () { selectItem(item.id, false); });
      return marker;
    });
    state.map.add(state.markers);
  }

  function updateMeMarker() {
    if (!state.map || !state.pos) return;
    if (!state.meMarker) {
      state.meMarker = new AMap.Marker({
        position: [state.pos.lng, state.pos.lat],
        offset: new AMap.Pixel(-9, -9),
        zIndex: 200,
        content: '<div class="mn-me"></div>'
      });
      state.map.add(state.meMarker);
    } else {
      state.meMarker.setPosition([state.pos.lng, state.pos.lat]);
    }
  }

  /* ---------- 定位 ---------- */

  function setPosition(lng, lat, source, accuracy, focus) {
    state.pos = { lng: lng, lat: lat, source: source, accuracy: accuracy || null };
    state.pickMode = false;
    document.body.classList.remove('mn-picking');
    var label = source === 'gps' ? '已定位' : '已设定位置';
    if (accuracy) label += '（±' + Math.round(accuracy) + ' m）';
    $('metaPos').textContent = label;
    updateMeMarker();
    if (state.map) {
      if (focus) {
        focusPoint(lng, lat, zoomMe());
      } else if (!state.mapCentered) {
        state.map.setZoomAndCenter(zoomDefault(), [lng, lat]);
      }
    }
    renderList();
  }

  function geolocate(focus) {
    if (!navigator.geolocation) {
      toast('这个浏览器不支持定位', 4000);
      startPick();
      return;
    }
    toast('正在定位…', 1500);
    navigator.geolocation.getCurrentPosition(function (position) {
      setPosition(
        position.coords.longitude,
        position.coords.latitude,
        'gps',
        position.coords.accuracy,
        focus
      );
    }, function (error) {
      var reason = error && error.code === 1 ? '定位权限被拒绝' : '定位失败';
      toast(reason + '。直接在地图上点一下设定位置（或稍后再点 ◎ 重试）', 6000);
      startPick();
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  function startPick() {
    if (!state.map) {
      $('metaPos').textContent = '未定位（无地图，无法点选）';
      return;
    }
    state.pickMode = true;
    document.body.classList.add('mn-picking');
    toast('在地图上点一下，把那里设为「我在这」', 5000);
  }

  /* ---------- 事件 ---------- */

  function bindEvents() {
    $('searchInput').addEventListener('input', function () {
      var value = this.value;
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () {
        state.query = value;
        renderList();
      }, 200);
    });

    $('locateBtn').addEventListener('click', function () { geolocate(true); });
    $('metaPos').addEventListener('click', startPick);

    $('radiusBtn').addEventListener('click', function () {
      if (!state.pos) {
        toast('先点右上角 ◎ 定位，才能按距离筛选', 3000);
        return;
      }
      state.radiusOnly = !state.radiusOnly;
      renderList();
    });

    $('sourceFilter').addEventListener('click', function (event) {
      var btn = event.target.closest('.mn-filter-btn');
      if (!btn) return;
      var value = btn.getAttribute('data-source');
      if (!value || value === state.sourceFilter) return;
      state.sourceFilter = value;
      persistDisplay();
      updateSourceFilter();
      renderList();
    });

    $('sourceBtn').addEventListener('click', function (event) {
      event.stopPropagation();
      var panel = $('sourceSettings');
      if (panel.hidden) {
        renderSourceSettings();
        panel.hidden = false;
      } else {
        panel.hidden = true;
      }
    });

    $('sourceSettings').addEventListener('change', function (event) {
      var input = event.target;
      if (input.id === 'showLabelToggle') {
        state.showSourceLabel = input.checked;
        persistDisplay();
        renderList();
        return;
      }
      var key = input.getAttribute('data-source');
      if (!key) return;
      var index = state.enabledSources.indexOf(key);
      if (input.checked && index === -1) state.enabledSources.push(key);
      if (!input.checked && index !== -1) state.enabledSources.splice(index, 1);
      if (!state.enabledSources.length) {
        state.enabledSources = SOURCE_ORDER.slice();
        toast('至少保留一个来源', 3000);
        renderSourceSettings();
        return;
      }
      state.enabledSources = SOURCE_ORDER.filter(function (item) {
        return state.enabledSources.indexOf(item) !== -1;
      });
      restoreSourceFilter();
      updateSourceFilter();
      renderSourceSettings();
      persistDisplay();
      renderList();
    });

    document.addEventListener('click', function (event) {
      var panel = $('sourceSettings');
      if (panel.hidden) return;
      if (event.target.closest('#sourceSettings') || event.target.closest('#sourceBtn')) return;
      panel.hidden = true;
    });

    // 列表框：点顶部横条切换展开，也支持直接上/下拉手势
    var sheetHead = document.querySelector('.mn-sheet-head');
    var sheetDrag = null;
    var sheetClickBlockedUntil = 0;

    function sheetOpen() { return document.body.classList.contains('mn-sheet-open'); }

    $('gripBtn').addEventListener('click', function () {
      if (Date.now() < sheetClickBlockedUntil) return;
      document.body.classList.toggle('mn-sheet-open');
    });

    sheetHead.addEventListener('click', function (event) {
      if (Date.now() < sheetClickBlockedUntil) return;
      if (event.target.closest('button')) return;
      document.body.classList.toggle('mn-sheet-open');
    });

    sheetHead.addEventListener('pointerdown', function (event) {
      if (event.button) return;
      if (event.target.closest('.mn-radius')) return;
      sheetDrag = { y: event.clientY, open: sheetOpen(), moved: false };
    });

    window.addEventListener('pointermove', function (event) {
      if (!sheetDrag) return;
      if (Math.abs(event.clientY - sheetDrag.y) > 8) sheetDrag.moved = true;
    });

    window.addEventListener('pointerup', function (event) {
      if (!sheetDrag) return;
      var dy = event.clientY - sheetDrag.y;
      var moved = sheetDrag.moved;
      var open = sheetDrag.open;
      sheetDrag = null;
      if (!moved) return;
      sheetClickBlockedUntil = Date.now() + 400;
      if (dy <= -24 && !open) document.body.classList.add('mn-sheet-open');
      if (dy >= 24 && open) document.body.classList.remove('mn-sheet-open');
    });

    window.addEventListener('pointercancel', function () { sheetDrag = null; });

    $('detailBack').addEventListener('click', function () { closeDetail(); });
    $('detailClose').addEventListener('click', function () { closeDetail(); });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('detail').hidden) closeDetail();
    });

    // 系统返回键 / 侧滑返回：有详情卡时只关详情
    window.addEventListener('popstate', function () {
      var echo = state.closingDetail;
      state.closingDetail = false;
      if (echo) return;
      state.detailPushed = false;
      if (!$('detail').hidden) closeDetail(true);
    });

    $('dNote').addEventListener('input', function () {
      if (!state.selected) return;
      autoGrow(this);
      state.pending = { id: state.selected, text: this.value };
      state.notes[state.selected] = { text: this.value };
      setSaveState('saving');
      clearTimeout(state.noteTimer);
      state.noteTimer = setTimeout(function () { flushNote(); }, 500);
    });

    $('dNote').addEventListener('blur', function () { flushNote(); });
    window.addEventListener('pagehide', function () { flushNote(true); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushNote();
    });

    // 头部搜索条在移动端收起详情时仍可点
    $('detail').addEventListener('click', function (event) { event.stopPropagation(); });

    var wallBtn = $('loginWallBtn');
    if (wallBtn) {
      wallBtn.addEventListener('click', function () {
        if (window.MNAuth && window.MNAuth.requireLogin) {
          window.MNAuth.requireLogin();
          return;
        }
        location.href = 'https://account.chesterlee.cn/login.html?productId=map-notes'
          + '&returnUrl=' + encodeURIComponent(location.href);
      });
    }
  }

  function init() {
    bindEvents();
    initMap();

    // 等统一账户静默登录 / 换会话 cookie 完成，再取数据（未登录时服务端会回 401）
    var authReady = (window.MNAuth && window.MNAuth.boot)
      ? window.MNAuth.boot()
      : Promise.resolve(null);

    authReady.catch(function () {}).then(function () {
      return Promise.all([loadFavorites(), loadNotes(), loadDisplay()]);
    })
      .then(function () {
        restoreSourceFilter();
        updateSourceFilter();
        renderList();
        centerMap();
        if (!state.pos) geolocate(false);
      })
      .catch(function () {
        if (state.needLogin) return;
        $('metaSync').textContent = '收藏数据未加载';
        $('empty').hidden = false;
        $('empty').textContent = '没有读到收藏数据。请确认已用 python3 tools/serve.py 打开页面，并跑过 python3 tools/sync.py。';
      });
  }

  init();
})();
