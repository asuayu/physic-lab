import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/lab-runtime.js", import.meta.url), "utf8");
function setup() {
    const listeners = new Map(), frames = new Map();
    let nextId = 0, now = 1000;
    const document = {
        hidden: false,
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    };
    const window = { devicePixelRatio: 3 };
    vm.runInNewContext(source, {
        window, document, location: { protocol: "file:" }, performance: { now: () => now },
        requestAnimationFrame(fn) { const id = ++nextId; frames.set(id, fn); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
    });
    return {
        lab: window.PhysicsLab, frames, document,
        frame(timestamp) { const pending = [...frames.values()]; frames.clear(); pending.forEach((fn) => fn(timestamp)); },
        visibility(hidden, timestamp) { now = timestamp; document.hidden = hidden; listeners.get("visibilitychange")?.forEach((fn) => fn()); },
    };
}

test("fixed physical steps give identical orbits at 60 and 144 Hz", () => {
    const { lab } = setup();
    const orbitAt = (fps) => {
        const body = { x: 1, y: 0, vx: 0, vy: 1 };
        const clock = lab.createFixedStepper({ step: 0.005 });
        for (let i = 0; i < fps * 10; i++) clock.advance(1 / fps, (dt) => lab.stepGravity(body, 1, dt));
        return body;
    };
    assert.deepEqual(orbitAt(60), orbitAt(144));
});

test("Verlet preserves angular momentum and bounded circular-orbit energy", () => {
    const { lab } = setup();
    const body = { x: 1, y: 0, vx: 0, vy: 1 };
    let maxEnergyError = 0;
    for (let i = 0; i < 13000; i++) {
        lab.stepGravity(body, 1, 0.01);
        const energy = (body.vx ** 2 + body.vy ** 2) / 2 - 1 / Math.hypot(body.x, body.y);
        maxEnergyError = Math.max(maxEnergyError, Math.abs(energy + 0.5));
    }
    assert.ok(maxEnergyError < 1e-7, `energy error ${maxEnergyError}`);
    assert.ok(Math.abs(body.x * body.vy - body.y * body.vx - 1) < 1e-10);
});

test("fixed-step catch-up is bounded and reset discards partial time", () => {
    const { lab } = setup();
    const clock = lab.createFixedStepper({ step: 0.01, maxElapsed: 0.1, maxSteps: 3 });
    let steps = 0;
    assert.equal(clock.advance(20, () => steps++), 3);
    clock.reset();
    assert.equal(clock.advance(0.005, () => steps++), 0);
    clock.reset();
    assert.equal(clock.advance(0.005, () => steps++), 0);
    assert.equal(steps, 3);
});

test("Canvas DPR cap preserves CSS coordinate dimensions", () => {
    const { lab } = setup();
    let transform;
    const canvas = { width: 0, height: 0, clientWidth: 400, clientHeight: 250,
        getContext: () => ({ setTransform: (...args) => { transform = args; } }) };
    const size = lab.resizeCanvas(canvas);
    assert.equal(size.width, 400);
    assert.equal(size.height, 250);
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 500);
    assert.deepEqual(transform, [2, 0, 0, 2, 0, 0]);
    assert.equal(lab.resizeCanvas(canvas).changed, false);
});

test("animation owns one RAF and becomes idle after pause", () => {
    const env = setup();
    let updates = 0, renders = 0;
    const animation = env.lab.createAnimation({ update: () => updates++, render: () => renders++ });
    animation.start(); animation.start();
    assert.equal(env.frames.size, 1);
    env.frame(1000); env.frame(1017);
    assert.equal(updates, 2);
    animation.pause(); env.frame(1034);
    assert.equal(updates, 2);
    assert.equal(env.frames.size, 0);
    animation.invalidate(); env.frame(1050);
    assert.equal(renders, 4);
    assert.equal(env.frames.size, 0);
    animation.destroy(); animation.invalidate();
    assert.equal(env.frames.size, 0);
});

test("visibility suspension does not integrate elapsed background time", () => {
    const env = setup();
    let updates = 0;
    const animation = env.lab.createAnimation({ update: () => updates++, render: () => {} });
    animation.start(); env.frame(1000); env.frame(1017);
    env.visibility(true, 1020);
    assert.equal(env.frames.size, 0);
    env.visibility(false, 50000); env.frame(50000);
    assert.equal(updates, 2);
    assert.equal(env.lab.frameScale(50000, 1017), 0);
    animation.destroy();
});
