/** Pure models shared by the demonstrations and their numerical regression tests. */
const TAU = Math.PI * 2;
const positive = (value, name) => {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
};
const mod = value => ((value % TAU) + TAU) % TAU;

export function reflectionPhase(fromIndex, toIndex) {
    positive(fromIndex, 'fromIndex');
    positive(toIndex, 'toIndex');
    if (Math.abs(fromIndex - toIndex) < 1e-12) return null;
    return toIndex > fromIndex ? Math.PI : 0;
}

/** Coherent, lossless film at normal incidence, including all internal reflections. */
export function thinFilmOptics(n0, n1, n2, thickness, vacuumWavelength) {
    [n0, n1, n2].forEach((n, i) => positive(n, `n${i}`));
    positive(vacuumWavelength, 'vacuumWavelength');
    if (!Number.isFinite(thickness) || thickness < 0) throw new RangeError('thickness must be nonnegative');
    const r01 = (n0 - n1) / (n0 + n1);
    const r12 = (n1 - n2) / (n1 + n2);
    const propagationPhase = 4 * Math.PI * n1 * thickness / vacuumWavelength;
    const phase1 = reflectionPhase(n0, n1);
    const phase2 = reflectionPhase(n1, n2);
    const crossTerm = 2 * r01 * r12 * Math.cos(propagationPhase);
    const reflectance = (r01 * r01 + r12 * r12 + crossTerm)
        / (1 + (r01 * r12) ** 2 + crossTerm);
    return {
        r01, r12, phase1, phase2, propagationPhase,
        phaseDifference: phase1 === null || phase2 === null ? null : propagationPhase + phase2 - phase1,
        reflectance: Math.max(0, Math.min(1, reflectance)),
    };
}

/** Unit Coulomb constant; the physical solution applies only above the plane. */
export function imagePlanePotential(x, y, distance, charge = 1) {
    positive(distance, 'distance');
    const near = Math.max(1e-12, Math.hypot(x, y - distance));
    const far = Math.max(1e-12, Math.hypot(x, y + distance));
    return charge * (1 / near - 1 / far);
}

export function imagePlaneField(x, y, distance, charge = 1) {
    positive(distance, 'distance');
    let ex = 0, ey = 0;
    for (const [sourceY, sourceQ] of [[distance, charge], [-distance, -charge]]) {
        const dy = y - sourceY;
        const radius = Math.max(1e-12, Math.hypot(x, dy));
        const factor = sourceQ / radius ** 3;
        ex += factor * x;
        ey += factor * dy;
    }
    return [ex, ey];
}

/** Paths are generated outward from the real charge; negative charges play backward. */
export function tracerIndex(progress, offset, length, chargeSign = 1) {
    if (!Number.isInteger(length) || length < 1) throw new RangeError('length must be a positive integer');
    const fraction = ((progress + offset) % 1 + 1) % 1;
    return Math.floor((chargeSign < 0 ? 1 - fraction : fraction) * (length - 1));
}

/** Constant-charge straight panel for the 2-D logarithmic electrostatic kernel. */
export function linePanelPotential(x, y, panel) {
    const { x: cx, y: cy, ds, tx = 1, ty = 0 } = panel;
    positive(ds, 'panel.ds');
    const u = (x - cx) * tx + (y - cy) * ty;
    const v = Math.abs(-(x - cx) * ty + (y - cy) * tx);
    const primitive = z => {
        if (v < 1e-14) return Math.abs(z) < 1e-14 ? 0 : z * Math.log(Math.abs(z)) - z;
        return .5 * z * Math.log(z * z + v * v) - z + v * Math.atan(z / v);
    };
    return -(primitive(u + ds / 2) - primitive(u - ds / 2)) / ds;
}

export function linePanelField(x, y, panel) {
    const { x: cx, y: cy, ds, tx = 1, ty = 0 } = panel;
    positive(ds, 'panel.ds');
    const u = (x - cx) * tx + (y - cy) * ty;
    const v = -(x - cx) * ty + (y - cy) * tx;
    const start = u - ds / 2, end = u + ds / 2;
    const tangent = .5 * Math.log(Math.max(1e-24, end * end + v * v)
        / Math.max(1e-24, start * start + v * v)) / ds;
    const normal = Math.abs(v) < 1e-14 ? 0 : (Math.atan(end / v) - Math.atan(start / v)) / ds;
    return [tangent * tx - normal * ty, tangent * ty + normal * tx];
}

/** Partial-pivot Gaussian elimination; callers retain their original matrix. */
export function solveLinearSystem(matrix, rhs) {
    const n = rhs.length;
    if (!n || matrix.length !== n || matrix.some(row => row.length !== n)) throw new RangeError('matrix must be square');
    const a = matrix.map(row => [...row]);
    const b = [...rhs];
    for (let k = 0; k < n; k++) {
        let pivot = k;
        for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
        if (Math.abs(a[pivot][k]) < 1e-14) throw new RangeError('singular matrix');
        [a[k], a[pivot]] = [a[pivot], a[k]];
        [b[k], b[pivot]] = [b[pivot], b[k]];
        const denominator = a[k][k];
        for (let j = k; j < n; j++) a[k][j] /= denominator;
        b[k] /= denominator;
        for (let i = 0; i < n; i++) {
            if (i === k) continue;
            const factor = a[i][k];
            for (let j = k; j < n; j++) a[i][j] -= factor * a[k][j];
            b[i] -= factor * b[k];
        }
    }
    return b;
}

/** Neutral finite rectangular conductor in 2-D, with a unit positive line charge above it. */
export function neutralPlateModel(distance, { halfLength = 2.75, halfThickness = .15, topPanels = 34, sidePanels = 5 } = {}) {
    positive(halfLength, 'halfLength');
    positive(halfThickness, 'halfThickness');
    if (!Number.isFinite(distance) || distance <= halfThickness) throw new RangeError('charge must be outside the conductor');
    if (![topPanels, sidePanels].every(value => Number.isInteger(value) && value > 0)) throw new RangeError('panel counts must be positive integers');
    const panels = [];
    for (let i = 0; i < topPanels; i++) {
        const x = -halfLength + (i + .5) * 2 * halfLength / topPanels;
        panels.push({ x, y: halfThickness, ds: 2 * halfLength / topPanels, tx: 1, ty: 0 });
        panels.push({ x, y: -halfThickness, ds: 2 * halfLength / topPanels, tx: 1, ty: 0 });
    }
    for (let i = 0; i < sidePanels; i++) {
        const y = -halfThickness + (i + .5) * 2 * halfThickness / sidePanels;
        panels.push({ x: -halfLength, y, ds: 2 * halfThickness / sidePanels, tx: 0, ty: 1 });
        panels.push({ x: halfLength, y, ds: 2 * halfThickness / sidePanels, tx: 0, ty: 1 });
    }
    const n = panels.length;
    const matrix = Array.from({ length: n + 1 }, () => Array(n + 1).fill(0));
    const rhs = Array(n + 1).fill(0);
    panels.forEach((point, i) => {
        panels.forEach((panel, j) => matrix[i][j] = linePanelPotential(point.x, point.y, panel));
        matrix[i][n] = -1;
        rhs[i] = Math.log(Math.hypot(point.x, point.y - distance));
    });
    for (let j = 0; j < n; j++) matrix[n][j] = 1;
    const solution = solveLinearSystem(matrix, rhs);
    const charges = solution.slice(0, n), potential = solution[n];
    const solverResidual = Math.max(...matrix.map((row, i) => Math.abs(
        row.reduce((sum, coefficient, j) => sum + coefficient * solution[j], 0) - rhs[i],
    )));
    let boundaryError = 0;
    // These points are independent of the collocation equations used in the solve.
    for (const panel of panels) for (const offset of [-.25, .25]) {
        const x = panel.x + offset * panel.ds * panel.tx;
        const y = panel.y + offset * panel.ds * panel.ty;
        let value = -Math.log(Math.hypot(x, y - distance));
        panels.forEach((source, i) => value += charges[i] * linePanelPotential(x, y, source));
        boundaryError = Math.max(boundaryError, Math.abs(value - potential));
    }
    return { panels, charges, potential, solverResidual, boundaryError };
}

/** Uniform magnetic field, fixed speed/radius, and the first crossing of y=height. */
export function magneticOrbit({ alpha, height, q = 1, B = -1, radius = 1 }) {
    positive(radius, 'radius');
    positive(height, 'height');
    if (!Number.isFinite(alpha) || !Number.isFinite(q * B) || q * B === 0) throw new RangeError('finite angle and nonzero qB required');
    const turn = Math.sign(q * B), direction = -turn;
    const O = { x: 0, y: 0 }, v = { x: -Math.cos(alpha), y: -Math.sin(alpha) };
    const C = { x: turn * radius * v.y, y: -turn * radius * v.x };
    const phi0 = Math.atan2(-C.y, -C.x), vertical = height - C.y;
    const candidates = [];
    if (Math.abs(vertical) <= radius + 1e-9) {
        const dx = Math.sqrt(Math.max(0, radius * radius - vertical * vertical));
        for (const x of [C.x - dx, C.x + dx]) {
            const P = { x, y: height }, phi = Math.atan2(P.y - C.y, P.x - C.x);
            const sweep = direction > 0 ? mod(phi - phi0) : mod(phi0 - phi);
            if (sweep > 1e-5) candidates.push({ P, phi, sweep });
        }
    }
    candidates.sort((a, b) => a.sweep - b.sweep);
    const hit = candidates.length > 0;
    const chosen = candidates[0] ?? { P: null, phi: phi0, sweep: TAU };
    return { r: radius, O, C, v, turn, direction, phi0, hit,
        tangent: hit && Math.abs(vertical - radius) < 1e-7,
        P: chosen.P, phiP: chosen.phi, sweep: chosen.sweep };
}
