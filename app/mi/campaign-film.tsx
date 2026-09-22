"use client";

import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Film = { id: number; startAt?: number; endAt?: number };

const films: Film[] = [
  { id: 3, endAt: 8 },
  { id: 1, startAt: 3 },
  { id: 4 },
  { id: 5 },
];
const fadeDuration = 700;

/** Only the visible film is fetched. Reduced motion/data saving starts with a poster. */
export function CampaignFilm() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const transitionTimer = useRef<number | null>(null);
  const userPaused = useRef(false);
  const [index, setIndex] = useState(0);
  const [allowed, setAllowed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fading, setFading] = useState(false);
  const film = films[index];
  const id = String(film.id).padStart(2, "0");

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
      else if (!userPaused.current) video.play().catch(() => setPlaying(false));
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [allowed, index]);

  useEffect(
    () => () => {
      if (transitionTimer.current !== null)
        window.clearTimeout(transitionTimer.current);
    },
    [],
  );

  function move(direction = 1) {
    if (transitionTimer.current !== null) return;
    videoRef.current?.pause();
    setFading(true);
    transitionTimer.current = window.setTimeout(() => {
      setFailed(false);
      setIndex(
        (current) => (current + direction + films.length) % films.length,
      );
      transitionTimer.current = null;
      window.requestAnimationFrame(() => setFading(false));
    }, fadeDuration);
  }

  function prepareFilm(video: HTMLVideoElement) {
    if (film.startAt) video.currentTime = film.startAt;
    if (allowed && !userPaused.current)
      video.play().catch(() => setPlaying(false));
  }

  function enforceTrim(video: HTMLVideoElement) {
    if (film.endAt && video.currentTime >= film.endAt) move();
  }

  return (
    <>
      {/* Source files have no audio streams; muted and playsInline also satisfy mobile autoplay. */}
      <video
        key={id}
        ref={videoRef}
        className={`mi-film${fading ? " is-fading" : ""}`}
        muted
        playsInline
        autoPlay={allowed}
        poster={`/mi-media/campaign-${id}.jpg`}
        preload="metadata"
        src={allowed ? `/mi-media/campaign-${id}.mp4` : undefined}
        data-start-at={film.startAt ?? 0}
        data-end-at={film.endAt ?? undefined}
        onLoadedMetadata={(event) => prepareFilm(event.currentTarget)}
        onTimeUpdate={(event) => enforceTrim(event.currentTarget)}
        onEnded={() => move()}
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
            {String(index + 1).padStart(2, "0")} <span>/ 04</span>
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
              userPaused.current = true;
            } else {
              userPaused.current = false;
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
