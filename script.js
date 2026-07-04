// ── AP2: content loading ────────────────────────────────────────────────────
// All copy lives in fetchable JSON files under content/ so the Pages CMS can
// edit it without touching code. Every entry follows the same schema:
// { id, title, description, images: [{src, alt, caption, width, height}],
//   sounds: [{title, url}] }.
// Paths are RELATIVE ("content/…", "images/…") because the site is served
// from a sub-path (/kirstenpalz/) in production.

// ── PAGE REGISTRY ────────────────────────────────────────────────────────────
// Every id listed here is (a) fetched from content/pages/<id>.json and
// (b) automatically routable as "#/<id>" — no router changes needed.
// To add a page: drop the JSON file into content/pages/ and append its id
// to this list. That's all (AP5 added impressum + datenschutz exactly so).
const PAGE_IDS = ['about', 'now', 'cv', 'thanks', 'sculpture', 'absences', 'ai-research', 'impressum', 'datenschutz'];

// AP5: the site is English (<html lang="en">), but the legal pages are
// written in German. Ids listed here get lang="…" on the detail-view
// container so screen readers/hyphenation switch language per page.
const PAGE_LANGS = { impressum: 'de', datenschutz: 'de' };

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

// AP3: document.title per route. Home is the bare site name; every other
// route appends it to the content's own title. Content titles are stored in
// their original mixed case (uppercase on screen is CSS-only), and the title
// bar keeps that original casing. The about page is titled "Kirsten Palz",
// which would double the site name — collapse that case to the bare name.
const setDocumentTitle = (title) => {
    document.title = (title && title.toUpperCase() !== 'KIRSTEN PALZ')
        ? `${title} — KIRSTEN PALZ`
        : 'KIRSTEN PALZ';
};

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
    // AP3: entries carry real "#/p/<id>" hrefs so middle-click / copy-link /
    // open-in-new-tab work; navigation itself runs through the hash router.
    const renderDirectoryList = (containerId, entries) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = entries.map((entry) => (
            `<a href="#/p/${escapeHtml(entry.id)}" class="brutalist-item">` +
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
    // (iframes would not survive the CMS editor).
    //
    // AP5 — click-to-load (two-click solution, GDPR): nothing is requested
    // from SoundCloud (no iframe, no thumbnail) until the visitor presses the
    // LOAD SOUND button. Only then is the player iframe injected into the
    // placeholder frame. A real <button> keeps it keyboard-operable; the
    // global button:focus-visible outline applies. Styles: .sound-* in
    // style.css.
    const buildSoundIframe = (sound) => {
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
        return iframe;
    };

    const renderSounds = (container, sounds) => {
        if (!Array.isArray(sounds) || sounds.length === 0) return;
        sounds.forEach((sound) => {
            if (!sound || !sound.url) return;
            const block = document.createElement('div');
            block.className = 'sound-embed';

            const placeholder = document.createElement('div');
            placeholder.className = 'sound-placeholder';

            const title = document.createElement('p');
            title.className = 'sound-title';
            const strong = document.createElement('strong');
            strong.textContent = sound.title || '';
            title.appendChild(strong);

            const loadBtn = document.createElement('button');
            loadBtn.type = 'button';
            loadBtn.className = 'sound-load-btn';
            loadBtn.textContent = '▶ LOAD SOUND';

            const hint = document.createElement('p');
            hint.className = 'sound-load-hint';
            hint.textContent = 'Loading transfers data to SoundCloud.';

            loadBtn.addEventListener('click', () => {
                const iframe = buildSoundIframe(sound);
                loadBtn.remove();
                hint.remove();
                placeholder.appendChild(iframe);
                // The button (the focused element) is gone — hand focus to the
                // player so keyboard users are not dropped back to <body>.
                iframe.focus();
            }, { once: true });

            placeholder.appendChild(title);
            placeholder.appendChild(loadBtn);
            placeholder.appendChild(hint);
            block.appendChild(placeholder);
            container.appendChild(block);
        });
    };

    const openProject = (projectId) => {
        const data = contentState.byId[projectId];
        if (!data) {
            // Registry miss (id routes, but no content entry exists — e.g. a
            // JSON file was removed): behave exactly like an unknown route
            // instead of leaving the previous view under a wrong URL.
            recoverToHome();
            return;
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
        setDocumentTitle(data.title || fallbackTitle);

        detailDescription.innerHTML = data.description || '';
        decorateExternalLinks(detailDescription);
        renderSounds(detailDescription, data.sounds);

        detailImages.innerHTML = '';
        if (Array.isArray(data.images) && data.images.length > 0) {
            const grid = document.createElement('div');
            grid.className = data.images.length === 1
                ? 'image-grid single-image'
                : 'image-grid multi-image';
            // AP4: markup matches the CSS contract exactly —
            //   .image-box > figure.image-frame > img  (+ p.image-caption)
            // The .image-frame wrapper (overflow: hidden) is what makes the
            // slow editorial hover zoom work; it was never rendered before.
            // No inline styles: spacing/typography live in style.css
            // (.image-grid margins, .image-box, .image-caption).
            data.images.forEach((image) => {
                if (!image || !image.src) return;
                const box = document.createElement('div');
                box.className = 'image-box';

                const frame = document.createElement('figure');
                frame.className = 'image-frame';

                const img = document.createElement('img');
                // Defensive: the CMS may save absolute paths; the site lives
                // under /kirstenpalz/, so leading slashes must go.
                img.src = image.src.replace(/^\//, '');
                img.alt = image.alt || '';
                if (image.width) img.width = image.width;
                if (image.height) img.height = image.height;
                img.loading = 'lazy';
                frame.appendChild(img);
                box.appendChild(frame);

                if (image.caption) {
                    const caption = document.createElement('p');
                    caption.className = 'image-caption';
                    caption.textContent = image.caption;
                    box.appendChild(caption);
                }
                grid.appendChild(box);
            });
            detailImages.appendChild(grid);
        }

        sections.forEach(sec => sec.classList.remove('active'));
        const detailSection = document.getElementById('project-detail');
        // AP5: German legal pages announce their language on the container
        // (see PAGE_LANGS); every other entry inherits <html lang="en">.
        if (PAGE_LANGS[projectId]) {
            detailSection.setAttribute('lang', PAGE_LANGS[projectId]);
        } else {
            detailSection.removeAttribute('lang');
        }
        detailSection.classList.add('active');
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

    if (menuToggle) {
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.addEventListener('click', () => {
            setSidebarOpen(!sidebar.classList.contains('open'));
        });
    }

    // ── AP3: hash router ────────────────────────────────────────────────────
    // Route table (the "#/" prefix keeps native in-page anchors usable):
    //   #/ or empty   → home (PROJECTS directory)
    //   #/engagement  → ENGAGEMENT directory
    //   #/p/<id>      → detail view of a project or engagement entry (byId)
    //   #/<page-id>   → standalone page; every id in PAGE_IDS routes
    //                   automatically (see the PAGE REGISTRY at the top)
    //   anything else → home, URL silently corrected to #/ (replaceState)
    // All links carry real hrefs; clicks just change location.hash and the
    // hashchange listener renders — so deep links, reload and the browser's
    // back/forward buttons all resolve through the same navigate() path.

    const parseRoute = (rawHash) => {
        let hash;
        try {
            hash = decodeURIComponent(rawHash || '');
        } catch (error) {
            return null; // malformed percent-encoding → treat as unknown route
        }
        if (hash === '' || hash === '#' || hash === '#/') return { view: 'home' };
        if (!hash.startsWith('#/')) return null;
        const path = hash.slice(2);
        if (path === 'engagement') return { view: 'engagement' };
        const detail = path.match(/^p\/([\w-]+)$/);
        if (detail && contentState.byId[detail[1]]) return { view: 'detail', id: detail[1] };
        if (PAGE_IDS.includes(path)) return { view: 'detail', id: path };
        return null;
    };

    // Canonical hash per route — used to highlight the matching sidebar link.
    // Directory-list entries (#/p/<id>) have no sidebar counterpart, so the
    // nav intentionally shows no active item there (same as before AP3).
    const routeHash = (route) => {
        if (route.view === 'engagement') return '#/engagement';
        if (route.view === 'detail') {
            return PAGE_IDS.includes(route.id) ? `#/${route.id}` : `#/p/${route.id}`;
        }
        return '#/';
    };

    const renderRoute = (route) => {
        // Any navigation closes the mobile drawer so the new view is visible.
        if (window.innerWidth <= MOBILE_BP) closeSidebar();
        const hash = routeHash(route);
        navLinks.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === hash));

        if (route.view === 'detail') {
            openProject(route.id); // sets document.title from the content
            return;
        }
        const target = document.getElementById(route.view === 'engagement' ? 'engagement' : 'home');
        sections.forEach(sec => sec.classList.remove('active'));
        target.classList.add('active');
        animateSectionIn(target);
        scrollContentTop();
        setDocumentTitle(route.view === 'engagement' ? 'Engagement' : null);
    };

    // Unknown route/id: show home and quietly repair the URL without adding
    // a history entry or re-firing hashchange. Shared by navigate() (route
    // doesn't parse) and openProject() (route parses, but no registry entry).
    const recoverToHome = () => {
        history.replaceState(null, '', '#/');
        renderRoute({ view: 'home' });
    };

    const navigate = () => {
        const route = parseRoute(location.hash);
        if (route) renderRoute(route); else recoverToHome();
    };

    // Back-btn / Escape prefer real browser history so back-forward stays
    // symmetrical — but only when the visitor has navigated inside the app.
    // On a cold deep link there is no in-app entry behind us, so we go to the
    // route's parent instead (engagement entry → #/engagement, else → #/).
    let internalNavCount = 0;
    const parentHash = (route) => (
        route && route.view === 'detail' && contentState.engagement.some((e) => e.id === route.id)
            ? '#/engagement'
            : '#/'
    );
    const goBack = () => {
        if (internalNavCount > 0) {
            history.back();
            return;
        }
        location.hash = parentHash(parseRoute(location.hash));
    };

    window.addEventListener('hashchange', () => {
        internalNavCount += 1;
        navigate();
    });

    // Same-hash clicks (e.g. tapping PROJECTS while on home) don't fire
    // hashchange — re-render manually so scroll-to-top/animation still replay
    // and the mobile drawer still closes.
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href^="#/"]');
        if (!link) return;
        if (link.getAttribute('href') === location.hash) navigate();
    });

    if (backBtn) backBtn.addEventListener('click', goBack);

    // Escape returns from a project detail to the directory. Brutalist,
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
        if (detail && detail.classList.contains('active')) goBack();
    });

    // Initial load resolves whatever hash the visitor arrived with, so deep
    // links like #/p/chronicle or #/cv render directly.
    navigate();
});
