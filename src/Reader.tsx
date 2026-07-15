import { DialogButton, Focusable, Navigation } from "@decky/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeLatest,
  AnalyzeResult,
  Entry,
  getCurrentAnalysis,
  lookup,
  lookupAt,
  OcrLine,
} from "./api";

interface Popup {
  key: string;
  word: string;
  entries: Entry[];
  left: number;
  top: number;
  height: number;
  pinned: boolean;
}

function EntryView({ entry }: { entry: Entry }) {
  const head = entry.kanji.length ? entry.kanji.join("、") : entry.kana.join("、");
  const reading = entry.kanji.length ? entry.kana.join("、") : "";
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>
        {head}
        {reading && (
          <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.7, marginLeft: 8 }}>
            {reading}
          </span>
        )}
      </div>
      {entry.senses.slice(0, 6).map((s, i) => (
        <div key={i} style={{ fontSize: 13, marginTop: 3 }}>
          {s.pos.length > 0 && (
            <span style={{ opacity: 0.55, marginRight: 6 }}>{s.pos.join(", ")}</span>
          )}
          <span>{s.glosses.join("; ")}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reader() {
  const [data, setData] = useState<AnalyzeResult | null>(() => getCurrentAnalysis());
  const [popup, setPopup] = useState<Popup | null>(null);
  const [imgStatus, setImgStatus] = useState<"loading" | "loaded" | "error">("loading");
  const reqId = useRef(0);
  const lastHoverKey = useRef<string>("");
  // window.innerWidth/innerHeight are 1×1 inside Steam's route context, so we
  // measure the real rendered container instead.
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Robustness: if the panel→route hand-off didn't carry the analysis, fetch it here.
  useEffect(() => {
    if (!data) {
      analyzeLatest()
        .then((r) => setData(r))
        .catch((e) => setData({ error: String(e), width: 0, height: 0, image_b64: "", lines: [] }));
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") Navigation.NavigateBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Measure the actual rendered container (100vw×100vh) rather than window.inner*.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setBox({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const layout = useMemo(() => {
    const vw = box.w || 1280;
    const vh = box.h || 800;
    if (!data || !data.width || !data.height) {
      return { scale: 1, dispW: vw, dispH: vh, offX: 0, offY: 0 };
    }
    const scale = Math.min(vw / data.width, vh / data.height);
    const dispW = data.width * scale;
    const dispH = data.height * scale;
    return { scale, dispW, dispH, offX: (vw - dispW) / 2, offY: (vh - dispH) / 2 };
  }, [data, box]);

  if (!data) {
    return (
      <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "#0b0d12", color: "white", padding: 40, boxSizing: "border-box" }}>
        <h2>Analyzing…</h2>
        <p style={{ opacity: 0.7 }}>Running OCR on the latest screenshot.</p>
      </div>
    );
  }

  if (data.error || !data.lines.length || !data.image_b64) {
    return (
      <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "#0b0d12", color: "white", padding: 40, boxSizing: "border-box" }}>
        <h2>Nothing to show</h2>
        <p style={{ opacity: 0.8 }}>
          {data.error
            ? `Error: ${data.error}`
            : !data.lines.length
            ? "OCR found no Japanese text in the latest screenshot."
            : "No image was returned."}
        </p>
        <p style={{ opacity: 0.5, fontSize: 12 }}>
          image: {data.width}×{data.height}, {data.lines.length} lines, b64 len {data.image_b64.length}
        </p>
        <DialogButton style={{ width: 160 }} onClick={() => Navigation.NavigateBack()}>Back</DialogButton>
      </div>
    );
  }

  const { scale } = layout;

  const showHover = async (line: OcrLine, charIdx: number, bbox: number[]) => {
    if (popup?.pinned) return;
    const key = `${line.text}#${charIdx}`;
    if (key === lastHoverKey.current) return;
    lastHoverKey.current = key;
    const id = ++reqId.current;
    const res = await lookupAt(line.text.slice(charIdx));
    if (id !== reqId.current) return;
    if (!res.entries.length) {
      setPopup(null);
      return;
    }
    setPopup({
      key, word: res.matched, entries: res.entries,
      left: bbox[0] * scale, top: bbox[1] * scale, height: (bbox[3] - bbox[1]) * scale,
      pinned: false,
    });
  };

  const pinTap = async (line: OcrLine, charIdx: number, bbox: number[]) => {
    const tok = line.tokens.find((t) => charIdx >= t.start && charIdx < t.end);
    const query = tok ? tok.base : line.text[charIdx];
    const id = ++reqId.current;
    const entries = await lookup(query);
    if (id !== reqId.current) return;
    setPopup({
      key: `pin:${line.text}#${charIdx}`, word: query, entries,
      left: bbox[0] * scale, top: bbox[1] * scale, height: (bbox[3] - bbox[1]) * scale,
      pinned: true,
    });
  };

  const popupStyle = (p: Popup): React.CSSProperties => {
    const below = p.top + p.height + 8;
    const flipAbove = below + 220 > layout.dispH;
    const left = Math.max(0, Math.min(p.left, layout.dispW - 340));
    return {
      position: "absolute", left,
      top: flipAbove ? undefined : below,
      bottom: flipAbove ? layout.dispH - p.top + 8 : undefined,
      width: 330, maxHeight: 300, overflowY: "auto",
      background: "rgba(20,22,28,0.97)", border: "1px solid rgba(255,255,255,0.15)",
      borderRadius: 8, padding: "10px 12px", color: "white",
      boxShadow: "0 8px 24px rgba(0,0,0,0.6)", zIndex: 20,
    };
  };

  return (
    <div ref={rootRef} style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "#000", overflow: "hidden" }}>
      {/* screenshot + tap targets, centered full-screen */}
      <div
        style={{ position: "absolute", left: layout.offX, top: layout.offY, width: layout.dispW, height: layout.dispH }}
        onClick={() => popup?.pinned && setPopup(null)}
      >
        <img
          src={data.image_b64}
          style={{ width: "100%", height: "100%", display: "block" }}
          draggable={false}
          onLoad={() => setImgStatus("loaded")}
          onError={() => setImgStatus("error")}
        />

        {imgStatus === "error" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#f66", fontSize: 18, background: "rgba(0,0,0,0.3)" }}>
            image failed to load (b64 len {data.image_b64.length}) — CSP?
          </div>
        )}

        {data.lines.map((line, li) =>
          line.chars.map((c, ci) => {
            const b = c.bbox;
            return (
              <div
                key={`${li}-${ci}`}
                onMouseEnter={() => showHover(line, ci, b)}
                onClick={(e) => { e.stopPropagation(); pinTap(line, ci, b); }}
                style={{
                  position: "absolute",
                  left: b[0] * scale, top: b[1] * scale,
                  width: (b[2] - b[0]) * scale, height: (b[3] - b[1]) * scale,
                  cursor: "pointer",
                }}
              />
            );
          })
        )}

        {popup && (
          <Focusable style={popupStyle(popup)} onClick={(e: any) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, opacity: 0.85 }}>{popup.word}</span>
              {popup.pinned && (
                <DialogButton style={{ width: 60, minWidth: 60 }} onClick={() => setPopup(null)}>✕</DialogButton>
              )}
            </div>
            {popup.entries.length ? (
              popup.entries.map((en, i) => <EntryView key={i} entry={en} />)
            ) : (
              <div style={{ opacity: 0.6, fontSize: 13 }}>No dictionary entry.</div>
            )}
          </Focusable>
        )}
      </div>
    </div>
  );
}
