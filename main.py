import os
import sys
import glob
import json
import base64
import asyncio
from concurrent.futures import ThreadPoolExecutor

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky

SETTINGS_FILENAME = "settings.json"
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
# Yomitan-style hover scans at most this many characters forward from the cursor.
MAX_LOOKUP_LEN = 12
# Cap the number of JMdict entries returned per query.
MAX_ENTRIES = 10


class Plugin:
    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #
    async def _main(self):
        self.loop = asyncio.get_event_loop()
        # A single worker thread so the (thread-affine) ONNX sessions and the
        # sqlite-backed jamdict connection are always touched from one thread,
        # and OCR/lookups never block the asyncio loop / Steam UI.
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._ocr = None
        self._tokenizer = None
        self._jam = None
        self._settings = self._load_settings()
        decky.logger.info(
            "deckyojp loaded (python %s, py_modules on path: %s)",
            sys.version.split()[0],
            any(p.endswith("py_modules") for p in sys.path),
        )

    async def _unload(self):
        decky.logger.info("deckyojp unloading")
        executor = getattr(self, "_executor", None)
        if executor is not None:
            executor.shutdown(wait=False)

    async def _uninstall(self):
        decky.logger.info("deckyojp uninstalled")

    # ------------------------------------------------------------------ #
    # Settings (screenshot folder)
    # ------------------------------------------------------------------ #
    def _settings_path(self) -> str:
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, SETTINGS_FILENAME)

    def _default_screenshot_dir(self) -> str:
        home = getattr(decky, "DECKY_USER_HOME", None) or os.path.expanduser("~")
        for candidate in (os.path.join(home, "Pictures", "Screenshots"), "/tmp"):
            if os.path.isdir(candidate):
                return candidate
        return "/tmp"

    def _load_settings(self) -> dict:
        try:
            with open(self._settings_path(), "r", encoding="utf-8") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            data = {}
        if not data.get("screenshot_dir"):
            data["screenshot_dir"] = self._default_screenshot_dir()
        return data

    def _save_settings(self) -> None:
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        with open(self._settings_path(), "w", encoding="utf-8") as f:
            json.dump(self._settings, f)

    async def get_settings(self) -> dict:
        return self._settings

    async def set_screenshot_dir(self, path: str) -> dict:
        self._settings["screenshot_dir"] = path
        self._save_settings()
        return self._settings

    # ------------------------------------------------------------------ #
    # Engines (lazily constructed inside the worker thread)
    # ------------------------------------------------------------------ #
    def _ensure_engines(self) -> None:
        if self._ocr is None:
            from meikiocr import MeikiOCR
            self._ocr = MeikiOCR(provider="CPUExecutionProvider")
        if self._tokenizer is None:
            from janome.tokenizer import Tokenizer
            self._tokenizer = Tokenizer()
        if self._jam is None:
            from jamdict import Jamdict
            self._jam = Jamdict()

    # ------------------------------------------------------------------ #
    # Analyze: image path -> structured OCR + tokens
    # ------------------------------------------------------------------ #
    async def analyze_latest(self) -> dict:
        folder = self._settings.get("screenshot_dir") or self._default_screenshot_dir()
        path = self._newest_image(folder)
        if not path:
            return {"error": f"No image found in {folder}"}
        return await self.analyze_path(path)

    async def analyze_path(self, path: str) -> dict:
        return await self.loop.run_in_executor(self._executor, self._analyze_sync, path)

    def _newest_image(self, folder: str):
        files = []
        for ext in IMAGE_EXTS:
            files.extend(glob.glob(os.path.join(folder, "*" + ext)))
            files.extend(glob.glob(os.path.join(folder, "*" + ext.upper())))
        return max(files, key=os.path.getmtime) if files else None

    def _analyze_sync(self, path: str) -> dict:
        try:
            import cv2
            self._ensure_engines()
            image = cv2.imread(path, cv2.IMREAD_COLOR)
            if image is None:
                return {"error": f"Could not read image: {path}"}
            height, width = image.shape[:2]

            lines = []
            for line in self._ocr.run_ocr(image):
                text = line.get("text", "")
                if not text:
                    continue
                char_bboxes = [c["bbox"] for c in line.get("chars", [])]
                lines.append({
                    "text": text,
                    "is_vertical": bool(line.get("is_vertical", False)),
                    "bbox": self._union_bbox(char_bboxes),
                    "chars": [
                        {"ch": c["char"], "bbox": c["bbox"]}
                        for c in line.get("chars", [])
                    ],
                    "tokens": self._tokenize(text),
                })

            ok, buf = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 85])
            image_b64 = (
                "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
                if ok else ""
            )
            return {
                "width": width,
                "height": height,
                "image_b64": image_b64,
                "lines": lines,
                "path": path,
            }
        except Exception as e:  # surface as a callable error instead of crashing
            decky.logger.exception("analyze failed")
            return {"error": str(e)}

    def _tokenize(self, text: str) -> list:
        """Segment a line into tokens, recording char offsets that align 1:1
        with the line's per-character bounding boxes."""
        tokens = []
        offset = 0
        for tok in self._tokenizer.tokenize(text):
            surface = tok.surface
            start, offset = offset, offset + len(surface)
            base = tok.base_form if tok.base_form and tok.base_form != "*" else surface
            pos = tok.part_of_speech.split(",")[0] if tok.part_of_speech else ""
            tokens.append({
                "surface": surface,
                "base": base,
                "start": start,
                "end": offset,
                "pos": pos,
            })
        return tokens

    @staticmethod
    def _union_bbox(bboxes: list):
        if not bboxes:
            return None
        return [
            min(b[0] for b in bboxes),
            min(b[1] for b in bboxes),
            max(b[2] for b in bboxes),
            max(b[3] for b in bboxes),
        ]

    # ------------------------------------------------------------------ #
    # Dictionary lookup
    # ------------------------------------------------------------------ #
    async def lookup(self, query: str) -> list:
        """Exact JMdict lookup for a single string (used by tapping a token)."""
        return await self.loop.run_in_executor(self._executor, self._lookup_sync, query)

    async def lookup_at(self, text: str) -> dict:
        """Yomitan-style scan: from the hovered character, find the longest
        dictionary word (with a janome base-form deinflection fallback)."""
        return await self.loop.run_in_executor(self._executor, self._lookup_at_sync, text)

    def _lookup_sync(self, query: str) -> list:
        try:
            self._ensure_engines()
            return self._jam_entries(query)
        except Exception:
            decky.logger.exception("lookup failed")
            return []

    def _lookup_at_sync(self, text: str) -> dict:
        try:
            self._ensure_engines()
            text = (text or "")[:MAX_LOOKUP_LEN]
            # Longest exact prefix wins (like Yomitan scanning forward).
            for length in range(len(text), 0, -1):
                sub = text[:length]
                entries = self._jam_entries(sub)
                if entries:
                    return {"matched": sub, "entries": entries}
            # Fallback: deinflect the first token to its dictionary form.
            tokens = list(self._tokenizer.tokenize(text))
            if tokens:
                first = tokens[0]
                base = first.base_form if first.base_form and first.base_form != "*" else first.surface
                entries = self._jam_entries(base)
                if entries:
                    return {"matched": first.surface, "entries": entries}
            return {"matched": "", "entries": []}
        except Exception:
            decky.logger.exception("lookup_at failed")
            return {"matched": "", "entries": []}

    def _jam_entries(self, query: str, limit: int = MAX_ENTRIES) -> list:
        if not query:
            return []
        result = self._jam.lookup(query)
        entries = []
        for e in result.entries[:limit]:
            entries.append({
                "kanji": [k.text for k in e.kanji_forms],
                "kana": [k.text for k in e.kana_forms],
                "senses": [
                    {"pos": list(s.pos) if s.pos else [], "glosses": [str(g) for g in s.gloss]}
                    for s in e.senses
                ],
            })
        return entries
