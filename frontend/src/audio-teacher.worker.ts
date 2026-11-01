import { env, pipeline, LogitsProcessor, LogitsProcessorList, Tensor } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/browser-model/speech/';
env.backends.onnx.wasm!.wasmPaths = '/speech-ort/';
env.backends.onnx.wasm!.numThreads = 1;
let teacher: any;

class SpeechConfidence extends LogitsProcessor {
  probabilities: number[] = [];
  _call(_ids: bigint[][], scores: Tensor) {
    const values = scores.data as Float32Array;
    let best = 0;
    for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
    if (best < 50256) {
      let total = 0;
      for (const value of values) total += Math.exp(value - values[best]);
      this.probabilities.push(-Math.log(total));
    }
    return scores;
  }
}

self.onmessage = async event => {
  const { id, audio } = event.data;
  try {
    if (!(audio instanceof Float32Array) || audio.length < 12800 || audio.length > 115200 || audio.some(value => !Number.isFinite(value))) throw new Error('Record a spoken sentence between one and seven seconds.');
    if (Math.sqrt(audio.reduce((sum, value) => sum + value * value, 0) / audio.length) < 0.002) throw new Error('The microphone is too quiet. Speak aloud and record again.');
    if (!teacher) {
      self.postMessage({ id, progress: 0.1, message: 'Loading local Whisper audio teacher…' });
      try { teacher = await pipeline('automatic-speech-recognition', 'whisper-base.en', { device: 'wasm', dtype: 'q8', progress_callback: (event: any) => { if (event.status === 'progress') self.postMessage({ id, progress: 0.1, message: `Loading Whisper · ${Math.round(event.progress)}%` }); } }); } catch { throw new Error('The audio teacher could not load. Retry, or use a typed reference.'); }
    }
    self.postMessage({ id, progress: 0.3, message: 'Transcribing speech with local Whisper…' });
    const confidence = new SpeechConfidence(), processors = new LogitsProcessorList();
    processors.push(confidence);
    const result = await teacher(audio, { max_new_tokens: 100, do_sample: false, logits_processor: processors });
    const text = result.text.trim().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    if (!/^[\x20-\x7e]{1,300}$/.test(text) || (text.match(/[a-z]+(?:'[a-z]+)?/gi)?.length ?? 0) < 3) throw new Error('Whisper could not read a clear English sentence. Speak again or use a typed reference.');
    const average = confidence.probabilities.reduce((sum, value) => sum + value, 0) / Math.max(confidence.probabilities.length, 1);
    self.postMessage({ id, result: { text, reliable: confidence.probabilities.length > 0 && average >= -1, teacher: 'Whisper base.en', average_log_probability: average } });
  } catch (error) { self.postMessage({ id, error: (error as Error).message }); }
};
