"use client";

import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const films = [2, 3, 1, 4, 5];

/** Only the visible film is fetched. Reduced motion/data saving starts with a poster. */
export function CampaignFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [allowed, setAllowed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const id = String(films[index]).padStart(2, "0");

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    const apply = () =>
      setAllowed(!media.matches && !connection?.saveData && navigator.onLine);
    apply();
    media.addEventListener("change", apply);
    window.addEventListener("offline", apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("offline", apply);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !allowed) return;
    video.play().catch(() => setPlaying(false));
    const visibility = () => {
      if (document.hidden) video.pause();
      else video.play().catch(() => setPlaying(false));
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [allowed, index]);

  function move(direction: number) {
    setFailed(false);
    setIndex((current) => (current + direction + films.length) % films.length);
  }

  return (
    <>
      {/* Source files have no audio streams; muted and playsInline also satisfy mobile autoplay. */}
      <video
        key={id}
        ref={videoRef}
        className="mi-film"
        muted
        playsInline
        loop
        poster={`/mi-media/campaign-${id}.jpg`}
        preload="none"
        src={allowed ? `/mi-media/campaign-${id}.mp4` : undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
        aria-hidden="true"
      />
      <div className="mi-film-controls" aria-label="Videos de Vaquero SM">
        <div className="mi-film-pagination">
          <button
            type="button"
            className="mi-icon-button"
            onClick={() => move(-1)}
            aria-label="Video anterior"
          >
            <ArrowLeft />
          </button>
          <span aria-live="polite">
            {String(index + 1).padStart(2, "0")} <span>/ 05</span>
          </span>
          <button
            type="button"
            className="mi-icon-button"
            onClick={() => move(1)}
            aria-label="Video siguiente"
          >
            <ArrowRight />
          </button>
        </div>
        <button
          type="button"
          className="mi-icon-button"
          disabled={failed}
          aria-label={playing ? "Pausar video" : "Reproducir video"}
          onClick={() => {
            if (playing) {
              videoRef.current?.pause();
              setAllowed(false);
            } else {
              setAllowed(true);
              videoRef.current?.play().catch(() => setPlaying(false));
            }
          }}
        >
          {playing ? <Pause /> : <Play />}
        </button>
      </div>
    </>
  );
}
