// =============================================================================
// Mobile navbar drawer.
//
// Injects a hamburger button into every .nav-container, wires up the toggle,
// and closes the drawer when any link inside it is tapped. Pure CSS handles
// the layout — JS only flips the `.is-open` class on the parent .navbar.
//
// Loaded on every page that renders the global navbar, including pages that
// don't load auth.js (terms / privacy / offer / contacts). Has no external
// dependencies.
// =============================================================================
(function () {
    'use strict';

    function init() {
        var containers = document.querySelectorAll('.nav-container');
        for (var i = 0; i < containers.length; i++) {
            wire(containers[i]);
        }
    }

    function wire(container) {
        if (container.querySelector('.nav-hamburger')) return;
        var navbar = container.closest('.navbar');
        if (!navbar) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-hamburger';
        btn.setAttribute('aria-label', 'Меню');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(btn);

        // Backdrop sibling to the navbar — gets visible (via CSS) only while
        // the drawer is open and serves as a tap-anywhere-to-close target.
        var backdrop = document.querySelector('.nav-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'nav-backdrop';
            backdrop.setAttribute('aria-hidden', 'true');
            navbar.parentNode.insertBefore(backdrop, navbar.nextSibling);
        }

        function close() {
            navbar.classList.remove('is-open');
            btn.setAttribute('aria-expanded', 'false');
        }

        btn.addEventListener('click', function () {
            var open = navbar.classList.toggle('is-open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        });

        backdrop.addEventListener('click', close);

        // Close the drawer when any link inside the nav is tapped. Without
        // this, in-page navigations like showPage('tryon') would leave the
        // drawer hanging open behind the new view.
        container.addEventListener('click', function (e) {
            var link = e.target.closest && e.target.closest('a');
            if (!link) return;
            if (!navbar.classList.contains('is-open')) return;
            close();
        });

        // Close on Esc — small a11y nicety.
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && navbar.classList.contains('is-open')) {
                close();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
