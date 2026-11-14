// Landing page behaviour. Progressive enhancement only: the page is complete without it.
import '@fontsource/saira-stencil-one/400.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

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
