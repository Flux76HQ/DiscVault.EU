/**
 * Loops play only while they are on screen. Nothing is fetched before that
 * (`preload="none"`), and nothing at all under reduced motion or Save-Data:
 * the still underneath is then the whole picture. Each playing loop gets a
 * pause control (WCAG 2.2.2).
 */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const connection = (
  navigator as Navigator & { connection?: { saveData?: boolean } }
).connection;

const loops = [
  ...document.querySelectorAll<HTMLVideoElement>('video[data-loop]'),
];

if (loops.length && !reduceMotion.matches && !connection?.saveData) {
  const paused = new WeakSet<HTMLVideoElement>();

  const play = (video: HTMLVideoElement) => {
    if (paused.has(video)) return;
    // A rejected play() (Low Power Mode, a blocked codec) leaves the still.
    video.play().catch(() => {});
  };

  for (const video of loops) {
    const toggle =
      video.parentElement?.querySelector<HTMLButtonElement>(
        '[data-loop-toggle]',
      );
    video.addEventListener('playing', () => {
      video.dataset.playing = '';
      if (toggle) toggle.hidden = false;
    });
    toggle?.addEventListener('click', () => {
      const nowPaused = !paused.has(video);
      if (nowPaused) {
        paused.add(video);
        video.pause();
        toggle.dataset.paused = '';
      } else {
        paused.delete(video);
        delete toggle.dataset.paused;
        play(video);
      }
      toggle.setAttribute(
        'aria-label',
        (nowPaused ? toggle.dataset.playLabel : toggle.dataset.pauseLabel) ??
          '',
      );
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) play(video);
        else video.pause();
      }
    },
    { threshold: 0.25 },
  );
  // Nothing is asked for before the page has finished loading, so a loop on
  // the first screen never competes with the first paint.
  const watch = () => loops.forEach((video) => observer.observe(video));
  if (document.readyState === 'complete') watch();
  else window.addEventListener('load', watch, { once: true });

  document.addEventListener('visibilitychange', () => {
    for (const video of loops) {
      if (document.hidden) video.pause();
    }
  });

  reduceMotion.addEventListener('change', (event) => {
    if (!event.matches) return;
    observer.disconnect();
    loops.forEach((video) => video.pause());
  });
}

export {};
