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
