export function tokenize(text: string, pieces: [string, number][], tokens: string[]) {
  const input = `▁${text.toUpperCase().replace(/[^A-Z' ]/g, ' ').trim().replace(/\s+/g, '▁')}`;
  const scores = new Float64Array(input.length + 1).fill(-Infinity);
  const paths: { start: number; token: string }[] = [];
  scores[0] = 0;
  for (let start = 0; start < input.length; start++) {
    if (!Number.isFinite(scores[start])) continue;
    for (const [piece, score] of pieces) {
      if (piece.startsWith('<') || !input.startsWith(piece, start)) continue;
      const end = start + piece.length;
      if (scores[start] + score > scores[end]) { scores[end] = scores[start] + score; paths[end] = { start, token: piece }; }
    }
  }
  if (!Number.isFinite(scores[input.length])) throw new Error('Use English letters and apostrophes in reference sentences.');
  const output = [];
  for (let end = input.length; end > 0;) { output.push(tokens.indexOf(paths[end].token)); end = paths[end].start; }
  if (output.some(id => id < 0)) throw new Error('Model tokenizer does not match its vocabulary.');
  return output.reverse();
}

export function visualFeatures(memory: Float32Array, frames: number) {
  const features = new Float32Array(32);
  for (let i = 0; i < memory.length; i++) features[i % 32] += memory[i] / (frames * 24);
  const norm = Math.max(1e-6, Math.sqrt(features.reduce((sum, value) => sum + value * value, 0)));
  for (let i = 0; i < features.length; i++) features[i] /= norm;
  return features;
}

export function adjustedScores(scores: Float32Array, bias: Float32Array, visual?: Float32Array, features?: Float32Array) {
  const output = Float32Array.from(scores, (value, i) => value + (bias[i] ?? 0));
  if (visual && features) for (let i = 0; i < output.length; i++) for (let j = 0; j < features.length; j++) output[i] += visual[i * 32 + j] * features[j];
  const maximum = output.reduce((a, b) => Math.max(a, b), -Infinity);
  const total = output.reduce((sum, value) => sum + Math.exp(value - maximum), 0);
  const normalizer = maximum + Math.log(total);
  for (let i = 0; i < output.length; i++) output[i] -= normalizer;
  return output;
}

export function biasGradient(rows: { scores: Float32Array; target: number; features?: Float32Array }[], bias: Float32Array, visual = new Float32Array(0)) {
  const gradient = new Float32Array(bias.length);
  const visualGradient = new Float32Array(visual.length);
  let loss = 0;
  for (const row of rows) {
    const probabilities = adjustedScores(row.scores, bias, visual.length ? visual : undefined, row.features);
    loss -= probabilities[row.target];
    for (let i = 0; i < gradient.length; i++) {
      const error = Math.exp(probabilities[i]) - Number(i === row.target);
      gradient[i] += error;
      if (row.features) for (let j = 0; j < row.features.length; j++) visualGradient[i * 32 + j] += error * row.features[j];
    }
  }
  for (let i = 0; i < gradient.length; i++) gradient[i] = gradient[i] / rows.length + 0.02 * bias[i];
  for (let i = 0; i < visualGradient.length; i++) visualGradient[i] = visualGradient[i] / rows.length + 0.02 * visual[i];
  return { gradient, visualGradient, loss: loss / rows.length + 0.01 * bias.reduce((sum, value) => sum + value * value, 0) + 0.01 * visual.reduce((sum, value) => sum + value * value, 0) };
}

export function wordErrors(reference: string, hypothesis: string) {
  const words = (value: string) => value.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const ref = words(reference), hyp = words(hypothesis);
  let row = hyp.map((_, i) => i + 1); row.unshift(0);
  for (let i = 1; i <= ref.length; i++) {
    const next = [i];
    for (let j = 1; j <= hyp.length; j++) next.push(Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(ref[i - 1] !== hyp[j - 1])));
    row = next;
  }
  return { errors: row[hyp.length], words: ref.length };
}
