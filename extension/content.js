/* 留个点 · 地图收藏备注
 * 在高德 / 百度地图页面读取「我的收藏」，提供本地备注、搜索、距离排序与附近筛选。
 * 收藏只在当前浏览器读取和缓存，不上传；本版本备注也只存本机。
 */
(function () {
  'use strict';

  if (window.__mnMapNotesLoaded) return;
  window.__mnMapNotesLoaded = true;

  var MN = window.MNParse;
  var site = location.hostname.indexOf('amap.com') >= 0 ? 'amap'
    : (location.hostname.indexOf('map.baidu.com') >= 0 ? 'baidu' : '');
  if (!site || !MN) return;

  var FAV_KEY = 'mn:favorites';
  var NOTES_KEY = 'mn:notes';
  var UI_KEY = 'mn:ui';
  var BAIDU_FAV_URL = 'https://map.baidu.com/?newmap=1&reqflag=pcmap&biz=1&from=webmap' +
    '&da_par=direct&pcevaname=pc4.1&qt=fav&mode=get&type=favdata&limit=5000&lastver=0';
  var AMAP_FAV_URLS = ['/service/fav/getFav', '/ssr/api/cloudSync'];
  var STALE_MS = 10 * 60 * 1000;
  var SYNC_STALE_MS = 5 * 60 * 1000;
  var LOGIN_PAGE = 'https://account.chesterlee.cn/login.html?productId=map-notes&returnUrl=' +
    encodeURIComponent('https://map.chesterlee.cn/');

  var state = {
    open: false,
    loading: false,
    locating: false,
    error: '',
    favorites: {},
    notes: {},
    ui: { sort: 'distance', radius: 0 },
    position: null,
    query: '',
    expanded: '',
    shadow: null,
    refs: {},
    saveTimers: {},
    sync: { loggedIn: false, at: null, error: '', busy: false, hint: '' }
  };

  // ---------- 存储 ----------

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (data) { resolve(data || {}); });
    });
  }

  function storageSet(obj) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(obj, function () { resolve(); });
    });
  }

  function normalizeNotes(raw) {
    var notes = {};
    Object.keys(raw || {}).forEach(function (id) {
      var value = raw[id];
      if (typeof value === 'string') {
        if (value.trim()) notes[id] = { text: value, updatedAt: null };
      } else if (value && typeof value.text === 'string' && value.text.trim()) {
        notes[id] = { text: value.text, updatedAt: value.updatedAt || null };
      }
    });
    return notes;
  }

  // ---------- 备注同步（账户中心 Token，只同步备注文本） ----------

  function sendMessage(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (res) {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  function timeValue(iso) {
    var time = iso ? new Date(iso).getTime() : NaN;
    return isNaN(time) ? -1 : time;
  }

  function syncText() {
    if (state.sync.busy) return '同步中…';
    if (state.sync.hint) return state.sync.hint;
    if (state.sync.error) return '同步失败，点此重试';
    if (!state.sync.loggedIn) return '登录后多设备同步';
    return state.sync.at ? '已同步 ' + timeText(state.sync.at) : '已登录，待同步';
  }

  function syncNotes() {
    if (state.sync.busy) return Promise.resolve();
    state.sync.busy = true;
    state.sync.hint = '';
    updateFoot();

    return sendMessage({ type: 'mn:auth' }).then(function (auth) {
      state.sync.loggedIn = !!(auth && auth.ok && auth.loggedIn);
      if (!state.sync.loggedIn) return null;
      return sendMessage({ type: 'mn:pull' });
    }).then(function (pull) {
      if (!pull) return null;
      if (!pull.ok) throw new Error(pull.error === 'unauthorized' ? '登录已失效' : pull.error);
      var remote = normalizeNotes(pull.notes || {});
      var local = state.notes;
      var ids = Object.keys(local);
      Object.keys(remote).forEach(function (id) { if (!local[id]) ids.push(id); });

      var merged = {};
      var pushes = [];
      ids.forEach(function (id) {
        var mine = local[id];
        var theirs = remote[id];
        var mineAt = mine ? timeValue(mine.updatedAt) : -1;
        var theirsAt = theirs ? timeValue(theirs.updatedAt) : -1;
        if (mine && mineAt >= theirsAt) {
          merged[id] = mine;
          if (!theirs || mineAt > theirsAt) pushes.push(id);
        } else if (theirs) {
          merged[id] = theirs;
        }
      });

      state.notes = merged;
      return persistNotes().then(function () {
        return pushes.reduce(function (chain, id) {
          return chain.then(function () {
            return sendMessage({ type: 'mn:push', id: id, text: merged[id].text });
          });
        }, Promise.resolve());
      });
    }).then(function () {
      state.sync.busy = false;
      state.sync.error = '';
      state.sync.at = new Date().toISOString();
      render();
    }).catch(function (err) {
      state.sync.busy = false;
      state.sync.error = err && err.message ? err.message : String(err);
      updateFoot();
    });
  }

  function pushNote(id, text) {
    if (!state.sync.loggedIn) return;
    sendMessage({ type: 'mn:push', id: id, text: text }).then(function (res) {
      if (!res || !res.ok) {
        throw new Error(!res || res.error === 'unauthorized' ? '登录已失效' : res.error);
      }
      state.sync.error = '';
      state.sync.at = new Date().toISOString();
      updateFoot();
    }).catch(function (err) {
      state.sync.error = err && err.message ? err.message : String(err);
      updateFoot();
    });
  }

  function openLogin() {
    window.open(LOGIN_PAGE, '_blank', 'noopener');
    state.sync.hint = '登录完成后会自动同步';
    updateFoot();
  }

  function onSyncClick() {
    if (state.sync.busy) return;
    if (state.sync.loggedIn) syncNotes();
    else openLogin();
  }

  // ---------- 取数 ----------

  async function fetchAmap() {
    var last = '';
    for (var i = 0; i < AMAP_FAV_URLS.length; i++) {
      var url = AMAP_FAV_URLS[i];
      try {
        var res = await fetch(url, {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json, text/plain, */*' }
        });
        if (!res.ok) { last = 'HTTP ' + res.status; continue; }
        var text = await res.text();
        var head = text.trim().slice(0, 1);
        if (head !== '{' && head !== '[') { last = '返回的不是 JSON'; continue; }
        var items = MN.normalizeAmap(MN.collectItems(JSON.parse(text)));
        if (items.length) return items;
        last = '接口里没有地点';
      } catch (err) {
        last = err && err.message ? err.message : String(err);
      }
    }
    throw new Error('读取高德收藏失败：' + (last || '未知错误'));
  }

  async function fetchBaidu() {
    var res = await fetch(BAIDU_FAV_URL, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error('读取百度收藏失败：HTTP ' + res.status);
    var text = await res.text();
    if (text.trim().slice(0, 1) !== '{') throw new Error('读取百度收藏失败：返回不是 JSON，可能未登录');
    return MN.parseBaiduPayload(JSON.parse(text));
  }

  function refresh(source) {
    source = source || site;
    state.loading = true;
    state.error = '';
    render();

    var job = source === 'amap' ? fetchAmap() : fetchBaidu();
    job.then(function (items) {
      if (!items.length) throw new Error('没有读到收藏，请确认已在地图网页登录');
      var next = Object.assign({}, state.favorites);
      next[source] = { syncedAt: new Date().toISOString(), items: items };
      state.favorites = next;
      return storageSet((function () { var obj = {}; obj[FAV_KEY] = next; return obj; })());
    }).catch(function (err) {
      state.error = err && err.message ? err.message : String(err);
    }).then(function () {
      state.loading = false;
      render();
    });
  }

  function maybeRefresh() {
    var cached = state.favorites[site];
    if (!cached || !cached.items || !cached.items.length) return refresh(site);
    var age = Date.now() - new Date(cached.syncedAt || 0).getTime();
    if (age > STALE_MS) refresh(site);
  }

  // ---------- 数据整理 ----------

  function mergedItems() {
    var groups = {};
    Object.keys(state.favorites).forEach(function (source) {
      var cached = state.favorites[source];
      if (cached && Array.isArray(cached.items)) groups[source] = cached.items;
    });
    return MN.mergeSources(groups);
  }

  function distanceOf(item) {
    if (!state.position) return null;
    return MN.haversine(state.position.lng, state.position.lat, item.lng, item.lat);
  }

  function visibleItems() {
    var query = state.query.trim().toLowerCase();
    var radius = Number(state.ui.radius) || 0;
    var list = mergedItems().map(function (item) {
      var note = state.notes[item.id] ? state.notes[item.id].text : '';
      return { item: item, note: note, distance: distanceOf(item) };
    });

    if (query) {
      list = list.filter(function (entry) {
        return (entry.item.name + ' ' + entry.item.address + ' ' +
          (entry.item.tags || []).join(' ') + ' ' + entry.note).toLowerCase().indexOf(query) >= 0;
      });
    }

    if (radius && state.position) {
      list = list.filter(function (entry) { return entry.distance !== null && entry.distance <= radius; });
    }

    if (state.ui.sort === 'distance' && state.position) {
      list.sort(function (a, b) { return a.distance - b.distance; });
    } else {
      list.sort(function (a, b) { return String(a.item.name).localeCompare(String(b.item.name), 'zh-CN'); });
    }
    return list;
  }

  function counts() {
    var amap = state.favorites.amap && state.favorites.amap.items ? state.favorites.amap.items.length : 0;
    var baidu = state.favorites.baidu && state.favorites.baidu.items ? state.favorites.baidu.items.length : 0;
    return { amap: amap, baidu: baidu };
  }

  // ---------- 备注 ----------

  function setNote(id, text) {
    if (String(text || '').trim()) {
      state.notes[id] = { text: String(text), updatedAt: new Date().toISOString() };
    } else {
      delete state.notes[id];
    }
  }

  function persistNotes() {
    var obj = {};
    obj[NOTES_KEY] = state.notes;
    return storageSet(obj);
  }

  function scheduleSave(id, text) {
    if (state.saveTimers[id]) clearTimeout(state.saveTimers[id]);
    state.saveTimers[id] = setTimeout(function () {
      delete state.saveTimers[id];
      setNote(id, text);
      persistNotes().then(function () {
        markSaved(id);
        updateFoot();
        pushNote(id, text);
      });
    }, 500);
  }

  function saveNow(id, text) {
    if (state.saveTimers[id]) {
      clearTimeout(state.saveTimers[id]);
      delete state.saveTimers[id];
    }
    setNote(id, text);
    persistNotes().then(function () {
      markSaved(id);
      updateFoot();
      pushNote(id, text);
    });
  }

  function markSaved(id) {
    var nodes = state.shadow ? state.shadow.querySelectorAll('.mn-note-status') : [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-id') === id) {
        nodes[i].textContent = '已保存 ' + timeText(new Date().toISOString());
      }
    }
  }

  // ---------- 渲染 ----------

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function timeText(iso) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  }

  function distanceText(meters) {
    if (meters === null || meters === undefined) return '';
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + ' km';
  }

  function sourceBadges(item) {
    var sources = item.sources && item.sources.length ? item.sources : [item.source];
    var labels = { amap: '高德', baidu: '百度' };
    if (sources.length > 1) return '<span class="mn-badge mn-badge-both">双源</span>';
    return '<span class="mn-badge mn-badge-' + esc(sources[0]) + '">' + esc(labels[sources[0]] || sources[0]) + '</span>';
  }

  function itemHTML(entry) {
    var item = entry.item;
    var note = entry.note;
    var open = state.expanded === item.id;
    var tags = (item.tags || []).slice(0, 4).map(function (tag) {
      return '<span class="mn-tag">' + esc(tag) + '</span>';
    }).join('');
    var preview = !open && note
      ? '<div class="mn-note-preview">' + esc(note.length > 42 ? note.slice(0, 42) + '…' : note) + '</div>'
      : '';
    var editor = open ? (
      '<div class="mn-editor">' +
      '<textarea class="mn-note" data-id="' + esc(item.id) + '" rows="3" ' +
      'placeholder="写一句备注，例如：二楼靠窗、只收现金、停车从侧门进…">' + esc(note) + '</textarea>' +
      '<div class="mn-editor-foot">' +
      '<span class="mn-note-status" data-id="' + esc(item.id) + '">' +
      (note ? '已保存 ' + timeText(state.notes[item.id] && state.notes[item.id].updatedAt) : '') + '</span>' +
      '<button class="mn-link mn-note-del" type="button" data-id="' + esc(item.id) + '">清除备注</button>' +
      '</div></div>'
    ) : '';

    return '<div class="mn-item' + (open ? ' is-open' : '') + '" data-id="' + esc(item.id) + '">' +
      '<div class="mn-row">' +
      '<div class="mn-line1"><span class="mn-name">' + esc(item.name) + '</span>' +
      sourceBadges(item) +
      '<span class="mn-dist">' + esc(distanceText(entry.distance)) + '</span></div>' +
      (item.address ? '<div class="mn-addr">' + esc(item.address) + '</div>' : '') +
      (tags ? '<div class="mn-tags">' + tags + '</div>' : '') +
      preview +
      '</div>' + editor + '</div>';
  }

  function render() {
    ensureUI();
    var list = state.refs.list;
    var foot = state.refs.foot;
    var sub = state.refs.sub;
    if (!list || !foot || !sub) return;

    var all = mergedItems();
    var entries = visibleItems();
    var c = counts();

    sub.textContent = state.loading
      ? '正在读取收藏…'
      : (all.length ? '共 ' + all.length + ' 个点 · 高德 ' + c.amap + ' / 百度 ' + c.baidu : '还没有收藏数据');

    state.refs.refresh.disabled = state.loading;
    state.refs.refresh.textContent = state.loading ? '…' : '↻';

    if (!entries.length) {
      var hint = state.error
        ? '<div class="mn-empty mn-empty-error">' + esc(state.error) +
          '<div class="mn-empty-tip">请先在地图网页登录，确认「我的收藏」能正常打开，再点右上角刷新。</div>' +
          '<button class="mn-btn" type="button" data-action="refresh">重试</button></div>'
        : (all.length
          ? '<div class="mn-empty">没有符合条件的点<br><span class="mn-empty-tip">试试清空搜索，或把附近范围调大。</span></div>'
          : '<div class="mn-empty">' + (state.loading ? '正在读取…' : '还没有读到收藏') +
            '<div class="mn-empty-tip">打开地图网页并登录后，点右上角刷新。</div></div>');
      list.innerHTML = hint;
    } else {
      list.innerHTML = entries.map(itemHTML).join('');
    }

    var sortChips = state.refs.sortChips.querySelectorAll('.mn-chip');
    for (var i = 0; i < sortChips.length; i++) {
      sortChips[i].classList.toggle('is-on', sortChips[i].getAttribute('data-sort') === state.ui.sort);
    }
    var radiusChips = state.refs.radiusChips.querySelectorAll('.mn-chip[data-radius]');
    for (var j = 0; j < radiusChips.length; j++) {
      radiusChips[j].classList.toggle('is-on', Number(radiusChips[j].getAttribute('data-radius')) === Number(state.ui.radius));
    }
    state.refs.locate.textContent = state.locating ? '定位中…' : (state.position ? '已定位' : '定位');
    state.refs.locate.classList.toggle('is-on', !!state.position);

    updateFoot();
  }

  function updateFoot() {
    var foot = state.refs.foot;
    if (!foot) return;
    var parts = [];
    Object.keys(state.favorites).forEach(function (source) {
      var cached = state.favorites[source];
      if (cached && cached.syncedAt) {
        parts.push((source === 'amap' ? '高德' : '百度') + ' ' + timeText(cached.syncedAt));
      }
    });
    var noteCount = Object.keys(state.notes).length;
    foot.innerHTML = (state.error
      ? '<span class="mn-error">' + esc(state.error) + '</span> · '
      : '') +
      (parts.length ? '更新 ' + esc(parts.join(' · ')) + ' · ' : '') +
      '备注 ' + noteCount + ' 条 · ' +
      '<button class="mn-link mn-sync-link' + (state.sync.error ? ' is-error' : '') + '"' +
      ' type="button" data-action="sync" title="' +
      esc(state.sync.error || (state.sync.loggedIn ? '点此立即同步备注' : '登录统一账户后可在多设备同步备注')) +
      '">' + esc(syncText()) + '</button>';
  }

  // ---------- UI 骨架 ----------

  var CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.mn-launcher{position:fixed;right:60px;bottom:96px;pointer-events:auto;border:0;border-radius:999px;',
    'padding:10px 16px;background:#1f6feb;color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;',
    'box-shadow:0 6px 20px rgba(31,111,235,.35);cursor:pointer;z-index:2}',
    '.mn-launcher:hover{background:#1a5fd0}',
    '.mn-launcher.is-open{background:#3a3f47;box-shadow:0 6px 18px rgba(0,0,0,.25)}',
    '.mn-panel{position:fixed;right:56px;top:76px;width:360px;max-height:calc(100vh - 110px);display:flex;flex-direction:column;',
    'background:#fff;color:#1f2329;border-radius:14px;box-shadow:0 16px 48px rgba(15,23,42,.22);overflow:hidden;pointer-events:auto;z-index:3;',
    'font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}',
    '.mn-panel[hidden]{display:none!important}',
    '.mn-head{display:flex;align-items:flex-start;justify-content:space-between;padding:14px 14px 10px;border-bottom:1px solid #eef0f3}',
    '.mn-title{font-size:15px;font-weight:700;letter-spacing:.5px}',
    '.mn-sub{margin-top:2px;font-size:12px;color:#8a919e}',
    '.mn-actions{display:flex;gap:2px}',
    '.mn-icon{border:0;background:transparent;color:#6b7280;font-size:16px;line-height:1;width:26px;height:26px;border-radius:7px;cursor:pointer}',
    '.mn-icon:hover{background:#f1f3f5;color:#111}',
    '.mn-icon:disabled{cursor:default;opacity:.5}',
    '.mn-toolbar{padding:10px 12px 8px;border-bottom:1px solid #eef0f3;display:flex;flex-direction:column;gap:8px}',
    '.mn-search{width:100%;height:32px;border:1px solid #e3e6ea;border-radius:8px;padding:0 10px;font:inherit;color:#1f2329;background:#fafbfc;outline:none}',
    '.mn-search:focus{border-color:#1f6feb;background:#fff}',
    '.mn-chips{display:flex;gap:6px;flex-wrap:wrap}',
    '.mn-chip{border:1px solid #e3e6ea;background:#fff;color:#5b6270;border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}',
    '.mn-chip:hover{border-color:#c7ccd4;color:#1f2329}',
    '.mn-chip.is-on{background:#eef4ff;border-color:#b9d2ff;color:#1f6feb;font-weight:600}',
    '.mn-locate{margin-left:auto}',
    '.mn-list{flex:1;overflow:auto;overscroll-behavior:contain;min-height:80px}',
    '.mn-item{border-bottom:1px solid #f0f2f5;cursor:pointer}',
    '.mn-item:hover{background:#fafbfc}',
    '.mn-item.is-open{background:#f7f9fc}',
    '.mn-row{padding:10px 12px}',
    '.mn-line1{display:flex;align-items:center;gap:6px}',
    '.mn-name{font-weight:600;font-size:13px;color:#111827;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mn-badge{flex:none;font-size:10px;line-height:1;padding:3px 5px;border-radius:4px;border:1px solid transparent}',
    '.mn-badge-amap{background:#eef6ff;color:#1f6feb;border-color:#d6e6ff}',
    '.mn-badge-baidu{background:#fff3ee;color:#d9481c;border-color:#ffded2}',
    '.mn-badge-both{background:#f0f0ff;color:#5856d6;border-color:#e2e1ff}',
    '.mn-dist{flex:none;font-size:11px;color:#8a919e;font-variant-numeric:tabular-nums}',
    '.mn-addr{margin-top:2px;font-size:12px;color:#8a919e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mn-tags{margin-top:5px;display:flex;gap:4px;flex-wrap:wrap}',
    '.mn-tag{font-size:11px;color:#6b7280;background:#f3f4f6;border-radius:4px;padding:1px 6px}',
    '.mn-note-preview{margin-top:4px;font-size:12px;color:#3f4653;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.mn-editor{padding:0 12px 10px}',
    '.mn-note{width:100%;min-height:62px;resize:vertical;border:1px solid #e3e6ea;border-radius:8px;padding:8px;font:inherit;color:#1f2329;background:#fff;outline:none}',
    '.mn-note:focus{border-color:#1f6feb}',
    '.mn-editor-foot{display:flex;align-items:center;justify-content:space-between;margin-top:4px}',
    '.mn-note-status{font-size:11px;color:#9aa1ac}',
    '.mn-link{border:0;background:transparent;color:#1f6feb;font:inherit;font-size:12px;cursor:pointer;padding:0}',
    '.mn-sync-link{font-size:11px;color:#8a919e}',
    '.mn-sync-link:hover{color:#1f6feb}',
    '.mn-sync-link.is-error{color:#d14343}',
    '.mn-foot{padding:8px 12px;border-top:1px solid #eef0f3;font-size:11px;color:#9aa1ac;background:#fcfcfd}',
    '.mn-error{color:#d14343}',
    '.mn-empty{padding:36px 18px;text-align:center;color:#6b7280;font-size:13px}',
    '.mn-empty-error{color:#b42318}',
    '.mn-empty-tip{margin-top:8px;font-size:12px;color:#9aa1ac;line-height:1.6}',
    '.mn-btn{margin-top:12px;border:1px solid #e3e6ea;background:#fff;border-radius:8px;padding:6px 14px;font:inherit;font-size:12px;cursor:pointer;color:#1f2329}',
    '.mn-btn:hover{border-color:#c7ccd4}',
    '@media (max-width:720px){.mn-panel{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:70vh}.mn-launcher{bottom:18px;right:14px}}'
  ].join('');

  var HTML = [
    '<button class="mn-launcher" type="button" title="打开留个点">留个点</button>',
    '<section class="mn-panel" hidden>',
    '<header class="mn-head"><div><div class="mn-title">留个点</div><div class="mn-sub" data-ref="sub">正在读取…</div></div>',
    '<div class="mn-actions"><button class="mn-icon" type="button" data-ref="refresh" title="重新读取收藏">↻</button>',
    '<button class="mn-icon" type="button" data-ref="close" title="收起">×</button></div></header>',
    '<div class="mn-toolbar">',
    '<input class="mn-search" data-ref="search" type="search" placeholder="搜索名称、地址、标签或备注">',
    '<div class="mn-chips" data-ref="sortChips">',
    '<button class="mn-chip is-on" type="button" data-sort="distance">距我最近</button>',
    '<button class="mn-chip" type="button" data-sort="name">按名称</button>',
    '</div>',
    '<div class="mn-chips" data-ref="radiusChips">',
    '<button class="mn-chip is-on" type="button" data-radius="0">全部</button>',
    '<button class="mn-chip" type="button" data-radius="1000">1km</button>',
    '<button class="mn-chip" type="button" data-radius="3000">3km</button>',
    '<button class="mn-chip" type="button" data-radius="10000">10km</button>',
    '<button class="mn-chip mn-locate" type="button" data-ref="locate">定位</button>',
    '</div></div>',
    '<div class="mn-list" data-ref="list"></div>',
    '<footer class="mn-foot" data-ref="foot"></footer>',
    '</section>'
  ].join('');

  function ensureUI() {
    if (state.shadow) return;
    var host = document.createElement('div');
    host.id = 'mn-root';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    (document.body || document.documentElement).appendChild(host);
    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style>' + CSS + '</style>' + HTML;
    state.shadow = shadow;

    var refs = state.refs;
    refs.launcher = shadow.querySelector('.mn-launcher');
    refs.panel = shadow.querySelector('.mn-panel');
    refs.sub = shadow.querySelector('[data-ref="sub"]');
    refs.refresh = shadow.querySelector('[data-ref="refresh"]');
    refs.close = shadow.querySelector('[data-ref="close"]');
    refs.search = shadow.querySelector('[data-ref="search"]');
    refs.sortChips = shadow.querySelector('[data-ref="sortChips"]');
    refs.radiusChips = shadow.querySelector('[data-ref="radiusChips"]');
    refs.locate = shadow.querySelector('[data-ref="locate"]');
    refs.list = shadow.querySelector('[data-ref="list"]');
    refs.foot = shadow.querySelector('[data-ref="foot"]');

    refs.launcher.addEventListener('click', toggle);
    refs.close.addEventListener('click', function () { toggle(false); });
    refs.refresh.addEventListener('click', function () { refresh(site); });
    refs.search.addEventListener('input', function () {
      state.query = refs.search.value;
      state.expanded = '';
      render();
    });
    refs.sortChips.addEventListener('click', function (event) {
      var chip = event.target.closest('.mn-chip');
      if (!chip) return;
      state.ui.sort = chip.getAttribute('data-sort');
      if (state.ui.sort === 'distance' && !state.position) locate();
      persistUi();
      render();
    });
    refs.radiusChips.addEventListener('click', function (event) {
      var chip = event.target.closest('.mn-chip[data-radius]');
      if (!chip) return;
      state.ui.radius = Number(chip.getAttribute('data-radius')) || 0;
      if (state.ui.radius && !state.position) locate();
      persistUi();
      render();
    });
    refs.locate.addEventListener('click', locate);
    refs.foot.addEventListener('click', function (event) {
      if (event.target.closest('[data-action="sync"]')) onSyncClick();
    });
    refs.list.addEventListener('click', onListClick);
    refs.list.addEventListener('input', onNoteInput);
    refs.list.addEventListener('blur', onNoteBlur, true);
    refs.list.addEventListener('click', function (event) {
      var retry = event.target.closest('[data-action="refresh"]');
      if (retry) refresh(site);
    });
  }

  function persistUi() {
    var obj = {};
    obj[UI_KEY] = state.ui;
    storageSet(obj);
  }

  function toggle(force) {
    state.open = typeof force === 'boolean' ? force : !state.open;
    ensureUI();
    state.refs.panel.hidden = !state.open;
    state.refs.launcher.classList.toggle('is-open', state.open);
    state.refs.launcher.textContent = state.open ? '收起' : '留个点';
    if (state.open) {
      render();
      maybeRefresh();
      var syncAge = state.sync.at ? Date.now() - new Date(state.sync.at).getTime() : Infinity;
      if (syncAge > SYNC_STALE_MS) syncNotes();
    }
  }

  function onListClick(event) {
    var del = event.target.closest('.mn-note-del');
    if (del) {
      event.stopPropagation();
      var delId = del.getAttribute('data-id');
      saveNow(delId, '');
      state.expanded = '';
      render();
      return;
    }
    var item = event.target.closest('.mn-item');
    if (!item) return;
    if (event.target.closest('.mn-editor')) return;
    var id = item.getAttribute('data-id');
    state.expanded = state.expanded === id ? '' : id;
    render();
    if (state.expanded) {
      var area = state.refs.list.querySelector('.mn-note');
      if (area) {
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      }
    }
  }

  function onNoteInput(event) {
    var area = event.target.closest('.mn-note');
    if (!area) return;
    var id = area.getAttribute('data-id');
    setNote(id, area.value);
    var statuses = state.refs.list.querySelectorAll('.mn-note-status');
    for (var i = 0; i < statuses.length; i++) {
      if (statuses[i].getAttribute('data-id') === id) statuses[i].textContent = '保存中…';
    }
    scheduleSave(id, area.value);
  }

  function onNoteBlur(event) {
    var area = event.target.closest('.mn-note');
    if (!area) return;
    var id = area.getAttribute('data-id');
    saveNow(id, area.value);
  }

  function locate() {
    if (!navigator.geolocation) {
      state.error = '当前浏览器不支持定位';
      render();
      return;
    }
    if (state.locating) return;
    state.locating = true;
    state.error = '';
    render();
    navigator.geolocation.getCurrentPosition(function (position) {
      state.position = { lng: position.coords.longitude, lat: position.coords.latitude };
      state.locating = false;
      render();
    }, function (err) {
      state.locating = false;
      state.error = '定位失败：' + (err && err.message ? err.message : '请允许浏览器定位');
      render();
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.type === 'mn:toggle') toggle();
  });

  // 在 map.chesterlee.cn 上登录成功后，后台会写入 Token，这里立刻补同步
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes['mn:auth']) syncNotes();
  });

  storageGet([FAV_KEY, NOTES_KEY, UI_KEY]).then(function (data) {
    state.favorites = data[FAV_KEY] || {};
    state.notes = normalizeNotes(data[NOTES_KEY] || {});
    state.ui = Object.assign({ sort: 'distance', radius: 0 }, data[UI_KEY] || {});
    render();
    syncNotes();
  });
})();
