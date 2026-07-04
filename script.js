// ── AP2: content loading ────────────────────────────────────────────────────
// All copy lives in fetchable JSON files under content/ so the Pages CMS can
// edit it without touching code. Every entry follows the same schema:
// { id, title, description, images: [{src, alt, caption, width, height}],
//   sounds: [{title, url}] }.
// Paths are RELATIVE ("content/…", "images/…") because the site is served
// from a sub-path (/kirstenpalz/) in production.

const PAGE_IDS = ['about', 'now', 'cv', 'thanks', 'sculpture', 'absences', 'ai-research'];

const contentState = {
    byId: {},      // registry: id → entry (projects + engagement + pages)
    projects: [],  // ordered list for the PROJECTS directory
    engagement: [] // ordered list for the ENGAGEMENT directory
};

const fetchJson = async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
};

const loadContent = async () => {
    const [projects, engagement, ...pages] = await Promise.all([
        fetchJson('content/projects.json'),
        fetchJson('content/engagement.json'),
        ...PAGE_IDS.map((id) => fetchJson(`content/pages/${id}.json`))
    ]);
    contentState.projects = projects;
    contentState.engagement = engagement;
    [...projects, ...engagement, ...pages].forEach((entry) => {
        contentState.byId[entry.id] = entry;
    });
};

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
));

document.addEventListener('DOMContentLoaded', async () => {
    // Progressive enhancement flag: unlocks the `html.js [data-reveal]` rules
    // in style.css. Without JS the content stays visible (no-JS fallback).
    document.documentElement.classList.add('js');

    // Content must be loaded before anything can render. On failure we show a
    // plain brutalist notice instead of a silently empty page.
    try {
        await loadContent();
    } catch (error) {
        console.error('Content could not be loaded:', error);
        const wrapper = document.querySelector('.content-wrapper');
        if (wrapper) {
            wrapper.innerHTML = '<p style="padding: 40px 0;">CONTENT COULD NOT BE LOADED.</p>';
        }
        return;
    }

    // ── Round 2 (KON-295): motion behaviour ────────────────────────────────
    // The CSS reduced-motion block neutralises CSS animation/transition with
    // `!important`, but it canNOT touch JS-driven motion (Web Animations API,
    // smooth scroll). So every JS micro-interaction below is gated on this
    // live flag instead. Tracks the OS setting in real time.
    const reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = reduceMotionMQ.matches;
    reduceMotionMQ.addEventListener('change', (e) => { prefersReducedMotion = e.matches; });

    // Scroll-reveal observer: fades each tagged element in once, when ~12%
    // visible. prefers-reduced-motion is handled in CSS (it neutralises the
    // reveal transform/opacity), so no JS branch is needed here.
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target); // fire once per element
            }
        });
    }, { threshold: 0.12 });

    // Tag elements with data-reveal and observe them. Safe to call on
    // re-render: clears any prior is-visible so the reveal can replay.
    const observeReveal = (elements) => {
        elements.forEach((el) => {
            if (!el) return;
            el.classList.remove('is-visible');
            el.setAttribute('data-reveal', '');
            revealObserver.observe(el);
        });
    };

    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.content-section');

    // Specific logic for Kirsten Palz dropdown
    const aboutToggle = document.getElementById('about-toggle');
    const aboutDropdown = document.getElementById('about-dropdown');
    if (aboutToggle && aboutDropdown) {
        aboutToggle.addEventListener('click', () => {
            // Note: We don't call e.preventDefault() here because we WANT
            // the general project-link logic to also fire and load the 'about' content.

            if (aboutDropdown.style.display === 'none') {
                aboutDropdown.style.display = 'block';
                aboutToggle.querySelector('h1').innerHTML = 'KIRSTEN PALZ <span style="font-size: 10px; vertical-align: middle;">▲</span>';
            } else {
                aboutDropdown.style.display = 'none';
                aboutToggle.querySelector('h1').innerHTML = 'KIRSTEN PALZ <span style="font-size: 10px; vertical-align: middle;">▼</span>';
            }
        });
    }

    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const backBtn = document.getElementById('backToDirectory');
    const detailTitle = document.getElementById('detail-title');
    const detailDescription = document.getElementById('detail-description');
    const detailImages = document.getElementById('detail-images');

    // ── Round 2 motion helpers (all reduced-motion safe) ───────────────────

    // Smooth scroll the content column back to the top on every route change,
    // replacing the previous instant `mainContent.scrollTop = 0` jumps. Falls
    // back to an instant jump when reduced motion is requested.
    const scrollContentTop = () => {
        if (mainContent) {
            mainContent.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
        }
        // KON-305 mobile route-change safety: some mobile browsers scroll the
        // window (URL-bar collapse) instead of .main-content, so reset both so
        // a new view always lands at the top. Instant jump = reduced-motion safe.
        window.scrollTo(0, 0);
    };

    // Choreographed section-enter via the Web Animations API. The CSS `riseIn`
    // keyframes only fire the FIRST time a section matches `.active`; on
    // re-navigation they stay silent. This replays a short fade+rise on every
    // switch so routing always feels alive. Composes cleanly with the CSS
    // child stagger on a section's first view (parent fades, children rise).
    const animateSectionIn = (section) => {
        if (!section || prefersReducedMotion || typeof section.animate !== 'function') return;
        section.animate(
            [
                { opacity: 0, transform: 'translateY(10px)' },
                { opacity: 1, transform: 'none' }
            ],
            { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }
        );
    };

    // NOTE: the old hover/focus image-prefetch helper was removed with AP2.
    // Images are now local (AP1), carry width/height (no layout shift) and use
    // loading="lazy"; warming the cache with full-size files on mere hover
    // would waste bandwidth for no perceivable gain.

    // ── AP2: directory + detail rendering ──────────────────────────────────

    // Renders a brutalist directory list from an ordered content array,
    // matching the markup the hardcoded lists used (style.css stays as-is).
    const renderDirectoryList = (containerId, entries) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = entries.map((entry) => (
            `<a href="#" class="brutalist-item project-link" data-project-id="${escapeHtml(entry.id)}">` +
            `<span>${escapeHtml(entry.title)}</span><span class="arrow">+</span></a>`
        )).join('');
    };

    // Every external link inside rendered content opens in a new tab. The
    // content JSON deliberately carries no target/rel attributes (the CMS
    // editor would strip them anyway) — behaviour is applied here centrally.
    const decorateExternalLinks = (root) => {
        root.querySelectorAll('a[href^="http://"], a[href^="https://"]').forEach((a) => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener');
        });
    };

    // SoundCloud embeds are built from plain track URLs in the content JSON
    // (iframes would not survive the CMS editor). Click-to-load follows in AP5.
    const renderSounds = (container, sounds) => {
        if (!Array.isArray(sounds) || sounds.length === 0) return;
        sounds.forEach((sound) => {
            if (!sound || !sound.url) return;
            const block = document.createElement('div');
            block.className = 'sound-embed';
            block.style.margin = '30px 0';

            const title = document.createElement('p');
            title.style.marginBottom = '10px';
            const strong = document.createElement('strong');
            strong.textContent = sound.title || '';
            title.appendChild(strong);

            const iframe = document.createElement('iframe');
            iframe.width = '100%';
            iframe.height = '166';
            iframe.setAttribute('scrolling', 'no');
            iframe.setAttribute('frameborder', 'no');
            iframe.setAttribute('allow', 'autoplay');
            iframe.loading = 'lazy';
            iframe.title = sound.title || 'SoundCloud player';
            iframe.src = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(sound.url)
                + '&color=%23000000&auto_play=false&show_user=true';

            block.appendChild(title);
            block.appendChild(iframe);
            container.appendChild(block);
        });
    };

    const openProject = (projectId, link) => {
        const data = contentState.byId[projectId];
        if (!data) return;

        // Active-state sync (recognition over recall): clear nav highlight,
        // then re-set it only if the clicked link lives in the sidebar so
        // the nav reflects the open view. Brutalist-list links (main
        // content) intentionally leave the nav with no active item.
        navLinks.forEach(l => l.classList.remove('active'));
        if (link && link.closest('.sidebar')) {
            link.classList.add('active');
        }

        // Masthead shows the opened work's own name (Round 2 poster
        // masthead — each detail view reads as a titled work, not a
        // generic category). The body description still opens with the
        // full dated citation line `TITLE (YEAR)`, so the masthead is
        // the clean work name and the body is the citation — hierarchy,
        // not doubling. Falls back to the section category if an entry
        // ever lacks a title.
        const engagementIds = contentState.engagement.map((entry) => entry.id);
        let fallbackTitle;
        if (engagementIds.includes(projectId) || projectId === 'thanks') {
            fallbackTitle = 'ENGAGEMENT';
        } else if (projectId === 'about' || projectId === 'now' || projectId === 'cv') {
            fallbackTitle = 'KIRSTEN PALZ';
        } else {
            fallbackTitle = 'PROJECTS';
        }
        detailTitle.textContent = data.title || fallbackTitle;

        detailDescription.innerHTML = data.description || '';
        decorateExternalLinks(detailDescription);
        renderSounds(detailDescription, data.sounds);

        detailImages.innerHTML = '';
        if (Array.isArray(data.images) && data.images.length > 0) {
            const grid = document.createElement('div');
            grid.className = data.images.length === 1
                ? 'image-grid single-image'
                : 'image-grid multi-image';
            grid.style.marginTop = '40px';
            data.images.forEach((image) => {
                if (!image || !image.src) return;
                const box = document.createElement('div');
                box.className = 'image-box';
                box.style.marginBottom = '30px';

                const img = document.createElement('img');
                // Defensive: the CMS may save absolute paths; the site lives
                // under /kirstenpalz/, so leading slashes must go.
                img.src = image.src.replace(/^\//, '');
                img.alt = image.alt || '';
                if (image.width) img.width = image.width;
                if (image.height) img.height = image.height;
                img.loading = 'lazy';
                img.style.cssText = 'max-width:100%; height:auto; display:block; margin: 0 auto;';
                box.appendChild(img);

                if (image.caption) {
                    const caption = document.createElement('p');
                    caption.className = 'image-caption';
                    caption.style.cssText = 'font-size: 12px; margin-top: 10px; text-align: left;';
                    caption.textContent = image.caption;
                    box.appendChild(caption);
                }
                grid.appendChild(box);
            });
            detailImages.appendChild(grid);
        }

        sections.forEach(sec => sec.classList.remove('active'));
        document.getElementById('project-detail').classList.add('active');
        scrollContentTop();

        // Scroll reveal: tag the description block plus every image-box
        // injected into the grid above and observe them.
        observeReveal([detailDescription, ...document.querySelectorAll('#project-detail .image-box')]);
    };

    renderDirectoryList('projects-list', contentState.projects);
    renderDirectoryList('engagement-list', contentState.engagement);

    // ── KON-305 mobile nav-drawer behaviour ────────────────────────────────
    // One source of truth for opening/closing the mobile sidebar. The
    // hamburger, nav links, the outside-tap backdrop and the Escape key all
    // route through setSidebarOpen() so the .open class, toggle label,
    // aria-expanded, body scroll-lock (mobile only) and the injected
    // .sidebar-backdrop element never drift out of sync. UXDesigner owns the
    // .sidebar-backdrop visuals in style.css; this lane owns the DOM + events.
    const MOBILE_BP = 768;
    let sidebarBackdrop = null;

    const closeSidebar = () => setSidebarOpen(false);

    const removeBackdrop = () => {
        if (sidebarBackdrop) { sidebarBackdrop.remove(); sidebarBackdrop = null; }
    };

    const addBackdrop = () => {
        if (sidebarBackdrop) return;
        sidebarBackdrop = document.createElement('div');
        sidebarBackdrop.className = 'sidebar-backdrop';
        // Functional fallback only when UXDesigner's CSS hasn't landed yet: if a
        // stylesheet already positions .sidebar-backdrop we defer all visuals to
        // it; otherwise we apply the minimum needed to make outside-tap work.
        if (getComputedStyle(sidebarBackdrop).position === 'static') {
            Object.assign(sidebarBackdrop.style, {
                position: 'fixed', inset: '0', zIndex: '9',
                background: 'rgba(0,0,0,0.32)', cursor: 'pointer'
            });
        }
        sidebarBackdrop.addEventListener('click', closeSidebar);
        document.body.appendChild(sidebarBackdrop);
    };

    const setSidebarOpen = (open) => {
        if (!sidebar) return;
        sidebar.classList.toggle('open', open);
        if (menuToggle) {
            menuToggle.textContent = open ? 'CLOSE' : 'MENU';
            menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        // Lock background scroll while the drawer is open on mobile; restoring to
        // an empty string hands control back to the stylesheet default.
        if (window.innerWidth <= MOBILE_BP) {
            document.body.style.overflow = open ? 'hidden' : '';
        } else if (!open) {
            document.body.style.overflow = '';
        }
        if (open) addBackdrop(); else removeBackdrop();
    };

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            // Sidebar project links (data-project-id) are handled by the
            // delegated project-link handler below.
            const targetId = link.getAttribute('data-target');
            if (!targetId) return;
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            sections.forEach(sec => sec.classList.remove('active'));
            const targetSec = document.getElementById(targetId);
            if (targetSec) {
                targetSec.classList.add('active');
                animateSectionIn(targetSec);
            }
            if (window.innerWidth <= MOBILE_BP) closeSidebar();
            scrollContentTop();
        });
    });

    if (menuToggle) {
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.addEventListener('click', () => {
            setSidebarOpen(!sidebar.classList.contains('open'));
        });
    }

    // AP2: one delegated listener covers both the static sidebar project
    // links and the dynamically rendered directory lists — no per-link
    // listeners to (re)attach after a render.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('.project-link');
        if (!link) return;
        e.preventDefault();
        const projectId = link.getAttribute('data-project-id');
        if (!projectId) return;
        openProject(projectId, link);
        if (window.innerWidth <= MOBILE_BP && link.closest('.sidebar')) closeSidebar();
    });

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            sections.forEach(sec => sec.classList.remove('active'));
            const home = document.getElementById('home');
            home.classList.add('active');
            animateSectionIn(home);
            navLinks.forEach(l => l.classList.remove('active'));
            document.querySelector('.nav-link[data-target="home"]').classList.add('active');
            scrollContentTop();
        });
    }

    // Escape returns from a project detail to the directory — reuses the back
    // button's routine so nav state + scroll stay consistent. Brutalist,
    // keyboard-first micro-interaction; no-op anywhere else.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // KON-305: the open mobile drawer takes priority — Escape closes it
        // first and stops, so it doesn't also pop the project detail underneath.
        if (sidebar && sidebar.classList.contains('open')) {
            closeSidebar();
            return;
        }
        const detail = document.getElementById('project-detail');
        if (backBtn && detail && detail.classList.contains('active')) {
            backBtn.click();
        }
    });
});
