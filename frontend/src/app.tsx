import { useEffect, useRef, useState } from "react";
import { Camera, Circle, Copy, Mic, Settings, SlidersHorizontal, Square, UserRound, Check } from "lucide-react";
import { Button } from "./components/button/components/button";
import { Toaster } from "./components/sonner/components/sonner";
import { toast } from "sonner";
import { request, isBrowserRuntime } from "./api";
import { CalibrationSession } from "./components/calibration-session";
import { InstrumentModule } from "./components/card/components/instrument-module";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Progress } from "./components/ui/progress";
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from "./components/sidebar/components/sidebar";
import { ProfileSelect } from "./components/profile-select";

type Score = { errors: number; words: number; wer: number };
type Calibration = { baseline: Score; candidate: Score; accepted: boolean; message: string; replay_baseline?: Score; replay_candidate?: Score };
export type Profile = { id: string; name: string; samples: { id: string; text: string; frames: number }[]; calibration: Calibration | null; learning_pending?: boolean };
type Job = { id: string; kind: string; status: string; message: string; progress: number; result?: { text?: string; inference_seconds?: number; correction_id?: string } & Partial<Calibration> };

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

function sentenceKey(text: string) {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g)?.join(" ") ?? "";
}

export function App() {
  const [page, setPage] = useState("Dictate");
  const [calibrationSentences, setCalibrationSentences] = useState<string[] | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [correctionId, setCorrectionId] = useState("");
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
  useEffect(() => { if (error) toast.error(error); }, [error]);
  useEffect(() => { if (notice) toast.success(notice); }, [notice]);
  const running = job?.status === "running";
  const profile = profiles.find(item => item.id === selected);
  const distinctExamples = new Set(profile?.samples.map(sample => sentenceKey(sample.text))).size;

  useEffect(() => {
    const current = profiles.find(item => item.id === selected);
    if (current) setReference(prompts.find(sentence => !current.samples.some(sample => sentenceKey(sample.text) === sentenceKey(sentence))) ?? prompts[0]);
  }, [selected]);


  async function refresh() {
    const data = await request("/api/session");
    setCsrf(data.csrf);
    setProfiles(data.profiles);
    setReady(data.models_ready);
    if (data.auto_job) setJob(previous => previous?.status === "running" ? previous : data.auto_job);
    setSelected(previous => data.profiles.some((item: Profile) => item.id === previous) ? previous : data.profiles[0]?.id ?? "");
  }

  useEffect(() => {
    refresh().catch(error => setError(error.message));
    return () => { discard.current = true; captureGeneration.current += 1; if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => refresh().catch(error => setError(error.message)), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (video.current && stream.current && video.current.srcObject !== stream.current) video.current.srcObject = stream.current;
  }, [camera, page]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds(previous => previous + 1), 1000);
    const limit = window.setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), 6500);
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
        if (next.kind === "transcribe") { setText(next.result.text); setLatency(next.result.inference_seconds); setCorrectionId(next.result.correction_id ?? ""); }
        if (next.kind === "load") { await refresh(); setNotice("Browser model ready. Recordings and learning stay on this laptop."); }
        if (next.kind === "label") { setReference(next.result.text.slice(0, 300)); setNotice("Check this sentence, then record it silently."); }
        if (next.kind === "sample") { setTake(null); setReference(prompts.find(sentence => !next.result.samples.some((sample: Profile["samples"][number]) => sentenceKey(sample.text) === sentenceKey(sentence))) ?? prompts[0]); setNotice("Example saved. Record the next sentence when ready."); await refresh(); }
        if (next.kind === "correction") { setCorrectionId(""); setNotice("Correction saved. Local learning is queued automatically."); await refresh(); }
        if (next.kind === "train") { setNotice(next.result.message); await refresh(); }
      } catch (error) { setError((error as Error).message); setJob(null); }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, csrf]);

  async function startJob(path: string, body?: Blob | string, headers = {}) {
    setError(""); setNotice("");
    const result = await request(path, { method: "POST", body, headers: body instanceof Blob ? { "Content-Type": body.type, ...headers } : headers });
    setJob({ id: result.id, kind: "", status: "running", message: "Processing locally…", progress: 0 });
  }

  async function startCamera(audio: boolean, generation: number) {
    if (stream.current?.getVideoTracks().some(track => track.readyState === "live") && Boolean(stream.current.getAudioTracks().length) === audio) return stream.current;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null; setCamera(false);
    const media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 25, max: 30 }, facingMode: "user" }, audio });
    if (generation !== captureGeneration.current) { media.getTracks().forEach(track => track.stop()); return null; }
    stream.current = media;
    setCamera(true);
    if (video.current) { video.current.srcObject = media; await video.current.play(); }
    if (generation !== captureGeneration.current) { media.getTracks().forEach(track => track.stop()); return null; }
    return media;
  }

  async function record(kind: "silent" | "spoken") {
    if (acquiring.current || recorder.current?.state === "recording") return;
    acquiring.current = true; setStarting(true);
    const generation = ++captureGeneration.current;
    try {
      setError(""); setNotice(""); setTake(null); setCorrectionId(""); discard.current = false;
      await request("/api/activity", { method: "POST" });
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
        const blob = discard.current ? null : new Blob(chunks, { type: mime });
        chunks.length = 0;
        current.onstop = null; current.ondataavailable = null; current.onerror = null;
        if (recorder.current === current) recorder.current = null;
        if (!blob) return;
        try {
          if (kind === "spoken") await startJob("/api/label", blob);
          else if (page === "Calibration") setTake(blob);
          else await startJob(`/api/transcribe/${selected}`, blob);
        } catch (error) { setError((error as Error).message); }
      };
      current.onerror = () => { chunks.length = 0; current.ondataavailable = null; current.onstop = null; current.onerror = null; if (recorder.current === current) recorder.current = null; setError("Camera recording failed. Turn it off and try again."); setRecording(null); media.getTracks().forEach(track => track.stop()); setCamera(false); };
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

  if (calibrationSentences && profile) return <><Toaster closeButton position="bottom-right" /><CalibrationSession profile={profile} sentences={calibrationSentences} onClose={() => { setCalibrationSentences(null); refresh().catch(error => setError(error.message)); }} onComplete={() => { setCalibrationSentences(null); setPage("Dictate"); refresh().catch(error => setError(error.message)); }} /></>;

  return (
    <SidebarProvider className="app notra-workspace" defaultOpen={false} defaultWidth={248} minWidth={240} maxWidth={256}>
      <Toaster closeButton position="bottom-right" />
      <Sidebar collapsible="icon" variant="sidebar">
        <SidebarHeader><a className="wordmark" href="/" aria-label="Wisprsight home"><span className="brand-mark">W</span><span>Wisprsight</span></a></SidebarHeader>
        <SidebarContent><nav aria-label="Workspace"><SidebarMenu>{[["Dictate", Camera], ["Calibration", SlidersHorizontal], ["Settings", Settings]].map(([label, Icon]) => { const NavIcon = Icon as typeof Camera; return <SidebarMenuItem key={label as string}><SidebarMenuButton tooltip={label as string} aria-label={label as string} isActive={page === label} disabled={starting || !!recording} aria-disabled={starting || !!recording} onClick={() => { if (acquiring.current || recorder.current?.state === "recording") return; stopCamera(); setCorrectionId(""); setPage(label as string); setError(""); setNotice(""); }}><NavIcon size={17} /><span>{label as string}</span></SidebarMenuButton></SidebarMenuItem>; })}</SidebarMenu></nav></SidebarContent>
        <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton tooltip="Profiles" aria-label="Manage profiles" disabled={starting || !!recording} aria-disabled={starting || !!recording} onClick={() => { if (acquiring.current || recorder.current?.state === "recording") return; stopCamera(); setPage("Settings"); }}><UserRound size={17} /><span>Profiles</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
      </Sidebar>
      <main>
        <header className="toolbar">
          <SidebarTrigger disabled={starting || !!recording} />
          <span className="toolbar-title">{page}</span>
          <div className="toolbar-right"><span className="model-status">{ready ? "On device" : isBrowserRuntime() ? "Model not loaded" : "Models missing"}</span><ProfileSelect profiles={profiles} value={selected} disabled={starting || !!recording || !!running} onChange={value => { setSelected(value); setTake(null); setText(""); setCorrectionId(""); setLatency(null); setNotice(""); }} /></div>
        </header>
        <div className="workspace">
          <div className="page-heading"><h1>{page}</h1><p>{page === "Dictate" ? "Mouth a sentence, review your words, and copy them anywhere." : page === "Calibration" ? "Calibrate in full screen. Each sentence saves automatically, then your model trains." : "Your profiles and training data stay on this laptop."}</p></div>
          {isBrowserRuntime() && <Alert className="mb-5"><AlertDescription>Running in this browser. Profiles are stored on this device, separately from Python profiles. Browser learning adjusts word probabilities; Python mode trains the visual frontend.</AlertDescription></Alert>}
          {profile?.learning_pending && !running && <Alert><AlertDescription>{distinctExamples < 8 ? "Correction saved. Automatic learning starts once you have 8 different sentences." : "Corrections are saved. Local learning starts automatically after 30 seconds without recording. You can cancel it while it runs."}</AlertDescription></Alert>}
          {error && <Alert variant="destructive" className="mb-5"><AlertDescription>{error}</AlertDescription></Alert>}

          {!ready && <div className="install-notice"><strong>{isBrowserRuntime() ? "Load the model on this laptop" : "Install the models to begin."}</strong>{isBrowserRuntime() ? <><p>The first download is about 1 GB, and files are cached when browser storage allows. Chrome with WebGPU is required. Camera recordings stay on your laptop.</p><Button disabled={!!running} onClick={() => startJob("/api/browser/load").catch(error => setError(error.message))}>Load browser model</Button></> : <p>Run <code>uv run wisprsight download-models</code> once in the project folder, then reload this page.</p>}</div>}
          {!profiles.length && <section className="first-profile"><h2>Create a profile</h2><p>Start with the shared model. Your examples personalize it to you.</p><form onSubmit={addProfile}><label htmlFor="first-name">Profile name</label><div className="input-action"><input id="first-name" maxLength={60} value={name} onChange={event => setName(event.target.value)} required placeholder="Your name" /><Button type="submit" disabled={!name.trim() || !csrf}>Create profile</Button></div></form></section>}
          {page === "Calibration" && !showManual && <InstrumentModule eyebrow="Personal calibration" variant="panel" description="Mouth one sentence at a time. We detect the pause, save the take, and move to the next. Training starts automatically at the end." action={<Button disabled={!profile || !ready || !!running} onClick={async () => { try { await request("/api/activity", { method: "POST" }); stopCamera(); const remaining = prompts.filter(sentence => !profile?.samples.some(sample => sentenceKey(sample.text) === sentenceKey(sentence))); setCalibrationSentences((remaining.length ? remaining : prompts).slice(0, Math.max(8 - distinctExamples, 1))); } catch (error) { setError((error as Error).message); } }}>Start calibration</Button>}><Progress value={Math.min(distinctExamples / 8 * 100, 100)} aria-label="Calibration examples" /><p className="mt-3 text-sm text-muted-foreground">{distinctExamples} different sentences saved. {distinctExamples < 8 ? "We’ll complete a set of 8, then train your model." : "Initial calibration is complete. Additional sentences are optional."}</p><Button variant="ghost" size="sm" className="mt-3" onClick={() => setShowManual(true)}>Add a custom sentence instead</Button></InstrumentModule>}
          {page === "Calibration" && showManual && <section className="reference-section"><label htmlFor="reference">Reference sentence</label><textarea id="reference" rows={2} value={reference} maxLength={300} disabled={starting || !!recording || !!running} onChange={event => setReference(event.target.value)} /><div className="reference-actions"><Button variant="outline" disabled={starting || !!take || !!recording || !!running} onClick={() => setReference(prompts[(prompts.indexOf(reference) + 1) % prompts.length])}>Next suggestion</Button><Button variant="ghost" disabled={isBrowserRuntime() || starting || !ready || !profile || !!recording || !!running} onClick={() => record("spoken")}><Mic size={14} />Record spoken reference</Button></div><p className="supporting">{isBrowserRuntime() ? "Use a suggestion or type your own sentence. You can edit the words before saving." : "Use a suggestion, type your own sentence, or say one with the microphone. You can edit the words before saving."}</p></section>}
          {(page === "Dictate" || (page === "Calibration" && showManual)) && <section className="capture-area" aria-label="Camera and recording">
            <div className={camera ? "camera-preview enabled" : "camera-preview"}>
              <video ref={video} autoPlay muted playsInline hidden={!camera} aria-label="Mirrored camera preview" />
              {!camera && <Button variant="ghost" className="camera-start" disabled={starting || !ready || !profile || !!running} onClick={() => record("silent")}><Camera size={25} strokeWidth={1.5} /><strong>{starting ? "Waiting for camera permission…" : page === "Calibration" ? "Record silent take" : "Record sentence"}</strong><span>{page === "Calibration" ? "Face your camera and mouth the reference sentence." : "Face your camera and mouth a sentence without sound."}</span></Button>}
              {camera && <span className="recording-label">{recording ? `${recording === "spoken" ? "Camera + mic" : "Camera only"} · ${seconds}s` : "Camera on · mic off"}</span>}
            </div>
            <div className="capture-controls">
              {starting ? <Button variant="outline" onClick={() => { stopCamera(); setNotice("Camera request cancelled. Close the browser permission prompt to continue."); }}>Cancel camera request</Button> : recording ? <><Button onClick={() => recorder.current?.stop()}><Square size={13} fill="currentColor" />Stop recording</Button><Button variant="outline" onClick={stopCamera}>Discard</Button></> : camera ? <><Button disabled={!!running} onClick={() => record("silent")}><Circle size={13} />{page === "Calibration" ? "Record silent take" : "Record sentence"}</Button><Button variant="ghost" onClick={stopCamera}>Camera off</Button></> : <span className="capture-state">Camera off · Microphone off</span>}
              {page === "Calibration" && take && <><Button disabled={!!running || !profile} onClick={() => startJob(`/api/samples/${selected}`, take, { "x-reference": reference.replace(/\s+/g, " ").trim() }).catch(error => setError(error.message))}><Check size={14} />Save example</Button><Button variant="ghost" onClick={() => setTake(null)}>Retake</Button></>}
            </div>
          </section>}
          {running && <section className="job" role="status"><span>{job.message}</span><Button variant="ghost" onClick={() => request(`/api/jobs/${job.id}/cancel`, { method: "POST" }).then(() => setNotice("Cancellation requested. The current operation will finish safely.")).catch(error => setError(error.message))}>Cancel task</Button></section>}
          {page === "Dictate" && <section className="transcript-section"><div className="section-heading"><label htmlFor="transcript">Transcript</label>{latency !== null && <span>{latency}s inference</span>}</div><textarea id="transcript" rows={4} value={text} maxLength={10000} placeholder="Your words will appear here." onChange={event => setText(event.target.value)} /><div className="text-actions"><Button variant="outline" disabled={!text} onClick={() => navigator.clipboard.writeText(text).then(() => setNotice("Copied to clipboard.")).catch(() => setError("Clipboard access was blocked. Select and copy the text manually."))}><Copy size={14} />Copy text</Button><Button variant="ghost" disabled={!text} onClick={() => { setText(""); setCorrectionId(""); setLatency(null); setNotice(""); }}>Clear</Button><Button className="learn-action" variant="outline" disabled={!correctionId || !text.trim() || text.length > 300 || !!running} onClick={() => startJob(`/api/corrections/${selected}`, JSON.stringify({ token: correctionId, text: text.replace(/\s+/g, " ").trim() }), { "Content-Type": "application/json" }).catch(error => setError(error.message))}>Save correction</Button></div><p className="supporting">Edit mistakes and save your correction. Local learning starts automatically when idle. Unsaved takes expire after five minutes.</p></section>}
          {page === "Calibration" && <section className="examples"><div className="section-heading"><div><h2>{profile?.samples.length ?? 0} saved examples</h2><p>{distinctExamples < 8 ? `${8 - distinctExamples} more different sentences to start training. Aim for varied sentences.` : "Ready to train. Your current model stays active until a candidate improves."}</p></div><Button disabled={!profile || !ready || distinctExamples < 8 || !!running || !!recording || starting} onClick={() => startJob(`/api/train/${selected}`).catch(error => setError(error.message))}>Train locally</Button></div>{profile?.calibration && <div className="training-result"><strong>{profile.calibration.accepted ? "Personal calibration active" : "Previous model retained"}</strong><p>Word error rate: {(profile.calibration.baseline.wer * 100).toFixed(1)}% → {(profile.calibration.candidate.wer * 100).toFixed(1)}% on {profile.calibration.candidate.words} reserved words.</p><p>{profile.calibration.message}</p>{profile.calibration.replay_baseline && profile.calibration.replay_candidate && <p>Replayed training examples: {(profile.calibration.replay_baseline.wer * 100).toFixed(1)}% → {(profile.calibration.replay_candidate.wer * 100).toFixed(1)}% word error. This measures remembered examples, not new sentences.</p>}</div>}{!!profile?.samples.length && <details className="example-details"><summary>View saved sentences</summary><ol className="example-list">{profile.samples.map((sample, index) => <li key={sample.id}><span className="example-number">{index + 1}</span><span>{sample.text}</span><span className="sample-duration">{(sample.frames / 25).toFixed(1)}s</span></li>)}</ol></details>}<p className="supporting">Training uses your saved examples and corrections. Reserved sentences check whether the update helps. More examples may be needed.</p></section>}
          {page === "Settings" && <div className="settings"><section><h2>Profiles</h2><form onSubmit={addProfile}><label htmlFor="profile-name">New profile name</label><div className="input-action"><input id="profile-name" required maxLength={60} value={name} onChange={event => setName(event.target.value)} /><Button type="submit" disabled={!name.trim()}>Create profile</Button></div></form>{profiles.map(item => <div className="profile-row" key={item.id}><form className="profile-edit" onSubmit={async event => { event.preventDefault(); const name = new FormData(event.currentTarget).get("name"); try { await request(`/api/profiles/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); await refresh(); setNotice("Profile name saved."); } catch (error) { setError((error as Error).message); } }}><label htmlFor={`rename-${item.id}`}>Profile name</label><div className="input-action"><input id={`rename-${item.id}`} name="name" defaultValue={item.name} maxLength={60} required /><Button type="submit" variant="outline" disabled={!!running}>Save name</Button></div><p>{item.samples.length} saved examples</p></form><Button variant="destructive" disabled={!!running} onClick={async () => { if (!window.confirm(`Delete ${item.name}'s profile, examples and calibration from this laptop?`)) return; try { await request(`/api/profiles/${item.id}`, { method: "DELETE" }); await refresh(); } catch (error) { setError((error as Error).message); } }}>Delete profile</Button></div>)}</section><section><h2>Model and privacy</h2><p>Auto-AVSR is the pretrained lip-reading model. Browser mode adapts a small decoder token adapter using your approved examples; Python mode adapts the visual frontend. Browser decoding uses attention beam search without the external language model.</p><p>{isBrowserRuntime() ? "Approved references, encoded mouth features and personal word preferences are saved in this browser. Full video is released after processing. Unsaved correction features expire after five minutes. Clearing site data deletes your profiles." : "Dictation keeps only mouth crops temporarily for corrections. Spoken-reference audio and full-face recordings are discarded after processing. Only explicitly saved examples persist in .local/profiles."}</p><p>{isBrowserRuntime() ? "The microphone is disabled in browser mode. Type references for calibration. Recognition and learning run on this laptop." : "The microphone is used only when you choose Record spoken reference. Recognition and training run locally."}</p></section></div>}
        </div>
      </main>
    </SidebarProvider>
  );
}
