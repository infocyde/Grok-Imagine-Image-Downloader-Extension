# Grok Imagine Downloader

A Chrome extension that scans and downloads all generated images from [grok.com/imagine](https://grok.com/imagine) as a single ZIP file.

## What It Does

Grok's Imagine page uses **virtualized scrolling** — only a handful of images exist in the DOM at any given time, even if you've generated dozens or hundreds. This extension automatically scrolls through the entire page container, collecting every unique image as it appears, then bundles them all into a single `grok-images.zip` download.

It handles both image formats that Grok uses:

- **Base64 data URIs** — used for images generated in the current session (from a prompt you just submitted)
- **HTTP URLs** — used for images in the public gallery/feed

## Installation

1. Download or clone this repository into a folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the extension folder
5. The extension icon will appear in your Chrome toolbar

## Usage

1. Navigate to [grok.com/imagine](https://grok.com/imagine)
2. If you've submitted a prompt, wait for all images to finish generating
3. Click the extension icon in your toolbar
4. Click **🔍 Scan Images** — the extension will auto-scroll through the page to find all images
5. Once scanning is complete, click **⬇️ Download All**
6. A single `grok-images.zip` file will be downloaded containing all images

The **"Try full-size (no thumbnail)"** checkbox attempts to download the original resolution by stripping `_thumbnail` from HTTP image URLs. This has no effect on base64 images (which are already full resolution).

## File Structure
```
grok-image-downloader/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup.html             # Extension popup UI
├── popup.js               # Default script (images only)
├── popup_wvideo.js        # Alternate script (images + videos)
├── jszip.min.js           # JSZip library for ZIP creation
├── icon.png               # Extension icon (128x128)
└── README.md
```

## Video Support

The default `popup.js` downloads **images only**. If you want to also capture generated videos (MP4 files), swap in the alternate script:

1. Rename or back up `popup.js` → `popup_images_only.js`
2. Copy `popup_wvideo.js` → `popup.js`
3. Go to `chrome://extensions/` and click the reload button on the extension

The video-enabled version detects `<video>` elements alongside images during the scroll scan and includes them in the ZIP as `.mp4` files. Videos are shown with a blue border in the preview grid.

> **Note:** Videos can be significantly larger than images, so expect bigger ZIP files when using this version.

## Known Limitations

### Virtualized Scrolling
Grok only keeps ~9–18 images in the DOM at a time. The extension handles this by programmatically scrolling through the entire container in 200px increments, but this means scanning takes a few seconds on pages with many images.

### Edit Variants Are Not Captured
If you've edited an image multiple times (e.g., changed styles, re-prompted), Grok stores the edit history as a chain of variants. However, **only the latest version appears in the gallery view**. The edit variants (visible as thumbnails when you click into an individual post) are loaded on-demand from a separate API and are not present in the gallery DOM. The extension captures only what is displayed in the gallery — one image per generation card.

To manually save edit variants, click into the specific post on Grok to view all versions in the sidebar.

### Base64 Fingerprinting
To deduplicate base64 data URI images during the scroll scan, the extension samples characters from multiple positions in the encoded string. In rare cases with very similar images, this could theoretically miss a duplicate or treat two identical images as different.

### Session-Only Data URIs
Images generated in the current browser session use base64 data URIs. If you refresh the page, these may be replaced with HTTP URLs (or may not load at all if the generation has expired). For best results, scan and download before refreshing.

## Dependencies

- [JSZip 3.10.1](https://stuk.github.io/jszip/) — included as `jszip.min.js` for ZIP file creation

## Permissions

- `activeTab` — Access the current tab to scan for images
- `downloads` — Save the ZIP file to your downloads folder
- `scripting` — Inject the scanning script into the Grok page