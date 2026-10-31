const lips = [13, 14, 78, 308, 82, 312, 87, 317, 61, 291, 0, 17];

export function mouthMotion(previous: number[] | null, points: { x: number; y: number }[]) {
  const width = Math.hypot(points[61].x - points[291].x, points[61].y - points[291].y);
  if (width < 0.015) return { shape: null, energy: 0 };
  const x = (points[61].x + points[291].x) / 2;
  const y = (points[61].y + points[291].y) / 2;
  const shape = lips.flatMap(index => [(points[index].x - x) / width, (points[index].y - y) / width]);
  return { shape, energy: previous ? Math.sqrt(shape.reduce((sum, value, index) => sum + (value - previous[index]) ** 2, 0) / shape.length) : 0 };
}

export function sentenceFinished(now: number, started: number, lastMotion: number, movingFrames: number, words: number) {
  return movingFrames >= 5 && now - started >= Math.max(1800, words * 160) && now - lastMotion >= 1100;
}
