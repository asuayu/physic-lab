(() => {
    "use strict";
    if (window.PhysicsLab) return;
    const FRAME_MS = 1000 / 60;
    let resumedAt = 0;
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) resumedAt = performance.now();
    });

    function frameScale(timestamp, previousTimestamp, maxFrames = 3) {
        if (document.hidden) return 0;
        if (!Number.isFinite(timestamp) || !Number.isFinite(previousTimestamp) || previousTimestamp <= 0) return 1;
        if (previousTimestamp < resumedAt) return 0;
        return Math.min(Math.max(0, timestamp - previousTimestamp) / FRAME_MS, Math.max(0, maxFrames));
    }

    /** Drawing coordinates remain CSS pixels; backing pixels follow display density. */
    function resizeCanvas(canvas, { width = canvas.clientWidth, height = canvas.clientHeight, maxDpr = 2 } = {}) {
        width = Math.max(1, Number(width) || 1);
        height = Math.max(1, Number(height) || 1);
        const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), Math.max(1, maxDpr));
        const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
        const changed = canvas.width !== pixelWidth || canvas.height !== pixelHeight;
        if (changed) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
        canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
        return { width, height, dpr, changed };
    }

    function observeResize(element, callback) {
        let lastWidth = -1, lastHeight = -1, lastDpr = -1;
        const check = () => {
            const width = element.clientWidth, height = element.clientHeight, dpr = window.devicePixelRatio || 1;
            if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;
            lastWidth = width; lastHeight = height; lastDpr = dpr;
            callback();
        };
        const observer = new ResizeObserver(check);
        observer.observe(element);
        window.addEventListener("resize", check);
        return () => { observer.disconnect(); window.removeEventListener("resize", check); };
    }

    /** Accumulate elapsed seconds and integrate at a fixed physical step. */
    function createFixedStepper({ step = 1 / 120, maxElapsed = 0.05, maxSteps = 12 } = {}) {
        if (!(step > 0) || !(maxElapsed > 0) || !Number.isInteger(maxSteps) || maxSteps < 1) {
            throw new RangeError("Invalid fixed-step configuration");
        }
        let accumulator = 0;
        return Object.freeze({
            advance(elapsed, update) {
                accumulator += Math.min(Math.max(0, Number(elapsed) || 0), maxElapsed);
                let count = 0;
                while (accumulator + step * 1e-9 >= step && count < maxSteps) {
                    update(step);
                    accumulator = Math.max(0, accumulator - step);
                    count++;
                }
                if (count === maxSteps && accumulator >= step) accumulator %= step;
                return count;
            },
            reset() { accumulator = 0; },
        });
    }

    /** Velocity Verlet for a body orbiting a fixed inverse-square gravity source. */
    function stepGravity(body, mu, dt) {
        const radius = Math.hypot(body.x, body.y);
        if (!(radius > 0) || !(mu >= 0) || !(dt >= 0)) throw new RangeError("Invalid gravity state");
        const scale = -mu / radius ** 3;
        const ax = scale * body.x, ay = scale * body.y;
        body.x += body.vx * dt + 0.5 * ax * dt * dt;
        body.y += body.vy * dt + 0.5 * ay * dt * dt;
        const nextScale = -mu / Math.hypot(body.x, body.y) ** 3;
        body.vx += 0.5 * (ax + nextScale * body.x) * dt;
        body.vy += 0.5 * (ay + nextScale * body.y) * dt;
        return body;
    }

    /** One RAF owner, with no polling while paused, static, or backgrounded. */
    function createAnimation({ update = () => {}, render, isActive = () => true, stepMs = 1000 / 120, maxSteps = 12 }) {
        let running = false, dirty = true, destroyed = false, raf = null, previous = null;
        const stepper = createFixedStepper({ step: stepMs / 1000, maxElapsed: 0.05, maxSteps });
        const schedule = () => {
            if (!destroyed && !document.hidden && raf === null && (dirty || (running && isActive()))) raf = requestAnimationFrame(frame);
        };
        function frame(timestamp) {
            raf = null;
            const active = running && isActive();
            const elapsed = previous === null ? 0 : Math.max(0, timestamp - previous) / 1000;
            previous = timestamp;
            if (active) stepper.advance(elapsed, (dt) => { if (isActive()) update(dt); });
            if (dirty || active) render(timestamp);
            dirty = false;
            if (!running || !isActive()) { previous = null; stepper.reset(); }
            schedule();
        }
        const visibility = () => {
            previous = null;
            stepper.reset();
            if (document.hidden && raf !== null) { cancelAnimationFrame(raf); raf = null; }
            else { dirty = true; schedule(); }
        };
        document.addEventListener("visibilitychange", visibility);
        return Object.freeze({
            start() { running = true; dirty = true; previous = null; schedule(); },
            pause() { running = false; previous = null; stepper.reset(); dirty = true; schedule(); },
            invalidate() { dirty = true; schedule(); },
            destroy() {
                destroyed = true;
                if (raf !== null) cancelAnimationFrame(raf);
                document.removeEventListener("visibilitychange", visibility);
            },
        });
    }

    window.PhysicsLab = Object.freeze({ frameScale, resizeCanvas, observeResize, createFixedStepper, stepGravity, createAnimation });

    if (location.protocol === "http:" || location.protocol === "https:") {
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = "/lab-comments.css";
        document.head.appendChild(style);
        for (const source of ["/lab-comments.js", "/lab-tools.js"]) {
            const script = document.createElement("script");
            script.src = source;
            script.defer = true;
            document.head.appendChild(script);
        }
    }
})();
