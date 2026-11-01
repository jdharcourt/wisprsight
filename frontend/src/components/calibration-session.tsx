import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { Check, Camera, X, ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./button/components/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import { request, faceModelPath } from "../api";
import { mouthMotion, sentenceFinished } from "../calibration-endpoint";
import type { Profile } from "../app";

type Phase = "loading" | "ready" | "recording" | "saving" | "review" | "transition" | "training" | "complete" | "error";

export function CalibrationSession({ profile, sentences, spoken = false, onClose, onComplete }: { profile: Profile; sentences: string[]; spoken?: boolean; onClose: () => void; onComplete: () => void }) {
  const [devices, setDevices] = useState({ camera: false, microphone: false });
  const [phase, setPhase] = useState<Phase>("loading");
  const [index, setIndex] = useState(0);
  const [message, setMessage] = useState("Preparing your camera and local mouth tracking…");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ accepted: boolean; message: string } | null>(null);
  const [manual, setManual] = useState(false);
  const [trainingMode, setTrainingMode] = useState(false);
  const [audioDraft, setAudioDraft] = useState<{ text: string; visual_text: string; correction_id: string } | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [editing, setEditing] = useState(false);
  const [sentence, setSentence] = useState(sentences[0] ?? "");
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const tracker = useRef<FaceLandmarker | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const alive = useRef(true);
  const phaseRef = useRef<Phase>("loading");
  const indexRef = useRef(0);
  const sentenceRef = useRef(sentence);
  const jobId = useRef("");
  const discarded = useRef(false);
  const started = useRef(0);
  const lastMotion = useRef(0);
  const movingFrames = useRef(0);
  const previous = useRef<number[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editingRef = useRef(false);
  const manualRef = useRef(false);

  function changePhase(value: Phase) {
    phaseRef.current = value;
    if (alive.current) setPhase(value);
  }

  async function waitForJob(id: string) {
    jobId.current = id;
    while (alive.current) {
      const job = await request(`/api/jobs/${id}`);
      if (!alive.current) throw new Error("Session closed.");
      if (job.status === "done") { jobId.current = ""; return job.result; }
      if (job.status === "error" || job.status === "cancelled") throw new Error(job.message || "The operation was cancelled.");
      setMessage(job.message);
      if (typeof job.progress === "number") setProgress(job.progress * 100);
      await new Promise(resolve => setTimeout(resolve, 850));
    }
    throw new Error("Session closed.");
  }

  function releaseCamera() {
    if (timer.current) clearTimeout(timer.current);
    discarded.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    media.current?.getTracks().forEach(track => track.stop());
    media.current = null;
    if (alive.current) setDevices({ camera: false, microphone: false });
  }

  async function train() {
    setTrainingMode(true);
    changePhase("training");
    releaseCamera();
    setMessage("Your sentences are saved. Starting local training…");
    setProgress(0);
    const job = await request(`/api/train/${profile.id}`, { method: "POST" });
    const completed = await waitForJob(job.id);
    if (!alive.current) return;
    setResult(completed);
    changePhase("complete");
    toast.success("Calibration training finished", { description: completed.message });
  }

  async function save(blob: Blob | null, reference: string) {
    changePhase("saving");
    setMessage("Saving this example on your laptop…");
    if (!blob) return;
    const job = await request(spoken ? `/api/teach/${profile.id}` : `/api/samples/${profile.id}`, { method: "POST", body: blob, headers: { "Content-Type": blob.type, "x-reference": reference.replace(/\s+/g, " ").trim() } });
    blob = null;
    const saved = await waitForJob(job.id);
    if (!alive.current) return;
    if (spoken && !saved.saved) { setAudioDraft(saved); setReviewText(saved.text); setMessage("Check the audio reference before teaching the visual model."); changePhase("review"); return; }
    await advance();
  }

  async function advance() {
    setAudioDraft(null);
    changePhase("transition");
    setMessage("Saved");
    toast.success("Sentence saved", { duration: 1400 });
    await new Promise(resolve => setTimeout(resolve, 400));
    if (!alive.current) return;
    if (indexRef.current + 1 >= sentences.length) { await train(); return; }
    indexRef.current += 1;
    setIndex(indexRef.current);
    sentenceRef.current = sentences[indexRef.current];
    setSentence(sentenceRef.current);
    previous.current = null;
    changePhase("ready");
    setMessage(spoken ? "Get ready, then read this sentence aloud." : "Get ready, then mouth this sentence silently.");
    timer.current = setTimeout(() => beginRecording(), 900);
  }

  function fail(reason: unknown) {
    if (!alive.current) return;
    setError((reason as Error).name === "NotAllowedError" ? "Camera or microphone access was denied. Allow access in your browser settings, then exit and restart calibration." : (reason as Error).message || "Calibration paused. Please try this sentence again.");
    changePhase("error");
    toast.error("Calibration paused", { description: (reason as Error).message });
  }

  function finishRecording(retry = false) {
    if (recorder.current?.state !== "recording") return;
    discarded.current = retry;
    if (timer.current) clearTimeout(timer.current);
    recorder.current.stop();
  }

  function beginRecording() {
    if (!alive.current || editingRef.current || !media.current || recorder.current?.state === "recording") return;
    if (!["ready", "error"].includes(phaseRef.current)) return;
    setError("");
    discarded.current = false;
    previous.current = null;
    movingFrames.current = 0;
    started.current = performance.now();
    lastMotion.current = started.current;
    const mime = [spoken ? "video/webm;codecs=vp8,opus" : "video/webm;codecs=vp8", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) { fail(new Error("This browser cannot record a supported video format. Try Chrome.")); return; }
    const chunks: BlobPart[] = [];
    const current = new MediaRecorder(media.current, { mimeType: mime, videoBitsPerSecond: 1_000_000 });
    const reference = sentenceRef.current;
    current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    current.onstop = () => {
      const blob = discarded.current ? null : new Blob(chunks, { type: mime });
      chunks.length = 0;
      current.ondataavailable = null; current.onstop = null; current.onerror = null;
      if (recorder.current === current) recorder.current = null;
      if (!alive.current) return;
      if (!blob) { changePhase("error"); setError("No clear articulation was detected. Try the sentence again."); return; }
      save(blob, reference).catch(fail);
    };
    current.onerror = () => { chunks.length = 0; current.ondataavailable = null; current.onstop = null; current.onerror = null; recorder.current = null; fail(new Error("Camera recording failed. Retry this sentence.")); };
    recorder.current = current;
    current.start(200);
    changePhase("recording");
    setMessage(spoken ? "Read the sentence aloud. Pause naturally when you finish." : manualRef.current ? "Mouth the sentence, then choose Done." : "Mouth the sentence. Pause naturally when you finish.");
    timer.current = setTimeout(() => finishRecording(!manualRef.current && movingFrames.current < 5), 6800);
  }

  useEffect(() => {
    alive.current = true;
    let frame = 0;
    let lastCheck = 0;
    let lastVideoTime = -1;
    const activity = setInterval(() => {
      if (["ready", "recording", "transition", "review"].includes(phaseRef.current)) request("/api/activity", { method: "POST" }).catch(() => undefined);
    }, 10000);
    async function setup() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 25, max: 30 } }, audio: spoken });
      if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return; }
      media.current = stream;
      const updateDevices = () => {
        if (!alive.current) return;
        setDevices({ camera: stream.getVideoTracks().some(track => track.readyState === "live" && track.enabled && !track.muted), microphone: stream.getAudioTracks().some(track => track.readyState === "live" && track.enabled && !track.muted) });
      };
      for (const track of stream.getTracks()) for (const event of ["ended", "mute", "unmute"]) track.addEventListener(event, updateDevices);
      updateDevices();
      if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      try {
        const files = await FilesetResolver.forVisionTasks("/vision");
        const face = await FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: faceModelPath(), delegate: "CPU" }, runningMode: "VIDEO", numFaces: 2 });
        if (!alive.current) { face.close(); return; }
        tracker.current = face;
      } catch {
        manualRef.current = true;
        setManual(true);
        toast.warning("Automatic completion is unavailable", { description: "You can still record each sentence using Done." });
      }
      if (!alive.current) return;
      changePhase("ready");
      setMessage(spoken ? "Get ready, then read the sentence aloud." : "Get ready, then mouth the sentence silently.");
      timer.current = setTimeout(beginRecording, 1300);
      function check(now: number) {
        if (!alive.current) return;
        frame = requestAnimationFrame(check);
        if (!tracker.current || !video.current || video.current.readyState < 2 || now - lastCheck < 90 || video.current.currentTime === lastVideoTime) return;
        lastCheck = now;
        lastVideoTime = video.current.currentTime;
        try {
          const faces = tracker.current.detectForVideo(video.current, now).faceLandmarks;
          if (faces.length !== 1) {
            previous.current = null;
            if (phaseRef.current === "recording") setMessage(faces.length > 1 ? "Only one face should be visible." : "Keep your face in view.");
            return;
          }
          const motion = mouthMotion(previous.current, faces[0]);
          previous.current = motion.shape;
          if (phaseRef.current !== "recording") return;
          if (motion.energy > 0.012) { lastMotion.current = now; movingFrames.current += 1; }
          if (sentenceFinished(now, started.current, lastMotion.current, movingFrames.current, sentenceRef.current.split(/\s+/).length)) finishRecording();
        } catch {
          manualRef.current = true;
          setManual(true);
          tracker.current?.close(); tracker.current = null;
        }
      }
      frame = requestAnimationFrame(check);
    }
    setup().catch(fail);
    return () => {
      alive.current = false;
      clearInterval(activity);
      cancelAnimationFrame(frame);
      releaseCamera();
      tracker.current?.close(); tracker.current = null;
    };
  }, []);

  function close() {
    alive.current = false;
    releaseCamera();
    if (jobId.current) request(`/api/jobs/${jobId.current}/cancel`, { method: "POST" }).catch(() => toast.error("Could not cancel the background task. Check its status before starting another training run."));
    onClose();
  }

  return (
    <section className="calibration-session" data-phase={phase} aria-label="Full-screen calibration">
      <header className="session-header"><span>Calibration <span className="session-count">{Math.min(index + 1, sentences.length)} / {sentences.length}</span></span><Button variant="ghost" size="sm" onClick={close}><X size={15} />Exit calibration</Button></header>
      <Progress className="session-progress" value={phase === "complete" ? 100 : phase === "training" ? progress : index / sentences.length * 100} aria-label={phase === "training" ? "Training progress" : "Calibration progress"} />
      {trainingMode || phase === "complete" ? <div className="session-completion">{phase === "complete" && <div className="session-complete-icon"><Check size={28} /></div>}<h1>{phase === "complete" ? "Calibration complete" : phase === "error" ? "Training paused" : "Training your personal model"}</h1><p>{phase === "complete" ? result?.message : phase === "error" ? error : message}</p>{phase === "training" ? <Button loading>Training locally</Button> : phase === "error" ? <Button onClick={() => train().catch(fail)}>Retry training</Button> : <Button onClick={() => { onComplete(); }}><ArrowRight size={15} />Start dictating</Button>}</div> : <>
        <div className="sentence-stage"><p className="session-instruction">{spoken ? "Read this sentence aloud" : "Mouth this sentence silently"}</p><div className="sentence-slide" key={index}>{editing ? <textarea autoFocus maxLength={300} value={sentence} onChange={event => { setSentence(event.target.value); sentenceRef.current = event.target.value; }} aria-label="Edit calibration sentence" /> : <h1>{sentence}</h1>}</div><div className="session-feedback" role="status">{message}</div>
          {audioDraft && phase === "review" && <section className="reference-section"><label htmlFor="review-audio-reference">Whisper reference</label><textarea id="review-audio-reference" rows={2} maxLength={300} value={reviewText} onChange={event => setReviewText(event.target.value)} /><p>Visual prediction: {audioDraft.visual_text}</p><Button disabled={!reviewText.trim()} onClick={async () => { try { changePhase("saving"); const job = await request(`/api/corrections/${profile.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: audioDraft.correction_id, text: reviewText }) }); await waitForJob(job.id); if (alive.current) await advance(); } catch (error) { setError((error as Error).message); changePhase("review"); } }}>Save reviewed sentence</Button><Button variant="ghost" onClick={() => { setAudioDraft(null); changePhase("ready"); beginRecording(); }}>Record again</Button></section>}
          {error && <Alert variant="destructive" className="session-alert"><AlertTitle>Try this sentence again</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="session-actions">{phase === "recording" && <Button onClick={() => finishRecording()}>Done</Button>}{phase === "error" && media.current && <Button onClick={beginRecording}><RotateCcw size={14} />Retry sentence</Button>}{!["loading", "recording", "saving", "transition", "review"].includes(phase) && <Button variant="outline" onClick={() => { if (timer.current) clearTimeout(timer.current); editingRef.current = !editing; setEditing(!editing); if (editing) timer.current = setTimeout(beginRecording, 500); }}>{editing ? "Use this sentence" : "Edit sentence"}</Button>}</div>
        </div>
        <footer className="session-camera"><div className="session-preview"><video ref={video} autoPlay muted playsInline aria-label="Calibration camera preview" /></div><div><span className="session-camera-label"><Camera size={14} />{phase === "loading" && !devices.camera && !devices.microphone ? "Preparing camera permissions…" : `${devices.camera ? "Camera on" : "Camera off"} · ${devices.microphone ? "Microphone on" : "Microphone off"}`}</span><p>{manual ? "Choose Done when you finish." : "Completion is detected from mouth movement and a short pause."}</p><p>{spoken ? "Whisper labels this take. Uncertain references pause for review; usable examples save automatically." : "Examples save automatically."} Training starts after the final sentence.</p></div></footer>
      </>}
    </section>
  );
}
