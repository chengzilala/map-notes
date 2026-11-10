/* ============================================================
   map-notes · 我的收藏画像
   只读取本人 /api/favorites 与 /api/notes，全部在浏览器本地计算；
   不新增服务端统计接口，也不上传任何新数据。
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.MN_CONFIG || {};
  var API_BASE = String(CFG.API_BASE || '').replace(/\/+$/, '');
  var MAX_MONTHS = 12;
  var CITY_BLACKLIST = { '超市': 1, '城市': 1, '市场': 1, '夜市': 1, '菜市场': 1, '股市': 1 };
  var CITY_ALIAS = { '内蒙': '内蒙古', '香港': '香港', '澳门': '澳门' };
  var CATEGORY_SET = {
    '生活': 1, '景点': 1, '购物': 1, '酒店': 1, '房产': 1, '教育': 1, '企业': 1,
    '美食': 1, '医院': 1, '地铁站': 1, '交通': 1, '公园': 1, '学校': 1,
    '超市': 1, '餐厅': 1, '咖啡': 1, '商场': 1, '停车场': 1, '小区': 1,
    '公司': 1, '其他': 1
  };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var BUCKETS = ['深夜', '上午', '下午', '晚上'];

  var state = {
    auth: null,
    items: [],
    notes: {},
    status: null
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtInt(n) { return Number(n || 0).toLocaleString('zh-CN'); }

  function pct(part, total) {
    if (!total) return '0%';
    var v = (part / total) * 100;
    if (part > 0 && v < 1) return '<1%';
    return Math.round(v) + '%';
  }

  function parseDate(value) {
    if (!value) return null;
    var d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(d) {
    if (!d) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function fmtMonth(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function fmtMonthCn(key) {
    var parts = String(key || '').split('-');
    if (parts.length < 2) return key;
    return Number(parts[0]) + ' 年 ' + Number(parts[1]) + ' 月';
  }

  function fmtSpan(days) {
    if (!days || days < 1) return '1 天';
    if (days < 60) return days + ' 天';
    var months = Math.round(days / 30.4);
    if (months < 24) return months + ' 个月';
    var years = Math.floor(months / 12);
    var rest = months % 12;
    return years + ' 年' + (rest ? ' ' + rest + ' 个月' : '');
  }

  function apiUrl(path) { return (API_BASE || '') + path; }

  function fetchJson(path) {
    return fetch(apiUrl(path), {
      credentials: 'include',
      cache: 'no-store'
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var err = new Error('auth');
        err.auth = true;
        throw err;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function showState(id, text) {
    var node = $(id);
    if (!node) return;
    node.textContent = text;
    node.hidden = false;
  }

  function hideState(id) {
    var node = $(id);
    if (node) node.hidden = true;
  }

  /* ---------- 数据整理 ---------- */

  function tagsOf(item) {
    var list = item && item.tags;
    if (!Array.isArray(list)) return [];
    var seen = {};
    var out = [];
    list.forEach(function (tag) {
      var s = String(tag || '').trim();
      if (!s || seen[s]) return;
      seen[s] = 1;
      out.push(s);
    });
    return out;
  }

  function sourcesOf(item) {
    var out = [];
    var src = item && (item.sources || item.source);
    if (Array.isArray(src)) out = src.slice();
    else if (typeof src === 'string' && src) out = [src];
    if (!out.length && item && item.sourceIds && typeof item.sourceIds === 'object') {
      out = Object.keys(item.sourceIds);
    }
    return out.map(function (s) { return String(s || '').toLowerCase(); }).filter(Boolean);
  }

  function noteOf(item) {
    var ids = [];
    if (!item) return { text: '', updatedAt: '' };
    if (item.id) ids.push(String(item.id));
    if (item.sourceIds && typeof item.sourceIds === 'object') {
      Object.keys(item.sourceIds).forEach(function (k) {
        if (item.sourceIds[k]) ids.push(String(item.sourceIds[k]));
      });
    }
    for (var i = 0; i < ids.length; i += 1) {
      var note = state.notes[ids[i]];
      if (note && typeof note === 'object' && typeof note.text === 'string' && note.text.trim()) {
        return { text: note.text.trim(), updatedAt: note.updatedAt || '' };
      }
    }
    return { text: '', updatedAt: '' };
  }

  function isCityName(tag) {
    var s = String(tag || '');
    if (s.length < 3 || CITY_BLACKLIST[s]) return false;
    return /(市|自治州|地区|盟)$/.test(s);
  }

  function cityFromAddress(address) {
    var s = String(address || '').replace(/\s+/g, '');
    if (!s) return '';
    // 只从地址开头识别，避免把「农贸市场」这类词误判成城市。
    var province = '(?:[\\u4e00-\\u9fa5]{2,10}?(?:省|自治区|特别行政区))';
    var m = s.match(new RegExp('^(?:中国)?' + province + '?([\\u4e00-\\u9fa5]{2,6}市)'));
    if (m) return m[1];
    m = s.match(new RegExp('^(?:中国)?' + province + '?([\\u4e00-\\u9fa5]{2,12}(?:自治州|地区|盟))'));
    return m ? m[1] : '';
  }

  function districtFromAddress(address) {
    var s = String(address || '').replace(/\s+/g, '');
    if (!s) return '';
    // 同样只认地址开头的区县，避免把「幸福小区」当成行政区。
    var province = '(?:[\\u4e00-\\u9fa5]{2,10}?(?:省|自治区|特别行政区))';
    var city = '(?:[\\u4e00-\\u9fa5]{2,6}市)?';
    var m = s.match(new RegExp('^(?:中国)?' + province + '?' + city + '([\\u4e00-\\u9fa5]{2,6}?(?:区|县|旗))'));
    return m ? m[1] : '';
  }

  function buildCitySet(items) {
    var set = {};
    items.forEach(function (item) {
      tagsOf(item).forEach(function (tag) {
        if (isCityName(tag)) set[tag] = 1;
      });
    });
    return set;
  }

  function normalizeCityTag(tag, citySet) {
    var s = String(tag || '').trim();
    if (!s) return '';
    if (CITY_ALIAS[s]) return CITY_ALIAS[s];
    if (isCityName(s)) return s;
    if (s.length >= 2 && citySet[s + '市']) return s + '市';
    return '';
  }

  function cityOfItem(item, citySet) {
    var tags = tagsOf(item);
    for (var i = 0; i < tags.length; i += 1) {
      var city = normalizeCityTag(tags[i], citySet);
      if (city) return city;
    }
    return cityFromAddress(item.address);
  }

  function shortCity(name) {
    var s = String(name || '');
    if (s === '内蒙古') return s;
    return s.replace(/市$/, '');
  }

  function displayName(name) {
    return String(name || '').trim() || '未命名地点';
  }

  function distanceKm(a, b) {
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var lat1 = a.lat * rad;
    var lat2 = b.lat * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function countBy(list, keyFn) {
    var map = {};
    list.forEach(function (item) {
      var key = keyFn(item);
      if (!key) return;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }

  function sortedEntries(map, limit) {
    return Object.keys(map).map(function (key) {
      return { label: key, value: map[key] };
    }).sort(function (a, b) {
      return b.value - a.value || a.label.localeCompare(b.label, 'zh-CN');
    }).slice(0, limit || 9999);
  }

  /* ---------- 渲染小工具 ---------- */

  function renderBars(container, entries, options) {
    if (!container) return;
    clear(container);
    options = options || {};
    if (!entries.length) {
      container.appendChild(el('p', 'st-footnote', options.empty || '暂时没有可统计的数据。'));
      return;
    }
    var max = Math.max.apply(null, entries.map(function (e) { return e.value; })) || 1;
    entries.forEach(function (entry) {
      var row = el('div', 'st-bar-row');
      var label = el('span', 'st-bar-label', entry.label);
      label.title = entry.title || entry.label;
      var track = el('div', 'st-bar-track');
      var fill = el('div', 'st-bar-fill');
      var width = Math.max(3, Math.round((entry.value / max) * 100));
      track.appendChild(fill);
      var value = el('span', 'st-bar-value', options.format ? options.format(entry.value) : fmtInt(entry.value));
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      container.appendChild(row);
      requestAnimationFrame(function () { fill.style.width = width + '%'; });
    });
  }

  function renderFacts(container, facts) {
    if (!container) return;
    clear(container);
    facts.forEach(function (factItem) {
      var box = el('div', 'st-fact');
      var value = el('b', '', factItem.value);
      if (factItem.title) value.title = factItem.title;
      box.appendChild(value);
      var hintText = [factItem.label, factItem.hint].filter(Boolean).join(' · ');
      if (hintText) box.appendChild(el('span', '', hintText));
      container.appendChild(box);
    });
  }

  function fact(label, value, hint, title) {
    return { label: label, value: value, hint: hint, title: title };
  }

  /* ---------- 账户 ---------- */

  function maskEmail(email) {
    var s = String(email || '');
    var at = s.indexOf('@');
    if (at < 1) return s;
    var name = s.slice(0, at);
    var show = name.slice(0, Math.min(2, name.length));
    return show + '***' + s.slice(at);
  }

  function freshness(status) {
    if (!status || !status.favorites) return '';
    var hours = status.favorites.ageHours;
    if (typeof hours === 'number') {
      if (hours < 1) return '刚刚更新';
      if (hours < 24) return Math.round(hours) + ' 小时前更新';
      return Math.round(hours / 24) + ' 天前更新';
    }
    var d = parseDate(status.favorites.syncedAt);
    return d ? ('更新于 ' + fmtDate(d)) : '';
  }

  function renderAccount() {
    var card = $('accountCard');
    if (!card) return;
    clear(card);

    var auth = state.auth || {};
    var user = auth.user;
    var main = el('div', 'st-account-main');
    var avatar = el('span', 'st-avatar');

    if (user && user.avatar) {
      var img = document.createElement('img');
      img.src = user.avatar;
      img.alt = '';
      avatar.appendChild(img);
    } else {
      var nameForAvatar = user && user.nickname ? user.nickname : '我';
      avatar.textContent = nameForAvatar.slice(0, 1);
    }

    var text = el('div', 'st-account-text');
    var title = el('h2', '', user ? (user.nickname || '我的账户') : '本地账户');
    var metaParts = [];
    if (user) {
      metaParts.push('统一账户');
      if (user.email) metaParts.push(maskEmail(user.email));
    } else {
      metaParts.push('未连接统一账户，仅显示当前设备数据');
    }
    var fresh = freshness(state.status);
    if (fresh) metaParts.push(fresh);
    var meta = el('p', '', metaParts.join(' · '));
    meta.title = metaParts.join(' · ');
    text.appendChild(title);
    text.appendChild(meta);

    main.appendChild(avatar);
    main.appendChild(text);

    var actions = el('div', 'st-account-actions');
    var center = document.createElement('a');
    center.href = (window.MNAuth && window.MNAuth.accountWeb) ? window.MNAuth.accountWeb() + '/account.html' : '#';
    center.textContent = user ? '账户中心' : '登录账户';
    if (!user) {
      center.href = '#';
      center.onclick = function (e) {
        e.preventDefault();
        if (window.MNAuth) window.MNAuth.requireLogin();
      };
    }
    var back = document.createElement('a');
    back.href = './';
    back.textContent = '返回地图';

    actions.appendChild(center);
    actions.appendChild(back);
    card.appendChild(main);
    card.appendChild(actions);
  }

  /* ---------- 收藏同步 ---------- */

  var syncPollTimer = null;

  function fmtSyncTime(iso) {
    var d = parseDate(iso);
    if (!d) return iso || '—';
    return (d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtSyncAge(hours) {
    if (hours === null || hours === undefined) return '—';
    if (hours < 1) return '刚刚';
    if (hours < 24) return Math.round(hours) + ' 小时前';
    return Math.round(hours / 24) + ' 天前';
  }

  function addSyncFact(box, label, value, title) {
    var fact = el('div', 'st-fact');
    var b = el('b', '', value);
    if (title) b.title = title;
    fact.appendChild(b);
    fact.appendChild(el('span', '', label));
    box.appendChild(fact);
  }

  function setSyncMessage(text) {
    var msg = $('syncMsg');
    if (msg) msg.textContent = text || '';
  }

  function renderSync() {
    var card = $('syncCard');
    if (!card) return;
    var status = state.status;
    if (!status || !status.favorites) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    var fav = status.favorites || {};
    var sync = status.sync || {};
    var facts = $('syncFacts');
    clear(facts);

    addSyncFact(facts, '地点数', (fav.count || 0) + ' 个');
    addSyncFact(facts, '更新时间', fmtSyncTime(fav.syncedAt), fav.syncedAt || '');
    var ageWarn = typeof fav.ageHours === 'number' && fav.ageHours > 72;
    addSyncFact(facts, '新鲜度', fmtSyncAge(fav.ageHours) + (ageWarn ? '，建议同步' : ''));

    var sources = sync.sources || {};
    var names = { amap: '高德', baidu: '百度' };
    var tones = { ok: '正常', not_configured: '未登录' };
    var parts = [];
    Object.keys(sources).forEach(function (key) {
      var meta = sources[key] || {};
      var name = names[key] || key;
      var tone = tones[meta.status] || '失败';
      parts.push(name + ' ' + (meta.count || 0) + ' 个（' + tone + '）');
    });
    addSyncFact(facts, '数据来源', parts.length ? parts.join('；') : '—', parts.join('\n'));

    var err = $('syncError');
    err.hidden = !sync.error;
    err.textContent = sync.error || '';

    var btn = $('syncBtn');
    btn.disabled = Boolean(sync.running);
    btn.textContent = sync.running ? '正在同步…' : '立即同步收藏';

    var relogin = $('syncRelogin');
    if (relogin) {
      var failed = !sync.running && Boolean(sync.error || sync.ok === false);
      relogin.hidden = !failed;
      if (failed) {
        var errorText = String(sync.error || '');
        relogin.href = errorText.indexOf('高德') >= 0 ? '/admin#amap-login'
          : (errorText.indexOf('百度') >= 0 ? '/admin#baidu-login' : '/admin');
      }
    }

    if (sync.running) {
      setSyncMessage('同步进行中，请稍候…');
      startSyncPolling();
    }
  }

  function startSyncPolling() {
    if (syncPollTimer) return;
    syncPollTimer = setInterval(function () {
      fetchJson('/api/status').then(function (data) {
        state.status = data;
        renderSync();
        if (data.sync && data.sync.running) return;
        stopSyncPolling();
        if (data.sync && data.sync.ok) {
          setSyncMessage('同步完成，正在刷新数据…');
          reloadAfterSync();
        } else {
          setSyncMessage('同步失败，请查看上方说明');
        }
      }).catch(function () {});
    }, 3000);
  }

  function stopSyncPolling() {
    if (!syncPollTimer) return;
    clearInterval(syncPollTimer);
    syncPollTimer = null;
  }

  function reloadAfterSync() {
    return loadData().then(function () {
      if (state.items.length) renderAll(compute());
      else renderSync();
      setSyncMessage('同步完成，数据已刷新');
    }).catch(function () {
      setSyncMessage('同步完成，刷新页面即可看到最新数据');
    });
  }

  function bindSyncButton() {
    var btn = $('syncBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = '正在同步…';
      setSyncMessage('正在启动同步…');
      fetch(apiUrl('/api/sync/run'), { method: 'POST', credentials: 'include' })
        .then(function (res) {
          if (res.status === 401 || res.status === 403) {
            var err = new Error('auth');
            err.auth = true;
            throw err;
          }
          return res.json().catch(function () { return {}; });
        })
        .then(function (data) {
          if (data && data.ok) {
            setSyncMessage('同步已启动，请稍候…');
            startSyncPolling();
          } else {
            btn.disabled = false;
            btn.textContent = '立即同步收藏';
            setSyncMessage((data && data.message) || '启动失败，请稍后重试');
          }
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = '立即同步收藏';
          setSyncMessage(err && err.auth ? '登录后即可同步' : '启动失败，请稍后重试');
        });
    });
  }

  /* ---------- 顶部数字 ---------- */

  function renderKpis(stats) {
    var box = $('kpis');
    if (!box) return;
    clear(box);

    var items = [
      { value: fmtInt(stats.total), label: '收藏地点' },
      { value: pct(stats.noteCount, stats.total), label: '备注覆盖率' },
      { value: fmtInt(stats.cityCount), label: '城市 / 地区' },
      { value: fmtSpan(stats.spanDays), label: '收藏跨度' }
    ];

    items.forEach(function (item) {
      var card = el('div', 'st-kpi');
      card.appendChild(el('b', '', item.value));
      card.appendChild(el('span', '', item.label));
      box.appendChild(card);
    });
  }

  function renderLede(stats) {
    var node = $('lede');
    if (!node) return;
    var text = '你收藏了 ' + fmtInt(stats.total) + ' 个地点';
    if (stats.cityCount) text += '，分布在 ' + fmtInt(stats.cityCount) + ' 个城市 / 地区';
    text += '；其中 ' + fmtInt(stats.taggedCount) + ' 个带标签，'
      + fmtInt(stats.noteCount) + ' 个写了备注。';
    node.textContent = text;
  }

  /* ---------- 时间线 ---------- */

  function renderTimeline(stats) {
    var yearBars = $('yearBars');
    var monthBars = $('monthBars');
    var hint = $('timelineHint');
    var rhythm = $('rhythm');
    if (!yearBars || !monthBars) return;
    clear(yearBars);
    clear(monthBars);

    if (!stats.dateCount) {
      if (hint) hint.textContent = '没有可用的收藏时间';
      if (rhythm) rhythm.textContent = '地图返回的收藏数据里没有时间字段，暂时无法分析收藏节奏。';
      return;
    }

    if (hint) hint.textContent = '有效时间 ' + fmtInt(stats.dateCount) + ' / ' + fmtInt(stats.total) + ' · 近 12 个月';

    var yearEntries = sortedEntries(stats.yearCounts, 99).sort(function (a, b) {
      return Number(a.label) - Number(b.label);
    });
    var maxYear = Math.max.apply(null, yearEntries.map(function (e) { return e.value; })) || 1;
    yearEntries.forEach(function (entry) {
      var row = el('div', 'st-bar-row');
      var label = el('span', 'st-bar-label', entry.label + ' 年');
      var track = el('div', 'st-bar-track');
      var fill = el('div', 'st-bar-fill');
      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(el('span', 'st-bar-value', fmtInt(entry.value)));
      yearBars.appendChild(row);
      requestAnimationFrame(function () {
        fill.style.width = Math.max(3, Math.round((entry.value / maxYear) * 100)) + '%';
      });
    });

    var monthMax = 0;
    stats.monthSeries.forEach(function (m) { if (m.count > monthMax) monthMax = m.count; });
    monthMax = monthMax || 1;

    stats.monthSeries.forEach(function (m) {
      var col = el('div', 'st-month');
      col.title = m.key + '：' + m.count + ' 个';
      var count = el('span', 'st-month-count', m.count ? m.count : '');
      var bar = el('div', 'st-month-bar');
      var h = m.count ? Math.max(4, Math.round((m.count / monthMax) * 100)) : 0;
      bar.style.height = h + '%';
      bar.style.opacity = m.count ? '1' : '0.18';
      var label = el('span', 'st-month-label', Number(m.key.slice(5)) + '月');
      col.appendChild(count);
      col.appendChild(bar);
      col.appendChild(label);
      monthBars.appendChild(col);
    });

    if (rhythm) {
      var parts = [];
      if (stats.topMonth) parts.push('最集中的月份是 ' + fmtMonthCn(stats.topMonth.label) + '（' + stats.topMonth.value + ' 个）');
      if (stats.topWeekday) parts.push('最常在' + stats.topWeekday.label + '收藏');
      if (stats.topBucket) parts.push('最常在' + stats.topBucket.label + '收藏');
      if (stats.topDay) parts.push('单日最多是 ' + stats.topDay.label + '（' + stats.topDay.value + ' 个）');
      rhythm.textContent = parts.join('；') + '。';
    }
  }

  /* ---------- 城市 / 类型 ---------- */

  function renderCities(stats) {
    var hint = $('cityHint');
    var note = $('cityNote');
    if (hint) hint.textContent = stats.cityCount ? stats.cityCount + ' 个' : '';
    renderBars($('cityBars'), stats.cityEntries.slice(0, 8), {
      empty: '地址和标签里都没识别出城市。'
    });
    if (note) {
      note.textContent = '城市来自地图标签和地址文字；已识别 ' + fmtInt(stats.cityItems)
        + ' / ' + fmtInt(stats.total) + ' 个点。';
    }
  }

  function renderCategories(stats) {
    var hint = $('categoryHint');
    var note = $('categoryNote');
    if (hint) hint.textContent = stats.categoryItems ? stats.categoryItems + ' 个点' : '';
    renderBars($('categoryBars'), stats.categoryEntries.slice(0, 8), {
      empty: '地图标签里没有可归类的类型。'
    });
    if (note) {
      note.textContent = '按「生活 / 景点 / 购物 / 酒店 / 教育」等常见类型归类；'
        + '标签覆盖 ' + fmtInt(stats.taggedCount) + ' / ' + fmtInt(stats.total) + ' 个点。';
    }
  }

  /* ---------- 来源 ---------- */

  function renderSources(stats) {
    var donut = $('sourceDonut');
    var totalNode = $('sourceTotal');
    var legend = $('sourceLegend');
    var hint = $('sourceHint');
    var note = $('sourceNote');
    if (!donut || !legend) return;
    clear(legend);

    if (hint) hint.textContent = '共 ' + fmtInt(stats.total) + ' 个';

    var segments = [
      { key: 'amap', label: '仅高德', color: '#1677ff', count: stats.sourceCounts.amapOnly },
      { key: 'baidu', label: '仅百度', color: '#12b886', count: stats.sourceCounts.baiduOnly },
      { key: 'both', label: '两个平台都有', color: '#f59f00', count: stats.sourceCounts.both },
      { key: 'other', label: '来源未知', color: '#a5acb8', count: stats.sourceCounts.other }
    ];

    var total = stats.total || 0;
    if (totalNode) totalNode.textContent = fmtInt(total);

    if (!total) {
      donut.style.background = '#f0f2f5';
    } else {
      var acc = 0;
      var parts = [];
      segments.forEach(function (seg) {
        if (!seg.count) return;
        var start = (acc / total) * 360;
        acc += seg.count;
        var end = (acc / total) * 360;
        parts.push(seg.color + ' ' + start.toFixed(2) + 'deg ' + end.toFixed(2) + 'deg');
      });
      donut.style.background = parts.length ? 'conic-gradient(' + parts.join(',') + ')' : '#f0f2f5';
    }

    segments.forEach(function (seg) {
      if (!seg.count) return;
      var row = el('div', 'st-legend-row');
      var dot = el('span', 'st-dot');
      dot.style.background = seg.color;
      row.appendChild(dot);
      row.appendChild(el('span', 'st-legend-name', seg.label));
      row.appendChild(el('span', 'st-legend-val', fmtInt(seg.count) + ' · ' + pct(seg.count, total)));
      legend.appendChild(row);
    });

    if (note) {
      note.textContent = '高德共 ' + fmtInt(stats.sourceCounts.amapTotal)
        + ' 个、百度共 ' + fmtInt(stats.sourceCounts.baiduTotal)
        + ' 个，其中 ' + fmtInt(stats.sourceCounts.both)
        + ' 个地点两个平台都收藏了（重合率 ' + pct(stats.sourceCounts.both, total) + '）。';
    }
  }

  /* ---------- 标签 ---------- */

  function renderTags(stats) {
    var hint = $('tagHint');
    var note = $('tagNote');
    if (hint) hint.textContent = stats.taggedCount ? '覆盖 ' + pct(stats.taggedCount, stats.total) : '';
    renderBars($('tagBars'), stats.tagEntries.slice(0, 12), {
      empty: '还没有标签数据。'
    });
    if (note) {
      note.textContent = '不含城市标签；共 ' + fmtInt(stats.tagEntries.length)
        + ' 种标签，累计出现 ' + fmtInt(stats.tagTotal) + ' 次。';
    }
  }

  /* ---------- 范围 ---------- */

  function renderRegion(stats) {
    var facts = $('regionFacts');
    var hint = $('regionHint');
    var note = $('regionNote');
    if (hint) hint.textContent = stats.geoCount ? fmtInt(stats.geoCount) + ' 个点有坐标' : '';
    if (!facts) return;

    if (!stats.geoCount) {
      renderFacts(facts, [fact('有坐标的收藏', '0 个', '暂时算不出范围')]);
      renderBars($('districtBars'), [], { empty: '' });
      if (note) note.textContent = '收藏数据里没有可用坐标，暂时无法估算收藏范围。';
      return;
    }

    var regionFacts = [
      fact('东西跨度', stats.spanWidth.toFixed(1) + ' km', '按最东与最西的直线距离估算'),
      fact('南北跨度', stats.spanHeight.toFixed(1) + ' km', '按最南与最北的直线距离估算'),
      fact('一半收藏在', stats.p50.toFixed(1) + ' km 内', '距所有收藏点的重心'),
      fact('80% 收藏在', stats.p80.toFixed(1) + ' km 内', '距所有收藏点的重心')
    ];
    if (stats.farthest) {
      regionFacts.push(fact(
        '最远的两点',
        stats.farthest.km.toFixed(0) + ' km',
        stats.farthest.a + ' ↔ ' + stats.farthest.b,
        stats.farthest.a + ' ↔ ' + stats.farthest.b
      ));
    }
    renderFacts(facts, regionFacts);

    renderBars($('districtBars'), stats.districtEntries.slice(0, 8), {
      empty: ''
    });

    if (note) {
      note.textContent = '区县只从地址文字里识别，覆盖 ' + fmtInt(stats.districtItems)
        + ' / ' + fmtInt(stats.total) + ' 个点；没有地址的收藏不会出现在这里。';
    }
  }

  /* ---------- 备注 ---------- */

  function renderNotes(stats) {
    var facts = $('noteFacts');
    var hint = $('noteHint');
    var note = $('noteNote');
    var list = $('longNotes');
    if (hint) hint.textContent = '覆盖 ' + pct(stats.noteCount, stats.total);
    if (!facts) return;

    renderFacts(facts, [
      fact('已写备注', fmtInt(stats.noteCount) + ' 个', '占全部收藏 ' + pct(stats.noteCount, stats.total)),
      fact('平均长度', fmtInt(stats.avgNoteLen) + ' 字', stats.noteCount ? '只统计已有备注' : '还没有备注'),
      fact('最长一条', fmtInt(stats.maxNoteLen) + ' 字', stats.maxNoteLen ? '写得很具体' : '还没有备注'),
      fact('最近更新', stats.latestNoteDate || '—', stats.latestNoteDate ? '备注最后修改时间' : '还没有备注')
    ]);

    if (!list) return;
    clear(list);
    if (!stats.longNotes.length) {
      list.appendChild(el('p', 'st-footnote', '还没有备注。回地图点开任意地点，写一句「为什么收藏它」。'));
      return;
    }
    stats.longNotes.forEach(function (entry) {
      var box = el('div', 'st-longnote');
      box.appendChild(el('h3', '', entry.name));
      box.appendChild(el('p', '', entry.text));
      box.appendChild(el('small', '', fmtInt(entry.len) + ' 字' + (entry.updatedAt ? ' · ' + entry.updatedAt : '')));
      list.appendChild(box);
    });

    if (note) note.textContent = '备注只属于你本人；这里只做字数与覆盖统计，不展示给其他人。';
  }

  /* ---------- 有趣的事实 ---------- */

  function renderFun(stats) {
    var box = $('funFacts');
    if (!box) return;
    var facts = [];

    facts.push(fact('今年收藏', fmtInt(stats.thisYearCount) + ' 个', String(new Date().getFullYear()) + ' 年新增'));

    if (stats.topYear) {
      facts.push(fact('收藏最多的一年', stats.topYear.label + ' 年', fmtInt(stats.topYear.value) + ' 个'));
    }

    if (stats.firstItem) {
      facts.push(fact('第一次收藏', stats.firstItem.date, stats.firstItem.name));
    }

    if (stats.lastItem) {
      facts.push(fact('最近一次收藏', stats.lastItem.date, stats.lastItem.name));
    }

    if (stats.topDay) {
      facts.push(fact('单日最多', stats.topDay.label, fmtInt(stats.topDay.value) + ' 个地点'));
    }

    if (stats.streakDays > 1) {
      facts.push(fact('最长连续收藏', fmtInt(stats.streakDays) + ' 天', stats.streakRange));
    }

    if (stats.duplicateName) {
      facts.push(fact('同名最多', stats.duplicateName.label, '出现 ' + stats.duplicateName.value + ' 次，可能是分店或重复'));
    }

    facts.push(fact('双平台重合', fmtInt(stats.sourceCounts.both) + ' 个',
      '占全部收藏 ' + pct(stats.sourceCounts.both, stats.total)));

    renderFacts(box, facts);
  }

  /* ---------- 主计算 ---------- */

  function compute() {
    var items = state.items;
    var total = items.length;
    var citySet = buildCitySet(items);
    var taggedCount = 0;
    var categoryItems = 0;
    var cityItems = 0;
    var geoItems = [];
    var dateItems = [];
    var yearCounts = {};
    var monthCounts = {};
    var weekdayCounts = {};
    var bucketCounts = {};
    var dayCounts = {};
    var cityCounts = {};
    var districtCounts = {};
    var categoryCounts = {};
    var rawTagCounts = {};
    var tagTotal = 0;
    var nameCounts = {};
    var noteItems = [];
    var noteLengths = [];
    var latestNote = null;
    var sourceCounts = { amapOnly: 0, baiduOnly: 0, both: 0, other: 0 };
    var firstItem = null;
    var lastItem = null;

    items.forEach(function (item) {
      var tags = tagsOf(item);
      if (tags.length) taggedCount += 1;

      var city = cityOfItem(item, citySet);
      if (city) {
        cityItems += 1;
        cityCounts[city] = (cityCounts[city] || 0) + 1;
      }

      var district = districtFromAddress(item.address);
      if (district) districtCounts[district] = (districtCounts[district] || 0) + 1;

      var hasCategory = false;
      tags.forEach(function (tag) {
        if (CATEGORY_SET[tag]) {
          categoryCounts[tag] = (categoryCounts[tag] || 0) + 1;
          hasCategory = true;
        }
        if (!isCityName(tag) && !CITY_ALIAS[tag] && !citySet[tag + '市']) {
          rawTagCounts[tag] = (rawTagCounts[tag] || 0) + 1;
          tagTotal += 1;
        }
      });
      if (hasCategory) categoryItems += 1;

      var src = sourcesOf(item);
      var hasAmap = src.indexOf('amap') >= 0;
      var hasBaidu = src.indexOf('baidu') >= 0;
      if (hasAmap && hasBaidu) sourceCounts.both += 1;
      else if (hasAmap) sourceCounts.amapOnly += 1;
      else if (hasBaidu) sourceCounts.baiduOnly += 1;
      else sourceCounts.other += 1;

      var lat = Number(item.lat);
      var lng = Number(item.lng);
      if (isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0) {
        geoItems.push({ lat: lat, lng: lng, name: displayName(item.name) });
      }

      var d = parseDate(item.createdAt);
      if (d) {
        dateItems.push(d);
        var y = d.getFullYear();
        var ym = fmtMonth(d);
        var day = fmtDate(d);
        var wd = WEEKDAYS[d.getDay()];
        var hour = d.getHours();
        var bucket = hour < 6 ? BUCKETS[0] : (hour < 12 ? BUCKETS[1] : (hour < 18 ? BUCKETS[2] : BUCKETS[3]));
        yearCounts[y] = (yearCounts[y] || 0) + 1;
        monthCounts[ym] = (monthCounts[ym] || 0) + 1;
        weekdayCounts[wd] = (weekdayCounts[wd] || 0) + 1;
        bucketCounts[bucket] = (bucketCounts[bucket] || 0) + 1;
        dayCounts[day] = (dayCounts[day] || 0) + 1;

        if (!firstItem || d < firstItem.dateObj) firstItem = { dateObj: d, date: day, name: displayName(item.name) };
        if (!lastItem || d > lastItem.dateObj) lastItem = { dateObj: d, date: day, name: displayName(item.name) };
      }

      var note = noteOf(item);
      if (note.text) {
        noteItems.push(item);
        noteLengths.push(note.text.length);
        var updated = parseDate(note.updatedAt);
        if (updated && (!latestNote || updated > latestNote)) latestNote = updated;
      }

      var nm = displayName(item.name);
      nameCounts[nm] = (nameCounts[nm] || 0) + 1;
    });

    var sortedDates = dateItems.slice().sort(function (a, b) { return a - b; });
    var spanDays = 0;
    if (sortedDates.length > 1) {
      spanDays = Math.max(1, Math.round((sortedDates[sortedDates.length - 1] - sortedDates[0]) / 86400000));
    } else if (sortedDates.length === 1) {
      spanDays = 1;
    }

    var monthSeries = [];
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth() - (MAX_MONTHS - 1), 1);
    for (var i = 0; i < MAX_MONTHS; i += 1) {
      var mDate = new Date(start.getFullYear(), start.getMonth() + i, 1);
      var key = fmtMonth(mDate);
      monthSeries.push({ key: key, count: monthCounts[key] || 0 });
    }

    var geoCount = geoItems.length;
    var spanWidth = 0;
    var spanHeight = 0;
    var p50 = 0;
    var p80 = 0;
    var farthest = null;

    if (geoCount) {
      var minLat = geoItems[0].lat, maxLat = geoItems[0].lat;
      var minLng = geoItems[0].lng, maxLng = geoItems[0].lng;
      var sumLat = 0, sumLng = 0;
      geoItems.forEach(function (p) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
        sumLat += p.lat;
        sumLng += p.lng;
      });
      var center = { lat: sumLat / geoCount, lng: sumLng / geoCount };
      spanWidth = distanceKm({ lat: center.lat, lng: minLng }, { lat: center.lat, lng: maxLng });
      spanHeight = distanceKm({ lat: minLat, lng: center.lng }, { lat: maxLat, lng: center.lng });

      var distances = geoItems.map(function (p) { return distanceKm(center, p); }).sort(function (a, b) { return a - b; });
      p50 = distances[Math.max(0, Math.floor(distances.length * 0.5) - 1)] || 0;
      p80 = distances[Math.max(0, Math.floor(distances.length * 0.8) - 1)] || 0;

      if (geoCount <= 1500) {
        var maxKm = 0;
        for (var a = 0; a < geoItems.length; a += 1) {
          for (var b = a + 1; b < geoItems.length; b += 1) {
            var km = distanceKm(geoItems[a], geoItems[b]);
            if (km > maxKm) {
              maxKm = km;
              farthest = { km: km, a: geoItems[a].name, b: geoItems[b].name };
            }
          }
        }
      }
    }

    var yearEntries = sortedEntries(yearCounts, 99);
    var topYear = yearEntries.slice().sort(function (a, b) { return b.value - a.value; })[0] || null;

    var allMonthEntries = sortedEntries(monthCounts, 99);
    var topMonth = allMonthEntries.slice().sort(function (a, b) { return b.value - a.value; })[0] || null;

    var weekEntries = sortedEntries(weekdayCounts, 7);
    var topWeekday = weekEntries[0] || null;
    var bucketEntries = sortedEntries(bucketCounts, 4);
    var topBucket = bucketEntries[0] || null;
    var dayEntries = sortedEntries(dayCounts, 99);
    var topDay = dayEntries[0] || null;

    var streakDays = 0;
    var streakRange = '';
    var dayKeys = Object.keys(dayCounts).sort();
    if (dayKeys.length) {
      var run = 1;
      var runStart = dayKeys[0];
      for (var k = 1; k < dayKeys.length; k += 1) {
        var prev = new Date(dayKeys[k - 1] + 'T00:00:00');
        var cur = new Date(dayKeys[k] + 'T00:00:00');
        if (Math.round((cur - prev) / 86400000) === 1) {
          run += 1;
        } else {
          if (run > streakDays) { streakDays = run; streakRange = runStart + ' ~ ' + dayKeys[k - 1]; }
          run = 1;
          runStart = dayKeys[k];
        }
      }
      if (run > streakDays) { streakDays = run; streakRange = runStart + ' ~ ' + dayKeys[dayKeys.length - 1]; }
    }

    var duplicateName = null;
    sortedEntries(nameCounts, 99).some(function (entry) {
      if (entry.value > 1) { duplicateName = entry; return true; }
      return false;
    });

    var thisYear = new Date().getFullYear();
    var thisYearCount = yearCounts[thisYear] || 0;

    var longNotes = noteItems.map(function (item) {
      var note = noteOf(item);
      return {
        name: displayName(item.name),
        text: note.text,
        len: note.text.length,
        updatedAt: note.updatedAt ? fmtDate(parseDate(note.updatedAt)) : ''
      };
    }).sort(function (a, b) { return b.len - a.len; }).slice(0, 3);

    var avgNoteLen = noteLengths.length
      ? Math.round(noteLengths.reduce(function (sum, n) { return sum + n; }, 0) / noteLengths.length)
      : 0;
    var maxNoteLen = noteLengths.length ? Math.max.apply(null, noteLengths) : 0;

    return {
      total: total,
      taggedCount: taggedCount,
      categoryItems: categoryItems,
      cityItems: cityItems,
      cityCount: Object.keys(cityCounts).length,
      cityEntries: sortedEntries(cityCounts, 99),
      districtItems: Object.keys(districtCounts).reduce(function (sum, key) { return sum + districtCounts[key]; }, 0),
      districtEntries: sortedEntries(districtCounts, 8),
      categoryEntries: sortedEntries(categoryCounts, 99),
      tagEntries: sortedEntries(rawTagCounts, 99),
      tagTotal: tagTotal,
      noteCount: noteItems.length,
      avgNoteLen: avgNoteLen,
      maxNoteLen: maxNoteLen,
      latestNoteDate: latestNote ? fmtDate(latestNote) : '',
      longNotes: longNotes,
      dateCount: dateItems.length,
      spanDays: spanDays,
      yearCounts: yearCounts,
      monthSeries: monthSeries,
      monthCounts: monthCounts,
      topMonth: topMonth,
      topWeekday: topWeekday,
      topBucket: topBucket,
      topDay: topDay,
      topYear: topYear,
      firstItem: firstItem,
      lastItem: lastItem,
      streakDays: streakDays,
      streakRange: streakRange,
      duplicateName: duplicateName,
      thisYearCount: thisYearCount,
      geoCount: geoCount,
      spanWidth: spanWidth,
      spanHeight: spanHeight,
      p50: p50,
      p80: p80,
      farthest: farthest,
      sourceCounts: {
        amapOnly: sourceCounts.amapOnly,
        baiduOnly: sourceCounts.baiduOnly,
        both: sourceCounts.both,
        other: sourceCounts.other,
        amapTotal: sourceCounts.amapOnly + sourceCounts.both,
        baiduTotal: sourceCounts.baiduOnly + sourceCounts.both
      }
    };
  }

  /* ---------- 启动 ---------- */

  function renderAll(stats) {
    renderAccount();
    renderSync();
    renderLede(stats);
    renderKpis(stats);
    renderTimeline(stats);
    renderCities(stats);
    renderCategories(stats);
    renderSources(stats);
    renderTags(stats);
    renderRegion(stats);
    renderNotes(stats);
    renderFun(stats);
    $('statsMain').hidden = false;
    hideState('loading');
  }

  function loadData() {
    return Promise.all([
      fetchJson('/api/favorites'),
      fetchJson('/api/notes').catch(function () { return { notes: {} }; }),
      fetchJson('/api/status').catch(function () { return null; })
    ]).then(function (results) {
      var fav = results[0] || {};
      var notes = results[1] || {};
      state.items = Array.isArray(fav.items) ? fav.items : [];
      state.notes = notes.notes && typeof notes.notes === 'object' ? notes.notes : {};
      state.status = results[2];
    });
  }

  function showLoginWall() {
    $('statsMain').hidden = true;
    hideState('loading');
    hideState('empty');
    $('loginWall').hidden = false;
    var btn = $('loginWallBtn');
    if (btn) {
      btn.onclick = function () {
        if (window.MNAuth) window.MNAuth.requireLogin();
        else location.href = './';
      };
    }
  }

  function showFailure(message) {
    hideState('loading');
    $('statsMain').hidden = true;
    showState('empty', message);
  }

  function boot() {
    bindSyncButton();
    var authReady = window.MNAuth ? window.MNAuth.boot() : Promise.resolve({ user: null });
    authReady.then(function (auth) {
      state.auth = auth || { user: null };
      return loadData();
    }).then(function () {
      if (!state.items.length) {
        hideState('loading');
        showState('empty', '还没有收藏数据。回地图完成一次同步后再来看。');
        return;
      }
      renderAll(compute());
      window.addEventListener('resize', function () {
        // 图形全部用百分比宽度，无需重算；这里只处理未来可能的断点变化。
      });
    }).catch(function (err) {
      if (err && err.auth) showLoginWall();
      else showFailure('读取收藏数据失败，请稍后刷新重试。');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
