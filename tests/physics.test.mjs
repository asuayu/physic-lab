import test from 'node:test';
import assert from 'node:assert/strict';
import {
    thinFilmOptics, imagePlanePotential, imagePlaneField, tracerIndex,
    linePanelPotential, linePanelField, solveLinearSystem, neutralPlateModel, magneticOrbit,
} from '../public/lab-physics.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
);

test('a matched film has no reflection and no two-beam relative phase', () => {
    for (const thickness of [0, 100, 700]) {
        const model = thinFilmOptics(1.33, 1.33, 1.33, thickness, 550);
        near(model.reflectance, 0);
        assert.equal(model.phaseDifference, null);
    }
});

test('zero-thickness film reduces to the direct boundary, regardless of the film index', () => {
    for (const n1 of [1, 1.33, 1.8, 2.2]) {
        near(thinFilmOptics(1, n1, 1.52, 0, 550).reflectance, ((1 - 1.52) / (1 + 1.52)) ** 2);
    }
});

test('a single matched boundary has constant reflectance as film thickness changes', () => {
    for (const thickness of [0, 60, 220, 700]) {
        near(thinFilmOptics(1, 1, 1.5, thickness, 550).reflectance, .04);
        near(thinFilmOptics(1, 1.5, 1.5, thickness, 550).reflectance, .04);
    }
});

test('ideal quarter-wave coating cancels reflection; a half-wave layer restores it', () => {
    const n = Math.sqrt(1.52), wavelength = 550;
    near(thinFilmOptics(1, n, 1.52, wavelength / (4 * n), wavelength).reflectance, 0);
    near(thinFilmOptics(1, n, 1.52, wavelength / (2 * n), wavelength).reflectance,
        ((1 - 1.52) / (1 + 1.52)) ** 2);
    assert.throws(() => thinFilmOptics(0, 1, 1.5, 100, wavelength), RangeError);
});

test('the grounded plane has zero potential and zero tangential electric field', () => {
    for (const x of [-3, -.3, 0, .3, 3]) {
        near(imagePlanePotential(x, 0, 1.4), 0);
        const [ex, ey] = imagePlaneField(x, 0, 1.4);
        near(ex, 0);
        near(ey, -2 * 1.4 / (x * x + 1.4 ** 2) ** 1.5);
    }
});

test('plane field equals minus the potential gradient and reverses with charge sign', () => {
    const x = .7, y = .9, d = 1.4, step = 1e-5;
    const field = imagePlaneField(x, y, d);
    const gradient = [
        -(imagePlanePotential(x + step, y, d) - imagePlanePotential(x - step, y, d)) / (2 * step),
        -(imagePlanePotential(x, y + step, d) - imagePlanePotential(x, y - step, d)) / (2 * step),
    ];
    field.forEach((value, i) => near(value, gradient[i], 1e-8));
    imagePlaneField(x, y, d, -1).forEach((value, i) => near(value, -field[i]));
});

test('negative charges play outward-generated paths backward', () => {
    assert.ok(tracerIndex(.3, 0, 101, 1) > tracerIndex(.2, 0, 101, 1));
    assert.ok(tracerIndex(.3, 0, 101, -1) < tracerIndex(.2, 0, 101, -1));
    assert.equal(tracerIndex(.4, .2, 1, -1), 0);
});

test('integrated line-panel field equals minus its potential gradient on both sides', () => {
    const panel = { x: .2, y: -.1, ds: .4, tx: 1, ty: 0 }, step = 1e-5;
    for (const [x, y] of [[.5, .6], [.5, -.6], [-.3, -.1]]) {
        const actual = linePanelField(x, y, panel);
        const expected = [
            -(linePanelPotential(x + step, y, panel) - linePanelPotential(x - step, y, panel)) / (2 * step),
            -(linePanelPotential(x, y + step, panel) - linePanelPotential(x, y - step, panel)) / (2 * step),
        ];
        actual.forEach((value, i) => near(value, expected[i], 1e-7));
    }
    near(linePanelPotential(.2, -.1, panel), 1 - Math.log(.2));
});

test('the linear solver pivots, preserves inputs and rejects singular systems', () => {
    const a = [[0, 2], [1, 3]], rhs = [4, 7];
    assert.deepEqual(solveLinearSystem(a, rhs), [1, 2]);
    assert.deepEqual(a, [[0, 2], [1, 3]]);
    assert.deepEqual(rhs, [4, 7]);
    assert.throws(() => solveLinearSystem([[1, 2], [2, 4]], [3, 6]), RangeError);
});

test('the finite neutral plate conserves charge and its independently sampled boundary converges', () => {
    const coarse = neutralPlateModel(.75, { topPanels: 12, sidePanels: 2 });
    const fine = neutralPlateModel(.75, { topPanels: 24, sidePanels: 3 });
    for (const model of [coarse, fine, neutralPlateModel(2.2, { topPanels: 24, sidePanels: 3 })]) {
        near(model.charges.reduce((sum, charge) => sum + charge, 0), 0, 1e-11);
        assert.ok(model.solverResidual < 1e-10);
        assert.ok(model.boundaryError > model.solverResidual * 1000);
        assert.ok(model.charges.some(charge => charge > 0));
        assert.ok(model.charges.some(charge => charge < 0));
    }
    assert.ok(fine.boundaryError < coarse.boundaryError * .6);
    assert.throws(() => neutralPlateModel(.1), RangeError);
});

test('magnetic arcs start with the selected velocity and terminate at their first plate intersection', () => {
    for (const q of [-1, 1]) for (const B of [-1, 1]) {
        const m = magneticOrbit({ alpha: 4.6, height: 1.2, q, B });
        near(m.C.x + Math.cos(m.phi0), 0);
        near(m.C.y + Math.sin(m.phi0), 0);
        near(-Math.sin(m.phi0) * m.direction, m.v.x);
        near(Math.cos(m.phi0) * m.direction, m.v.y);
        if (m.hit) {
            near(m.C.x + Math.cos(m.phi0 + m.direction * m.sweep), m.P.x);
            near(m.C.y + Math.sin(m.phi0 + m.direction * m.sweep), 1.2);
            for (let fraction = .01; fraction < .99; fraction += .01) {
                assert.ok(m.C.y + Math.sin(m.phi0 + m.direction * m.sweep * fraction) < 1.2 + 1e-9);
            }
        }
    }
});

test('magnetic model distinguishes tangency from an unreachable plate', () => {
    const tangent = magneticOrbit({ alpha: Math.acos(-.2), height: 1.2, q: 1, B: -1 });
    assert.equal(tangent.hit, true);
    assert.equal(tangent.tangent, true);
    near(tangent.P.y, 1.2);
    assert.equal(magneticOrbit({ alpha: 0, height: 1.2, q: 1, B: -1 }).hit, false);
});
