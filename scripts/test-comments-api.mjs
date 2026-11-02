const baseUrl = new URL(process.env.COMMENTS_TEST_URL || "http://127.0.0.1:8787").origin;
const adminToken = process.env.COMMENTS_TEST_ADMIN_TOKEN || "local-admin-token-change-me";
const turnstileToken = "XXXX.DUMMY.TOKEN.XXXX";
const testRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const canonicalTestPage = `/__comments-test-${testRunId}`;
const testPage = `${canonicalTestPage}.html`;
const createdIds = [];
const localTarget = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname);
// Local workerd accepts an explicit edge header. Give each run a fresh test-only
// address so deleted comments from earlier runs do not consume its IP quota.
const testIp = `2001:db8:${crypto.randomUUID().replaceAll("-", "").slice(0, 20).match(/.{4}/g).join(":")}:1`;
if (!localTarget && process.env.COMMENTS_TEST_ALLOW_REMOTE !== "1") {
    throw new Error("This test writes comments. Use a local Wrangler URL, or explicitly set COMMENTS_TEST_ALLOW_REMOTE=1 for a disposable remote test environment.");
}

async function request(path, options = {}, expectedStatus = 200) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            origin: baseUrl,
            "user-agent": `physics-lab-comments-integration-test/${testRunId}`,
            ...(localTarget ? { "cf-connecting-ip": testIp } : {}),
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...options.headers,
        },
        signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== expectedStatus) {
        throw new Error(`${options.method || "GET"} ${path}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(body)}`);
    }
    return body;
}

async function create(content, parentId = null, expectedStatus = 201, requestId = crypto.randomUUID()) {
    const data = await request(
        "/api/comments",
        {
            method: "POST",
            body: JSON.stringify({
                page: testPage,
                nickname: "集成测试",
                content,
                parentId,
                website: "",
                turnstileToken,
                requestId,
            }),
        },
        expectedStatus,
    );
    if (data.comment?.id && !createdIds.includes(data.comment.id)) createdIds.push(data.comment.id);
    return data;
}

async function remove(id) {
    return request(
        `/api/comments/${id}`,
        { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } },
        200,
    );
}

try {
    const health = await request("/api/comments/health");
    if (!health.ok || health.schemaVersion !== 2) throw new Error("Health check did not confirm the current schema");

    const suffix = testRunId;
    const rootRequestId = crypto.randomUUID();
    const root = await create(`主留言 ${suffix}`, null, 201, rootRequestId);
    const replay = await create(`主留言 ${suffix}`, null, 200, rootRequestId);
    if (!replay.replayed || replay.comment.id !== root.comment.id) throw new Error("Idempotent retry created another comment");
    const reply = await create(`回复 ${suffix}`, root.comment.id);
    await create(`主留言 ${suffix}`, null, 409);
    await create(`第二条 ${suffix}`);
    await create(`第三条 ${suffix}`);
    await create(`超过限流 ${suffix}`, null, 429);

    const list = await request(`/api/comments?page=${encodeURIComponent(canonicalTestPage)}&limit=15`);
    const listedRoot = list.comments.find((comment) => comment.id === root.comment.id);
    if (!listedRoot) throw new Error("Created root comment was not listed");
    if (!listedRoot.replies.some((comment) => comment.id === reply.comment.id)) {
        throw new Error("Created reply was not nested under its root comment");
    }
    await request(
        `/api/comments/${root.comment.id}`,
        { method: "DELETE", headers: { authorization: "Bearer wrong-token" } },
        401,
    );

    await remove(root.comment.id);
    createdIds.splice(createdIds.indexOf(root.comment.id), 1);
    const preservedThread = await request(`/api/comments?page=${encodeURIComponent(canonicalTestPage)}&limit=15`);
    const deletedRootWithReply = preservedThread.comments.find((comment) => comment.id === root.comment.id);
    if (!deletedRootWithReply?.deleted || deletedRootWithReply.content !== "该留言已被管理员删除。") {
        throw new Error("A deleted root with a visible reply was not preserved and sanitized");
    }
    if (!deletedRootWithReply.replies.some((comment) => comment.id === reply.comment.id)) {
        throw new Error("The visible reply disappeared after its root comment was deleted");
    }

    for (const id of [...createdIds].reverse()) await remove(id);
    createdIds.length = 0;
    const deletedList = await request(`/api/comments?page=${encodeURIComponent(canonicalTestPage)}&limit=15`);
    const deletedRoot = deletedList.comments.find((comment) => comment.id === root.comment.id);
    if (deletedRoot || deletedList.total !== 0) {
        throw new Error("Fully deleted threads were still returned or counted");
    }

    console.log(`留言 API 集成测试通过：schema 健康检查、路径归一化、发布、幂等、回复、重复检测、限流、软删除和线程保留。`);
} finally {
    for (const id of [...createdIds].reverse()) {
        try {
            await remove(id);
        } catch {}
    }
}
