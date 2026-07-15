# deckyojp

deckyojp is a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck that takes a game screenshot, runs local Japanese OCR on it, and overlays the recognized text. Hover or tap any word to get instant Yomitan-style dictionary definitions from JMdict, so you can read and study Japanese straight from your games.

## Credits

deckyojp is built on top of these open-source projects:

- **[meikiocr](https://github.com/rtr46/meikiocr)** by rtr46 — local Japanese OCR pipeline (text detection + recognition). _Apache License 2.0._
- **[OpenCV](https://github.com/opencv/opencv-python)** (`opencv-python-headless`) — image loading and processing. _Apache License 2.0; Python packaging under the MIT License._
- **[Janome](https://github.com/mocobeta/janome)** by Tomoko Uchida — Japanese morphological analysis and tokenization. _Apache License 2.0._
- **[jamdict](https://github.com/neocl/jamdict)** by Le Tuan Anh — JMdict / KanjiDic2 dictionary lookups. _MIT License._ Dictionary data © the [Electronic Dictionary Research and Development Group (EDRDG)](https://www.edrdg.org/edrdg/licence.html), used under CC BY-SA.
- **[decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template)** by Steam Deck Homebrew — the plugin scaffold this project was built from. _BSD 3-Clause License._

Full license texts and required attribution notices are collected in the [`NOTICE`](./NOTICE) file.
