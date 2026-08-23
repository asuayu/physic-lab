const baseUrl = process.env.COMMENTS_TEST_URL || "http://127.0.0.1:8787";
const adminToken = process.env.COMMENTS_TEST_ADMIN_TOKEN || "local-admin-token";
const testPage = "/科里奥利效应.html";
const canonicalTestPage = "/科里奥利效应";
const turnstileToken = "XXXX.DUMMY.TOKEN.XXXX";
const testRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdIds = [];

async function request(path, options = {}, expectedStatus = 200) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            origin: baseUrl,
            "user-agent": `physics-lab-comments-integration-test/${testRunId}`,
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...options.headers,
        },
    });
    const body = await response.json().catch(() => ({}));
    if (response.status !== expectedStatus) {
        throw new Error(`${options.method || "GET"} ${path}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(body)}`);
    }
    return body;
}

async function create(content, parentId = null, expectedStatus = 201) {
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
            }),
        },
        expectedStatus,
    );
    if (data.comment?.id) createdIds.push(data.comment.id);
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
    if (!health.ok || !health.turnstile) throw new Error("Health check did not report Turnstile enabled");

    const suffix = testRunId;
    const root = await create(`主留言 ${suffix}`);
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

    console.log(`留言 API 集成测试通过：健康检查、路径归一化、发布、回复、重复检测、限流、软删除和线程保留。`);
} finally {
    for (const id of [...createdIds].reverse()) {
        try {
            await remove(id);
        } catch {}
    }
}
