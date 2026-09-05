/**
 * The motion script (motion-system.md §8). Everything visible works without
 * it; it only adds: the session flag for return visits, the hero tilt, the
 * torch on the poster wall, the strip's scrolled state, the reel counter and
 * the arming of cut-ins and the barcode reveal for reels below the fold.
 * Pointer features run only on fine pointers; autonomous ones only without
 * reduced motion and on fast-updating displays.
 */
const root = document.documentElement;
const fine = matchMedia('(pointer: fine)').matches;
const still =
  matchMedia('(prefers-reduced-motion: reduce)').matches ||
  matchMedia('(update: slow)').matches;

// Return visits: the room is already lit (the inline head script applied
// .is-return before first paint; this only records the visit).
try {
  sessionStorage.setItem('dv-hero-seen', '1');
} catch {
  /* storage unavailable: the entrance plays once per load */
}

// The hero tilt: two custom properties per animation frame.
const hero = document.getElementById('discvault26');
if (hero && fine && !still) {
  let px = 0;
  let py = 0;
  let pending = false;
  const apply = () => {
    pending = false;
    root.style.setProperty('--tx', px.toFixed(3));
    root.style.setProperty('--ty', py.toFixed(3));
  };
  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    px = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    py = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    if (!pending) {
      pending = true;
      requestAnimationFrame(apply);
    }
  });
  hero.addEventListener('pointerleave', () => {
    px = 0;
    py = 0;
    apply();
  });
}

// The torch on the poster wall.
const wall = document.querySelector<HTMLElement>('.wall');
const torch = wall?.querySelector<HTMLElement>('.wall-torch');
if (wall && torch && fine && !still) {
  let x = -1000;
  let y = -1000;
  let pending = false;
  const apply = () => {
    pending = false;
    torch.style.setProperty('--torch-x', `${x}px`);
    torch.style.setProperty('--torch-y', `${y}px`);
  };
  wall.addEventListener('pointermove', (event) => {
    const rect = wall.getBoundingClientRect();
    x = event.clientX - rect.left;
    y = event.clientY - rect.top;
    if (!pending) {
      pending = true;
      requestAnimationFrame(apply);
    }
  });
  wall.addEventListener('pointerleave', () => {
    x = -1000;
    y = -1000;
    apply();
  });
}

// The strip: ground and hairline after 80 px.
const strip = document.querySelector<HTMLElement>('[data-strip]');
if (strip) {
  const update = () => strip.classList.toggle('is-scrolled', scrollY >= 80);
  update();
  addEventListener('scroll', update, { passive: true });
}

// Reels: arm cut-ins only for reels entirely below the fold at load, and
// drive the reel counter. Nothing visible at load is ever hidden.
const reels = [...document.querySelectorAll<HTMLElement>('main .reel')];
const counter = document.querySelector<HTMLElement>('[data-reel-counter]');
if (reels.length && 'IntersectionObserver' in window) {
  const fold = innerHeight;
  for (const reel of reels) {
    if (!still && reel.getBoundingClientRect().top >= fold) {
      reel.classList.add('is-armed');
    }
  }
  const live = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-live');
          live.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -20% 0px' },
  );
  for (const reel of reels) live.observe(reel);

  if (counter) {
    const current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = reels.indexOf(entry.target as HTMLElement);
            counter.textContent = String(index).padStart(2, '0');
          }
        }
      },
      { rootMargin: '-64px 0px -85% 0px' },
    );
    for (const reel of reels) current.observe(reel);
    const credits = document.getElementById('credits');
    if (credits) {
      const last = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            counter.textContent = '06';
          }
        },
        { rootMargin: '-64px 0px -85% 0px' },
      );
      last.observe(credits);
    }
  }
}
