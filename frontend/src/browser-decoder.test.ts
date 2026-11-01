import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedScores, biasGradient, tokenize, wordErrors } from './browser-decoder.ts';

test('unigram segmentation chooses the highest total score, not the longest token', () => {
  assert.deepEqual(tokenize('ab', [['▁', -0.1], ['AB', -0.1], ['▁AB', -3]], ['<blank>', '▁', 'AB', '▁AB']), [1, 2]);
  assert.throws(() => tokenize('missing', [['▁', 0]], ['▁']), /English letters/);
});

test('personalization gradients match finite differences and lower supervised loss', () => {
  const rows = [{ scores: new Float32Array([-2, -0.5, -1]), target: 0 }, { scores: new Float32Array([-1, -2, -0.5]), target: 1 }];
  const bias = new Float32Array([0.1, -0.2, 0.05]);
  const original = biasGradient(rows, bias);
  for (let i = 0; i < bias.length; i++) {
    const plus = new Float32Array(bias), minus = new Float32Array(bias);
    plus[i] += 0.001; minus[i] -= 0.001;
    const numeric = (biasGradient(rows, plus).loss - biasGradient(rows, minus).loss) / 0.002;
    assert.ok(Math.abs(numeric - original.gradient[i]) < 0.001);
  }
  const updated = Float32Array.from(bias, (value, i) => value - 0.1 * original.gradient[i]);
  assert.ok(biasGradient(rows, updated).loss < original.loss);
  const scores = adjustedScores(rows[0].scores, updated);
  assert.ok(Math.abs(scores.reduce((sum, value) => sum + Math.exp(value), 0) - 1) < 1e-6);
});

test('word errors distinguish replay changes and preserve apostrophes', () => {
  assert.deepEqual(wordErrors("I'm writing a clear sentence", "I'm writing the clear sentence"), { errors: 1, words: 5 });
});

test('visual adapter gradients are correct and learn different outputs from visual inputs', () => {
  const positive = new Float32Array(32), negative = new Float32Array(32);
  positive[0] = 1; negative[0] = -1;
  const rows = [{ scores: new Float32Array([0, 0]), target: 0, features: positive }, { scores: new Float32Array([0, 0]), target: 1, features: negative }];
  const bias = new Float32Array(2), visual = new Float32Array(64);
  const original = biasGradient(rows, bias, visual);
  for (const index of [0, 1, 32]) {
    const plus = new Float32Array(visual), minus = new Float32Array(visual);
    plus[index] += 0.001; minus[index] -= 0.001;
    const numeric = (biasGradient(rows, bias, plus).loss - biasGradient(rows, bias, minus).loss) / 0.002;
    assert.ok(Math.abs(numeric - original.visualGradient[index]) < 0.001);
  }
  for (let step = 0; step < 20; step++) {
    const { visualGradient } = biasGradient(rows, bias, visual);
    for (let i = 0; i < visual.length; i++) visual[i] -= 0.2 * visualGradient[i];
  }
  assert.ok(biasGradient(rows, bias, visual).loss < original.loss);
  assert.ok(adjustedScores(rows[0].scores, bias, visual, positive)[0] > adjustedScores(rows[0].scores, bias, visual, positive)[1]);
  assert.ok(adjustedScores(rows[1].scores, bias, visual, negative)[1] > adjustedScores(rows[1].scores, bias, visual, negative)[0]);
});
