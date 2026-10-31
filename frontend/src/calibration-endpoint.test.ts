import assert from "node:assert/strict";
import test from "node:test";
import { mouthMotion, sentenceFinished } from "./calibration-endpoint.ts";

test("mouth motion ignores head translation and scale", () => {
  const points = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  points[61].x = 0.4;
  points[291].x = 0.6;
  points[13].y = 0.49;
  points[14].y = 0.51;
  const first = mouthMotion(null, points);
  const moved = points.map(point => ({ x: point.x * 0.9 + 0.04, y: point.y * 0.9 + 0.03 }));
  assert.ok(mouthMotion(first.shape, moved).energy < 1e-8);
  points[13].y -= 0.03;
  points[14].y += 0.03;
  assert.ok(mouthMotion(first.shape, points).energy > 0.012);
});

test("completion requires articulation, enough time and a real pause", () => {
  assert.equal(sentenceFinished(1800, 0, 800, 8, 10), false);
  assert.equal(sentenceFinished(1900, 0, 800, 8, 10), true);
  assert.equal(sentenceFinished(10000, 0, 800, 4, 10), false);
  assert.equal(sentenceFinished(3000, 0, 800, 8, 20), false);
  assert.equal(sentenceFinished(3300, 0, 800, 8, 20), true);
});
