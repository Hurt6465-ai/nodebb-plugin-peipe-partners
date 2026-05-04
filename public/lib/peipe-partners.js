'use strict';

(function () {
  var VERSION = 'plugin-1.1.5-relationship-cssfile';
  window.PEIPE_PARTNER_FRONTEND_VERSION = VERSION;

  var CONFIG = {
    pageSize: 20,
    skeletonCount: 5,
    locKey: 'peipe_partners_location_v1',
    locSyncKey: 'peipe_partners_location_sync_v1',
    locCacheTime: 7 * 24 * 60 * 60 * 1000,
    locSyncInterval: 24 * 60 * 60 * 1000,
    defaultPic: 'https://ui-avatars.com/api/?background=random&color=fff&size=128',
    swipeMinDistance: 70,
    debug: false
  };

  var STATE = {
    root: null,
    list: null,
    footer: null,
    mode: 'recommend',
    otherPath: '/nearby',
    loading: false,
    done: false,
    cursor: '0',
    users: [],
    observer: null,
    i18n: {},
    options: null,
    imageErrorBound: false,
    touchStartX: 0,
    touchStartY: 0,
    pendingByUid: {}
  };

  var I18N_KEYS = [
    'loading', 'load-failed', 'empty', 'end', 'current-online', 'recently-online',
    'just-now', 'min-ago', 'hour-ago', 'day-ago', 'days-ago', 'years-old', 'no-bio',
    'message', 'message-aria', 'distance-unknown', 'distance-m300', 'distance-m500',
    'distance-km1', 'distance-km3', 'distance-km5', 'distance-km10', 'distance-km30',
    'distance-nearby', 'need-location', 'location-denied', 'locating', 'chat-open-failed',
    'login-required', 'self-chat-error', 'socket-lost', 'profile-title', 'profile-subtitle',
    'profile-country', 'profile-native', 'profile-learning', 'profile-gender', 'profile-age',
    'profile-age-placeholder', 'profile-save', 'profile-saving', 'profile-required',
    'profile-error', 'profile-select-placeholder', 'profile-picker-title', 'profile-change',
    'greet-limit-exceeded', 'greet-remaining', 'option-country-cn', 'option-country-mm',
    'option-country-vn', 'option-country-sg', 'option-language-cn', 'option-language-mm',
    'option-language-vi', 'option-gender-male', 'option-gender-female',
    'profile-relationship', 'option-relationship-private', 'option-relationship-single',
    'option-relationship-love', 'option-relationship-married', 'option-relationship-divorced'
  ];

  var FALLBACK = {
    'profile-relationship': '感情状况',
    'option-relationship-private': '保密',
    'option-relationship-single': '单身',
    'option-relationship-love': '热恋',
    'option-relationship-married': '已婚',
    'option-relationship-divorced': '离异'
  };

  function bp() {
    return (window.config && window.config.relative_path) || '';
  }

  function csrf() {
    return (window.config && window.config.csrf_token) || '';
  }

  function hasUser() {
    return !!(window.app && window.app.user && window.app.user.uid);
  }

  function escapeHtml(value) {
    var div = escapeHtml._div || (escapeHtml._div = document.createElement('div'));
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function t(key) {
    var args = Array.prototype.slice.call(arguments, 1);
    var str = STATE.i18n[key] || FALLBACK[key] || key;
    args.forEach(function (arg) {
      str = str.replace('%s', arg);
    });
    return str;
  }

  function loadTranslations() {
    return new Promise(function (resolve) {
      if (!window.require) return resolve();
      window.require(['translator'], function (translator) {
        var pending = I18N_KEYS.length;
        if (!pending) return resolve();
        I18N_KEYS.forEach(function (key) {
          translator.translate('[[peipe-partners:' + key + ']]', function (translated) {
            STATE.i18n[key] = translated || FALLBACK[key] || key;
            pending -= 1;
            if (!pending) resolve();
          });
        });
      }, function () {
        resolve();
      });
    });
  }

  function localStoreGet(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.e || Date.now() > parsed.e) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.d;
    } catch (e) {
      try { localStorage.removeItem(key); } catch (err) {}
      return null;
    }
  }

  function localStoreSet(key, data, ttl) {
    try {
      localStorage.setItem(key, JSON.stringify({ d: data, e: Date.now() + ttl }));
    } catch (e) {}
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.cache = 'no-store';
    opts.headers = Object.assign({
      Accept: 'application/json',
      'Cache-Control': 'no-store'
    }, opts.headers || {});
    if (opts.body && !opts.headers['Content-Type']) {
      opts.headers['Content-Type'] = 'application/json';
    }
    if (csrf()) opts.headers['x-csrf-token'] = csrf();
    return fetch(bp() + url, opts).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      return data && data.response ? data.response : data;
    });
  }

  function flagEmoji(code) {
    var country = String(code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return '';
    return country.replace(/./g, function (char) {
      return String.fromCodePoint(127397 + char.charCodeAt(0));
    });
  }

  function countryFromFlagSrc(src) {
    var match = String(src || '').match(/\/([a-z]{2})\.png/i);
    return match ? match[1] : '';
  }

  function userFlag(user) {
    return user.flagEmoji || flagEmoji(user.countryCode) || flagEmoji(countryFromFlagSrc(user.flagSrc));
  }

  function normalizePic(pic, username) {
    if (!pic) return CONFIG.defaultPic + '&name=' + encodeURIComponent(username || 'U');
    if (pic.indexOf('http') === 0 || pic.indexOf('//') === 0) return pic;
    return bp() + pic;
  }

  function timeText(user) {
    if (user.isOnline) return t('current-online');
    var ts = Number(user.lastonline || 0);
    if (!ts) return t('recently-online');
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('just-now');
    if (minutes < 60) return t('min-ago', minutes);
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return t('hour-ago', hours);
    var days = Math.floor(hours / 24);
    if (days <= 1) return t('day-ago');
    return t('days-ago', Math.min(days, 7));
  }

  function genderIcon(code) {
    if (code === 'M') {
      return '<svg class="peipe-gender-svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="12" r="4.2"></circle><path d="M11.2 8.8 15.2 4.8"></path><path d="M12.6 4.8h2.6v2.6"></path></svg>';
    }
    if (code === 'F') {
      return '<svg class="peipe-gender-svg" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7.5" r="4.2"></circle><path d="M10 11.8v5"></path><path d="M7.6 14.3h4.8"></path></svg>';
    }
    return '';
  }

  function metaPill(user) {
    var parts = [];
    if (user.genderCode) parts.push(genderIcon(user.genderCode));
    if (user.age || user.ageText) parts.push('<span>' + escapeHtml(user.ageText || t('years-old', user.age)) + '</span>');
    if (!parts.length) return '';
    var cls = user.genderCode === 'F' ? 'female' : (user.genderCode === 'M' ? 'male' : 'neutral');
    return '<span class="peipe-meta-pill ' + cls + '">' + parts.join('') + '</span>';
  }


  function relationshipText(user) {
    if (!user) return '';
    var key = user.relationshipKey || '';
    var raw = user.relationshipStatus || user.relationship_status || '';
    var text = key ? t(key) : raw;
    if (!text || text === '保密' || text === 'Private' || text === 'Riêng tư' || text === 'မပြပါ') return '';
    var emoji = user.relationshipEmoji || '';
    if (emoji && text.indexOf(emoji) !== 0) text = emoji + ' ' + text;
    return text;
  }

  function relationshipPill(user) {
    var text = relationshipText(user);
    if (!text) return '';
    return '<span class="peipe-relationship-pill">' + escapeHtml(text) + '</span>';
  }

  function distanceLabel(user) {
    if (STATE.mode !== 'nearby') return '';
    var key = user.distanceBucket ? 'distance-' + user.distanceBucket : '';
    var text = key ? t(key) : (user.distanceText || t('distance-unknown'));
    return '<div class="peipe-distance"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 18s6-5.1 6-10A6 6 0 0 0 4 8c0 4.9 6 10 6 10Z"></path><circle cx="10" cy="8" r="2"></circle></svg><span>' + escapeHtml(text) + '</span></div>';
  }

  function sendIcon() {
    return '<svg class="peipe-send-svg" viewBox="0 0 28 28" aria-hidden="true"><path d="M4.6 13.4 22.7 5.6c.8-.3 1.6.4 1.3 1.2l-6.4 17.4c-.3.9-1.5 1-2 .2l-3.3-5.7-5.9-3.1c-.9-.4-.8-1.7.2-2.2Z"></path><path d="m12.4 18.5 4.2-4.5"></path></svg>';
  }

  function buildCard(user) {
    var flag = userFlag(user);
    var onlineDot = user.isOnline ? '<span class="peipe-online-dot" aria-hidden="true"></span>' : '';
    var flagHtml = flag ? '<span class="peipe-flag-emoji" aria-hidden="true">' + escapeHtml(flag) + '</span>' : '';
    var profile = user.profileLink || (user.userslug ? (bp() + '/user/' + encodeURIComponent(user.userslug) + '/topics') : '#');
    var bio = user.bio || t('no-bio');
    var canChat = !!user.canChat;

    return '' +
      '<article class="peipe-partner-card" data-uid="' + Number(user.uid || 0) + '">' +
        '<a class="peipe-card-main" href="' + escapeHtml(profile) + '">' +
          '<div class="peipe-left">' +
            '<div class="peipe-avatar-wrap">' +
              '<img class="peipe-avatar" loading="lazy" alt="' + escapeHtml(user.username || '') + '" src="' + escapeHtml(normalizePic(user.picture, user.username)) + '">' +
              flagHtml + onlineDot +
            '</div>' +
            '<div class="peipe-status ' + (user.isOnline ? 'online' : '') + '">' + escapeHtml(timeText(user)) + '</div>' +
          '</div>' +
          '<div class="peipe-card-body">' +
            '<div class="peipe-name-row">' +
              '<span class="peipe-name">' + escapeHtml(user.username || 'User') + '</span>' +
              metaPill(user) +
              relationshipPill(user) +
            '</div>' +
            '<div class="peipe-langs">' +
              '<span class="native">' + escapeHtml(user.nativeCode || '-') + '</span>' +
              '<span class="swap">⇄</span>' +
              '<span class="learn">' + escapeHtml(user.learnCode || '-') + '</span>' +
            '</div>' +
            '<div class="peipe-bio">' + escapeHtml(bio) + '</div>' +
          '</div>' +
        '</a>' +
        (canChat ? '<div class="peipe-side"><button class="peipe-greet-btn" data-uid="' + Number(user.uid || 0) + '" type="button" aria-label="' + escapeHtml(t('message-aria')) + '">' + sendIcon() + '</button>' + distanceLabel(user) + '</div>' : '') +
      '</article>';
  }

  function renderSkeleton() {
    var html = '';
    for (var i = 0; i < CONFIG.skeletonCount; i += 1) {
      html += '<div class="peipe-skeleton-card"><div class="peipe-skeleton-left"><div class="peipe-skeleton-avatar"></div><div class="peipe-skeleton-status"></div></div><div class="peipe-skeleton-main"><div class="peipe-skeleton-line title"></div><div class="peipe-skeleton-line lang"></div><div class="peipe-skeleton-line bio"></div></div><div class="peipe-skeleton-side"><div class="peipe-skeleton-button"></div></div></div>';
    }
    STATE.list.innerHTML = html;
  }

  function showFooter(message, persist) {
    if (!STATE.footer) return;
    STATE.footer.textContent = message || '';
    STATE.footer.hidden = !message;
    if (message && !persist) {
      clearTimeout(showFooter.timer);
      showFooter.timer = setTimeout(function () {
        if (STATE.footer) STATE.footer.hidden = true;
      }, 2200);
    }
  }

  function appendUsers(users) {
    if (!users || !users.length) return;
    var html = users.map(buildCard).join('');
    STATE.list.insertAdjacentHTML('beforeend', html);
  }

  function requestBrowserLocation() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('geolocation-unavailable'));
      navigator.geolocation.getCurrentPosition(function (pos) {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() });
      }, reject, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 30 * 60 * 1000
      });
    });
  }

  function uploadLocation(loc, force) {
    return fetchJson('/api/peipe-partners/location', {
      method: 'PUT',
      body: JSON.stringify({ lat: loc.lat, lng: loc.lng, force: !!force })
    }).then(function (data) {
      localStoreSet(CONFIG.locKey, loc, CONFIG.locCacheTime);
      localStoreSet(CONFIG.locSyncKey, Date.now(), CONFIG.locCacheTime);
      return data;
    });
  }

  function ensureLocationIfNeeded(response) {
    if (STATE.mode !== 'nearby' || !response || !response.needLocation || !hasUser()) {
      return Promise.resolve(false);
    }

    var cached = localStoreGet(CONFIG.locKey);
    var lastSync = localStoreGet(CONFIG.locSyncKey);
    if (cached && Number.isFinite(Number(cached.lat)) && Number.isFinite(Number(cached.lng))) {
      if (!lastSync || Date.now() - Number(lastSync) >= CONFIG.locSyncInterval) {
        return uploadLocation(cached, false).then(function () { return true; }).catch(function () { return false; });
      }
    }

    showFooter(t('locating'), true);
    return requestBrowserLocation().then(function (loc) {
      return uploadLocation(loc, false).then(function () { return true; });
    }).catch(function () {
      showFooter(t('location-denied'), true);
      return false;
    });
  }

  function loadMore() {
    if (STATE.loading || STATE.done) return Promise.resolve();
    STATE.loading = true;
    showFooter('');
    var url = '/api/peipe-partners?mode=' + encodeURIComponent(STATE.mode) + '&limit=' + CONFIG.pageSize + '&cursor=' + encodeURIComponent(STATE.cursor || '0') + '&_=' + Date.now();

    return fetchJson(url).then(function (data) {
      return ensureLocationIfNeeded(data).then(function (retried) {
        if (retried) return fetchJson(url.replace(/_=[0-9]+/, '_=' + Date.now()));
        return data;
      });
    }).then(function (data) {
      var users = data.users || [];
      if (!STATE.users.length) STATE.list.innerHTML = '';
      appendUsers(users);
      STATE.users = STATE.users.concat(users);
      STATE.cursor = data.nextCursor || '';
      STATE.done = !data.hasMore || !data.nextCursor || !users.length;
      if (!STATE.users.length) showFooter(data.needLocation ? t('need-location') : t('empty'), true);
      else if (STATE.done) showFooter(t('end'), true);
    }).catch(function () {
      if (!STATE.users.length) STATE.list.innerHTML = '';
      showFooter(t('load-failed'), true);
    }).finally(function () {
      STATE.loading = false;
    });
  }

  function extractRoomId(payload) {
    if (payload == null) return 0;
    if (typeof payload === 'number' && payload > 0) return payload;
    if (typeof payload === 'string' && /^\d+$/.test(payload)) return Number(payload);
    if (typeof payload !== 'object') return 0;
    var keys = ['roomId', 'roomid', 'rid', 'id'];
    for (var i = 0; i < keys.length; i += 1) {
      var value = payload[keys[i]];
      if (typeof value === 'number' && value > 0) return value;
      if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    }
    var nested = ['response', 'data', 'payload'];
    for (var j = 0; j < nested.length; j += 1) {
      var obj = payload[nested[j]];
      if (obj && typeof obj === 'object') {
        var rid = extractRoomId(obj);
        if (rid) return rid;
      }
    }
    return 0;
  }

  function emitSocket(eventName, payload) {
    return new Promise(function (resolve, reject) {
      if (!window.socket || typeof window.socket.emit !== 'function') return reject(new Error(t('socket-lost')));
      var done = false;
      var timer = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error('socket timeout'));
        }
      }, 10000);
      try {
        window.socket.emit(eventName, payload, function (err, data) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (err) return reject(new Error(typeof err === 'string' ? err : (err.message || 'socket error')));
          resolve(data);
        });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function findPrivateRoom(uid) {
    var payloads = [uid, { uid: uid }, { uids: [uid] }];
    var index = 0;
    function next() {
      if (index >= payloads.length) return Promise.resolve(0);
      return emitSocket('modules.chats.hasPrivateChat', payloads[index++]).then(function (data) {
        return extractRoomId(data) || next();
      }).catch(next);
    }
    return next();
  }

  function postCreateChat(url, uid) {
    return fetchJson(url, {
      method: 'POST',
      body: JSON.stringify({ uids: [uid] })
    }).then(function (data) {
      var rid = extractRoomId(data);
      if (!rid) throw new Error('missing room id');
      return rid;
    });
  }

  function createPrivateRoom(uid) {
    var events = [
      { event: 'modules.chats.newRoom', payload: { uids: [uid] } },
      { event: 'modules.chats.create', payload: { uids: [uid] } },
      { event: 'modules.chats.new', payload: { uids: [uid] } }
    ];
    var index = 0;
    function trySocket() {
      if (index >= events.length) return tryHttp();
      var cur = events[index++];
      return emitSocket(cur.event, cur.payload).then(function (data) {
        var rid = extractRoomId(data);
        if (!rid) throw new Error('missing room id');
        return rid;
      }).catch(trySocket);
    }
    function tryHttp() {
      return postCreateChat('/api/v3/chats', uid).catch(function () {
        return postCreateChat('/api/chats', uid);
      });
    }
    return trySocket();
  }

  function goToChatRoom(roomId) {
    var rid = Number(roomId || 0);
    if (!rid) return;
    var slug = window.app && window.app.user && window.app.user.userslug ? window.app.user.userslug : '';
    var path = slug ? ('user/' + slug + '/chats/' + rid) : ('chats/' + rid);
    if (window.ajaxify && typeof window.ajaxify.go === 'function') window.ajaxify.go(path);
    else window.location.href = bp() + '/' + path;
  }

  function openChat(uid) {
    uid = Number(uid || 0);
    if (!uid) return Promise.reject(new Error('invalid uid'));
    if (!hasUser()) return Promise.reject(new Error(t('login-required')));
    if (Number(window.app.user.uid) === uid) return Promise.reject(new Error(t('self-chat-error')));
    if (STATE.pendingByUid[uid]) return STATE.pendingByUid[uid];
    STATE.pendingByUid[uid] = fetchJson('/api/peipe-partners/me/greet', {
      method: 'POST',
      body: JSON.stringify({ uid: uid })
    }).then(function (data) {
      if (!data || data.ok === false) {
        if (data && data.error === 'greet-limit-exceeded') {
          throw new Error(t('greet-limit-exceeded'));
        }
        throw new Error(t('chat-open-failed'));
      }
      goToChatRoom(data.roomId);
      return data.roomId;
    }).finally(function () {
      delete STATE.pendingByUid[uid];
    });
    return STATE.pendingByUid[uid];
  }

  function handleGreet(btn) {
    if (!btn || btn.dataset.busy === '1') return;
    var uid = Number(btn.getAttribute('data-uid') || 0);
    if (!uid) return;
    btn.dataset.busy = '1';
    btn.classList.add('loading');
    btn.innerHTML = '<span class="peipe-btn-spinner"></span>';
    openChat(uid).catch(function (err) {
      showFooter((err && err.message) || t('chat-open-failed'), false);
    }).finally(function () {
      if (!document.contains(btn)) return;
      btn.dataset.busy = '0';
      btn.classList.remove('loading');
      btn.innerHTML = sendIcon();
    });
  }

  function bindImages() {
    if (STATE.imageErrorBound || !STATE.list) return;
    STATE.imageErrorBound = true;
    STATE.list.addEventListener('error', function (event) {
      var target = event.target;
      if (!target || !target.classList || !target.classList.contains('peipe-avatar')) return;
      if (target.dataset.fallback === '1') return;
      target.dataset.fallback = '1';
      var alt = target.getAttribute('alt') || 'U';
      target.src = CONFIG.defaultPic + '&name=' + encodeURIComponent(alt.charAt(0) || 'U');
    }, true);
  }

  function setupInfiniteScroll() {
    if (STATE.observer) STATE.observer.disconnect();
    var sentinel = document.createElement('div');
    sentinel.className = 'peipe-scroll-sentinel';
    STATE.root.appendChild(sentinel);
    STATE.observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) loadMore();
    }, { rootMargin: '320px 0px' });
    STATE.observer.observe(sentinel);
  }

  function setupSwipe() {
    STATE.root.addEventListener('touchstart', function (event) {
      var touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      STATE.touchStartX = touch.clientX;
      STATE.touchStartY = touch.clientY;
    }, { passive: true });

    STATE.root.addEventListener('touchend', function (event) {
      var touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      var dx = touch.clientX - STATE.touchStartX;
      var dy = touch.clientY - STATE.touchStartY;
      if (Math.abs(dx) < CONFIG.swipeMinDistance || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      if (STATE.mode === 'recommend' && dx < 0) navigate(STATE.otherPath || '/nearby');
      if (STATE.mode === 'nearby' && dx > 0) navigate(STATE.otherPath || '/partners');
    }, { passive: true });
  }

  function navigate(path) {
    if (window.ajaxify && typeof window.ajaxify.go === 'function') window.ajaxify.go(path.replace(/^\//, ''));
    else window.location.href = bp() + path;
  }

  function optionLabel(option) {
    if (!option) return '';
    var key = option.key || '';
    var translated = key ? t(key) : '';
    var token = key ? '[[peipe-partners:' + key + ']]' : '';
    var text = '';

    if (
      translated &&
      translated !== key &&
      translated !== token &&
      translated.indexOf('[[peipe-partners:') === -1
    ) {
      text = translated;
    } else {
      text = option.textLabel || option.label || option.value || '';
    }

    var emoji = option.flagEmoji || option.emoji || '';
    if (emoji && text.indexOf(emoji) !== 0) {
      text = emoji + ' ' + text.replace(emoji, '').trim();
    }

    return text;
  }

  function parseValues(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
    }
    if (!value) return [];
    try {
      var parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parseValues(parsed);
      if (parsed && typeof parsed === 'object') return parseValues(Object.keys(parsed).map(function (key) { return parsed[key]; }));
      return parseValues(String(parsed || ''));
    } catch (e) {
      return String(value || '')
        .replace(/["\[\]{}]/g, '')
        .split(/[，,|/]+/)
        .map(function (item) { return item.trim(); })
        .filter(Boolean);
    }
  }

  function firstValue(value) {
    return parseValues(value)[0] || '';
  }

  function findOption(optionsList, value) {
    value = String(value || '');
    return (optionsList || []).filter(function (option) { return String(option.value) === value; })[0] || null;
  }

  function selectedLabels(optionsList, values) {
    var list = parseValues(values);
    var labels = list.map(function (value) {
      var selected = findOption(optionsList, value);
      return selected ? optionLabel(selected) : value;
    }).filter(Boolean);
    return labels.join('、');
  }

  function hiddenValue(values, multiple) {
    var list = parseValues(values);
    return multiple ? JSON.stringify(list) : (list[0] || '');
  }

  function buildChoice(name, label, optionsList, value, multiple) {
    var values = parseValues(value);
    var display = values.length ? selectedLabels(optionsList, values) : t('profile-select-placeholder');
    return '' +
      '<label class="peipe-profile-field peipe-choice-field ' + (multiple ? 'multiple' : '') + '" data-name="' + escapeHtml(name) + '">' +
        '<span>' + escapeHtml(label) + '</span>' +
        '<input type="hidden" name="' + escapeHtml(name) + '" value="' + escapeHtml(hiddenValue(values, multiple)) + '" data-multiple="' + (multiple ? '1' : '0') + '">' +
        '<button type="button" class="peipe-choice-trigger" data-name="' + escapeHtml(name) + '" data-multiple="' + (multiple ? '1' : '0') + '">' +
          '<span class="peipe-choice-text">' + escapeHtml(display) + '</span>' +
          '<span class="peipe-choice-chevron">›</span>' +
        '</button>' +
      '</label>';
  }

  function showChoicePicker(modal, config) {
    var old = modal.querySelector('.peipe-picker-mask');
    if (old) old.remove();

    var input = modal.querySelector('input[name="' + config.name + '"]');
    var currentValues = parseValues(input && input.value);
    var selectedSet = {};
    currentValues.forEach(function (value) { selectedSet[value] = true; });

    var picker = document.createElement('div');
    picker.className = 'peipe-picker-mask';

    var html = '' +
      '<div class="peipe-picker-sheet" role="dialog" aria-modal="true">' +
        '<div class="peipe-picker-head">' +
          '<button type="button" class="peipe-picker-back" aria-label="Close">×</button>' +
          '<strong>' + escapeHtml(config.label) + '</strong>' +
          (config.multiple ? '<button type="button" class="peipe-picker-done">' + escapeHtml(t('profile-save')) + '</button>' : '') +
        '</div>' +
        '<div class="peipe-picker-options">';

    (config.options || []).forEach(function (option) {
      var active = selectedSet[String(option.value)] ? ' active' : '';
      html += '<button type="button" class="peipe-picker-option' + active + '" data-value="' + escapeHtml(option.value) + '" data-label="' + escapeHtml(optionLabel(option)) + '">' +
        '<span>' + escapeHtml(optionLabel(option)) + '</span>' +
        '<i></i>' +
      '</button>';
    });

    html += '</div></div>';
    picker.innerHTML = html;
    modal.appendChild(picker);

    function applySelection(closePicker) {
      var selected = [];
      picker.querySelectorAll('.peipe-picker-option.active').forEach(function (item) {
        selected.push(item.getAttribute('data-value') || '');
      });

      var text = modal.querySelector('.peipe-choice-field[data-name="' + config.name + '"] .peipe-choice-text');
      input.value = hiddenValue(selected, !!config.multiple);
      text.textContent = selected.length ? selectedLabels(config.options, selected) : t('profile-select-placeholder');

      if (closePicker) picker.remove();
    }

    picker.addEventListener('click', function (event) {
      if (event.target === picker || event.target.closest('.peipe-picker-back')) {
        picker.remove();
        return;
      }

      if (event.target.closest('.peipe-picker-done')) {
        applySelection(true);
        return;
      }

      var item = event.target.closest('.peipe-picker-option');
      if (!item) return;

      if (config.multiple) {
        item.classList.toggle('active');
        applySelection(false);
      } else {
        picker.querySelectorAll('.peipe-picker-option.active').forEach(function (activeItem) {
          activeItem.classList.remove('active');
        });
        item.classList.add('active');
        applySelection(true);
      }
    });
  }

  function showProfileModal(status) {
    if (!STATE.options || document.querySelector('.peipe-profile-mask')) return;
    var profile = (status && status.profile) || {};
    var modal = document.createElement('div');
    modal.className = 'peipe-profile-mask';
    modal.innerHTML = '' +
      '<div class="peipe-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="peipe-profile-title">' +
        '<div class="peipe-profile-glow"></div>' +
        '<h2 id="peipe-profile-title">' + escapeHtml(t('profile-title')) + '</h2>' +
        '<p>' + escapeHtml(t('profile-subtitle')) + '</p>' +
        '<form class="peipe-profile-form">' +
          buildChoice('language_flag', t('profile-country'), STATE.options.countries, profile.language_flag, false) +
          buildChoice('language_fluent', t('profile-native'), STATE.options.languages, parseValues(profile.language_fluent), true) +
          buildChoice('language_learning', t('profile-learning'), STATE.options.languages, parseValues(profile.language_learning), true) +
          buildChoice('gender', t('profile-gender'), STATE.options.genders, profile.gender, false) +
          buildChoice('relationship_status', t('profile-relationship'), STATE.options.relationships || [], profile.relationship_status || '保密', false) +
          '<label class="peipe-profile-field peipe-age-field"><span>' + escapeHtml(t('profile-age')) + '</span><input name="age" type="number" min="13" max="99" inputmode="numeric" value="' + escapeHtml(profile.age || '') + '" placeholder="' + escapeHtml(t('profile-age-placeholder')) + '"></label>' +
          '<div class="peipe-profile-error" hidden></div>' +
          '<button class="peipe-profile-submit" type="submit">' + escapeHtml(t('profile-save')) + '</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(modal);

    var fields = {
      language_flag: { name: 'language_flag', label: t('profile-country'), options: STATE.options.countries, multiple: false },
      language_fluent: { name: 'language_fluent', label: t('profile-native'), options: STATE.options.languages, multiple: true },
      language_learning: { name: 'language_learning', label: t('profile-learning'), options: STATE.options.languages, multiple: true },
      gender: { name: 'gender', label: t('profile-gender'), options: STATE.options.genders, multiple: false },
      relationship_status: { name: 'relationship_status', label: t('profile-relationship'), options: STATE.options.relationships || [], multiple: false }
    };

    modal.addEventListener('click', function (event) {
      var trigger = event.target.closest && event.target.closest('.peipe-choice-trigger');
      if (!trigger) return;
      var name = trigger.getAttribute('data-name');
      if (fields[name]) showChoicePicker(modal, fields[name]);
    });

    var form = modal.querySelector('form');
    var error = modal.querySelector('.peipe-profile-error');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var payload = {};
      data.forEach(function (value, key) { payload[key] = value; });

      var nativeValues = parseValues(payload.language_fluent);
      var learningValues = parseValues(payload.language_learning);

      if (!payload.language_flag || !nativeValues.length || !learningValues.length || !payload.gender || !payload.age) {
        error.textContent = t('profile-required');
        error.hidden = false;
        return;
      }

      payload.language_fluent = JSON.stringify(nativeValues);
      payload.language_learning = JSON.stringify(learningValues);
      payload.relationship_status = payload.relationship_status || '保密';

      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = t('profile-saving');
      fetchJson('/api/peipe-partners/me/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      }).then(function (res) {
        if (!res.ok) throw new Error('save failed');
        modal.remove();
        STATE.list.innerHTML = '';
        STATE.users = [];
        STATE.done = false;
        STATE.cursor = '0';
        renderSkeleton();
        loadMore();
      }).catch(function () {
        error.textContent = t('profile-error');
        error.hidden = false;
      }).finally(function () {
        btn.disabled = false;
        btn.textContent = t('profile-save');
      });
    });
  }

  function maybeShowProfileModal() {
    if (!hasUser()) return Promise.resolve();
    return fetchJson('/api/peipe-partners/options').then(function (data) {
      if (data && data.i18n) STATE.i18n = Object.assign({}, STATE.i18n, data.i18n);
      STATE.options = data.options || data;
      return fetchJson('/api/peipe-partners/me/profile-status');
    }).then(function (status) {
      if (status && status.complete === false) showProfileModal(status);
    }).catch(function () {});
  }

  function bindEvents() {
    STATE.list.addEventListener('click', function (event) {
      var btn = event.target.closest && event.target.closest('.peipe-greet-btn');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      handleGreet(btn);
    });

    bindImages();
    setupSwipe();
  }



  function start() {
    STATE.root = document.querySelector('.peipe-partners-page');
    if (!STATE.root) return;
    STATE.list = STATE.root.querySelector('.peipe-partners-list');
    STATE.footer = STATE.root.querySelector('.peipe-partners-footer');
    STATE.mode = STATE.root.getAttribute('data-mode') || 'recommend';
    STATE.otherPath = STATE.root.getAttribute('data-other-path') || (STATE.mode === 'nearby' ? '/partners' : '/nearby');
    STATE.loading = false;
    STATE.done = false;
    STATE.cursor = '0';
    STATE.users = [];
    STATE.imageErrorBound = false;
    loadTranslations().then(function () {
      bindEvents();
      renderSkeleton();
      setupInfiniteScroll();
      return maybeShowProfileModal();
    }).then(function () {
      return loadMore();
    });
  }

  if (window.jQuery) {
    window.jQuery(document).ready(start);
    window.jQuery(window).off('action:ajaxify.end.peipePartners').on('action:ajaxify.end.peipePartners', start);
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
}());
