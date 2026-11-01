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

export function adjustedScores(scores: Float32Array, bias: Float32Array) {
  const output = Float32Array.from(scores, (value, i) => value + (bias[i] ?? 0));
  const maximum = output.reduce((a, b) => Math.max(a, b), -Infinity);
  const total = output.reduce((sum, value) => sum + Math.exp(value - maximum), 0);
  const normalizer = maximum + Math.log(total);
  for (let i = 0; i < output.length; i++) output[i] -= normalizer;
  return output;
}

export function biasGradient(rows: { scores: Float32Array; target: number }[], bias: Float32Array) {
  const gradient = new Float32Array(bias.length);
  let loss = 0;
  for (const row of rows) {
    const probabilities = adjustedScores(row.scores, bias);
    loss -= probabilities[row.target];
    for (let i = 0; i < gradient.length; i++) gradient[i] += Math.exp(probabilities[i]) - Number(i === row.target);
  }
  for (let i = 0; i < gradient.length; i++) gradient[i] = gradient[i] / rows.length + 0.02 * bias[i];
  return { gradient, loss: loss / rows.length + 0.01 * bias.reduce((sum, value) => sum + value * value, 0) };
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
