"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Flashlight, FlashlightOff, ScanLine, X } from "lucide-react";

type ScannerPhase =
  "intro" | "starting" | "scanning" | "denied" | "unavailable" | "error";

type NativeBarcode = { rawValue: string };
type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<NativeBarcode[]>;
};
type NativeBarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => NativeBarcodeDetector;

type Props = {
  title?: string;
  onClose: () => void;
  onDetected: (code: string) => void | Promise<void>;
};

const scanIntervalMs = 140;

function cameraErrorPhase(error: unknown): ScannerPhase {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "denied";
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return "unavailable";
    }
  }
  return "error";
}

function playConfirmation() {
  navigator.vibrate?.(120);
  try {
    const AudioContextClass =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.addEventListener("ended", () => void context.close(), {
      once: true,
    });
  } catch {
    // La vibración y el mensaje visible siguen confirmando el escaneo.
  }
}

export function BarcodeScanner({
  title = "Escanear código",
  onClose,
  onDetected,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastAttemptRef = useRef(0);
  const busyRef = useRef(false);
  const finishedRef = useRef(false);
  const [phase, setPhase] = useState<ScannerPhase>("intro");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const stopCamera = useCallback(() => {
    finishedRef.current = true;
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setPhase("unavailable");
      return;
    }

    setPhase("starting");
    finishedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (finishedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const capabilities =
        track?.getCapabilities?.() as MediaTrackCapabilities & {
          torch?: boolean;
        };
      setTorchAvailable(Boolean(capabilities?.torch));

      const video = videoRef.current;
      if (!video) throw new Error("VIDEO_NOT_READY");
      video.srcObject = stream;
      await video.play();
      setPhase("scanning");

      const detectorConstructor = (
        window as typeof window & {
          BarcodeDetector?: NativeBarcodeDetectorConstructor;
        }
      ).BarcodeDetector;
      let nativeDetector: NativeBarcodeDetector | null = null;
      if (detectorConstructor) {
        try {
          nativeDetector = new detectorConstructor({
            formats: ["ean_13", "code_128", "qr_code"],
          });
        } catch {
          // Algunos navegadores exponen la API pero no todas las simbologías.
          // En ese caso ZXing mantiene exactamente la misma experiencia.
        }
      }
      const zxingReader = nativeDetector
        ? null
        : new (await import("@zxing/browser")).BrowserMultiFormatReader();

      const scanFrame = async (timestamp: number) => {
        if (finishedRef.current) return;
        animationRef.current = requestAnimationFrame(scanFrame);
        if (
          busyRef.current ||
          timestamp - lastAttemptRef.current < scanIntervalMs ||
          video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return;
        }

        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d", {
          willReadFrequently: true,
        });
        if (!canvas || !context || !video.videoWidth || !video.videoHeight) {
          return;
        }

        lastAttemptRef.current = timestamp;
        busyRef.current = true;
        try {
          const cropWidth = Math.round(video.videoWidth * 0.86);
          const cropHeight = Math.round(video.videoHeight * 0.38);
          const sourceX = Math.round((video.videoWidth - cropWidth) / 2);
          const sourceY = Math.round((video.videoHeight - cropHeight) / 2);
          canvas.width = cropWidth;
          canvas.height = cropHeight;
          context.drawImage(
            video,
            sourceX,
            sourceY,
            cropWidth,
            cropHeight,
            0,
            0,
            cropWidth,
            cropHeight,
          );
          const code = nativeDetector
            ? (await nativeDetector.detect(canvas))[0]?.rawValue
            : zxingReader?.decodeFromCanvas(canvas).getText();
          const normalized = code?.trim();
          if (normalized && !finishedRef.current) {
            stopCamera();
            playConfirmation();
            await onDetected(normalized);
          }
        } catch {
          // Un cuadro sin código es normal; el siguiente se analiza enseguida.
        } finally {
          busyRef.current = false;
        }
      };

      animationRef.current = requestAnimationFrame(scanFrame);
    } catch (error) {
      stopCamera();
      finishedRef.current = false;
      setPhase(cameraErrorPhase(error));
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function close() {
    stopCamera();
    onClose();
  }

  return (
    <div className="modal-backdrop scanner-backdrop">
      <section
        className="checkout-modal scanner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-title"
      >
        <header className="modal-heading">
          <div>
            <p className="eyebrow">Cámara del dispositivo</p>
            <h2 id="scanner-title">{title}</h2>
          </div>
          <button type="button" aria-label="Cerrar cámara" onClick={close}>
            <X aria-hidden="true" />
          </button>
        </header>

        {phase === "intro" ? (
          <div className="scanner-intro">
            <span>
              <Camera aria-hidden="true" />
            </span>
            <strong>Usaremos la cámara sólo mientras escaneas</strong>
            <p>
              Apunta el código dentro del rectángulo. La imagen no se guarda ni
              se envía; el reconocimiento ocurre en este dispositivo.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={startCamera}
            >
              Activar cámara
            </button>
          </div>
        ) : null}

        {phase === "starting" ? (
          <div className="scanner-message" role="status">
            <Camera aria-hidden="true" />
            <strong>Abriendo la cámara…</strong>
            <span>Acepta el permiso cuando aparezca.</span>
          </div>
        ) : null}

        {phase === "scanning" || phase === "starting" ? (
          <div
            className={
              phase === "scanning" ? "scanner-view active" : "scanner-view"
            }
          >
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Vista de la cámara"
            />
            <div className="scanner-guide" aria-hidden="true">
              <ScanLine />
            </div>
            <canvas ref={canvasRef} aria-hidden="true" />
            {phase === "scanning" ? (
              <div className="scanner-controls">
                <span>Centra un EAN-13, CODE 128 o QR</span>
                {torchAvailable ? (
                  <button
                    type="button"
                    onClick={toggleTorch}
                    aria-pressed={torchOn}
                  >
                    {torchOn ? (
                      <FlashlightOff aria-hidden="true" />
                    ) : (
                      <Flashlight aria-hidden="true" />
                    )}
                    {torchOn ? "Apagar luz" : "Encender luz"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === "denied" ? (
          <div className="scanner-message scanner-error" role="alert">
            <Camera aria-hidden="true" />
            <strong>La cámara está bloqueada</strong>
            <span>
              En iPhone abre Ajustes → Privacidad y seguridad → Cámara. En
              Android toca el candado del navegador → Permisos → Cámara. Luego
              vuelve a intentarlo.
            </span>
            <button
              className="secondary-button"
              type="button"
              onClick={startCamera}
            >
              Volver a intentar
            </button>
          </div>
        ) : null}

        {phase === "unavailable" || phase === "error" ? (
          <div className="scanner-message scanner-error" role="alert">
            <Camera aria-hidden="true" />
            <strong>
              {phase === "unavailable"
                ? "No encontramos una cámara disponible"
                : "No fue posible abrir la cámara"}
            </strong>
            <span>
              Puedes cerrar esta ventana y escribir el código o usar el lector
              Bluetooth.
            </span>
            <button className="secondary-button" type="button" onClick={close}>
              Escribir código
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
