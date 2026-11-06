/* 留个点 · 收藏解析（高德 / 百度）
 * 与 tools/sync.py、tools/sources/baidu.py 的字段与 id 规则保持一致，
 * 这样扩展里的备注键能和 Web 站已有备注直接对应。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MNParse = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var AMAP_ZOOM = 20;
  var DEDUPE_METERS = 50.0;
  var SOURCE_ORDER = ['amap', 'baidu'];

  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var value = obj[keys[i]];
      if (value !== undefined && value !== null && value !== '' &&
          !(Array.isArray(value) && value.length === 0) &&
          !(typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
        return value;
      }
    }
    return null;
  }

  function toFloat(value) {
    if (value === null || value === undefined || value === '') return null;
    var num = Number(value);
    if (!isFinite(num)) return null;
    return num;
  }

  function isValidLngLat(lng, lat) {
    return lng !== null && lat !== null && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
  }

  // 高德自定义点：Web Mercator 像素坐标（z=20）反算经纬度
  function mercatorToLngLat(pointX, pointY, zoom) {
    var world = 256.0 * Math.pow(2, zoom === undefined ? AMAP_ZOOM : zoom);
    var lng = (pointX / world) * 360.0 - 180.0;
    var mercator = Math.PI * (1.0 - (2.0 * pointY) / world);
    var lat = (Math.atan(Math.sinh(mercator)) * 180.0) / Math.PI;
    return [lng, lat];
  }

  function parseCoords(item) {
    var lng = toFloat(pick(item, ['lon', 'lng', 'longitude']));
    var lat = toFloat(pick(item, ['lat', 'latitude']));
    if (isValidLngLat(lng, lat)) return [lng, lat, 'lonlat'];

    var location = pick(item, ['location', 'poi_location']);
    if (typeof location === 'string' && location.indexOf(',') >= 0) {
      var parts = location.split(',');
      var lng2 = toFloat(parts[0]);
      var lat2 = toFloat(parts[1]);
      if (isValidLngLat(lng2, lat2)) return [lng2, lat2, 'location'];
    }

    var pointX = toFloat(pick(item, ['point_x', 'pointX']));
    var pointY = toFloat(pick(item, ['point_y', 'pointY']));
    if (pointX && pointY) {
      var converted = mercatorToLngLat(pointX, pointY);
      if (isValidLngLat(converted[0], converted[1])) {
        return [converted[0], converted[1], 'point'];
      }
    }
    return null;
  }

  function parseTags(item) {
    var raw = pick(item, ['tag', 'tags', 'item_tag', 'label', 'labels']);
    if (raw === null || raw === undefined) return [];
    var parts;
    if (Array.isArray(raw)) {
      parts = raw.map(function (value) { return String(value); });
    } else {
      parts = String(raw).split(/[,，、/|;；]+/);
    }
    var tags = [];
    parts.forEach(function (part) {
      var text = part.trim();
      if (text && tags.indexOf(text) < 0) tags.push(text);
    });
    return tags;
  }

  function pad2(num) {
    return String(num).padStart(2, '0');
  }

  // 与 Python 的 astimezone() 一样输出东八区 ISO 字符串
  function epochToIso(seconds) {
    var date = new Date(seconds * 1000 + 8 * 3600 * 1000);
    return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate()) +
      'T' + pad2(date.getUTCHours()) + ':' + pad2(date.getUTCMinutes()) + ':' + pad2(date.getUTCSeconds()) + '+08:00';
  }

  function parseCreatedAt(item) {
    var raw = pick(item, ['create_time', 'createTime', 'ctime']);
    var num = toFloat(raw);
    if (num === null) return null;
    if (num > 1e12) num = num / 1000.0;
    if (!(num > 1e9 && num < 2e9)) return null;
    return epochToIso(num);
  }

  // 紧凑 SHA-1：只用于「接口没给 id」时生成稳定 id，和 Python 的规则对齐
  function sha1Hex(text) {
    var bytes = new TextEncoder().encode(String(text));
    var length = bytes.length;
    var blocks = Math.ceil((length + 9) / 64);
    var buffer = new Uint8Array(blocks * 64);
    buffer.set(bytes);
    buffer[length] = 0x80;
    var view = new DataView(buffer.buffer);
    var bitLength = length * 8;
    view.setUint32(buffer.length - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(buffer.length - 4, bitLength >>> 0, false);

    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    var words = new Uint32Array(80);
    for (var offset = 0; offset < buffer.length; offset += 64) {
      for (var i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
      for (var t = 16; t < 80; t++) {
        var value = words[t - 3] ^ words[t - 8] ^ words[t - 14] ^ words[t - 16];
        words[t] = ((value << 1) | (value >>> 31)) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (var j = 0; j < 80; j++) {
        var f, k;
        if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        var temp = ((((a << 5) | (a >>> 27)) >>> 0) + (f >>> 0) + e + k + words[j]) >>> 0;
        e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(function (num) {
      return num.toString(16).padStart(8, '0');
    }).join('');
  }

  function itemIdOf(item, name, lng, lat) {
    var raw = pick(item, ['item_id', 'poi_id', 'poiid', 'id', 'sid', 'fid', 'uid', 'data_id']);
    if (raw !== null) return String(raw);
    var address = pick(item, ['address', 'custom_address']) || '';
    var seed = name + '|' + address + '|' + lng.toFixed(6) + ',' + lat.toFixed(6);
    return 'h' + sha1Hex(seed).slice(0, 12);
  }

  var ITEM_KEYS = ['name', 'custom_name', 'lon', 'lng', 'latitude', 'lat',
    'point_x', 'point_y', 'item_id', 'poi_id', 'address'];

  function findItemLists(node, found, depth) {
    if (depth > 10) return;
    if (Array.isArray(node)) {
      if (node.length && node.every(function (item) { return item && typeof item === 'object' && !Array.isArray(item); })) {
        var first = node[0];
        var probe = first.data && typeof first.data === 'object' ? first.data : first;
        var hits = ITEM_KEYS.filter(function (key) { return key in probe; }).length;
        if (hits >= 2) found.push(node);
      }
      node.forEach(function (child) { findItemLists(child, found, depth + 1); });
    } else if (node && typeof node === 'object') {
      Object.keys(node).forEach(function (key) { findItemLists(node[key], found, depth + 1); });
    }
  }

  function collectItems(payload) {
    var lists = [];
    findItemLists(payload, lists, 0);
    var merged = [];
    var seen = new Set();
    lists.forEach(function (group) {
      if (seen.has(group)) return;
      seen.add(group);
      merged = merged.concat(group);
    });
    return merged;
  }

  // 高德：接口返回「变更流」，同一 id 取最新一条，act=d 视为删除
  function normalizeAmap(items) {
    var latest = new Map();
    var order = 0;
    items.forEach(function (raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
      var body = raw.data && typeof raw.data === 'object' ? raw.data : raw;
      var rid = pick(body, ['item_id', 'poi_id', 'poiid', 'id', 'fid', 'sid']);
      var key = rid !== null ? String(rid) : 'obj' + (order++);
      var ts = toFloat(raw.ts) || 0;
      var prev = latest.get(key);
      if (!prev || ts >= prev.ts) {
        latest.set(key, { ts: ts, body: body, act: String(raw.act || 'u').toLowerCase() });
      }
    });

    var rows = Array.from(latest.values()).sort(function (a, b) { return a.ts - b.ts; });
    var out = [];
    var seen = new Set();
    rows.forEach(function (entry) {
      if (entry.act === 'd') return;
      var raw = entry.body;
      var name = pick(raw, ['custom_name', 'name', 'poi_name', 'title']);
      var coords = parseCoords(raw);
      if (!name || !coords) return;
      var rawId = itemIdOf(raw, String(name), coords[0], coords[1]);
      var id = 'amap:' + rawId;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({
        id: id,
        source: 'amap',
        sources: ['amap'],
        sourceIds: { amap: rawId },
        name: String(name).trim(),
        address: String(pick(raw, ['custom_address', 'address', 'poi_address', 'addr']) || '').trim(),
        lng: Number(coords[0].toFixed(6)),
        lat: Number(coords[1].toFixed(6)),
        coordSys: 'gcj02',
        tags: parseTags(raw),
        createdAt: parseCreatedAt(raw),
        mergedFrom: []
      });
    });
    return out;
  }

  // 百度：BD09MC → BD-09 → GCJ-02
  var MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
  var MC2LL = [
    [1.410526172116255e-8, 0.00000898305509648872, -1.9939833816331, 200.9824383106796,
      -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198,
      -0.03801003308653, 17337981.2],
    [-7.435856389565537e-9, 0.000008983055097726239, -0.78625201886289, 96.32687599759846,
      -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887,
      2.28786674699375, 10260144.86],
    [-3.030883460898826e-8, 0.00000898305509983578, 0.30071316287616, 59.74293618442277,
      7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584,
      0.32710905363475, 6856817.37],
    [-1.981981304930552e-8, 0.000008983055099779535, 0.03278182852591, 40.31678527705744,
      0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204,
      -0.04625736007561, 4482777.06],
    [3.09191371068437e-9, 0.000008983055096812155, 0.00006995724062, 23.10934304144901,
      -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953,
      -0.00466043876332, 2555164.4],
    [2.890871144776878e-9, 0.000008983055095805407, -3.068298e-8, 7.47137025468032,
      -0.00000353937994, -0.02145144861037, -0.00001234426596, 0.00010322952773,
      -0.00000323890364, 826088.5]
  ];

  function convertor(x, y, coeff) {
    var lng = coeff[0] + coeff[1] * Math.abs(x);
    var ratio = Math.abs(y) / coeff[9];
    var lat = coeff[2] + coeff[3] * ratio + coeff[4] * Math.pow(ratio, 2) +
      coeff[5] * Math.pow(ratio, 3) + coeff[6] * Math.pow(ratio, 4) +
      coeff[7] * Math.pow(ratio, 5) + coeff[8] * Math.pow(ratio, 6);
    return [x < 0 ? -lng : lng, y < 0 ? -lat : lat];
  }

  function bd09mcToBd09(x, y) {
    var absY = Math.abs(y);
    var coeff = MC2LL[MC2LL.length - 1];
    for (var i = 0; i < MCBAND.length; i++) {
      if (absY >= MCBAND[i]) { coeff = MC2LL[i]; break; }
    }
    return convertor(Number(x), Number(y), coeff);
  }

  function bd09ToGcj02(lng, lat) {
    var xPi = (Math.PI * 3000.0) / 180.0;
    var x = lng - 0.0065;
    var y = lat - 0.006;
    var z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * xPi);
    var theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * xPi);
    return [z * Math.cos(theta), z * Math.sin(theta)];
  }

  function bd09mcToGcj02(x, y) {
    var bd = bd09mcToBd09(x, y);
    return bd09ToGcj02(bd[0], bd[1]);
  }

  function htmlUnescape(text) {
    return String(text)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, function (_, code) { return String.fromCharCode(Number(code)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, code) { return String.fromCharCode(parseInt(code, 16)); });
  }

  function parseBaiduPayload(data) {
    var result = data && typeof data === 'object' ? data.result : null;
    var error = result && typeof result === 'object' ? result.error : undefined;
    if (!result || !(error === 0 || error === '0' || error === undefined || error === null)) {
      throw new Error('百度返回异常（error=' + (error === undefined ? '?' : error) + '），登录态可能已过期');
    }

    var rows = (data.sync && data.sync.newdata) || [];
    var out = [];
    var seen = new Set();
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      if (String(row.action || '').toLowerCase() === 'del') return;
      var body = row.detail && row.detail.data;
      if (!body || typeof body !== 'object') return;

      var type = String(body.type || '');
      if (type !== '10' && type !== '11') return;

      var ext = body.extdata || {};
      var src = body.sourcedata || {};
      var name = htmlUnescape(ext.name || src.name || '').trim();
      if (!name) return;

      var x = ext.geoptx;
      var y = ext.geopty;
      if (x === null || x === undefined || x === '' || y === null || y === undefined || y === '') {
        var detail = (src.ext && src.ext.detail_info) || {};
        var point = detail.point || {};
        x = point.x;
        y = point.y;
      }
      if (x === null || x === undefined || x === '' || y === null || y === undefined || y === '') return;

      var bd = bd09mcToBd09(Number(x), Number(y));
      var gcj;
      try { gcj = bd09ToGcj02(bd[0], bd[1]); } catch (e) { return; }
      if (!isValidLngLat(gcj[0], gcj[1])) return;

      var sourceId = String(body.fid || body.sourceid || '');
      if (!sourceId || seen.has(sourceId)) return;
      seen.add(sourceId);

      var tags = [];
      (body.tags || []).forEach(function (tag) {
        var text = typeof tag === 'object' && tag ? tag.name : tag;
        text = String(text || '').trim();
        if (text && tags.indexOf(text) < 0) tags.push(text);
      });

      out.push({
        id: 'baidu:' + sourceId,
        source: 'baidu',
        sources: ['baidu'],
        sourceIds: { baidu: sourceId },
        name: name,
        address: String(src.addr || src.address || ext.content || '').trim(),
        lng: Number(gcj[0].toFixed(6)),
        lat: Number(gcj[1].toFixed(6)),
        coordSys: 'gcj02',
        rawLng: Number(bd[0].toFixed(6)),
        rawLat: Number(bd[1].toFixed(6)),
        rawCoordSys: 'bd09',
        tags: tags,
        createdAt: isFinite(Number(body.ctime)) && Number(body.ctime) > 0 ? epochToIso(Number(body.ctime)) : null,
        mergedFrom: []
      });
    });
    return out;
  }

  function haversine(lng1, lat1, lng2, lat2) {
    var radius = 6371008.8;
    var rad = Math.PI / 180.0;
    var dLat = (lat2 - lat1) * rad;
    var dLng = (lng2 - lng1) * rad;
    var a = Math.pow(Math.sin(dLat / 2), 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * radius * Math.asin(Math.min(1.0, Math.sqrt(a)));
  }

  var BRACKETS = /[（(【\[].*?[）)】\]]/g;
  var PUNCT = /[\s·•\-—_、,，.。:：;；/\\|+"'“”‘’!！?？]+/g;

  function normName(value) {
    return String(value || '').replace(BRACKETS, '').replace(PUNCT, '').toLowerCase();
  }

  function similarName(a, b) {
    if (!a || !b) return false;
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }

  // 跨源去重：≤50m 且名称相似才合并，宁可少合并不错合并
  function mergeSources(groups) {
    var merged = [];
    var keys = [];
    SOURCE_ORDER.forEach(function (source) {
      (groups[source] || []).forEach(function (input) {
        var item = Object.assign({}, input);
        item.mergedFrom = item.mergedFrom || [];
        var nameKey = normName(item.name);
        var targetIndex = -1;
        for (var i = 0; i < merged.length; i++) {
          var existing = merged[i];
          var sources = existing.sources || [existing.source];
          if (sources.indexOf(source) >= 0) continue;
          if (!similarName(nameKey, keys[i])) continue;
          var distance = haversine(Number(item.lng), Number(item.lat), Number(existing.lng), Number(existing.lat));
          if (distance <= DEDUPE_METERS) { targetIndex = i; break; }
        }

        if (targetIndex < 0) {
          merged.push(item);
          keys.push(nameKey);
          return;
        }

        var target = merged[targetIndex];
        var list = (target.sources || [target.source]).slice();
        (item.sources || [item.source]).forEach(function (value) {
          if (value && list.indexOf(value) < 0) list.push(value);
        });
        target.sources = SOURCE_ORDER.filter(function (value) { return list.indexOf(value) >= 0; });
        target.sourceIds = Object.assign({}, target.sourceIds || {}, item.sourceIds || {});
        var tags = (target.tags || []).slice();
        (item.tags || []).forEach(function (tag) {
          if (tags.indexOf(tag) < 0) tags.push(tag);
        });
        target.tags = tags;
        target.mergedFrom = target.mergedFrom || [];
        target.mergedFrom.push(item.id);
      });
    });
    return merged;
  }

  return {
    pick: pick,
    toFloat: toFloat,
    mercatorToLngLat: mercatorToLngLat,
    collectItems: collectItems,
    normalizeAmap: normalizeAmap,
    parseBaiduPayload: parseBaiduPayload,
    bd09mcToBd09: bd09mcToBd09,
    bd09ToGcj02: bd09ToGcj02,
    bd09mcToGcj02: bd09mcToGcj02,
    haversine: haversine,
    normName: normName,
    mergeSources: mergeSources,
    sha1Hex: sha1Hex
  };
});
