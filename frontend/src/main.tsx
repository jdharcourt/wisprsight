import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { Camera, Circle, Copy, Mic, Settings, SlidersHorizontal, Square, Video, X } from "lucide-react";
import { Button } from "./components/button";
import "./style.css";

type Score = { errors: number; words: number; wer: number };
type Calibration = { baseline: Score; candidate: Score; accepted: boolean; message: string };
type Profile = { id: string; name: string; samples: { id: string; text: string; frames: number }[]; calibration: Calibration | null };
type Job = { id: string; kind: string; status: string; message: string; progress: number; result?: { text?: string; inference_seconds?: number } & Partial<Calibration> };

const prompts = [
  "I would like to write a short message to my friend",
  "Please remember to bring the green notebook home this evening",
  "We should take a walk after lunch if the weather improves",
  "Can you help me find the document from our last meeting",
  "There is a small coffee shop at the end of this street",
  "I think we need a little more time to finish this work",
  "The next train leaves from the station at half past five",
  "Let us move our conversation to tomorrow morning after breakfast",
  "My favorite part of the day is reading before I sleep",
  "I will send you the revised version later this afternoon",
  "Could you please close the window before you leave the room",
  "We have enough food for everyone who is coming to dinner",
  "I am trying something new and learning a little every day",
  "The book you recommended was much better than I expected",
  "Please put the keys on the kitchen table by the door",
  "It would be nice to visit the coast sometime next month",
  "I cannot remember where I saved the notes from yesterday",
  "We can talk about the details when we see each other",
  "This is the first time I have tried writing without speaking",
  "I need to check my calendar before I make any plans",
  "The light in this room is much brighter in the morning",
  "Thank you for taking the time to explain how that works",
  "I would rather keep the original version of that paragraph",
  "Let me know when you are ready to start the next task",
  "We are going to need a different approach to this problem",
  "I have been looking forward to seeing you again all week",
  "There should be a clean cup in the cupboard above the sink",
  "Please tell me if there is anything else you need from me",
  "I will be back in a few minutes with something to drink",
  "Everything we need for the trip is already in the car",
];

function App() {
  const [page, setPage] = useState("Dictate");
  const [csrf, setCsrf] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [reference, setReference] = useState(prompts[0]);
  const [recording, setRecording] = useState<"silent" | "spoken" | null>(null);
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const acquiring = useRef(false);
  const captureGeneration = useRef(0);
  const [take, setTake] = useState<Blob | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  const running = job?.status === "running";
  const profile = profiles.find(item => item.id === selected);

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(path, { ...options, headers: { "x-csrf-token": csrf, ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Check the supplied values and try again.");
    return data;
  }

  async function refresh() {
    const response = await fetch("/api/session");
    if (!response.ok) throw new Error("Cannot connect to the local app. Reload this page.");
    const data = await response.json();
    setCsrf(data.csrf);
    setProfiles(data.profiles);
    setReady(data.models_ready);
    setSelected(previous => data.profiles.some((item: Profile) => item.id === previous) ? previous : data.profiles[0]?.id ?? "");
  }

  useEffect(() => {
    refresh().catch(error => setError(error.message));
    return () => { captureGeneration.current += 1; stream.current?.getTracks().forEach(track => track.stop()); };
  }, []);

  useEffect(() => {
    if (video.current && stream.current) video.current.srcObject = stream.current;
  }, [camera, page]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(previous => previous + 1), 1000);
    const limit = window.setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), page === "Calibration" ? 6500 : 11500);
    return () => { window.clearInterval(timer); window.clearTimeout(limit); };
  }, [recording]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await request(`/api/jobs/${job.id}`);
        setJob(next);
        if (next.status === "error") setError(next.message);
        if (next.status !== "done") return;
        if (next.kind === "transcribe") { setText(next.result.text); setLatency(next.result.inference_seconds); }
        if (next.kind === "label") { setReference(next.result.text.slice(0, 300)); setNotice("Check this sentence, then record it silently."); }
        if (next.kind === "sample") { setTake(null); setNotice("Example saved on this laptop."); await refresh(); }
        if (next.kind === "train") { setNotice(next.result.message); await refresh(); }
      } catch (error) { setError((error as Error).message); setJob(null); }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, csrf]);

  async function startJob(path: string, body?: Blob, headers = {}) {
    setError(""); setNotice("");
    const result = await request(path, { method: "POST", body, headers: body ? { "Content-Type": body.type, ...headers } : headers });
    setJob({ id: result.id, kind: "", status: "running", message: "Processing locally…", progress: 0 });
  }

  async function startCamera(audio: boolean, generation: number) {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null; setCamera(false);
    const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 25, max: 30 }, facingMode: "user" }, audio });
    if (generation !== captureGeneration.current) { media.getTracks().forEach(track => track.stop()); return null; }
    stream.current = media;
    if (video.current) video.current.srcObject = media;
    setCamera(true);
    return media;
  }

  async function record(kind: "silent" | "spoken") {
    if (acquiring.current || recorder.current?.state === "recording") return;
    acquiring.current = true; setStarting(true);
    const generation = ++captureGeneration.current;
    try {
      setError(""); setNotice(""); setTake(null); discard.current = false;
      const media = await startCamera(kind === "spoken", generation);
      if (!media) return;
      const mime = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("This browser cannot record a supported format. Try Chrome or Safari.");
      const chunks: BlobPart[] = [];
      const current = new MediaRecorder(media, { mimeType: mime, videoBitsPerSecond: 1_000_000 });
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onstop = async () => {
        setRecording(null);
        media.getAudioTracks().forEach(track => { track.stop(); media.removeTrack(track); });
        if (discard.current) return;
        const blob = new Blob(chunks, { type: mime });
        try {
          if (kind === "spoken") await startJob("/api/label", blob);
          else if (page === "Calibration") setTake(blob);
          else await startJob(`/api/transcribe/${selected}`, blob);
        } catch (error) { setError((error as Error).message); }
      };
      current.onerror = () => { setError("Camera recording failed. Turn it off and try again."); setRecording(null); media.getTracks().forEach(track => track.stop()); setCamera(false); };
      recorder.current = current;
      current.start(250); setSeconds(0); setRecording(kind);
    } catch (error) {
      if (generation !== captureGeneration.current) return;
      stream.current?.getTracks().forEach(track => track.stop()); setCamera(false);
      setError((error as Error).name === "NotAllowedError" ? "Camera or microphone access was denied. Allow access in your browser settings, then try again." : (error as Error).message);
    } finally { acquiring.current = false; setStarting(false); }
  }

  function stopCamera() {
    captureGeneration.current += 1;
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    setRecording(null); setCamera(false); setTake(null);
  }

  async function addProfile(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await request("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      await refresh(); setSelected(result.id); setName(""); setPage("Calibration"); setNotice("Your profile starts with the shared pretrained model.");
    } catch (error) { setError((error as Error).message); }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="wordmark" href="/" aria-label="Wisprsight home"><span className="brand-mark"><Video size={18} /></span>Wisprsight</a>
        <div className="profile-picker"><label htmlFor="profile">Your profile</label><select id="profile" value={selected} disabled={starting || !!recording || !!running} onChange={event => { setSelected(event.target.value); setTake(null); setText(""); setLatency(null); setNotice(""); }}><option value="" disabled>Select a profile</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <nav aria-label="Workspace">{[["Dictate", Camera], ["Calibration", SlidersHorizontal], ["Settings", Settings]].map(([label, Icon]) => { const NavIcon = Icon as typeof Camera; return <button key={label as string} className={page === label ? "nav-item active" : "nav-item"} disabled={starting || !!recording} aria-current={page === label ? "page" : undefined} onClick={() => { stopCamera(); setPage(label as string); setError(""); setNotice(""); }}><NavIcon size={17} />{label as string}</button>; })}</nav>
        <div className="sidebar-footer"><span className="local-status"><span className="status-dot" />Runs on your laptop</span><p>Camera-only dictation.<br />Your words stay here.</p><span className="version">Research preview · 0.1</span></div>
      </aside>
      <main>
        <header className="toolbar"><span>{page}</span><span className="model-status"><span className={ready ? "status-dot" : "status-dot pending"} />{ready ? "Local models installed" : "Models not installed"}</span></header>
        <div className="workspace">
          <div className="page-heading"><div><h1>{page}</h1><p>{page === "Dictate" ? "Face your camera, mouth a sentence, then review your words." : page === "Calibration" ? "Record examples to adapt the shared model to your speech." : "Manage your local profiles and model installation."}</p></div></div>
          {error && <div className="message error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div className="message" role="status">{notice}</div>}
          {!ready && <div className="install-notice"><strong>Install the local models to begin.</strong><p>In the project folder, run <code>uv run wisprsight download-models</code>. The first download requires internet; recognition works offline afterwards.</p></div>}
          {!profiles.length && <section className="first-profile"><h2>Create your first profile</h2><p>Everyone begins with the same pretrained model. Calibration stays separate for each person.</p><form onSubmit={addProfile}><label htmlFor="first-name">Profile name</label><div className="input-action"><input id="first-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} required placeholder="Your name" /><Button type="submit" disabled={!name.trim() || !csrf}>Create profile</Button></div></form></section>}
          {page !== "Settings" && <div className="dictation-layout">
            <section className="capture-area" aria-label="Camera and recording">
              <div className="section-heading"><h2>Your camera</h2><span>{recording ? `${recording === "spoken" ? "Camera + mic" : "Camera only"} · ${seconds}s` : camera ? "Camera on · mic off" : "Camera off"}</span></div>
              <div className="camera-preview">{camera ? <video ref={video} autoPlay muted playsInline aria-label="Mirrored camera preview" /> : <><video ref={video} autoPlay muted playsInline hidden /><div className="camera-empty"><Camera size={32} strokeWidth={1.3} /><strong>Ready when you are</strong><p>Your camera starts only when you choose.</p></div></>}{recording && <span className="recording-label"><Circle size={10} fill="currentColor" />Recording {recording === "spoken" ? "with microphone" : "silently"}</span>}</div>
              <div className="capture-controls">{starting ? <><Button disabled>Waiting for camera permission…</Button><Button variant="outline" onClick={() => { stopCamera(); setNotice("Camera request cancelled. Close the browser permission prompt to continue."); }}>Cancel camera request</Button></> : recording ? <><Button onClick={() => recorder.current?.stop()}><Square size={14} fill="currentColor" />Stop recording</Button><Button variant="outline" onClick={stopCamera}>Discard</Button></> : <><Button disabled={starting || !ready || !profile || !!running} onClick={() => record("silent")}><Circle size={15} />{page === "Calibration" ? "Record silent take" : "Record sentence"}</Button>{camera && <Button variant="outline" onClick={stopCamera}>Camera off</Button>}</>}</div>
              <p className="capture-hint">{page === "Calibration" ? "Mouth the reference sentence without sound. Keep each take under seven seconds." : "Move your lips naturally. Keep sentences under twelve seconds."}</p>
              {page === "Calibration" && <div className="spoken-label"><Mic size={18} /><div><strong>Use your own sentences</strong><p>Say a sentence with the mic on. Review the local transcript, then record a silent take.</p><Button variant="outline" disabled={starting || !ready || !profile || !!recording || !!running} onClick={() => record("spoken")}>Record spoken reference</Button></div></div>}
            </section>
            <section className="text-area" aria-label={page === "Calibration" ? "Calibration sentence" : "Transcription"}>
              <div className="section-heading"><h2>{page === "Calibration" ? "Reference sentence" : "Your words"}</h2><span>{page === "Calibration" ? `${profile?.samples.length ?? 0} examples saved` : "Editable transcript"}</span></div>
              {page === "Calibration" ? <><label className="visually-hidden" htmlFor="reference">Reference sentence</label><textarea id="reference" value={reference} maxLength={300} disabled={starting || !!take || !!recording || !!running} onChange={event => setReference(event.target.value)} /><div className="text-actions"><Button variant="outline" disabled={starting || !!take || !!recording || !!running} onClick={() => setReference(prompts[(prompts.indexOf(reference) + 1) % prompts.length])}>Next suggestion</Button><Button disabled={!take || !!running || !profile} onClick={() => startJob(`/api/samples/${selected}`, take!, { "x-reference": reference }).catch(error => setError(error.message))}>Save example</Button>{take && <Button variant="ghost" onClick={() => setTake(null)}>Retake</Button>}</div><p className="supporting">{take ? "Silent take captured. Save it to add this example to your profile." : "Check the words before recording. Silent takes are saved only when you choose Save example."}</p></> : <><label className="visually-hidden" htmlFor="transcript">Editable transcription</label><textarea id="transcript" value={text} maxLength={10000} placeholder="Your transcription will appear here." onChange={event => setText(event.target.value)} /><div className="text-actions"><Button variant="outline" disabled={!text} onClick={() => navigator.clipboard.writeText(text).then(() => setNotice("Copied to clipboard.")).catch(() => setError("Clipboard access was blocked. Select the text and copy it manually."))}><Copy size={15} />Copy text</Button><Button variant="ghost" disabled={!text} onClick={() => { setText(""); setLatency(null); setNotice(""); }}>Clear</Button>{latency !== null && <span className="timing">Inference: {latency}s</span>}</div><p className="supporting">Lip-reading can miss words. Review the transcript before using it.</p></>}
              <div className="profile-note"><h3>{profile ? profile.name : "No profile selected"}</h3><p>{profile?.calibration?.accepted ? "Personal calibration active." : "Shared pretrained model. Add examples to calibrate it to you."}</p></div>
            </section>
          </div>}
          {running && <section className="job" role="status"><div><strong>{job.message}</strong><p>You can leave the camera off while this task runs.</p></div><Button variant="outline" onClick={() => request(`/api/jobs/${job.id}/cancel`, { method: "POST" }).then(() => setNotice("Cancellation requested. The current operation will finish safely.")).catch(error => setError(error.message))}>Cancel task</Button></section>}
          {page === "Calibration" && <section className="examples"><div className="section-heading"><div><h2>Train your profile</h2><p>Save at least 18 different sentences. Some are reserved for checking the result.</p></div><Button disabled={!profile || (profile.samples.length < 18) || !!running || !!recording} onClick={() => startJob(`/api/train/${selected}`).catch(error => setError(error.message))}>Train locally</Button></div>{profile?.calibration && <div className="training-result"><strong>{profile.calibration.accepted ? "Personal calibration activated" : "Previous model retained"}</strong><p>Validation word error rate: {(profile.calibration.baseline.wer * 100).toFixed(1)}% → {(profile.calibration.candidate.wer * 100).toFixed(1)}% across {profile.calibration.candidate.words} reference words.</p><p>{profile.calibration.message}</p></div>}{profile?.samples.length ? <ol className="example-list">{profile.samples.map((sample, index) => <li key={sample.id}><span className="example-number">{index + 1}</span><span>{sample.text}</span><span className="sample-duration">{(sample.frames / 25).toFixed(1)}s</span></li>)}</ol> : <div className="empty-examples">No examples yet. Record your first silent take above.</div>}<p className="supporting">Aim for 30–50 varied sentences. A candidate needs at least 60 validation words and a clear improvement to replace your current model.</p></section>}
          {page === "Settings" && <div className="settings"><section><h2>Local profiles</h2><p>Each person has separate examples and calibration weights on this laptop.</p><form onSubmit={addProfile}><label htmlFor="profile-name">New profile name</label><div className="input-action"><input id="profile-name" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /><Button type="submit" disabled={!name.trim()}>Create profile</Button></div></form>{profiles.map(item => <div className="profile-row" key={item.id}><form className="profile-edit" onSubmit={async event => { event.preventDefault(); const name = new FormData(event.currentTarget).get("name"); try { await request(`/api/profiles/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); await refresh(); setNotice("Profile name saved."); } catch (error) { setError((error as Error).message); } }}><label htmlFor={`rename-${item.id}`}>Profile name</label><div className="input-action"><input id={`rename-${item.id}`} name="name" defaultValue={item.name} maxLength={60} required /><Button type="submit" variant="outline" disabled={!!running}>Save name</Button></div><p>{item.samples.length} saved examples</p></form><Button variant="danger" disabled={!!running} onClick={async () => { if (!window.confirm(`Delete ${item.name}'s profile, examples and calibration from this laptop?`)) return; try { await request(`/api/profiles/${item.id}`, { method: "DELETE" }); await refresh(); } catch (error) { setError((error as Error).message); } }}>Delete profile</Button></div>)}</section><section><h2>Privacy and storage</h2><p>Ordinary dictation is discarded after inference. Calibration saves mouth crops and approved labels only. Spoken-reference audio is discarded after local transcription.</p><p>Data is stored in the project's <code>.local/profiles</code> folder, separate from shared models. Deleting a profile removes its saved examples and personal weights.</p><p>The research model can make substantial errors. No commercial model license or accuracy guarantee is implied.</p></section></div>}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
