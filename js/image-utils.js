// Resize and compress images in the browser (no Firebase Storage needed).
// The result is a data URL that is small enough to store inside ONE
// Firestore document (the hard limit for a document is 1 MB).

const DEFAULTS = {
  maxSize: 1200,            // longest side in pixels
  targetBytes: 300 * 1024,  // aim for under 300 KB
  hardLimitBytes: 650 * 1024, // never save anything bigger than this
  keepTransparency: false   // true for logos (WebP keeps transparency)
};

let webpSupport = null;
export function supportsWebP() {
  if (webpSupport === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupport;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`"${file.name}" could not be opened as an image. Please use a JPG, PNG or WebP photo.`));
    };
    img.src = url;
  });
}

/** Size in bytes of the binary data inside a base64 data URL. */
export function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compress an image File.
 * @returns {Promise<{dataUrl:string, bytes:number, width:number, height:number, mime:string, originalBytes:number}>}
 */
export async function compressImage(file, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Please choose an image file (JPG, PNG or WebP).");
  }
  const img = await loadImage(file);
  const mime = supportsWebP() ? "image/webp" : "image/jpeg";
  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  let scale = Math.min(1, opt.maxSize / longest);
  let best = null;

  for (let round = 0; round < 6; round++) {
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (mime === "image/jpeg" || !opt.keepTransparency) {
      ctx.fillStyle = "#ffffff"; // JPEG has no transparency
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
      const dataUrl = canvas.toDataURL(mime, quality);
      const bytes = dataUrlBytes(dataUrl);
      if (!best || bytes < best.bytes) {
        best = { dataUrl, bytes, width, height, mime, originalBytes: file.size };
      }
      if (bytes <= opt.targetBytes) return best;
    }
    scale *= 0.8; // still too big – make it smaller and try again
  }

  if (best && best.bytes <= opt.hardLimitBytes) return best;
  throw new Error("This image is too large even after compression. Please try a different photo.");
}
