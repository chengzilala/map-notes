/* 留个点 · 扩展后台
 * 1) 工具栏图标 → 通知当前地图页展开 / 收起侧栏；
 * 2) 备注同步：拿着用户自己的账户 Token（Bearer）调 map-notes 的 /api/notes。
 *    收藏不进后台、不上传；只有备注文本过网络。
 */
'use strict';

var API_NOTES = 'https://map.chesterlee.cn/api/notes';
var AUTH_KEY = 'mn:auth';

// ---------- 登录态 ----------

function readAuth() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(AUTH_KEY, function (data) {
      var auth = (data && data[AUTH_KEY]) || null;
      resolve(auth && auth.token ? auth : null);
    });
  });
}

function saveAuth(token) {
  return new Promise(function (resolve) {
    var value = token ? { token: token, savedAt: Date.now() } : {};
    var patch = {};
    patch[AUTH_KEY] = value;
    chrome.storage.local.set(patch, function () { resolve(); });
  });
}

// ---------- 接口 ----------

function api(method, body, token) {
  var options = {
    method: method,
    cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token }
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  return fetch(API_NOTES, options).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (res.status === 401) throw new Error('unauthorized');
      if (res.status === 429) throw new Error('操作太频繁，请稍后再试');
      if (!res.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    });
  });
}

function withAuth(job) {
  return readAuth().then(function (auth) {
    if (!auth) throw new Error('unauthorized');
    return job(auth.token);
  });
}

// ---------- 消息 ----------

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return undefined;

  if (message.type === 'mn:token') {
    // 来自 map.chesterlee.cn 的登录态转交（空字符串 = 已退出登录）
    saveAuth(String(message.token || '')).then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'mn:auth') {
    readAuth().then(function (auth) {
      sendResponse({ ok: true, loggedIn: !!auth, savedAt: auth ? auth.savedAt : null });
    });
    return true;
  }

  if (message.type === 'mn:pull') {
    withAuth(function (token) { return api('GET', null, token); })
      .then(function (data) {
        sendResponse({ ok: true, notes: data.notes || {}, updatedAt: data.updatedAt || null });
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true;
  }

  if (message.type === 'mn:push') {
    var id = String(message.id || '');
    var text = typeof message.text === 'string' ? message.text : '';
    if (!id) {
      sendResponse({ ok: false, error: '缺少 id' });
      return false;
    }
    withAuth(function (token) { return api('POST', { id: id, text: text }, token); })
      .then(function (data) { sendResponse({ ok: true, updatedAt: data.updatedAt || null }); })
      .catch(function (err) { sendResponse({ ok: false, error: err.message || String(err) }); });
    return true;
  }

  return undefined;
});

// ---------- 工具栏图标 ----------

chrome.action.onClicked.addListener(function (tab) {
  if (!tab || !tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'mn:toggle' }).catch(function () {
    // 当前页不是地图页时没有接收方，忽略即可
  });
});
