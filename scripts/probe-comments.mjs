import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const origin = process.env.COMMENTS_PROBE_URL || "http://127.0.0.1:8787";
let lastError;
for (let attempt = 0; attempt < 6; attempt++) {
    try {
        const get = async (path) => {
            const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000) });
            assert.equal(response.ok, true, `${path}: HTTP ${response.status}`);
            return response.json();
        };
        const health = await get("/api/comments/health");
        assert.equal(health.ok, true);
        assert.equal(health.schemaVersion, 2, "Database schema is not ready");
        const list = await get(`/api/comments?page=${encodeURIComponent("/科里奥利效应")}&limit=1`);
        assert.equal(Array.isArray(list.comments), true);
        assert.equal(typeof list.total, "number");
        if (process.env.TURNSTILE_SECRET_KEY) {
            assert.equal(list.turnstileRequired, true, "Turnstile configuration mismatch");
        }
        console.log("留言就绪与业务只读探测通过。");
        process.exit(0);
    } catch (error) {
        lastError = error;
        if (attempt < 5) await setTimeout(3000);
    }
}
throw lastError;
