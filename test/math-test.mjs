#!/usr/bin/env node
/**
 * Verifies the pure pixel math embedded in the plugin's Client module.
 * The functions live between the `pure-math` markers in client.js; this test
 * evaluates that exact text so the shipped implementation is what is checked.
 */
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const start = source.indexOf('/* #region pure-math */');
const end = source.indexOf('/* #endregion pure-math */');
assert.ok(start >= 0 && end > start, 'pure-math region markers are present');

const moduleText = source.slice(start, end);
const exportsText = `${moduleText}
return { clampNumber, IMAGE_MEDIA_TYPES, mediaTypeOf, normalizeRect, rectPixelSize, fitScale, pixelPoint, selectionHandles, hitSelection, moveSelection, resizeSelection, zoomStep, wheelZoomFactor };`;
const math = new Function(exportsText)();

const { clampNumber, mediaTypeOf, normalizeRect, rectPixelSize, fitScale, pixelPoint, selectionHandles, hitSelection, moveSelection, resizeSelection, zoomStep, wheelZoomFactor } = math;

assert.equal(mediaTypeOf('dsh-resource://file/session/abc/0.webp'), 'image/webp');
assert.equal(mediaTypeOf('dsh-resource://file/session/abc/src/Hero.PNG'), 'image/png');
assert.equal(mediaTypeOf('dsh-resource://file/session/abc/logo.svg?cache=1#top'), 'image/svg+xml');
assert.equal(mediaTypeOf('dsh-resource://file/session/abc/with%20space.JPG'), 'image/jpeg');
assert.equal(mediaTypeOf('dsh-resource://file/session/abc/notes.txt'), '');
assert.equal(mediaTypeOf('dsh-resource://file/session/abc/no-extension'), '');

assert.equal(clampNumber(5, 0, 10), 5);
assert.equal(clampNumber(-5, 0, 10), 0);
assert.equal(clampNumber(50, 0, 10), 10);

assert.deepEqual(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 20 }), { left: 10, top: 20, right: 30, bottom: 40 });
assert.deepEqual(rectPixelSize({ left: 10, top: 20, right: 30, bottom: 40 }), { width: 21, height: 21 });
assert.deepEqual(rectPixelSize({ left: 0, top: 0, right: 0, bottom: 0 }), { width: 1, height: 1 });

assert.equal(fitScale(1000, 500, 24), 1, 'small images are not enlarged by fit');
assert.equal(fitScale(524, 1000, 24), 0.5);
assert.equal(fitScale(0, 1000, 24), 1, 'unmeasured viewport falls back to 1:1');
assert.equal(fitScale(500, 0, 24), 1, 'unknown intrinsic width falls back to 1:1');

// A 200x100 image displayed at 100x50 CSS pixels maps each CSS pixel to two image pixels.
const bounds = { left: 40, top: 10, width: 100, height: 50 };
const natural = { width: 200, height: 100 };
assert.deepEqual(pixelPoint(40, 10, bounds, natural, false), { x: 0, y: 0 });
assert.deepEqual(pixelPoint(40 + 50, 10 + 25, bounds, natural, false), { x: 100, y: 50 });
assert.deepEqual(pixelPoint(40 + 99.9, 10 + 49.9, bounds, natural, false), { x: 199, y: 99 });
assert.equal(pixelPoint(39, 10, bounds, natural, false), null, 'outside left is rejected');
assert.equal(pixelPoint(140, 10, bounds, natural, false), null, 'outside right is rejected');
assert.deepEqual(pixelPoint(0, 0, bounds, natural, true), { x: 0, y: 0 }, 'dragging clamps to the image');
assert.deepEqual(pixelPoint(1000, 1000, bounds, natural, true), { x: 199, y: 99 }, 'dragging clamps to the image');

// Zoomed display: 200% shows each image pixel as a 2x2 CSS block.
const zoomed = { left: 40, top: 10, width: 400, height: 200 };
assert.deepEqual(pixelPoint(40 + 2, 10 + 2, zoomed, natural, false), { x: 1, y: 1 });
assert.deepEqual(pixelPoint(40 + 2, 10 + 2, zoomed, natural, true), { x: 1, y: 1 });

// A 200x100 image displayed at 200x100 CSS pixels, selection 10..109 x 10..59.
const selection = { left: 10, top: 10, right: 109, bottom: 59 };
const fullBounds = { left: 0, top: 0, width: 200, height: 100 };
assert.deepEqual(selectionHandles(selection, 1, 1).nw, [10, 10]);
assert.deepEqual(selectionHandles(selection, 1, 1).se, [110, 60]);
assert.deepEqual(selectionHandles(selection, 1, 1).n, [60, 10]);

assert.deepEqual(hitSelection(110, 60, fullBounds, natural, selection), { kind: 'resize', handle: 'se' });
assert.deepEqual(hitSelection(10, 35, fullBounds, natural, selection), { kind: 'resize', handle: 'w' });
assert.deepEqual(hitSelection(60, 10, fullBounds, natural, selection), { kind: 'resize', handle: 'n' });
assert.deepEqual(hitSelection(60, 35, fullBounds, natural, selection), { kind: 'move' });
assert.equal(hitSelection(0, 0, fullBounds, natural, selection), null);
assert.equal(hitSelection(150, 35, fullBounds, natural, selection), null);

// Moving keeps the box inside the image and snaps at the boundary.
assert.deepEqual(moveSelection(selection, { x: 0, y: 0 }, { x: 5, y: 5 }, natural), { left: 15, top: 15, right: 114, bottom: 64 });
assert.deepEqual(moveSelection(selection, { x: 0, y: 0 }, { x: 500, y: 500 }, natural), { left: 100, top: 50, right: 199, bottom: 99 });
assert.deepEqual(moveSelection(selection, { x: 0, y: 0 }, { x: -500, y: -500 }, natural), { left: 0, top: 0, right: 99, bottom: 49 });

// Resizing snaps each dragged edge to the image bounds and never inverts the box.
assert.deepEqual(resizeSelection(selection, 'se', { x: 500, y: 500 }, natural), { left: 10, top: 10, right: 199, bottom: 99 });
assert.deepEqual(resizeSelection(selection, 'nw', { x: 0, y: 0 }, natural), { left: 0, top: 0, right: 109, bottom: 59 });
assert.deepEqual(resizeSelection(selection, 'nw', { x: 500, y: 500 }, natural), { left: 109, top: 59, right: 109, bottom: 59 });
assert.deepEqual(resizeSelection(selection, 'w', { x: -20, y: 30 }, natural), { left: 0, top: 10, right: 109, bottom: 59 });
assert.deepEqual(resizeSelection(selection, 'n', { x: 50, y: 90 }, natural), { left: 10, top: 59, right: 109, bottom: 59 });

assert.equal(zoomStep(1, 1), 1.25);
assert.equal(zoomStep(1, -1), 0.8);
assert.equal(zoomStep(15, 1), 16, 'maximum zoom clamps');
assert.equal(zoomStep(0.1, -1), 0.1, 'minimum zoom clamps');
assert.ok(wheelZoomFactor(-100) > 1 && wheelZoomFactor(-100) <= 1.25);
assert.ok(wheelZoomFactor(100) < 1 && wheelZoomFactor(100) >= 0.8);
assert.equal(wheelZoomFactor(0), 1);

console.log('image-pixel-scope pixel math: all assertions passed');
