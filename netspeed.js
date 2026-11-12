/*
 * Lampa plugin: Network Speed
 * Показывает текущую скорость загрузки в шапке (рядом с часами).
 * Замер: скачивание тестового файла с speed.cloudflare.com (CORS открыт).
 * ES5 — чтобы работало на старых Tizen/webOS.
 */
(function () {
  'use strict';

  if (window.lampa_netspeed_plugin) return;
  window.lampa_netspeed_plugin = true;

  var TEST_URL = 'https://speed.cloudflare.com/__down?bytes=';
  var MIN_BYTES = 200000;    // 200 KB
  var MAX_BYTES = 3000000;   // 3 MB — потолок, чтобы не жечь трафик
  var TARGET_MS = 1500;      // целимся в ~1.5 с на замер

  var bytes = 500000;
  var timer = null;
  var busy = false;
  var el = null;
  var playing = false;
  var current = null;

  function now() {
    return window.performance && performance.now ? performance.now() : Date.now();
  }

  function isEnabled() {
    var v = Lampa.Storage.get('netspeed_enabled', true);
    return v === true || v === 'true';
  }

  function getInterval() {
    return parseInt(Lampa.Storage.get('netspeed_interval', '60'), 10) || 60;
  }

  function format(mbps) {
    if (mbps >= 100) return mbps.toFixed(0);
    if (mbps >= 10) return mbps.toFixed(1);
    return mbps.toFixed(2);
  }

  function render(mbps) {
    if (!el) return;
    el.classList.remove('netspeed--low', 'netspeed--mid', 'netspeed--high', 'netspeed--off');

    if (mbps === null) {
      el.textContent = '↓ нет сети';
      el.classList.add('netspeed--off');
      return;
    }

    el.textContent = '↓ ' + format(mbps) + ' Мбит/с';
    el.classList.add(mbps < 5 ? 'netspeed--low' : mbps < 25 ? 'netspeed--mid' : 'netspeed--high');
  }

  function measure() {
    if (busy || playing || document.hidden || !isEnabled()) return;
    if (navigator.onLine === false) return render(null);

    busy = true;
    if (el) el.classList.add('netspeed--busy');

    var xhr = new XMLHttpRequest();
    current = xhr;
    var tStart = now();
    var t0 = 0;
    var b0 = 0;

    function done() {
      current = null;
      busy = false;
      if (el) el.classList.remove('netspeed--busy');
    }

    xhr.open('GET', TEST_URL + bytes + '&r=' + Date.now(), true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = 20000;

    // считаем от первого байта, чтобы пинг не занижал результат
    xhr.onprogress = function (e) {
      if (!t0) {
        t0 = now();
        b0 = e.loaded;
      }
    };

    xhr.onload = function () {
      done();
      if (xhr.status !== 200) return render(null);

      var t1 = now();
      var total = xhr.response ? xhr.response.byteLength : bytes;
      var dt = (t1 - t0) / 1000;
      var db = total - b0;

      if (!t0 || dt < 0.05 || db < 50000) {
        dt = (t1 - tStart) / 1000;
        db = total;
      }

      var mbps = (db * 8) / dt / 1e6;

      // подстраиваем размер файла под скорость канала
      var ms = t1 - tStart;
      if (ms < TARGET_MS / 2) bytes = Math.min(MAX_BYTES, bytes * 2);
      else if (ms > TARGET_MS * 2) bytes = Math.max(MIN_BYTES, Math.round(bytes / 2));

      render(mbps);
    };

    xhr.onerror = xhr.ontimeout = function () {
      done();
      render(null);
    };

    xhr.onabort = done;

    xhr.send();
  }

  function schedule() {
    clearInterval(timer);
    if (!el) return;

    if (!isEnabled()) {
      el.style.display = 'none';
      return;
    }

    el.style.display = '';
    measure();
    timer = setInterval(measure, getInterval() * 1000);
  }

  function addStyles() {
    var css =
      '.head__netspeed{display:flex;align-items:center;padding:0 .8em;margin-right:.5em;' +
      'font-size:1.3em;white-space:nowrap;border-radius:.5em;transition:opacity .2s}' +
      '.head__netspeed.focus,.head__netspeed:hover{background:#fff;color:#000}' +
      '.head__netspeed.netspeed--busy{opacity:.5}' +
      '.head__netspeed.netspeed--low{color:#ff6b6b}' +
      '.head__netspeed.netspeed--mid{color:#ffd166}' +
      '.head__netspeed.netspeed--high{color:#4ade80}' +
      '.head__netspeed.netspeed--off{color:#9ca3af}' +
      '.head__netspeed.focus.netspeed--low,.head__netspeed.focus.netspeed--mid,' +
      '.head__netspeed.focus.netspeed--high,.head__netspeed.focus.netspeed--off{color:#000}';

    var style = document.createElement('style');
    style.id = 'netspeed-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mount() {
    el = document.createElement('div');
    el.className = 'head__netspeed selector';
    el.textContent = '↓ …';

    var time = document.querySelector('.head__time');
    var actions = document.querySelector('.head__actions');

    if (time && time.parentNode) time.parentNode.insertBefore(el, time);
    else if (actions) actions.appendChild(el);
    else document.body.appendChild(el);

    // Enter на пульте / клик мышью — внеплановый замер
    if (window.$) $(el).on('hover:enter', measure);
    el.addEventListener('click', measure);
  }

  function addSettings() {
    if (!Lampa.SettingsApi) return;

    Lampa.SettingsApi.addComponent({
      component: 'netspeed',
      name: 'Скорость сети',
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M12 20l4-8"/><path d="M3.5 15a9 9 0 0 1 17 0"/></svg>'
    });

    Lampa.SettingsApi.addParam({
      component: 'netspeed',
      param: { name: 'netspeed_enabled', type: 'trigger', default: true },
      field: { name: 'Показывать скорость', description: 'Индикатор в шапке рядом с часами' },
      onChange: schedule
    });

    Lampa.SettingsApi.addParam({
      component: 'netspeed',
      param: {
        name: 'netspeed_interval',
        type: 'select',
        values: { '15': '15 сек', '30': '30 сек', '60': '1 мин', '300': '5 мин' },
        default: '60'
      },
      field: { name: 'Интервал замера', description: 'Каждый замер качает до 3 МБ' },
      onChange: schedule
    });
  }

  // Пока открыт плеер — не меряем: замер мешает буферизации
  // и показывает заниженную скорость из-за видеопотока.
  function watchPlayer() {
    if (!Lampa.Player || !Lampa.Player.listener) return;

    Lampa.Player.listener.follow('start', function () {
      playing = true;
      if (current) current.abort();
    });

    Lampa.Player.listener.follow('destroy', function () {
      playing = false;
      setTimeout(measure, 1000);
    });
  }

  function start() {
    addStyles();
    addSettings();
    mount();
    watchPlayer();
    schedule();

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) measure();
    });
    window.addEventListener('online', measure);
    window.addEventListener('offline', function () { render(null); });
  }

  if (window.appready) start();
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') start();
    });
  }
})();
