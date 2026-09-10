import { useRef, useState } from "react";
import { validateAudioFile } from "../../utils/validation.js";
import { computeSHA256 } from "../../utils/hashing.js";

/**
 * FileUploader component for the host to select and validate audio files.
 */
export default function FileUploader({ isHost, onFileReady, disabled }) {
  const fileInputRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);

    // 1. Validation
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      setError(validation.error);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setProcessing(true);

    try {
      // 2. Read duration using HTMLAudioElement
      const audioUrl = URL.createObjectURL(file);
      const audio = new Audio();
      audio.src = audioUrl;

      const duration = await new Promise((resolve) => {
        audio.onloadedmetadata = () => resolve(audio.duration || 0);
        audio.onerror = () => resolve(0);
        // Fallback timeout
        setTimeout(() => resolve(0), 3000);
      });

      // 3. Compute SHA-256
      const arrayBuffer = await file.arrayBuffer();
      const sha256 = await computeSHA256(arrayBuffer);

      const track = {
        fileName: file.name,
        mimeType: file.type || "audio/mpeg",
        size: file.size,
        sha256,
        duration,
      };

      onFileReady({ file, track, localAudioUrl: audioUrl });
    } catch (err) {
      console.error("[FileUploader] Failed to process audio file:", err);
      setError("Failed to process audio file. Please try another file.");
    } finally {
      setProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!isHost) return null;

  return (
    <div className="file-uploader">
      <input
        ref={fileInputRef}
        type="file"
        id="audio-file-input"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm"
        style={{ display: "none" }}
        onChange={handleFileChange}
        disabled={disabled || processing}
      />

      <button
        id="upload-audio-btn"
        className="btn btn-primary"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || processing}
      >
        {processing ? (
          <>
            <span className="spinner" /> Analyzing Audio…
          </>
        ) : (
          <>📁 Select Audio File</>
        )}
      </button>

      {error && <div className="uploader-error">⚠ {error}</div>}

      <style>{`
        .file-uploader {
          margin-top: 12px;
        }

        .uploader-error {
          color: var(--color-error);
          font-size: 0.8rem;
          margin-top: 8px;
        }

        .spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 0.6s linear infinite;
          margin-right: 6px;
          vertical-align: middle;
        }
      `}</style>
    </div>
  );
}
