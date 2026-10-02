export function parallax(element: HTMLElement, maxX: number, maxY: number): () => void {
  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = matchMedia('(hover: none), (pointer: coarse)');
  var x = 0, y = 0, targetX = 0, targetY = 0, frame = 0;
  function enabled() { return !reduced.matches && !coarse.matches && !document.hidden; }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0; x = y = targetX = targetY = 0;
    element.style.setProperty('--px', '0px');
    element.style.setProperty('--py', '0px');
    element.style.willChange = '';
  }
  function activate() {
    if (enabled() && element.style.willChange !== 'transform') element.style.willChange = 'transform';
  }
  function tick() {
    frame = 0;
    if (!enabled()) { stop(); return; }
    x += (targetX - x) * .08;
    y += (targetY - y) * .08;
    if (Math.abs(targetX - x) <= .1) x = targetX;
    if (Math.abs(targetY - y) <= .1) y = targetY;
    element.style.setProperty('--px', x + 'px');
    element.style.setProperty('--py', y + 'px');
    if (x !== targetX || y !== targetY) start();
  }
  function start() {
    if (frame || !enabled()) return;
    frame = requestAnimationFrame(tick);
  }
  function move(event: PointerEvent) {
    if (!enabled()) return;
    activate();
    var nextX = Math.max(-1, Math.min(1, event.clientX / innerWidth * 2 - 1)) * maxX;
    var nextY = Math.max(-1, Math.min(1, event.clientY / innerHeight * 2 - 1)) * maxY;
    if (Math.abs(nextX - targetX) < .5 && Math.abs(nextY - targetY) < .5) return;
    targetX = nextX;
    targetY = nextY;
    start();
  }
  function center() {
    activate();
    targetX = targetY = 0;
    start();
  }
  function check() { if (!enabled()) stop(); else activate(); }
  activate();
  window.addEventListener('pointermove', move, { passive: true });
  // pointerleave у window не срабатывает при уходе курсора со страницы — слушаем корневой элемент
  document.documentElement.addEventListener('pointerleave', center);
  window.addEventListener('blur', center);
  document.addEventListener('visibilitychange', check);
  reduced.addEventListener('change', check);
  coarse.addEventListener('change', check);
  return function () {
    window.removeEventListener('pointermove', move);
    document.documentElement.removeEventListener('pointerleave', center);
    window.removeEventListener('blur', center);
    document.removeEventListener('visibilitychange', check);
    reduced.removeEventListener('change', check);
    coarse.removeEventListener('change', check);
    stop();
  };
}
