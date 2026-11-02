// Runs the production Worker against real, disposable in-memory SQLite databases.
// No Wrangler process, Cloudflare account, secrets or network are required.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import worker from "../worker/index.js";

const migrationDir = new URL("../migrations/", import.meta.url);
const migrations = await Promise.all(
    (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort()
        .map((name) => readFile(new URL(name, migrationDir), "utf8")),
);

function fixture(migrationCount = migrations.length) {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of migrations.slice(0, migrationCount)) sqlite.exec(migration);
    // Each operation yields before executing, like asynchronous D1 calls. This
    // exposes preflight-read races while SQLite executes each write atomically.
    const db = {
        prepare(sql) {
            let params = [];
            return {
                bind(...values) { params = values; return this; },
                async first() { await setImmediate(); return sqlite.prepare(sql).get(...params) ?? null; },
                async all() { await setImmediate(); return { results: sqlite.prepare(sql).all(...params), success: true }; },
                async run() {
                    await setImmediate();
                    const result = sqlite.prepare(sql).run(...params);
                    return { success: true, meta: { changes: Number(result.changes) } };
                },
            };
        },
    };
    const env = { COMMENTS_DB: db, COMMENTS_HASH_SALT: "isolated-test-salt", COMMENTS_ADMIN_TOKEN: "isolated-admin-token" };
    const request = async (path, options = {}) => {
        const headers = {
            origin: "https://lab.test",
            "cf-connecting-ip": "192.0.2.1",
            "user-agent": "isolated-test",
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...options.headers,
        };
        const response = await worker.fetch(new Request(`https://lab.test${path}`, { ...options, headers }), env);
        return { status: response.status, data: await response.json() };
    };
    const create = (content = "留言", extra = {}, headers = {}) => request("/api/comments", {
        method: "POST", headers,
        body: JSON.stringify({ page: "/fixture.html", nickname: "访客", content, ...extra }),
    });
    const remove = (id, token = env.COMMENTS_ADMIN_TOKEN) => request(`/api/comments/${id}`, {
        method: "DELETE", headers: { authorization: `Bearer ${token}` },
    });
    const seed = (content, parentId = null, page = "/fixture", hash = "seed", createdAt = Math.floor(Date.now() / 1000)) => {
        return sqlite.prepare("INSERT INTO comments (page_key, parent_id, nickname, content, client_hash, created_at) VALUES (?, ?, '种子', ?, ?, ?) RETURNING id")
            .get(page, parentId, content, hash, createdAt).id;
    };
    return { sqlite, env, request, create, remove, seed };
}

test("health verifies the migrated schema and required idempotency index", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    assert.deepEqual(await f.request("/api/comments/health"), { status: 200, data: { ok: true, schemaVersion: 2, turnstile: false } });
    f.sqlite.exec("DROP INDEX idx_comments_client_request");
    assert.equal((await f.request("/api/comments/health")).data.code, "schema_unavailable");
    const old = fixture(1); t.after(() => old.sqlite.close());
    assert.equal((await old.request("/api/comments/health")).status, 503);
    const absent = fixture(0); t.after(() => absent.sqlite.close());
    assert.equal((await absent.request("/api/comments/health")).status, 503);
});

test("Turnstile keys must be configured together; missing tokens fail before network", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    f.env.TURNSTILE_SITE_KEY = "public-key";
    assert.equal((await f.request("/api/comments/health")).data.code, "turnstile_misconfigured");
    assert.equal((await f.create()).status, 503);
    delete f.env.TURNSTILE_SITE_KEY;
    f.env.TURNSTILE_SECRET_KEY = "secret-key";
    assert.equal((await f.request("/api/comments/health")).status, 503);
    f.env.TURNSTILE_SITE_KEY = "public-key";
    assert.equal((await f.request("/api/comments/health")).data.turnstile, true);
    assert.equal((await f.create()).data.code, "turnstile_required");
});

test("creation normalizes pages and checks duplicate content and reply ownership", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    const root = await f.create("<script>可见文本</script>", { nickname: "  访客  " });
    assert.equal(root.status, 201);
    assert.equal(root.data.comment.nickname, "访客");
    const listing = await f.request("/api/comments?page=%2Ffixture");
    assert.equal(listing.data.comments[0].content, "<script>可见文本</script>");
    assert.equal((await f.create("<script>可见文本</script>")).data.code, "duplicate_comment");
    assert.equal((await f.create("未知回复", { parentId: 9999 })).data.code, "parent_not_found");
    assert.equal((await f.create("跨页面", { parentId: root.data.comment.id, page: "/another" })).status, 404);
    const reply = await f.create("回复", { parentId: root.data.comment.id });
    assert.equal(reply.status, 201);
    assert.equal((await f.create("三级回复", { parentId: reply.data.comment.id })).status, 404);
});

test("changing User-Agent cannot reset the per-IP minute limit", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    for (let i = 0; i < 4; i++) assert.equal((await f.create(`第${i}条`, {}, { "user-agent": `agent-${i}` })).status, 201);
    assert.equal((await f.create("第五条", {}, { "user-agent": "brand-new-agent" })).status, 429);
    assert.equal((await f.create("其他IP", {}, { "cf-connecting-ip": "192.0.2.2" })).status, 201);
    assert.equal(f.sqlite.prepare("SELECT COUNT(DISTINCT client_hash) AS n FROM comments").get().n, 2);
});

test("concurrent requests cannot exceed the minute quota or insert duplicate content", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => f.create(`并发${i}`)));
    assert.equal(results.filter((r) => r.status === 201).length, 4);
    assert.equal(results.filter((r) => r.status === 429).length, 12);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 4);
    const d = fixture(); t.after(() => d.sqlite.close());
    const duplicates = await Promise.all(Array.from({ length: 16 }, () => d.create("相同内容")));
    assert.equal(duplicates.filter((r) => r.status === 201).length, 1);
    assert.equal(duplicates.filter((r) => r.status === 409).length, 15);
    assert.equal(d.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 1);
});

test("the rolling daily quota includes older and deleted comments, and expires", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    await f.create("初始");
    const hash = f.sqlite.prepare("SELECT client_hash FROM comments LIMIT 1").get().client_hash;
    const now = Math.floor(Date.now() / 1000);
    f.sqlite.exec(`UPDATE comments SET created_at = ${now - 120}, status = 'deleted'`);
    for (let i = 0; i < 29; i++) f.seed(`历史${i}`, null, "/fixture", hash, now - 120);
    assert.equal((await f.create("超日额度")).status, 429);
    f.sqlite.exec(`UPDATE comments SET created_at = ${now - 86401}`);
    assert.equal((await f.create("额度已恢复")).status, 201);
});

test("idempotency is atomic, payload-bound, IP-scoped and survives deletion", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    const requestId = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => f.create("幂等内容", { requestId })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 200 && r.data.replayed).length, 11);
    assert.equal(new Set(results.map((r) => r.data.comment.id)).size, 1);
    const id = results[0].data.comment.id;
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 1);
    assert.equal((await f.create("不同内容", { requestId })).data.code, "idempotency_conflict");
    assert.equal((await f.create("幂等内容", { requestId, nickname: "冒用昵称" })).data.code, "idempotency_conflict");
    const other = await f.create("幂等内容", { requestId }, { "cf-connecting-ip": "192.0.2.99" });
    assert.equal(other.status, 201);
    assert.notEqual(other.data.comment.id, id);
    assert.equal((await f.create("幂等内容", { requestId }, { "user-agent": "another" })).status, 200);
    assert.equal((await f.remove(id)).status, 200);
    // Replays do not require a new single-use Turnstile token.
    f.env.TURNSTILE_SITE_KEY = "public-key"; f.env.TURNSTILE_SECRET_KEY = "secret-key";
    const deletedReplay = await f.create("幂等内容", { requestId });
    assert.equal(deletedReplay.status, 200);
    assert.equal(deletedReplay.data.comment.deleted, true);
    assert.equal(deletedReplay.data.comment.content, "该留言已被管理员删除。");
    assert.equal((await f.create("新内容", { requestId: "short" })).data.code, "invalid_request_id");
});

test("Turnstile retries share a server-scoped validation key without using the network", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    f.env.TURNSTILE_SITE_KEY = "public-key"; f.env.TURNSTILE_SECRET_KEY = "secret-key";
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const validationKeys = [];
    globalThis.fetch = async (url, options) => {
        assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
        validationKeys.push(options.body.get("idempotency_key"));
        await setImmediate();
        return new Response(JSON.stringify({ success: options.body.get("response") !== "expired-test-token", action: "physics_comment" }), { status: 200 });
    };
    const requestId = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => f.create("带验证的幂等请求", {
        requestId, turnstileToken: "isolated-dummy-token",
    })));
    assert.ok(results.every((r) => r.status === 200 || r.status === 201));
    assert.ok(validationKeys.length > 0);
    assert.equal(new Set(validationKeys).size, 1);
    assert.match(validationKeys[0], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const callCount = validationKeys.length;
    assert.equal((await f.create("带验证的幂等请求", { requestId })).status, 200);
    assert.equal(validationKeys.length, callCount);
    const differentIp = await f.create("带验证的幂等请求", { requestId, turnstileToken: "isolated-dummy-token" }, { "cf-connecting-ip": "192.0.2.2" });
    assert.equal(differentIp.status, 201);
    assert.notEqual(validationKeys.at(-1), validationKeys[0]);
    const renewedRequestId = crypto.randomUUID();
    assert.equal((await f.create("验证过期后重试", { requestId: renewedRequestId, turnstileToken: "expired-test-token" })).status, 400);
    const expiredKey = validationKeys.at(-1);
    assert.equal((await f.create("验证过期后重试", { requestId: renewedRequestId, turnstileToken: "fresh-test-token" })).status, 201);
    assert.notEqual(validationKeys.at(-1), expiredKey);
});

test("reply previews are per root and all 325 replies remain reachable by cursor", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    const a = f.seed("A"), b = f.seed("B");
    const ids = Array.from({ length: 325 }, (_, i) => f.seed(`A回复${i}`, a));
    const bReply = f.seed("B唯一回复", b);
    const listing = (await f.request("/api/comments?page=%2Ffixture")).data;
    const aRoot = listing.comments.find((c) => c.id === a);
    assert.equal(aRoot.replyCount, 325);
    assert.equal(aRoot.replies.length, 5);
    assert.equal(aRoot.hasMoreReplies, true);
    assert.equal(aRoot.nextReplyCursor, aRoot.replies.at(-1).id);
    assert.equal(listing.comments.find((c) => c.id === b).replies[0].id, bReply);
    const collected = aRoot.replies.map((r) => r.id);
    let cursor = aRoot.nextReplyCursor;
    while (cursor) {
        const page = await f.request(`/api/comments/${a}/replies?page=%2Ffixture&after=${cursor}&limit=30`);
        assert.equal(page.status, 200);
        assert.ok(page.data.replies.length <= 30);
        collected.push(...page.data.replies.map((r) => r.id));
        assert.equal(page.data.nextCursor, page.data.hasMore ? page.data.replies.at(-1).id : null);
        cursor = page.data.nextCursor;
    }
    assert.deepEqual(collected, ids);
    assert.equal((await f.request(`/api/comments/${a}/replies?page=%2Fother`)).status, 404);
    assert.equal((await f.request(`/api/comments/${a}/replies?page=%2Ffixture&after=bad`)).status, 400);
});

test("deletion requires authorization, sanitizes storage and preserves visible replies", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    const root = f.seed("根正文"), reply = f.seed("回复正文", root);
    assert.equal((await f.remove(root, "wrong")).status, 401);
    assert.equal((await f.remove(root)).status, 200);
    const row = f.sqlite.prepare("SELECT nickname, content FROM comments WHERE id = ?").get(root);
    assert.equal(row.nickname, ""); assert.equal(row.content, "");
    let list = await f.request("/api/comments?page=%2Ffixture");
    assert.equal(list.data.comments[0].deleted, true);
    assert.equal(list.data.comments[0].replies[0].id, reply);
    assert.equal(list.data.total, 1);
    assert.equal((await f.remove(reply)).status, 200);
    list = await f.request("/api/comments?page=%2Ffixture");
    assert.deepEqual(list.data.comments, []);
    assert.equal(list.data.total, 0);
});

test("actual streamed bytes are bounded even without or with a false Content-Length", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    const oversized = JSON.stringify({ page: "/fixture", nickname: "人", content: "正常", ignored: "汉".repeat(4500) });
    assert.ok(oversized.length < 12_000);
    assert.ok(new TextEncoder().encode(oversized).length > 12_000);
    for (const headers of [{}, { "content-length": "1" }]) {
        const result = await f.request("/api/comments", { method: "POST", body: oversized, headers });
        assert.equal(result.status, 413);
        assert.equal(result.data.code, "payload_too_large");
    }
    let canceled = false;
    let emitted = 0;
    const stream = new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(4_000)); emitted++; },
        cancel() { canceled = true; },
    });
    const result = await f.request("/api/comments", { method: "POST", body: stream, duplex: "half" });
    assert.equal(result.status, 413);
    assert.equal(canceled, true);
    assert.ok(emitted <= 6, "reader should stop rather than consume the rest of the stream");
    for (const body of ["{bad", "[]", "null"]) {
        assert.equal((await f.request("/api/comments", { method: "POST", body })).data.code, "invalid_json");
    }
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM comments").get().n, 0);
});

test("cross-origin writes and invalid identifiers are rejected", async (t) => {
    const f = fixture(); t.after(() => f.sqlite.close());
    assert.equal((await f.create("跨站", {}, { origin: "https://other.test" })).status, 403);
    for (const page of ["/../secret", "/api/comments", "/white space", "/bad\\path"]) {
        assert.equal((await f.create("内容", { page })).data.code, "invalid_page");
    }
    assert.equal((await f.request("/api/comments?page=%2Ffixture&before=bad")).data.code, "invalid_cursor");
    assert.equal((await f.request("/api/comments/99999999999999999999/replies?page=%2Ffixture")).status, 404);
});
