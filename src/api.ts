import { callable } from "@decky/api";

// [x1, y1, x2, y2] in original image pixels
export type BBox = [number, number, number, number];

export interface Token {
  surface: string;
  base: string;
  start: number; // char offset into line.text (inclusive)
  end: number;   // char offset into line.text (exclusive)
  pos: string;
}

export interface CharBox {
  ch: string;
  bbox: BBox;
}

export interface OcrLine {
  text: string;
  is_vertical: boolean;
  bbox: BBox | null;
  chars: CharBox[];
  tokens: Token[];
}

export interface AnalyzeResult {
  width: number;
  height: number;
  image_b64: string;
  lines: OcrLine[];
  path?: string;
  error?: string;
}

export interface Sense {
  pos: string[];
  glosses: string[];
}

export interface Entry {
  kanji: string[];
  kana: string[];
  senses: Sense[];
}

export interface LookupAtResult {
  matched: string;
  entries: Entry[];
}

export interface Settings {
  screenshot_dir: string;
}

// --- backend callables ---
export const analyzeLatest = callable<[], AnalyzeResult>("analyze_latest");
export const analyzePath = callable<[path: string], AnalyzeResult>("analyze_path");
export const lookup = callable<[query: string], Entry[]>("lookup");
export const lookupAt = callable<[text: string], LookupAtResult>("lookup_at");
export const getSettings = callable<[], Settings>("get_settings");
export const setScreenshotDir = callable<[path: string], Settings>("set_screenshot_dir");

// --- tiny hand-off store between the QAM panel and the /deckyojp/reader route ---
let current: AnalyzeResult | null = null;
export const setCurrentAnalysis = (r: AnalyzeResult | null) => {
  current = r;
};
export const getCurrentAnalysis = (): AnalyzeResult | null => current;
