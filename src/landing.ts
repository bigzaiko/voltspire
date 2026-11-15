// Landing page behaviour. Progressive enhancement only: the page is complete without it.

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// --- sticky nav gets a solid backdrop once the hero has scrolled a little
const nav = document.getElementById('nav');
const onScroll = () => nav?.classList.toggle('nav-solid', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// --- "Watch trailer": scroll to the player and move focus to it
const trailer = document.getElementById('trailer');
const video = document.getElementById('trailer-video');
document.getElementById('watch-trailer')?.addEventListener('click', (e) => {
  if (!trailer) return;
  e.preventDefault();
  trailer.scrollIntoView({ behavior: reduced.matches ? 'auto' : 'smooth', block: 'start' });
  history.replaceState(null, '', '#trailer');
  if (video instanceof HTMLVideoElement && !video.hidden) video.focus({ preventScroll: true });
});

// --- trailer: if the file is missing or unplayable, show an intentional fallback over the poster
if (video instanceof HTMLVideoElement) {
  const frame = document.getElementById('trailer-frame');
  const fallback = document.getElementById('trailer-fallback');
  const fail = () => {
    if (!frame || !fallback || frame.classList.contains('frame-off')) return;
    frame.classList.add('frame-off');
    video.removeAttribute('controls');
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    fallback.hidden = false;
  };
  video.querySelector('source')?.addEventListener('error', fail);
  video.addEventListener('error', fail);
  if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) fail();
  video.addEventListener('loadedmetadata', () => frame?.classList.add('frame-ready'));
}

// --- reveal sections as they enter the viewport
if (!reduced.matches && 'IntersectionObserver' in window) {
  const targets = document.querySelectorAll<HTMLElement>('.head, .frame, .beat, .unit, .foe, .mode, .room, .lore-inner, .keys, .safe, .final .wrap');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      io.unobserve(en.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  const vh = innerHeight;
  targets.forEach((t) => {
    // never hide what is already on screen when the script arrives
    if (t.getBoundingClientRect().top < vh * 0.9) return;
    t.classList.add('rv');
    io.observe(t);
  });
  root.classList.add('js');
}

// --- hover previews: a short clip of the tower or machine in action, loaded only when asked for
{
  const clipOf = (img: HTMLImageElement) => /media\/((?:tower|enemy)_[a-z]+)\.jpg$/.exec(img.getAttribute('src') || '')?.[1];
  document.querySelectorAll<HTMLElement>('.unit, .foe').forEach((card) => {
    const img = card.querySelector('img');
    const name = img && clipOf(img);
    if (!img || !name) return;
    let video: HTMLVideoElement | null = null, dead = false, wanted = false;
    const start = () => {
      if (dead) return;
      wanted = true;
      if (!video) {
        const v = document.createElement('video');
        v.className = 'pv';
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
        v.addEventListener('playing', () => { if (wanted) card.classList.add('playing'); });
        v.addEventListener('error', () => { dead = true; card.classList.remove('playing'); v.remove(); video = null; });
        v.src = './media/prev/' + name + '.mp4';
        img.after(v);
        video = v;
      }
      void video.play().catch(() => { /* not allowed or not loaded yet */ });
    };
    const stop = () => {
      wanted = false;
      card.classList.remove('playing');
      if (video) { video.pause(); try { video.currentTime = 0; } catch { /* not seekable yet */ } }
    };
    // mouse: play while the pointer is over the card. Touch and reduced motion: a tap toggles it.
    card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !reduced.matches) start(); });
    card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') stop(); });
    card.addEventListener('click', () => { if (card.classList.contains('playing')) stop(); else start(); });
  });
}
