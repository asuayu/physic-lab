import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir, stat, mkdir } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { visibleExperiments } from "../src/data/experiments.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = resolve(root, "dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
let server;
let browser;
async function htmlPaths(dir, prefix = "") {
    const result = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) result.push(...await htmlPaths(join(dir, entry.name), path));
        else if (entry.name.endsWith(".html")) result.push(path);
    }
    return result;
}
try {
    let baseUrl = process.env.BROWSER_TEST_URL;
    if (!baseUrl) {
        await stat(join(dist, "index.html"));
        server = createServer(async (request, response) => {
            try {
                const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
                const file = resolve(dist, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
                if (!file.startsWith(dist + sep)) { response.writeHead(403).end(); return; }
                const body = await readFile(file);
                response.writeHead(200, { "content-type": `${mime[extname(file)] || "application/octet-stream"}; charset=utf-8` });
                response.end(body);
            } catch { response.writeHead(404).end(); }
        });
        await new Promise((done) => server.listen(0, "127.0.0.1", done));
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    }
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_TEST_CHANNEL ? { channel: process.env.BROWSER_TEST_CHANNEL } : {}) });
    const pages = await htmlPaths(join(root, "public"));
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport });
        await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseUrl).origin });
        async function copyParameters() {
            await page.locator(".lab-tools summary").click();
            await page.getByRole("button", { name: "复制参数链接", exact: true }).click();
            return page.evaluate(() => navigator.clipboard.readText());
        }
        let commentsFixture = false;
        const sampleReply = (id) => ({ id, nickname: "测试回复", content: `分页回复 ${id}`, createdAt: 1700000000, deleted: false });
        // Browser checks exercise static pages; the real Worker/D1 API has its own isolated test suite.
        await context.route("**/api/comments**", (route) => {
            const url = new URL(route.request().url());
            if (commentsFixture && url.pathname === "/api/comments/42/replies") {
                return route.fulfill({ json: { replies: [sampleReply(48)], hasMore: false, nextCursor: null } });
            }
            return route.fulfill({ json: {
                ok: true, total: commentsFixture ? 7 : 0, hasMore: false, turnstileRequired: false, turnstileSiteKey: null,
                comments: commentsFixture ? [{ id: 42, nickname: "测试主留言", content: "回复分页测试", createdAt: 1700000000, deleted: false,
                    replies: [43, 44, 45, 46, 47].map(sampleReply), replyCount: 6, hasMoreReplies: true, nextReplyCursor: 47 }] : [],
            } });
        });
        const page = await context.newPage();
        const pageErrors = [];
        const assetFailures = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("response", (response) => {
            if (response.status() >= 400 && new URL(response.url()).origin === new URL(baseUrl).origin) assetFailures.push(`${response.status()} ${response.url()}`);
        });
        for (const path of pages) {
            pageErrors.length = 0;
            assetFailures.length = 0;
            await page.goto(new URL(path, baseUrl).href, { waitUntil: "networkidle" });
            await page.waitForFunction(() => [...document.querySelectorAll("canvas, svg[data-lab-export]")].some((surface) => {
                const box = surface.getBoundingClientRect();
                return box.width > 0 && box.height > 0 && (surface.localName === "svg"
                    ? surface.viewBox.baseVal.width > 0 && surface.viewBox.baseVal.height > 0
                    : surface.width > 0 && surface.height > 0);
            }));
            assert.deepEqual(pageErrors, [], `${path} (${viewport.width}px) pageerror`);
            assert.deepEqual(assetFailures, [], `${path} (${viewport.width}px) missing resources`);
            const launcherBox = await page.locator(".pl-comments-launcher").boundingBox();
            assert.ok(launcherBox.width < 180, `${path} comment launcher must not inherit full-width page buttons`);
        }
        console.log(`页面加载与资源检查通过：${pages.length} 页，${viewport.width}px。`);
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        const search = page.locator("#experiment-search");
        await search.fill("科里奥利");
        assert.equal(await page.locator(".anim-card:visible").count(), 1);
        assert.equal(new URL(page.url()).searchParams.get("q"), "科里奥利");
        await page.reload({ waitUntil: "networkidle" });
        assert.equal(await search.inputValue(), "科里奥利");
        await page.locator('[data-filter="optics"]').click();
        assert.equal(await page.locator(".anim-card:visible").count(), 0);
        assert.equal(await page.locator("#empty-state").isVisible(), true);
        assert.equal(new URL(page.url()).searchParams.get("category"), "optics");
        await page.locator("#clear-filters").click();
        assert.equal(await page.locator(".anim-card:visible").count(), visibleExperiments.length);
        assert.equal(new URL(page.url()).search, "");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Homepage must fit mobile width");
        assert.deepEqual(pageErrors, [], `Homepage (${viewport.width}px)`);
        assert.deepEqual(assetFailures, [], `Homepage resources (${viewport.width}px)`);
        if (process.env.BROWSER_SCREENSHOTS === "1") {
            const output = join(root, "artifacts", "browser");
            await mkdir(output, { recursive: true });
            await page.screenshot({ path: join(output, `gallery-${viewport.width}.png`) });
        }

        await page.goto(new URL("/科里奥利效应.html", baseUrl).href, { waitUntil: "networkidle" });
        const play = page.locator("#play");
        await play.click();
        assert.match(await play.innerText(), /播放|开始|继续/);
        await play.click();
        assert.match(await play.innerText(), /暂停/);
        await page.locator("#reset").click();
        await page.locator("#latitude").focus();
        await page.keyboard.press("Home");
        await page.waitForFunction(() => document.querySelector("#latitudeText").textContent.includes("S"));
        assert.match(await page.locator("#latitudeText").innerText(), /S/);

        commentsFixture = true;
        const launcher = page.locator(".pl-comments-launcher");
        await launcher.focus();
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.querySelector(".pl-comments-drawer").contains(document.activeElement)), false, "Closed dialog must be outside the tab sequence");
        await launcher.click();
        await page.getByRole("button", { name: /加载更多回复/ }).click();
        await page.getByText("分页回复 48", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: /加载更多回复/ }).count(), 0);
        assert.equal(await page.evaluate(() => document.querySelector(".pl-comments-drawer").contains(document.activeElement)), true, "Reply pagination retains keyboard focus");
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".pl-comments-drawer").isVisible(), false);
        assert.equal(await launcher.evaluate((element) => element === document.activeElement), true, "Closing the dialog restores focus");
        commentsFixture = false;

        await page.goto(new URL("/半波损失.html", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator('[data-scene="film"]').click();
        for (const id of ["nTop", "nFilm", "nSub"]) {
            await page.locator(`#${id}`).focus();
            await page.keyboard.press("Home");
        }
        await page.waitForFunction(() => document.querySelector("#readout").textContent.includes("R=0.00%"));
        for (const scene of ["rings", "interface", "film"]) {
            await page.locator(`[data-scene="${scene}"]`).click();
            assert.equal(await page.locator(`[data-pane="${scene}"]`).isVisible(), true);
        }
        await page.locator("#animateLight").uncheck();
        await page.locator("#animateLight").check();

        await page.goto(new URL("/有界磁场旋转圆.html", baseUrl).href, { waitUntil: "networkidle" });
        for (const mode of ["translate", "focus", "diverge", "rotate"]) {
            await page.locator(`[data-mode="${mode}"]`).click();
            assert.equal(await page.locator(`[data-mode="${mode}"]`).getAttribute("aria-pressed"), "true");
            assert.equal(await page.locator("#angle").isDisabled(), mode !== "rotate");
            assert.equal((await page.locator("#modeExplanation").innerText()).length > 10, true);
        }
        await page.locator("#tangent").click();
        await page.locator("#launch").click();
        await page.locator("#reset").click();

        await page.goto(new URL("/镜像法感应电荷.html", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator("#negative").click();
        assert.equal(await page.locator("#negative").getAttribute("class"), "active");
        await page.locator("#play").click();
        assert.match(await page.locator("#play").innerText(), /继续|播放/);
        await page.locator("#play").click();
        await page.locator("#potential").uncheck();
        await page.locator("#showSphereImages").uncheck();

        for (const [path, button, startsPaused] of [
            ["/配速v1.html", "#btnPause", false],
            ["/小船渡河v1.html", "#btnPlay", true],
            ["/波的干涉v1.html", "#btn_pause", false],
        ]) {
            await page.goto(new URL(path, baseUrl).href, { waitUntil: "networkidle" });
            if (startsPaused) await page.locator(button).click();
            await page.locator(button).click();
            assert.match(await page.locator(button).innerText(), /继续/);
            const canvas = page.locator("#simCanvas");
            await canvas.scrollIntoViewIfNeeded();
            await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
            const paused = await canvas.evaluate((element) => element.toDataURL());
            await page.waitForTimeout(150);
            assert.equal(await canvas.evaluate((element) => element.toDataURL()), paused, `${path} must remain visually stationary when paused`);
            await page.locator(button).click();
            await canvas.scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
            assert.notEqual(await canvas.evaluate((element) => element.toDataURL()), paused, `${path} must resume after play`);
        }

        await page.goto(new URL("/双凸透镜组合成像.html?access_token=test-secret#test-private", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator("#spacedLens").click();
        await page.locator('[data-step="2"]').click();
        const lensLink = await copyParameters();
        assert.equal(new URL(lensLink).hash, "");
        assert.equal(lensLink.includes("test-secret"), false);
        assert.equal(new URL(lensLink).searchParams.has("access_token"), false);
        await page.goto(lensLink, { waitUntil: "networkidle" });
        assert.equal(await page.locator("#spacedLens").evaluate((button) => button.classList.contains("active")), true);
        assert.equal(await page.locator('[data-step="2"]').evaluate((button) => button.classList.contains("active")), true);
        assert.equal(await page.locator("#gap").isEnabled(), true);

        await page.goto(new URL("/镜像法感应电荷.html", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator("#negative").click();
        const chargeLink = await copyParameters();
        await page.goto(chargeLink, { waitUntil: "networkidle" });
        assert.equal(await page.locator("#negative").evaluate((button) => button.classList.contains("active")), true);

        await page.goto(new URL("/配速v1.html", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator("#scenarioSelect").selectOption("eq_v1");
        const presetLink = await copyParameters();
        await page.goto(presetLink, { waitUntil: "networkidle" });
        assert.equal(await page.locator("#scenarioSelect").inputValue(), "eq_v1");
        assert.equal(await page.locator("#input_v0_mag").inputValue(), "1");

        await page.goto(new URL("/向量叉乘.html", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator("#reverse").click();
        await page.locator("#areaToggle").click();
        const vectorLink = await copyParameters();
        await page.goto(vectorLink, { waitUntil: "networkidle" });
        assert.equal(await page.locator("#reverse").getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator("#areaToggle").getAttribute("aria-pressed"), "false");

        if (pages.includes("/圆环碰撞.html")) {
            await page.goto(new URL("/圆环碰撞.html", baseUrl).href, { waitUntil: "networkidle" });
            assert.equal(await page.locator("svg[data-lab-export]").count(), 3);
            assert.equal(await page.locator("canvas").count(), 0, "The ring experiment retains native SVG rendering");
            assert.equal(await page.locator("#event-rows tr").count(), 3);
            assert.equal(Number(await page.locator("#va-value").innerText()), 1.5);
            assert.equal(Number(await page.locator("#vb-value").innerText()), 3);
            assert.equal(Number(await page.locator("#vq-value").innerText()), 2);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "Ring page must fit mobile width");
            await page.locator("#play-btn").click();
            await page.waitForFunction(() => Number(document.querySelector("#collision-fraction").value) > 0);
            await page.locator("#play-btn").click();
            assert.equal(await page.locator("#play-btn").getAttribute("aria-pressed"), "false");
            const pausedFraction = await page.locator("#collision-fraction").inputValue();
            await page.waitForTimeout(120);
            assert.equal(await page.locator("#collision-fraction").inputValue(), pausedFraction);
            await page.locator("#reset-btn").click();
            await page.locator("#next-btn").click();
            assert.equal(await page.locator("#current-event").innerText(), "2");
            await page.locator("#prev-btn").click();
            assert.equal(await page.locator("#current-event").innerText(), "1");
            await page.locator("#end-btn").click();
            assert.equal(await page.locator("#current-event").innerText(), "3");
            assert.equal(await page.locator("#sa-value").innerText(), await page.locator("#sb-value").innerText());
            if (process.env.BROWSER_SCREENSHOTS === "1") {
                const output = join(root, "artifacts", "browser");
                await mkdir(output, { recursive: true });
                await page.screenshot({ path: join(output, `ring-${viewport.width}.png`), fullPage: true });
            }

            await page.locator('[data-before="2"]').click();
            const beforeLink = await copyParameters();
            await page.goto(beforeLink, { waitUntil: "networkidle" });
            assert.equal(await page.locator("#collision-before").inputValue(), "2", "Shared links preserve the pre-collision state");
            await page.locator("#restitution").focus();
            await page.keyboard.press("Home");
            await page.locator("#pairs").fill("40");
            await page.locator("#pairs").press("Tab");
            assert.equal(await page.locator("#event-rows tr").count(), 81);
            await page.locator("#end-btn").click();
            assert.equal(await page.locator("#current-event").innerText(), "81");
            await page.locator("#prev-btn").click();
            assert.equal(await page.locator("#current-event").innerText(), "80");
            await page.locator("#segment-timeline").evaluate((input) => {
                input.value = "5000";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
            const lateState = await page.locator("#collision-lab").evaluate((element) => ({
                gap: Number(element.dataset.gap), relative: Number(element.dataset.relative),
            }));
            assert.ok(Math.abs(lateState.gap - Math.PI) < 1e-10, "At n=40/e=0.2 the final segment preserves its half-circle gap");
            assert.notEqual(lateState.relative, 0, "Late relative velocity must not disappear through cancellation");
            await page.locator("#reset-btn").click();
            await page.locator("#next-btn").click();
            await page.locator("#segment-timeline").focus();
            await page.keyboard.press("Home");
            await page.keyboard.press("ArrowRight");
            const ringPosition = await page.evaluate(() => Object.fromEntries(
                ["collision-offset", "collision-fraction", "collision-before", "pairs", "restitution"].map((id) => [id, document.getElementById(id).value]),
            ));
            assert.equal(ringPosition["collision-offset"], "1");
            assert.ok(Number(ringPosition["collision-fraction"]) > 0 && Number(ringPosition["collision-fraction"]) < 0.01);
            const ringLink = await copyParameters();
            await page.goto(ringLink, { waitUntil: "networkidle" });
            const restoredPosition = await page.evaluate(() => Object.fromEntries(
                ["collision-offset", "collision-fraction", "collision-before", "pairs", "restitution"].map((id) => [id, document.getElementById(id).value]),
            ));
            assert.deepEqual(restoredPosition, ringPosition, "Shared links preserve early collision segments even when n=40 and e=0.2");

            await page.locator(".lab-tools summary").click();
            const options = [["0", 620, 450], ["1", 780, 450], ["2", 780, 150]];
            for (const [option, width, height] of options) {
                await page.getByRole("combobox", { name: "选择导出图形", exact: true }).selectOption(option);
                const downloaded = page.waitForEvent("download");
                await page.getByRole("button", { name: "导出图形 PNG", exact: true }).click();
                const download = await downloaded;
                assert.equal(await download.failure(), null);
                const png = await readFile(await download.path());
                assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
                assert.equal(png.readUInt32BE(16), width, "SVG export uses viewBox width");
                assert.equal(png.readUInt32BE(20), height, "SVG export uses viewBox height");
                const pixels = await page.evaluate(async (base64) => {
                    const image = new Image();
                    image.src = `data:image/png;base64,${base64}`;
                    await image.decode();
                    const canvas = document.createElement("canvas");
                    canvas.width = image.width;
                    canvas.height = image.height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(image, 0, 0);
                    const data = ctx.getImageData(0, 0, image.width, image.height).data;
                    let colored = 0;
                    for (let i = 0; i < data.length; i += 16) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) colored++;
                    return { corner: [...data.slice(0, 4)], colored };
                }, png.toString("base64"));
                assert.deepEqual(pixels.corner, [255, 255, 255, 255], "SVG export has an opaque white background");
                assert.ok(pixels.colored > 100, "SVG export contains the plotted diagram");
            }
            await page.locator(".pl-comments-launcher").click();
            await page.locator(".pl-comments-drawer[open]").waitFor();
            await page.getByRole("button", { name: "关闭留言", exact: true }).click();
            console.log(`圆环 SVG、播放导航、分享精确状态与三图 PNG 导出通过：${viewport.width}px。`);
        }

        await page.goto(new URL("/课堂点名系统.html", baseUrl).href, { waitUntil: "networkidle" });
        await page.locator("#rosterInput").fill("ONLY_BROWSER_TEST_PERSON");
        assert.equal((await copyParameters()).includes("ONLY_BROWSER_TEST_PERSON"), false, "Shared links exclude the student roster");
        assert.deepEqual(pageErrors, [], `Interactive controls (${viewport.width}px)`);
        if (process.env.BROWSER_SCREENSHOTS === "1") {
            const output = join(root, "artifacts", "browser");
            await mkdir(output, { recursive: true });
            await page.screenshot({ path: join(output, `examples-${viewport.width}.png`), fullPage: true });
        }
        await context.close();
    }
    console.log(`浏览器冒烟通过：${pages.length} 个页面，桌面/手机 Canvas 或显式 SVG、页面异常、资源、搜索、分享/导出和播放导航。`);
} finally {
    await browser?.close();
    if (server) await new Promise((done) => server.close(done));
}
