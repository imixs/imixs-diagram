import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePackLayout, packSiblings, enclose } from '../src/pack.js';

const node = id => ({ id, type: 'skill' });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

/** root → (a → (a1, a2, a3), b, c → (c1, c2)) */
const sample = () => computePackLayout(
    ['root', 'a', 'b', 'c', 'a1', 'a2', 'a3', 'c1', 'c2'].map(node),
    [edge('root', 'a'), edge('root', 'b'), edge('root', 'c'),
        edge('a', 'a1'), edge('a', 'a2'), edge('a', 'a3'), edge('c', 'c1'), edge('c', 'c2')]);

const distance = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

test('children lie completely inside their parent', () => {
    const { circles, parents } = sample();
    for (const [child, parent] of parents) {
        const c = circles.get(child);
        const p = circles.get(parent);
        assert.ok(distance(c, p) + c.r <= p.r + 0.01, `${child} inside ${parent}`);
    }
});

test('siblings do not overlap', () => {
    const { circles, parents } = sample();
    const siblings = [...parents.keys()];
    for (const a of siblings) {
        for (const b of siblings) {
            if (a < b && parents.get(a) === parents.get(b)) {
                const ca = circles.get(a);
                const cb = circles.get(b);
                assert.ok(distance(ca, cb) >= ca.r + cb.r - 0.01, `${a} and ${b} overlap`);
            }
        }
    }
});

test('a skill with more sub-skills is larger', () => {
    const { circles } = sample();
    assert.ok(circles.get('a').r > circles.get('c').r);
    assert.ok(circles.get('c').r > circles.get('b').r);
    assert.equal(circles.get('b').r, circles.get('a1').r, 'all leaves have the same size');
});

test('positions and sizes describe the circles for rendering', () => {
    const { circles, positions, sizes, depths, width, height } = sample();
    const root = circles.get('root');
    assert.deepEqual(positions.get('root'), { x: 40, y: 40 });
    assert.equal(sizes.get('root').width, Math.round(2 * root.r));
    assert.equal(depths.get('a1'), 2);
    assert.ok(width >= 2 * root.r + 80 - 1 && height >= 2 * root.r + 80 - 1);
});

test('a single skill is a leaf circle', () => {
    const { circles } = computePackLayout([node('root')], []);
    assert.equal(circles.get('root').r, 38);
});

test('packSiblings places every circle without overlap', () => {
    const placed = packSiblings(Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, r: 20 + (i % 3) * 10 })));
    assert.equal(placed.length, 12);
    for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
            assert.ok(distance(placed[i], placed[j]) >= placed[i].r + placed[j].r - 0.01);
        }
    }
});

test('enclose returns a circle around all circles that is not much larger than needed', () => {
    const circle = enclose([{ x: -10, y: 0, r: 10 }, { x: 10, y: 0, r: 10 }]);
    assert.ok(Math.abs(circle.x) < 0.5 && Math.abs(circle.y) < 0.5);
    assert.ok(circle.r >= 20 && circle.r < 20.5);
});
