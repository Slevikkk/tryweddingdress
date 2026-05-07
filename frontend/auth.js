// =============================================================================
// Auth helpers built on Supabase Auth.
//
// Loads the supabase-js v2 UMD bundle from a CDN, exposes a single
// `window.TWD_AUTH` namespace with sign-up / sign-in / sign-out / session
// helpers, and applies a small `data-auth` attribute system so any page can
// reflect logged-in vs logged-out state without bespoke JS.
//
// Usage in HTML:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="config.js"></script>
//   <script src="auth.js"></script>
//
// Then mark elements:
//   <div data-auth="signed-in">Visible only when logged in</div>
//   <div data-auth="signed-out">Visible only when logged out</div>
//   <span data-auth-email></span>      auto-filled with the user's email
//   <a href="#" data-auth-action="logout">Log out</a>
// =============================================================================
(function () {
    'use strict';

    if (!window.supabase || !window.TWD_CONFIG) {
        console.error(
            '[auth] supabase-js or TWD_CONFIG not loaded. Include the supabase-js ' +
                'UMD script and config.js before auth.js.'
        );
        return;
    }

    var sb = window.supabase.createClient(
        window.TWD_CONFIG.SUPABASE_URL,
        window.TWD_CONFIG.SUPABASE_ANON_KEY,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'twd-auth',
            },
        }
    );

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------
    async function signUp(email, password, fullName, marketingOptIn) {
        var origin = window.location.origin;
        var redirectTo = origin + '/login.html?confirmed=1';
        var result = await sb.auth.signUp({
            email: email,
            password: password,
            options: {
                emailRedirectTo: redirectTo,
                data: {
                    full_name: fullName || null,
                    marketing_opt_in: !!marketingOptIn,
                },
            },
        });
        return result;
    }

    async function signIn(email, password) {
        return sb.auth.signInWithPassword({ email: email, password: password });
    }

    async function signOut() {
        var result = await sb.auth.signOut();
        applyAuthVisibility(null);
        return result;
    }

    async function resetPassword(email) {
        var origin = window.location.origin;
        return sb.auth.resetPasswordForEmail(email, {
            redirectTo: origin + '/login.html?reset=1',
        });
    }

    async function getSession() {
        var resp = await sb.auth.getSession();
        return resp.data.session;
    }

    async function getUser() {
        var session = await getSession();
        return session ? session.user : null;
    }

    async function getProfile() {
        var user = await getUser();
        if (!user) return null;
        var resp = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
        return resp.data;
    }

    async function updateProfile(patch) {
        var user = await getUser();
        if (!user) throw new Error('Not signed in');
        return sb.from('profiles').update(patch).eq('id', user.id);
    }

    async function getCreditBalance() {
        var user = await getUser();
        if (!user) return 0;
        var resp = await sb
            .from('v_credit_balance')
            .select('balance')
            .eq('user_id', user.id)
            .maybeSingle();
        return (resp.data && resp.data.balance) || 0;
    }

    async function listGenerations(limit) {
        var user = await getUser();
        if (!user) return [];
        var resp = await sb
            .from('generations')
            .select('*')
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(limit || 25);
        return resp.data || [];
    }

    function requireAuth(redirectTo) {
        // For dashboard-style pages: bounce to /login.html if not signed in.
        var target = redirectTo || '/login.html?next=' +
            encodeURIComponent(window.location.pathname + window.location.search);
        getSession().then(function (s) {
            if (!s) window.location.replace(target);
        });
    }

    // ---------------------------------------------------------------------
    // DOM glue
    // ---------------------------------------------------------------------
    function applyAuthVisibility(user) {
        var signedInEls = document.querySelectorAll('[data-auth="signed-in"]');
        var signedOutEls = document.querySelectorAll('[data-auth="signed-out"]');
        for (var i = 0; i < signedInEls.length; i++) {
            signedInEls[i].style.display = user ? '' : 'none';
        }
        for (var j = 0; j < signedOutEls.length; j++) {
            signedOutEls[j].style.display = user ? 'none' : '';
        }

        var emailEls = document.querySelectorAll('[data-auth-email]');
        for (var k = 0; k < emailEls.length; k++) {
            emailEls[k].textContent = user ? user.email : '';
        }
    }

    function bindAuthActions() {
        document.addEventListener('click', function (e) {
            var t = e.target.closest && e.target.closest('[data-auth-action]');
            if (!t) return;
            var action = t.getAttribute('data-auth-action');
            if (action === 'logout') {
                e.preventDefault();
                signOut().then(function () {
                    var next = t.getAttribute('data-auth-next') || '/';
                    window.location.href = next;
                });
            }
        });
    }

    // Initial paint + listen for changes from anywhere (e.g. another tab).
    sb.auth.onAuthStateChange(function (_event, session) {
        applyAuthVisibility(session ? session.user : null);
    });

    document.addEventListener('DOMContentLoaded', function () {
        bindAuthActions();
        getUser().then(applyAuthVisibility);
    });

    // ---------------------------------------------------------------------
    // Expose
    // ---------------------------------------------------------------------
    window.TWD_AUTH = {
        client: sb,
        signUp: signUp,
        signIn: signIn,
        signOut: signOut,
        resetPassword: resetPassword,
        getSession: getSession,
        getUser: getUser,
        getProfile: getProfile,
        updateProfile: updateProfile,
        getCreditBalance: getCreditBalance,
        listGenerations: listGenerations,
        requireAuth: requireAuth,
    };
})();
