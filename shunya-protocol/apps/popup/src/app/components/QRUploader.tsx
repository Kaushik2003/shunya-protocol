'use client';
import { useRef } from 'react';
import jsQR from 'jsqr';

interface Props {
  onDecoded: (bytes: Uint8Array) => void;
  onError:   (msg: string) => void;
}

export function QRUploader({ onDecoded, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    try {
      if (file.type === 'application/pdf') {
        await handlePdf(file);
      } else {
        await handleImage(file);
      }
    } catch (err: any) {
      onError(err.message ?? 'Failed to decode QR');
    }
  }

  async function handleImage(file: File) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width  = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (!code) throw new Error('No QR code found in image');
    const bytes = Uint8Array.from(code.data, (c) => c.charCodeAt(0) & 0xff);
    onDecoded(bytes);
  }

  async function handlePdf(file: File) {
    const pdfjsLib = await import('pdfjs-dist');
    // Must configure worker source before first use.
    // Points to the matching versioned worker on unpkg CDN.
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }
    const { getDocument } = pdfjsLib;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: arrayBuffer }).promise;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page   = await pdf.getPage(p);
      const vp     = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width  = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        const bytes = Uint8Array.from(code.data, (c) => c.charCodeAt(0) & 0xff);
        onDecoded(bytes);
        return;
      }
    }
    throw new Error('No QR code found in PDF');
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        style={{
          width: '100%', padding: '2rem', border: '2px dashed #d1d5db',
          borderRadius: '8px', background: 'none', cursor: 'pointer',
          color: '#6b7280', fontSize: '0.9rem',
        }}
      >
        Click to upload Aadhaar QR image or PDF
      </button>
    </div>
  );
}
