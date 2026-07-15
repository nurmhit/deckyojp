import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  TextField,
  Navigation,
  staticClasses,
} from "@decky/ui";
import { definePlugin, routerHook, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { FaLanguage } from "react-icons/fa";

import {
  analyzeLatest,
  getSettings,
  setScreenshotDir,
  setCurrentAnalysis,
} from "./api";
import Reader from "./Reader";

const READER_ROUTE = "/deckyojp/reader";

function Content() {
  const [folder, setFolder] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    getSettings().then((s) => setFolder(s.screenshot_dir ?? "")).catch(() => {});
  }, []);

  const onAnalyze = async () => {
    setBusy(true);
    setStatus("Analyzing… (first run loads the OCR model)");
    try {
      const res = await analyzeLatest();
      if (res.error) {
        setStatus(res.error);
        toaster.toast({ title: "deckyojp", body: res.error });
        return;
      }
      setCurrentAnalysis(res);
      setStatus(`Found ${res.lines.length} line(s)`);
      Navigation.Navigate(READER_ROUTE);
      Navigation.CloseSideMenus();
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveFolder = async () => {
    const s = await setScreenshotDir(folder);
    setFolder(s.screenshot_dir);
    setStatus(`Screenshot folder set to ${s.screenshot_dir}`);
  };

  return (
    <PanelSection title="Japanese OCR">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={onAnalyze}>
          {busy ? "Analyzing…" : "Analyze latest screenshot"}
        </ButtonItem>
      </PanelSectionRow>

      {status && (
        <PanelSectionRow>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{status}</div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <TextField
          label="Screenshot folder"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onSaveFolder}>
          Save folder
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
  routerHook.addRoute(READER_ROUTE, Reader, { exact: true });

  return {
    name: "deckyojp",
    titleView: <div className={staticClasses.Title}>Japanese OCR</div>,
    content: <Content />,
    icon: <FaLanguage />,
    onDismount() {
      routerHook.removeRoute(READER_ROUTE);
    },
  };
});
