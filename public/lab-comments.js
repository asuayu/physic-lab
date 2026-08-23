(() => {
    "use strict";

    if (window.__physicsLabCommentsLoaded) return;
    window.__physicsLabCommentsLoaded = true;

    const PAGE = (() => {
        try {
            return decodeURIComponent(location.pathname).normalize("NFC");
        } catch {
            return location.pathname;
        }
    })();
    const ADMIN_MODE = new URLSearchParams(location.search).get("comments-admin") === "1";
    const state = {
        open: false,
        loaded: false,
        loading: false,
        comments: [],
        total: 0,
        nextCursor: null,
        hasMore: false,
        replyTo: null,
        turnstileRequired: false,
        turnstileSiteKey: null,
        turnstileToken: "",
        turnstileWidgetId: null,
        maxLength: 800,
    };

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };

    function pageTitle() {
        const raw = document.title.replace(/\s*[|·-]\s*(Physics Lab|物理.*)$/i, "").trim();
        return raw || "当前实验";
    }

    function buildUI() {
        const root = element("div");
        root.id = "pl-comments-root";
        root.dataset.open = "false";
        root.dataset.admin = ADMIN_MODE ? "true" : "false";
        root.innerHTML = `
            <button class="pl-comments-launcher" type="button" aria-haspopup="dialog" aria-expanded="false">
                <span aria-hidden="true">💬</span><span>留言</span><span class="pl-comments-count" hidden>0</span>
            </button>
            <div class="pl-comments-overlay" aria-hidden="true"></div>
            <section class="pl-comments-drawer" role="dialog" aria-modal="true" aria-labelledby="pl-comments-title" aria-hidden="true">
                <header class="pl-comments-head">
                    <div><h2 id="pl-comments-title">互动留言</h2><p></p></div>
                    <button class="pl-comments-icon-button" type="button" aria-label="关闭留言">×</button>
                </header>
                <div class="pl-comments-list" aria-live="polite"><div class="pl-comments-state">打开后加载留言…</div></div>
                <form class="pl-comments-composer">
                    <div class="pl-comments-admin"><input class="pl-comments-field" name="adminToken" type="password" autocomplete="off" placeholder="管理员删除令牌"></div>
                    <div class="pl-comments-replying"><span></span><button type="button" aria-label="取消回复">×</button></div>
                    <label><span class="pl-comments-honeypot" aria-hidden="true">网站</span><input class="pl-comments-honeypot" name="website" type="text" tabindex="-1" autocomplete="off"></label>
                    <label><span class="pl-comments-honeypot">昵称</span><input class="pl-comments-field" name="nickname" maxlength="24" autocomplete="nickname" placeholder="昵称（1–24 字）" required></label>
                    <label><span class="pl-comments-honeypot">留言内容</span><textarea class="pl-comments-field" name="content" maxlength="800" placeholder="写下问题、想法或实验发现…" required></textarea></label>
                    <div class="pl-comments-turnstile"></div>
                    <div class="pl-comments-form-footer"><span class="pl-comments-character-count">0 / 800</span><button class="pl-comments-submit" type="submit">发布留言</button></div>
                    <p class="pl-comments-message" role="status"></p>
                </form>
            </section>`;
        document.body.appendChild(root);

        const refs = {
            root,
            launcher: root.querySelector(".pl-comments-launcher"),
            count: root.querySelector(".pl-comments-count"),
            overlay: root.querySelector(".pl-comments-overlay"),
            drawer: root.querySelector(".pl-comments-drawer"),
            close: root.querySelector(".pl-comments-icon-button"),
            subtitle: root.querySelector(".pl-comments-head p"),
            list: root.querySelector(".pl-comments-list"),
            form: root.querySelector("form"),
            nickname: root.querySelector('[name="nickname"]'),
            content: root.querySelector('[name="content"]'),
            website: root.querySelector('[name="website"]'),
            adminToken: root.querySelector('[name="adminToken"]'),
            replying: root.querySelector(".pl-comments-replying"),
            replyingText: root.querySelector(".pl-comments-replying span"),
            cancelReply: root.querySelector(".pl-comments-replying button"),
            turnstile: root.querySelector(".pl-comments-turnstile"),
            characterCount: root.querySelector(".pl-comments-character-count"),
            submit: root.querySelector(".pl-comments-submit"),
            message: root.querySelector(".pl-comments-message"),
        };
        refs.subtitle.textContent = `${pageTitle()} · 每个实验独立讨论`;
        try {
            refs.nickname.value = localStorage.getItem("physicsLab.commentNickname") || "";
            if (ADMIN_MODE) refs.adminToken.value = sessionStorage.getItem("physicsLab.commentsAdminToken") || "";
        } catch {}
        return refs;
    }

    let ui;

    function setMessage(message = "", kind = "") {
        ui.message.textContent = message;
        ui.message.dataset.kind = kind;
    }

    function updateCount() {
        ui.count.textContent = state.total > 99 ? "99+" : String(state.total);
        ui.count.hidden = state.total < 1;
    }

    function formatDate(seconds) {
        const date = new Date(Number(seconds) * 1000);
        if (Number.isNaN(date.getTime())) return "";
        const delta = Date.now() - date.getTime();
        if (delta >= 0 && delta < 60_000) return "刚刚";
        if (delta >= 0 && delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
        if (delta >= 0 && delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
        return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
    }

    function adminToken() {
        return ADMIN_MODE ? ui.adminToken.value.trim() : "";
    }

    function makeComment(comment, isReply = false) {
        const article = element("article", "pl-comment");
        article.dataset.id = String(comment.id);
        article.dataset.deleted = comment.deleted ? "true" : "false";

        const meta = element("div", "pl-comment-meta");
        meta.append(element("span", "pl-comment-name", comment.nickname));
        meta.append(element("time", "", formatDate(comment.createdAt)));
        article.append(meta, element("div", "pl-comment-body", comment.content));

        if (!comment.deleted) {
            const actions = element("div", "pl-comment-actions");
            if (!isReply) {
                const reply = element("button", "pl-comment-action", "回复");
                reply.type = "button";
                reply.dataset.action = "reply";
                reply.addEventListener("click", () => startReply(comment));
                actions.append(reply);
            }
            if (ADMIN_MODE) {
                const remove = element("button", "pl-comment-action", "删除");
                remove.type = "button";
                remove.dataset.action = "delete";
                remove.addEventListener("click", () => removeComment(comment.id));
                actions.append(remove);
            }
            article.append(actions);
        }

        if (!isReply && comment.replies?.length) {
            const replies = element("div", "pl-comment-replies");
            for (const reply of comment.replies) replies.append(makeComment(reply, true));
            article.append(replies);
        }
        return article;
    }

    function renderComments() {
        ui.list.replaceChildren();
        if (!state.comments.length) {
            ui.list.append(element("div", "pl-comments-state", "还没有留言，来提出第一个问题吧。"));
            return;
        }
        for (const comment of state.comments) ui.list.append(makeComment(comment));
        if (state.hasMore) {
            const more = element("button", "pl-comments-more", "加载更早留言");
            more.type = "button";
            more.addEventListener("click", () => loadComments(true, more));
            ui.list.append(more);
        }
    }

    function startReply(comment) {
        state.replyTo = comment;
        ui.replying.dataset.visible = "true";
        ui.replyingText.textContent = `回复 ${comment.nickname}`;
        ui.content.focus();
    }

    function cancelReply() {
        state.replyTo = null;
        ui.replying.dataset.visible = "false";
        ui.replyingText.textContent = "";
    }

    async function requestJson(url, options) {
        const response = await fetch(url, options);
        let data = {};
        try {
            data = await response.json();
        } catch {}
        if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
        return data;
    }

    async function loadComments(append = false, trigger = null) {
        if (state.loading) return;
        state.loading = true;
        if (trigger) trigger.disabled = true;
        if (!append) ui.list.replaceChildren(element("div", "pl-comments-state", "正在加载留言…"));
        try {
            const params = new URLSearchParams({ page: PAGE, limit: "15" });
            if (append && state.nextCursor) params.set("before", String(state.nextCursor));
            const data = await requestJson(`/api/comments?${params}`);
            state.comments = append ? state.comments.concat(data.comments || []) : data.comments || [];
            state.total = Number(data.total || 0);
            state.hasMore = Boolean(data.hasMore);
            state.nextCursor = data.nextCursor || null;
            state.turnstileRequired = Boolean(data.turnstileRequired);
            state.turnstileSiteKey = data.turnstileSiteKey || null;
            state.maxLength = Number(data.maxContentLength || 800);
            ui.content.maxLength = state.maxLength;
            state.loaded = true;
            updateCount();
            renderComments();
            await setupTurnstile();
        } catch (error) {
            if (!append) ui.list.replaceChildren(element("div", "pl-comments-state", `留言加载失败：${error.message}`));
            else setMessage(error.message, "error");
        } finally {
            state.loading = false;
            if (trigger) trigger.disabled = false;
        }
    }

    function loadTurnstileScript() {
        if (window.turnstile) return Promise.resolve();
        if (window.__physicsTurnstilePromise) return window.__physicsTurnstilePromise;
        window.__physicsTurnstilePromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.async = true;
            script.defer = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error("人机验证组件加载失败。"));
            document.head.append(script);
        });
        return window.__physicsTurnstilePromise;
    }

    async function setupTurnstile() {
        if (!state.turnstileRequired) {
            ui.turnstile.replaceChildren();
            return;
        }
        if (!state.turnstileSiteKey) {
            ui.submit.disabled = true;
            setMessage("站点缺少 Turnstile Site Key，暂时不能发布留言。", "error");
            return;
        }
        if (state.turnstileWidgetId != null) return;
        try {
            await loadTurnstileScript();
            state.turnstileWidgetId = window.turnstile.render(ui.turnstile, {
                sitekey: state.turnstileSiteKey,
                action: "physics_comment",
                theme: "dark",
                size: "flexible",
                callback(token) {
                    state.turnstileToken = token;
                    ui.submit.disabled = false;
                    setMessage();
                },
                "expired-callback"() {
                    state.turnstileToken = "";
                    ui.submit.disabled = true;
                },
                "error-callback"() {
                    state.turnstileToken = "";
                    ui.submit.disabled = true;
                    setMessage("人机验证加载失败，请刷新后重试。", "error");
                },
            });
            ui.submit.disabled = !state.turnstileToken;
        } catch (error) {
            ui.submit.disabled = true;
            setMessage(error.message, "error");
        }
    }

    function resetTurnstile() {
        state.turnstileToken = "";
        if (state.turnstileWidgetId != null && window.turnstile) {
            window.turnstile.reset(state.turnstileWidgetId);
            ui.submit.disabled = true;
        }
    }

    async function submitComment(event) {
        event.preventDefault();
        if (state.turnstileRequired && !state.turnstileToken) {
            setMessage("请先完成人机验证。", "error");
            return;
        }
        const nickname = ui.nickname.value.trim();
        const content = ui.content.value.trim();
        if (!nickname || !content) {
            setMessage("请填写昵称和留言内容。", "error");
            return;
        }

        ui.submit.disabled = true;
        setMessage("正在发布…");
        try {
            await requestJson("/api/comments", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    page: PAGE,
                    nickname,
                    content,
                    parentId: state.replyTo?.id || null,
                    website: ui.website.value,
                    turnstileToken: state.turnstileToken,
                }),
            });
            try {
                localStorage.setItem("physicsLab.commentNickname", nickname);
            } catch {}
            ui.content.value = "";
            ui.characterCount.textContent = `0 / ${state.maxLength}`;
            cancelReply();
            resetTurnstile();
            setMessage("留言已发布。", "success");
            await loadComments(false);
            ui.list.scrollTop = 0;
        } catch (error) {
            setMessage(error.message, "error");
            resetTurnstile();
        } finally {
            if (!state.turnstileRequired) ui.submit.disabled = false;
        }
    }

    async function removeComment(id) {
        const token = adminToken();
        if (!token) {
            setMessage("请先填写管理员删除令牌。", "error");
            ui.adminToken.focus();
            return;
        }
        if (!window.confirm("确定删除这条留言吗？回复关系会保留。")) return;
        try {
            sessionStorage.setItem("physicsLab.commentsAdminToken", token);
        } catch {}
        setMessage("正在删除…");
        try {
            await requestJson(`/api/comments/${id}`, {
                method: "DELETE",
                headers: { authorization: `Bearer ${token}` },
            });
            setMessage("留言已删除。", "success");
            await loadComments(false);
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    function setOpen(open) {
        state.open = open;
        ui.root.dataset.open = open ? "true" : "false";
        ui.launcher.setAttribute("aria-expanded", String(open));
        ui.drawer.setAttribute("aria-hidden", String(!open));
        ui.overlay.setAttribute("aria-hidden", String(!open));
        if (open) {
            if (!state.loaded) loadComments();
            setTimeout(() => ui.close.focus(), 0);
        } else {
            ui.launcher.focus();
        }
    }

    function bindEvents() {
        ui.launcher.addEventListener("click", () => setOpen(true));
        ui.close.addEventListener("click", () => setOpen(false));
        ui.overlay.addEventListener("click", () => setOpen(false));
        ui.cancelReply.addEventListener("click", cancelReply);
        ui.form.addEventListener("submit", submitComment);
        ui.content.addEventListener("input", () => {
            ui.characterCount.textContent = `${[...ui.content.value].length} / ${state.maxLength}`;
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && state.open) setOpen(false);
        });
    }

    function init() {
        if (document.getElementById("pl-comments-root")) return;
        ui = buildUI();
        bindEvents();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})();
