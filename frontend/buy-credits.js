// ---------------------------------------------------------------------------
// Buy credits — opens the modal, talks to /api/checkout, redirects to YooKassa
// ---------------------------------------------------------------------------
// Used on both index.html (in-page modal) and dashboard.html (modal + nav CTA).
// Requires window.TWD_AUTH (auth.js) to be loaded first.

(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function getModal() {
        return document.getElementById('buy-credits-modal');
    }

    function getErrorBox() {
        return document.getElementById('buy-credits-error');
    }

    function showError(msg) {
        var box = getErrorBox();
        if (!box) return;
        box.textContent = msg;
        box.classList.add('visible');
    }

    function clearError() {
        var box = getErrorBox();
        if (!box) return;
        box.textContent = '';
        box.classList.remove('visible');
    }

    function setButtonsDisabled(disabled) {
        var modal = getModal();
        if (!modal) return;
        var buttons = modal.querySelectorAll('.pricing-buy');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].disabled = disabled;
        }
    }

    window.openBuyCreditsModal = async function () {
        var modal = getModal();
        if (!modal) return;
        clearError();
        setButtonsDisabled(false);

        // Restore default labels in case a previous attempt left
        // a "Перенаправляем…" string on a button.
        var buttons = modal.querySelectorAll('.pricing-buy');
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].textContent = 'Купить';
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Soft-gate: if no session, prompt sign-in instead of erroring on click.
        if (window.TWD_AUTH) {
            var session = await window.TWD_AUTH.getSession();
            if (!session) {
                window.closeBuyCreditsModal();
                if (typeof window.openAuthRequiredModal === 'function') {
                    window.openAuthRequiredModal();
                } else {
                    window.location.href = '/login.html?next=' +
                        encodeURIComponent(window.location.pathname);
                }
            }
        }
    };

    window.closeBuyCreditsModal = function () {
        var modal = getModal();
        if (!modal) return;
        modal.style.display = 'none';
        document.body.style.overflow = '';
    };

    window.buyCreditPack = async function (packId, btn) {
        clearError();
        if (!window.TWD_AUTH) {
            showError('Сервис временно недоступен. Обновите страницу и попробуйте ещё раз.');
            return;
        }
        var session = await window.TWD_AUTH.getSession();
        if (!session) {
            window.closeBuyCreditsModal();
            if (typeof window.openAuthRequiredModal === 'function') {
                window.openAuthRequiredModal();
            } else {
                window.location.href = '/login.html?next=' +
                    encodeURIComponent(window.location.pathname);
            }
            return;
        }

        setButtonsDisabled(true);
        var originalText = btn ? btn.textContent : '';
        if (btn) btn.textContent = 'Перенаправляем…';

        try {
            var res = await fetch('/api/checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + session.access_token,
                },
                body: JSON.stringify({
                    pack_id: packId,
                    return_url: window.location.origin + '/checkout-success.html',
                }),
            });

            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                if (res.status === 503) {
                    showError(
                        'Оплата сейчас недоступна — мы заканчиваем настройку платежей. ' +
                        'Попробуйте позже или напишите нам info@tryweddingdress.com.'
                    );
                } else if (res.status === 401) {
                    showError('Сессия истекла. Войдите снова и повторите попытку.');
                } else {
                    showError(err.detail || ('Не удалось создать оплату (' + res.status + ').'));
                }
                setButtonsDisabled(false);
                if (btn) btn.textContent = originalText;
                return;
            }

            var data = await res.json();
            if (!data.confirmation_url) {
                showError('Платёжный сервис не вернул ссылку на оплату. Попробуйте ещё раз.');
                setButtonsDisabled(false);
                if (btn) btn.textContent = originalText;
                return;
            }

            // Hand off to YooKassa hosted checkout.
            window.location.href = data.confirmation_url;
        } catch (e) {
            showError('Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.');
            setButtonsDisabled(false);
            if (btn) btn.textContent = originalText;
        }
    };

    // Allow ESC to close the modal.
    document.addEventListener('keydown', function (e) {
        var modal = getModal();
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
            window.closeBuyCreditsModal();
        }
    });
})();
