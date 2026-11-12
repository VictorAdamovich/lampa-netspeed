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

  var PLUGIN_NAME = 'Скорость сети';
  var PLUGIN_VERSION = '1.2.0';

  // Пороги цвета под качество видео, Мбит/с: [зелёный от, жёлтый от]
  var QUALITY = {
    uhd: { green: 50, yellow: 25, label: '4K' },
    fhd: { green: 20, yellow: 10, label: 'Full HD' },
    hd:  { green: 10, yellow: 5,  label: 'HD' }
  };

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

  // 'speed' — полный замер скорости, 'dot' — только кружок по пингу
  function getMode() {
    return Lampa.Storage.get('netspeed_mode', 'speed') === 'dot' ? 'dot' : 'speed';
  }

  function getQuality() {
    return QUALITY[Lampa.Storage.get('netspeed_quality', 'fhd')] || QUALITY.fhd;
  }

  function getInterval() {
    return parseInt(Lampa.Storage.get('netspeed_interval', '60'), 10) || 60;
  }

  function format(mbps) {
    if (mbps >= 100) return mbps.toFixed(0);
    if (mbps >= 10) return mbps.toFixed(1);
    return mbps.toFixed(2);
  }

  // level: 'low' | 'mid' | 'high' | 'off'
  function paint(level, text) {
    if (!el) return;
    el.classList.remove('netspeed--low', 'netspeed--mid', 'netspeed--high', 'netspeed--off', 'netspeed--wait');
    el.classList.add('netspeed--' + level);
    el.innerHTML = '<span class="netspeed__dot"></span>' +
      (text ? '<span class="netspeed__text">' + text + '</span>' : '');
  }

  function render(mbps) {
    if (mbps === null) return paint('off', getMode() === 'dot' ? '' : 'нет сети');
    var q = getQuality();
    paint(mbps >= q.green ? 'high' : mbps >= q.yellow ? 'mid' : 'low', format(mbps) + ' Мбит/с');
    if (el) el.setAttribute('title', 'Профиль ' + q.label + ': зелёный от ' + q.green + ', жёлтый от ' + q.yellow + ' Мбит/с');
  }

  function renderPing(ms) {
    if (ms === null) return paint('off', '');
    paint(ms < 150 ? 'high' : ms < 400 ? 'mid' : 'low', '');
    if (el) el.setAttribute('title', 'Пинг ' + Math.round(ms) + ' мс');
  }

  // Лёгкая проверка: пустой запрос, меряем время ответа. Трафика ~0.
  function ping() {
    if (busy || playing || document.hidden || !isEnabled()) return;
    if (navigator.onLine === false) return renderPing(null);

    busy = true;
    var xhr = new XMLHttpRequest();
    current = xhr;
    var t = now();

    function done() {
      current = null;
      busy = false;
    }

    xhr.open('GET', TEST_URL + '0&r=' + Date.now(), true);
    xhr.timeout = 5000;
    xhr.onload = function () {
      done();
      renderPing(xhr.status === 200 ? now() - t : null);
    };
    xhr.onerror = xhr.ontimeout = function () {
      done();
      renderPing(null);
    };
    xhr.onabort = done;
    xhr.send();
  }

  function check() {
    if (getMode() === 'dot') ping();
    else measure();
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
    el.removeAttribute('title');
    paint('wait', getMode() === 'dot' ? '' : '…');
    check();
    timer = setInterval(check, getInterval() * 1000);
  }

  function addStyles() {
    var css =
      '.head__netspeed{display:flex;align-items:center;padding:0 .8em;margin-right:.5em;' +
      'font-size:1.3em;white-space:nowrap;border-radius:.5em;transition:opacity .2s}' +
      '.head__netspeed.focus,.head__netspeed:hover{background:#fff;color:#000}' +
      '.head__netspeed.netspeed--busy{opacity:.5}' +
      '.netspeed__dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;' +
      'background:#9ca3af;flex-shrink:0}' +
      '.netspeed__text{margin-left:.45em}' +
      '.netspeed--low .netspeed__dot{background:#ff4d4f}' +
      '.netspeed--mid .netspeed__dot{background:#ffc53d}' +
      '.netspeed--high .netspeed__dot{background:#4ade80}' +
      '.netspeed--off .netspeed__dot{background:#ff4d4f;opacity:.5}' +
      '.netspeed--wait .netspeed__dot{background:#9ca3af}';

    var style = document.createElement('style');
    style.id = 'netspeed-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mount() {
    el = document.createElement('div');
    el.className = 'head__netspeed selector';

    var time = document.querySelector('.head__time');
    var actions = document.querySelector('.head__actions');

    if (time && time.parentNode) time.parentNode.insertBefore(el, time);
    else if (actions) actions.appendChild(el);
    else document.body.appendChild(el);

    // Enter на пульте / клик мышью — внеплановый замер
    if (window.$) $(el).on('hover:enter', check);
    el.addEventListener('click', check);
  }

  function addSettings() {
    if (!Lampa.SettingsApi) return;

    Lampa.SettingsApi.addComponent({
      component: 'netspeed',
      name: PLUGIN_NAME,
      icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M12 20l4-8"/><path d="M3.5 15a9 9 0 0 1 17 0"/></svg>'
    });

    Lampa.SettingsApi.addParam({
      component: 'netspeed',
      param: { name: 'netspeed_enabled', type: 'trigger', default: true },
      field: { name: 'Показывать индикатор', description: 'В шапке рядом с часами' },
      onChange: schedule
    });

    Lampa.SettingsApi.addParam({
      component: 'netspeed',
      param: {
        name: 'netspeed_mode',
        type: 'select',
        values: { speed: 'Скорость (Мбит/с)', dot: 'Только кружок' },
        default: 'speed'
      },
      field: {
        name: 'Режим',
        description: '«Только кружок» — без замера скорости, цвет по пингу, трафика почти нет'
      },
      onChange: schedule
    });

    Lampa.SettingsApi.addParam({
      component: 'netspeed',
      param: {
        name: 'netspeed_quality',
        type: 'select',
        values: {
          uhd: '4K — зелёный от 50, жёлтый от 25',
          fhd: 'Full HD — зелёный от 20, жёлтый от 10',
          hd: 'HD — зелёный от 10, жёлтый от 5'
        },
        default: 'fhd'
      },
      field: {
        name: 'Цвет под качество',
        description: 'Пороги цвета кружка в Мбит/с (только в режиме скорости)'
      },
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
      field: { name: 'Интервал проверки', description: 'В режиме скорости каждый замер качает до 3 МБ' },
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
      setTimeout(check, 1000);
    });
  }

  function addManifest() {
    var manifest = {
      type: 'other',
      version: PLUGIN_VERSION,
      name: PLUGIN_NAME,
      description: 'Индикатор скорости сети в шапке',
      component: 'netspeed'
    };
    try {
      if (Lampa.Manifest) Lampa.Manifest.plugins = manifest;
    } catch (e) {}
  }

  function start() {
    addManifest();
    addStyles();
    addSettings();
    mount();
    watchPlayer();
    schedule();

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) check();
    });
    window.addEventListener('online', check);
    window.addEventListener('offline', function () { render(null); });
  }

  if (window.appready) start();
  else {
    Lampa.Listener.follow('app', function (e) {
      if (e.type === 'ready') start();
    });
  }
})();
