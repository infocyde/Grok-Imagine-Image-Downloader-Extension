let foundImages = [];

const scanBtn = document.getElementById('scanBtn');
const downloadBtn = document.getElementById('downloadBtn');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const fullSizeCheckbox = document.getElementById('fullSize');

scanBtn.addEventListener('click', async () => {
  status.textContent = 'Scanning — scrolling through page...';
  preview.innerHTML = '';
  foundImages = [];
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
          const results = Array.from(imgs).map(img => img.src).filter(Boolean);
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
              src.substring(40, 80) +
              src.substring(Math.floor(len * 0.25), Math.floor(len * 0.25) + 40) +
              src.substring(Math.floor(len * 0.5), Math.floor(len * 0.5) + 40) +
              src.substring(len - 40)
            );
          }
          return src;
        }

        function doStep() {
          const imgs = container.querySelectorAll('img[alt="Generated image"]');
          for (const img of imgs) {
            const src = img.src;
            if (!src) continue;
            const key = fingerprint(src);
            if (!collected.has(key)) {
              collected.set(key, src);
            }
          }

          if (pos >= maxScroll) {
            container.scrollTop = savedScroll;
            resolve(Array.from(collected.values()));
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

  const srcs = results[0]?.result || [];

  if (srcs.length === 0) {
    status.textContent = '⚠️ No generated images found.';
    scanBtn.disabled = false;
    return;
  }

  const useFullSize = fullSizeCheckbox.checked;

  foundImages = srcs.map((src) => {
    const type = src.startsWith('data:') ? 'data' : 'http';
    if (type === 'http' && useFullSize) {
      return { type, src: src.replace('_thumbnail', '') };
    }
    return { type, src };
  });

  const previewLimit = Math.min(srcs.length, 40);
  for (let i = 0; i < previewLimit; i++) {
    const imgEl = document.createElement('img');
    imgEl.src = srcs[i];
    preview.appendChild(imgEl);
  }
  if (srcs.length > previewLimit) {
    const more = document.createElement('div');
    more.textContent = `+${srcs.length - previewLimit} more`;
    more.style.cssText = 'color:#aaa;font-size:11px;grid-column:span 4;text-align:center;padding:4px';
    preview.appendChild(more);
  }

  const dataCount = srcs.filter((s) => s.startsWith('data:')).length;
  const httpCount = srcs.length - dataCount;
  status.textContent = `✅ Found ${srcs.length} images (${dataCount} base64, ${httpCount} URL).`;
  downloadBtn.disabled = false;
  scanBtn.disabled = false;
});

// Fetch a src (data URI or http URL) and return its raw bytes.
// Works for cross-origin http URLs because the popup is an extension page and
// imagine-public.x.ai is declared in host_permissions, which exempts the
// request from CORS (the image CDN sends no Access-Control-Allow-Origin).
async function srcToBytes(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new Uint8Array(await blob.arrayBuffer());
}

downloadBtn.addEventListener('click', async () => {
  if (foundImages.length === 0) return;

  status.textContent = `Zipping ${foundImages.length} images...`;
  downloadBtn.disabled = true;
  scanBtn.disabled = true;

  try {
    const zip = new JSZip();
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < foundImages.length; i++) {
      const img = foundImages[i];
      const filename = `grok-imagine-${String(i + 1).padStart(3, '0')}.jpg`;

      try {
        const bytes = await srcToBytes(img.src);
        zip.file(filename, bytes);
        completed++;
      } catch (e) {
        failed++;
        console.error('Failed to add image:', img.src, e);
      }

      status.textContent = `Zipping ${completed}/${foundImages.length}${failed ? ` (${failed} failed)` : ''}...`;
    }

    if (completed === 0) {
      status.textContent = `❌ No images could be fetched (${failed} failed).`;
      downloadBtn.disabled = false;
      scanBtn.disabled = false;
      return;
    }

    status.textContent = `Generating ZIP file...`;

    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      (metadata) => {
        status.textContent = `Generating ZIP... ${Math.round(metadata.percent)}%`;
      }
    );

    const blobUrl = URL.createObjectURL(zipBlob);
    const sizeMB = (zipBlob.size / (1024 * 1024)).toFixed(1);

    await chrome.downloads.download({
      url: blobUrl,
      filename: `grok-images.zip`,
      conflictAction: 'uniquify',
    });

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    status.textContent = `✅ Done! ${completed} images zipped (${sizeMB} MB)${failed ? `, ${failed} failed` : ''}.`;
  } catch (e) {
    status.textContent = `❌ ZIP creation failed: ${e.message}`;
    console.error(e);
  }

  downloadBtn.disabled = false;
  scanBtn.disabled = false;
});