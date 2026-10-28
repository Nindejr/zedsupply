/* Product-detail side magnifier. No dependencies or additional image downloads.
   The original photo stays unchanged; a separate pane follows its inspection point. */
(function () {
  'use strict';
  var serial = 0;
  var QUERY = '(min-width: 900px) and (any-hover: hover) and (any-pointer: fine)';
  function clamp(n, low, high) { return Math.max(low, Math.min(high, n)); }

  // Map object-fit: contain coordinates to a crop in the separate magnified image.
  function geometry(box, natural, pane, point) {
    if (!box.width || !box.height || !natural.width || !natural.height) return null;
    var fit = Math.min(box.width / natural.width, box.height / natural.height);
    var width = natural.width * fit, height = natural.height * fit;
    var left = box.left + (box.width - width) / 2, top = box.top + (box.height - height) / 2;
    var x = point.normalized ? clamp(point.x, 0, 1) : (point.x - left) / width;
    var y = point.normalized ? clamp(point.y, 0, 1) : (point.y - top) / height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    var scale = Math.max(2.5, pane.width / width, pane.height / height);
    var zoomWidth = width * scale, zoomHeight = height * scale;
    return { width: zoomWidth, height: zoomHeight,
      x: clamp(x * zoomWidth - pane.width / 2, 0, zoomWidth - pane.width),
      y: clamp(y * zoomHeight - pane.height / 2, 0, zoomHeight - pane.height) };
  }

  function mount(frame) {
    if (!frame || !window.matchMedia || !window.MutationObserver) return function () {};
    var media = window.matchMedia(QUERY), alive = true, mode = '', suppressed = false;
    var lastPoint = null, raf = 0, leaveTimer = 0;
    var original = {};
    ['role', 'tabindex', 'aria-label', 'aria-describedby', 'aria-controls', 'aria-expanded'].forEach(function (name) {
      original[name] = frame.getAttribute(name);
    });
    var pane = document.createElement('div');
    pane.className = 'pzoom-panel'; pane.id = 'pzoom-' + (++serial);
    pane.hidden = true; pane.setAttribute('aria-hidden', 'true');
    var enlarged = document.createElement('img');
    enlarged.alt = ''; enlarged.draggable = false; enlarged.decoding = 'async';
    pane.appendChild(enlarged); document.body.appendChild(pane);
    var hint = document.createElement('p');
    hint.className = 'pzoom-hint'; hint.id = pane.id + '-hint'; hint.hidden = true;
    hint.textContent = 'Hover to magnify · Enter to inspect · Arrow keys to pan · Esc to close';
    frame.insertAdjacentElement('afterend', hint);

    function image() { return frame.querySelector(':scope > img:not(.is-broken)'); }
    function placement() {
      if (!alive || !frame.isConnected || !media.matches || document.documentElement.classList.contains('data-saver')) return null;
      var img = image();
      if (!img || !img.complete || !img.naturalWidth) return null;
      var box = frame.getBoundingClientRect(), vw = document.documentElement.clientWidth;
      var header = document.querySelector('.site-header');
      var floor = Math.max(12, header ? header.getBoundingClientRect().bottom + 12 : 12);
      var left = box.right + 16, width = Math.min(620, vw - left - 16);
      var height = Math.min(520, window.innerHeight - floor - 12);
      if (width < 280 || height < 200 || box.bottom <= floor || box.top >= window.innerHeight) return null;
      return { img: img, left: left, top: clamp(box.top, floor, window.innerHeight - height - 12), width: width, height: height };
    }
    function close() {
      clearTimeout(leaveTimer);
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0; pane.hidden = true;
      if (frame.getAttribute('aria-controls') === pane.id) frame.setAttribute('aria-expanded', 'false');
    }
    function restore(name) {
      if (original[name] === null) frame.removeAttribute(name); else frame.setAttribute(name, original[name]);
    }
    function sync() {
      var ready = placement();
      hint.hidden = !ready; frame.classList.toggle('pzoom-ready', !!ready);
      if (ready) {
        frame.setAttribute('role', 'button'); frame.tabIndex = 0;
        frame.setAttribute('aria-label', 'Magnify product image: ' + (ready.img.alt || 'Product photo'));
        frame.setAttribute('aria-describedby', [original['aria-describedby'], hint.id].filter(Boolean).join(' '));
        frame.setAttribute('aria-controls', pane.id);
        if (!frame.hasAttribute('aria-expanded')) frame.setAttribute('aria-expanded', 'false');
      } else {
        close();
        Object.keys(original).forEach(restore);
      }
    }
    function paint() {
      raf = 0;
      var place = placement();
      if (!place || !lastPoint || suppressed) { close(); return; }
      var crop = geometry(place.img.getBoundingClientRect(),
        { width: place.img.naturalWidth, height: place.img.naturalHeight },
        { width: place.width - 2, height: place.height - 2 }, lastPoint);
      if (!crop) { close(); return; }
      var src = place.img.currentSrc || place.img.src;
      if (enlarged.getAttribute('src') !== src) enlarged.src = src;
      pane.style.left = place.left + 'px'; pane.style.top = place.top + 'px';
      pane.style.width = place.width + 'px'; pane.style.height = place.height + 'px';
      enlarged.style.width = crop.width + 'px'; enlarged.style.height = crop.height + 'px';
      enlarged.style.transform = 'translate3d(' + (-crop.x) + 'px,' + (-crop.y) + 'px,0)';
      pane.hidden = false; frame.setAttribute('aria-expanded', 'true');
    }
    function schedule() { if (!raf && alive) raf = window.requestAnimationFrame(paint); }
    function pointer(e) {
      if (e.pointerType === 'touch' || e.pointerType === 'pen' || !media.matches) return;
      if (e.type === 'pointerenter') suppressed = false;
      if (suppressed) return;
      clearTimeout(leaveTimer); mode = 'pointer'; lastPoint = { x: e.clientX, y: e.clientY };
      schedule();
    }
    function leave() { if (mode === 'pointer') leaveTimer = window.setTimeout(close, 120); }
    function keepOpen() { clearTimeout(leaveTimer); }
    function keyboard(e) {
      if (e.key === 'Escape') { suppressed = true; mode = ''; close(); e.preventDefault(); return; }
      var arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) !== -1;
      if (e.key !== 'Enter' && e.key !== ' ' && !arrow) return;
      if (!placement()) return;
      e.preventDefault(); suppressed = false;
      if (!arrow && !pane.hidden && mode === 'keyboard') { mode = ''; close(); return; }
      if (mode !== 'keyboard') lastPoint = { x: 0.5, y: 0.5, normalized: true };
      mode = 'keyboard';
      if (e.key === 'ArrowLeft') lastPoint.x = clamp(lastPoint.x - 0.08, 0, 1);
      if (e.key === 'ArrowRight') lastPoint.x = clamp(lastPoint.x + 0.08, 0, 1);
      if (e.key === 'ArrowUp') lastPoint.y = clamp(lastPoint.y - 0.08, 0, 1);
      if (e.key === 'ArrowDown') lastPoint.y = clamp(lastPoint.y + 0.08, 0, 1);
      schedule();
    }
    function escape(e) { if (e.key === 'Escape' && !pane.hidden) { suppressed = true; mode = ''; close(); } }
    function reset() { mode = ''; close(); sync(); }
    function changed(records) {
      if (records && !records.some(function (r) { return r.type === 'childList' || r.target.tagName === 'IMG'; })) return;
      close(); sync();
    }
    function loaded(e) { if (e.target.parentElement === frame) changed(); }
    function failed(e) { if (e.target.parentElement === frame) { close(); sync(); } }
    function visibility() { if (document.hidden) close(); }
    var observer = new MutationObserver(changed);
    observer.observe(frame, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'class'] });
    frame.addEventListener('pointerenter', pointer);
    frame.addEventListener('pointermove', pointer);
    frame.addEventListener('pointerleave', leave);
    frame.addEventListener('pointercancel', reset);
    frame.addEventListener('keydown', keyboard);
    frame.addEventListener('blur', close);
    frame.addEventListener('load', loaded, true);
    frame.addEventListener('error', failed, true);
    pane.addEventListener('pointerenter', keepOpen);
    pane.addEventListener('pointerleave', leave);
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('zs:datasaver', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('scroll', close, true);
    if (media.addEventListener) media.addEventListener('change', reset); else media.addListener(reset);
    sync();
    return function () {
      alive = false; close(); observer.disconnect();
      frame.removeEventListener('pointerenter', pointer);
      frame.removeEventListener('pointermove', pointer);
      frame.removeEventListener('pointerleave', leave);
      frame.removeEventListener('pointercancel', reset);
      frame.removeEventListener('keydown', keyboard);
      frame.removeEventListener('blur', close);
      frame.removeEventListener('load', loaded, true);
      frame.removeEventListener('error', failed, true);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('zs:datasaver', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('scroll', close, true);
      if (media.removeEventListener) media.removeEventListener('change', reset); else media.removeListener(reset);
      Object.keys(original).forEach(restore); frame.classList.remove('pzoom-ready');
      hint.remove(); pane.remove();
    };
  }
  window.ZSProductZoom = { mount: mount, geometry: geometry };
})();
