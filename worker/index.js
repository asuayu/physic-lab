const JSON_HEADERS = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
};

const PAGE_MAX = 180;
const NICKNAME_MAX = 24;
const CONTENT_MAX = 800;
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 30;
const MINUTE_LIMIT = 4;
const DAY_LIMIT = 30;

class ApiError extends Error {
    constructor(status, message, code = "request_error") {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const json = (data, status = 200, extraHeaders = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { ...JSON_HEADERS, ...extraHeaders },
    });

function normalizePage(value) {
    if (typeof value !== "string") throw new ApiError(400, "缺少页面标识。", "invalid_page");
    let page = value.normalize("NFC");
    page = page.replace(/\/{2,}/g, "/").split(/[?#]/, 1)[0];
    if (!page.startsWith("/") || page.includes("..") || page.length > PAGE_MAX) {
        throw new ApiError(400, "页面标识格式错误。", "invalid_page");
    }
    if (page.length > 1) page = page.replace(/\/+$/, "");
    if (page.toLowerCase().endsWith(".html")) page = page.slice(0, -5);
    const lastSegment = page.slice(page.lastIndexOf("/") + 1);
    if (page !== "/" && (!lastSegment || lastSegment.includes(".") || page.toLowerCase().startsWith("/api/"))) {
        throw new ApiError(400, "该页面不支持留言。", "invalid_page");
    }
    return page;
}

function cleanText(value, max, fieldName) {
    if (typeof value !== "string") throw new ApiError(400, `${fieldName}不能为空。`, "invalid_content");
    const text = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
    const length = [...text].length;
    if (length < 1 || length > max) {
        throw new ApiError(400, `${fieldName}需为 1–${max} 个字符。`, "invalid_content");
    }
    if (/\p{C}/u.test(text.replace(/\n|\t/g, ""))) {
        throw new ApiError(400, `${fieldName}包含不支持的控制字符。`, "invalid_content");
    }
    return text;
}

function positiveInteger(value, fallback = null) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request) {
    const origin = request.headers.get("origin");
    return !origin || origin === new URL(request.url).origin;
}

async function clientHash(request, env) {
    const ip = request.headers.get("cf-connecting-ip") || "local";
    const userAgent = (request.headers.get("user-agent") || "unknown").slice(0, 180);
    const salt = env.COMMENTS_HASH_SALT || env.COMMENTS_ADMIN_TOKEN || "physics-lab-comments";
    return sha256(`${salt}\n${ip}\n${userAgent}`);
}

async function validateTurnstile(request, env, token) {
    if (!env.TURNSTILE_SECRET_KEY) return;
    if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
        throw new ApiError(400, "请先完成人机验证。", "turnstile_required");
    }

    const form = new FormData();
    form.set("secret", env.TURNSTILE_SECRET_KEY);
    form.set("response", token);
    const remoteIp = request.headers.get("cf-connecting-ip");
    if (remoteIp) form.set("remoteip", remoteIp);
    form.set("idempotency_key", crypto.randomUUID());

    let result;
    try {
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            body: form,
        });
        result = await response.json();
    } catch {
        throw new ApiError(503, "人机验证服务暂时不可用，请稍后再试。", "turnstile_unavailable");
    }

    if (!result.success || (result.action && result.action !== "physics_comment")) {
        throw new ApiError(400, "人机验证未通过，请重试。", "turnstile_failed");
    }
}

async function parseBody(request) {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 12_000) throw new ApiError(413, "提交内容过大。", "payload_too_large");
    let body;
    try {
        body = await request.json();
    } catch {
        throw new ApiError(400, "请求格式错误。", "invalid_json");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ApiError(400, "请求格式错误。", "invalid_json");
    }
    return body;
}

function publicComment(row) {
    const deleted = row.status === "deleted";
    return {
        id: row.id,
        parentId: row.parent_id,
        nickname: deleted ? "已删除" : row.nickname,
        content: deleted ? "该留言已被管理员删除。" : row.content,
        createdAt: row.created_at,
        deleted,
    };
}

async function listComments(request, env) {
    const url = new URL(request.url);
    const page = normalizePage(url.searchParams.get("page"));
    const before = positiveInteger(url.searchParams.get("before"));
    const limit = Math.min(positiveInteger(url.searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);

    const conditions = [
        "c.page_key = ?",
        "c.parent_id IS NULL",
        `(c.status = 'visible' OR (c.status = 'deleted' AND EXISTS (
            SELECT 1 FROM comments child WHERE child.parent_id = c.id AND child.status = 'visible'
        )))`,
    ];
    const values = [page];
    if (before) {
        conditions.push("id < ?");
        values.push(before);
    }

    const topQuery = `
        SELECT c.id, c.parent_id, c.nickname, c.content, c.status, c.created_at
        FROM comments c
        WHERE ${conditions.join(" AND ")}
        ORDER BY id DESC
        LIMIT ?
    `;
    const [topResult, countRow] = await Promise.all([
        env.COMMENTS_DB.prepare(topQuery).bind(...values, limit + 1).all(),
        env.COMMENTS_DB.prepare(
            "SELECT COUNT(*) AS total FROM comments WHERE page_key = ? AND status = 'visible'",
        )
            .bind(page)
            .first(),
    ]);

    const hasMore = topResult.results.length > limit;
    const roots = topResult.results.slice(0, limit);
    let replies = [];
    if (roots.length) {
        const placeholders = roots.map(() => "?").join(",");
        const replyResult = await env.COMMENTS_DB.prepare(`
            SELECT id, parent_id, nickname, content, status, created_at
            FROM comments
            WHERE parent_id IN (${placeholders}) AND status = 'visible'
            ORDER BY id ASC
            LIMIT 300
        `)
            .bind(...roots.map((row) => row.id))
            .all();
        replies = replyResult.results;
    }

    const repliesByParent = new Map();
    for (const row of replies) {
        if (!repliesByParent.has(row.parent_id)) repliesByParent.set(row.parent_id, []);
        repliesByParent.get(row.parent_id).push(publicComment(row));
    }

    return json({
        comments: roots.map((row) => ({
            ...publicComment(row),
            replies: repliesByParent.get(row.id) || [],
        })),
        total: Number(countRow?.total || 0),
        hasMore,
        nextCursor: hasMore ? roots.at(-1)?.id ?? null : null,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
        turnstileRequired: Boolean(env.TURNSTILE_SECRET_KEY),
        maxContentLength: CONTENT_MAX,
    });
}

async function createComment(request, env) {
    if (!sameOrigin(request)) throw new ApiError(403, "拒绝跨站提交。", "origin_mismatch");
    const body = await parseBody(request);

    // Quietly absorb automated form-fillers that populate the hidden field.
    if (body.website) return json({ ok: true, comment: null }, 201);

    const page = normalizePage(body.page);
    const nickname = cleanText(body.nickname, NICKNAME_MAX, "昵称");
    const content = cleanText(body.content, CONTENT_MAX, "留言");
    const parentId = body.parentId == null ? null : positiveInteger(body.parentId);
    if (body.parentId != null && !parentId) {
        throw new ApiError(400, "回复目标无效。", "invalid_parent");
    }

    await validateTurnstile(request, env, body.turnstileToken);
    const hash = await clientHash(request, env);
    const now = Math.floor(Date.now() / 1000);

    const [minuteRow, dayRow, duplicateRow] = await Promise.all([
        env.COMMENTS_DB.prepare(
            "SELECT COUNT(*) AS total FROM comments WHERE client_hash = ? AND created_at >= ?",
        )
            .bind(hash, now - 60)
            .first(),
        env.COMMENTS_DB.prepare(
            "SELECT COUNT(*) AS total FROM comments WHERE client_hash = ? AND created_at >= ?",
        )
            .bind(hash, now - 86400)
            .first(),
        env.COMMENTS_DB.prepare(
            "SELECT id FROM comments WHERE client_hash = ? AND page_key = ? AND content = ? AND created_at >= ? LIMIT 1",
        )
            .bind(hash, page, content, now - 600)
            .first(),
    ]);

    if (Number(minuteRow?.total || 0) >= MINUTE_LIMIT || Number(dayRow?.total || 0) >= DAY_LIMIT) {
        throw new ApiError(429, "留言太频繁，请稍后再试。", "rate_limited");
    }
    if (duplicateRow) throw new ApiError(409, "相同留言已提交，请勿重复发送。", "duplicate_comment");

    if (parentId) {
        const parent = await env.COMMENTS_DB.prepare(
            "SELECT id FROM comments WHERE id = ? AND page_key = ? AND parent_id IS NULL AND status IN ('visible', 'deleted')",
        )
            .bind(parentId, page)
            .first();
        if (!parent) throw new ApiError(404, "回复的留言不存在。", "parent_not_found");
    }

    const row = await env.COMMENTS_DB.prepare(`
        INSERT INTO comments (page_key, parent_id, nickname, content, status, client_hash, created_at)
        VALUES (?, ?, ?, ?, 'visible', ?, ?)
        RETURNING id, parent_id, nickname, content, status, created_at
    `)
        .bind(page, parentId, nickname, content, hash, now)
        .first();

    return json({ ok: true, comment: { ...publicComment(row), replies: [] } }, 201);
}

function secureEqual(actual, expected) {
    const a = new TextEncoder().encode(actual || "");
    const b = new TextEncoder().encode(expected || "");
    let mismatch = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
    return mismatch === 0;
}

async function deleteComment(request, env, id) {
    if (!sameOrigin(request)) throw new ApiError(403, "拒绝跨站请求。", "origin_mismatch");
    if (!env.COMMENTS_ADMIN_TOKEN) {
        throw new ApiError(503, "管理员删除功能尚未配置。", "admin_not_configured");
    }
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!secureEqual(token, env.COMMENTS_ADMIN_TOKEN)) {
        throw new ApiError(401, "管理员凭据无效。", "unauthorized");
    }

    const result = await env.COMMENTS_DB.prepare(
        "UPDATE comments SET status = 'deleted', nickname = '', content = '' WHERE id = ? AND status != 'deleted'",
    )
        .bind(id)
        .run();
    if (!result.meta.changes) throw new ApiError(404, "留言不存在或已删除。", "not_found");
    return json({ ok: true });
}

async function apiRouter(request, env) {
    if (!env.COMMENTS_DB) throw new ApiError(503, "留言数据库尚未配置。", "database_unavailable");
    const url = new URL(request.url);
    if (url.pathname === "/api/comments/health" && request.method === "GET") {
        await env.COMMENTS_DB.prepare("SELECT 1").first();
        return json({ ok: true, turnstile: Boolean(env.TURNSTILE_SECRET_KEY) });
    }
    if (url.pathname === "/api/comments" && request.method === "GET") return listComments(request, env);
    if (url.pathname === "/api/comments" && request.method === "POST") return createComment(request, env);
    const match = url.pathname.match(/^\/api\/comments\/(\d+)$/);
    if (match && request.method === "DELETE") return deleteComment(request, env, Number(match[1]));
    throw new ApiError(404, "接口不存在。", "not_found");
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
        try {
            return await apiRouter(request, env);
        } catch (error) {
            if (error instanceof ApiError) return json({ error: error.message, code: error.code }, error.status);
            console.error("comments-api", error);
            return json({ error: "服务器暂时无法处理请求。", code: "internal_error" }, 500);
        }
    },
};
