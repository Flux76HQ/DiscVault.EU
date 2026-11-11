/**
 * The motion layer, as enhancement: without this script every part of the
 * page is visible and the bar stays navy.
 *
 * 1. Entrances: parts marked `data-rise` that are still below the fold when
 *    the script runs are held back, then rise once as they enter.
 * 2. Colour by chapter: the bar takes the ground and ink of the chapter
 *    beneath it.
 */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if (!reduceMotion.matches && 'IntersectionObserver' in window) {
  const parts = [...document.querySelectorAll<HTMLElement>('[data-rise]')];
  const fold = window.innerHeight;
  const waiting = parts.filter(
    (part) => part.getBoundingClientRect().top > fold,
  );

  // Parts that share a parent rise one after another.
  const order = new Map<Element, number>();
  for (const part of waiting) {
    const parent = part.parentElement ?? document.body;
    const index = order.get(parent) ?? 0;
    order.set(parent, index + 1);
    part.style.setProperty('--rise-index', String(Math.min(index, 6)));
    part.classList.add('will-rise');
  }

  const rise = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('has-risen');
        entry.target.classList.remove('will-rise');
        rise.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  waiting.forEach((part) => rise.observe(part));
}

const bar = document.querySelector<HTMLElement>('[data-bar]');
const chapters = [...document.querySelectorAll<HTMLElement>('[data-chapter]')];

if (bar && chapters.length) {
  const fields = [
    ...new Set(chapters.map((chapter) => chapter.dataset.chapter ?? '')),
  ];
  let current = '';
  let scheduled = false;

  const update = () => {
    scheduled = false;
    const probe = bar.getBoundingClientRect().bottom - 1;
    let field = current;
    for (const chapter of chapters) {
      const rect = chapter.getBoundingClientRect();
      // In a split chapter the first half sits under the wordmark.
      if (rect.top <= probe && rect.bottom > probe) {
        field = chapter.dataset.chapter ?? field;
        break;
      }
    }
    if (field && field !== current) {
      bar.classList.remove(...fields);
      bar.classList.add(field);
      current = field;
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
}

export {};
