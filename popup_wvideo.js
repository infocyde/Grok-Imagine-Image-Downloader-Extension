let foundMedia = [];

const scanBtn = document.getElementById('scanBtn');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const fullSizeCheckbox = document.getElementById('fullSize');

scanBtn.addEventListener('click', async () => {
  status.textContent = 'Scanning — scrolling through page...';
  preview.innerHTML = '';
  foundMedia = [];
  downloadBtn.disabled = true;
  scanBtn.disabled = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('grok.com')) {
    status.textContent = '❌ Not on grok.com — navigate to grok.com/imagine first.';
    scanBtn.disabled = false;
    return;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return new Promise((resolve) => {
        const allEls = document.querySelectorAll('*');
        let container = null;
        for (const el of allEls) {
          if (
            el.scrollHeight > el.clientHeight + 100 &&
            el.clientHeight > 100 &&
            el.querySelectorAll('img[alt="Generated image"]').length > 0
          ) {
            container = el;
          }
        }

        if (!container) {
          const imgs = document.querySelectorAll('img[alt="Generated image"]');
          const results = Array.from(imgs).map(img => ({
            kind: 'image',
            src: img.src,
          })).filter(m => m.src);
          resolve(results);
          return;
        }

        const savedScroll = container.scrollTop;
        const maxScroll = container.scrollHeight - container.clientHeight;
        const collected = new Map();
        let pos = 0;
        const step = 200;

        function fingerprint(src) {
          if (src.startsWith('data:')) {
            const len = src.length;
            return (
              'data:' + len + ':' +
              src.substring(40, 80) +
              src.substring(Math.floor(len * 0.25), Math.floor(len * 0.25) + 40) +
              src.substring(Math.floor(len * 0.5), Math.floor(len * 0.5) + 40) +
              src.substring(len - 40)
            );
          }
          return src;
        }

        function doStep() {
          // Collect images
          const imgs = container.querySelectorAll('img[alt="Generated image"]');
          for (const img of imgs) {
            const src = img.src;
            if (!src) continue;
            const key = fingerprint(src);
            if (!collected.has(key)) {
              // Check if this image has a sibling video element
              const parentDiv = img.closest('div');
              const siblingVideo = parentDiv ? parentDiv.querySelector('video') : null;
              if (siblingVideo && siblingVideo.src) {
                // This is a video — store the video src and the image as poster
                const videoKey = siblingVideo.src;
                if (!collected.has(videoKey)) {
                  collected.set(videoKey, {
                    kind: 'video',
                    src: siblingVideo.src,
                    poster: src,
                  });
                }
                // Also mark the image key so we don't add it as a standalone image
                collected.set(key, null);
              } else {
                collected.set(key, {
                  kind: 'image',
                  src: src,
                });
              }
            }
          }

          // Also directly scan for video elements in case they don't have sibling imgs
          const videos = container.querySelectorAll('video');
          for (const video of videos) {
            const src = video.src;
            if (!src) continue;
            if (!collected.has(src)) {
              collected.set(src, {
                kind: 'video',
                src: src,
                poster: video.poster || null,
              });
            }
          }

          if (pos >= maxScroll) {
            container.scrollTop = savedScroll;
            const results = Array.from(collected.values()).filter(Boolean);
            resolve(results);
            return;
          }

          pos += step;
          container.scrollTop = pos;
          setTimeout(doStep, 120);
        }

        doStep();
      });
    },
  });

  const media = results[0]?.result || [];

  if (media.length === 0) {
    status.textContent = '⚠️ No generated media found.';
    scanBtn.disabled = false;
    return;
  }

  const useFullSize = fullSizeCheckbox.checked;

  foundMedia = media.map((item) => {
    if (item.kind === 'image' && item.src.startsWith('http') && useFullSize) {
      return { ...item, src: item.src.replace('_thumbnail', '') };
    }
    return item;
  });

  // Show preview thumbnails
  const images = foundMedia.filter(m => m.kind === 'image');
  const videos = foundMedia.filter(m => m.kind === 'video');

  const previewLimit = Math.min(foundMedia.length, 40);
  let shown = 0;
  for (const item of foundMedia) {
    if (shown >= previewLimit) break;
    const imgEl = document.createElement('img');
    imgEl.src = item.kind === 'video' ? (item.poster || '') : item.src;
    if (item.kind === 'video') {
      imgEl.style.border = '2px solid #00d4ff';
      imgEl.title = 'Video';
    }
    preview.appendChild(imgEl);
    shown++;
  }
  if (foundMedia.length > previewLimit) {
    const more = document.createElement('div');
    more.textContent = `+${foundMedia.length - previewLimit} more`;
    more.style.cssText = 'color:#aaa;font-size:11px;grid-column:span 4;text-align:center;padding:4px';
    preview.appendChild(more);
  }

  status.textContent = `✅ Found ${images.length} images + ${videos.length} videos (${foundMedia.length} total).`;
  downloadBtn.disabled = false;
  scanBtn.disabled = false;
});

async function downloadMedia(item, filename) {
  if (item.src.startsWith('data:')) {
    const response = await fetch(item.src);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      await chrome.downloads.download({
        url: blobUrl,
        filename,
        conflictAction: 'uniquify',
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
  } else {
    await chrome.downloads.download({
      url: item.src,
      filename,
      conflictAction: 'uniquify',
    });
  }
}

downloadBtn.addEventListener('click', async () => {
  if (foundMedia.length === 0) return;

  status.textContent = `Downloading ${foundMedia.length} files...`;
  downloadBtn.disabled = true;
  scanBtn.disabled = true;

  let completed = 0;
  let failed = 0;

  for (let i = 0; i < foundMedia.length; i++) {
    const item = foundMedia[i];
    const ext = item.kind === 'video' ? 'mp4' : 'jpg';
    const filename = `grok-imagine-${String(i + 1).padStart(3, '0')}.${ext}`;

    try {
      await downloadMedia(item, filename);
      completed++;
    } catch (e) {
      failed++;
      console.error('Failed to download file:', item.src, e);
    }

    status.textContent = `Downloading ${completed}/${foundMedia.length}${failed ? ` (${failed} failed)` : ''}...`;
  }

  status.textContent = `✅ Download requested for ${completed} files${failed ? `, ${failed} failed` : ''}.`;
  downloadBtn.disabled = false;
  scanBtn.disabled = false;
});