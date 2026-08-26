import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./Bubble.css";

const LONG_RAY = "M0,0 C-2.3,-6.5 -1.1,-13.5 0,-17 C1.1,-13.5 2.3,-6.5 0,0 Z";
const SHORT_RAY = "M0,0 C-1.4,-4.2 -0.7,-8.8 0,-10.5 C0.7,-8.8 1.4,-4.2 0,0 Z";

const RAYS = [
  { angle: 0, ray: LONG_RAY, opacity: 1 },
  { angle: 55, ray: SHORT_RAY, opacity: 0.55 },
  { angle: 100, ray: LONG_RAY, opacity: 0.85 },
  { angle: 165, ray: SHORT_RAY, opacity: 0.5 },
  { angle: 215, ray: LONG_RAY, opacity: 0.9 },
  { angle: 280, ray: SHORT_RAY, opacity: 0.55 },
];

function BubbleMark() {
  return (
    <svg
      className="bubble-mark"
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
    >
      <g transform="translate(16,16)">
        {RAYS.map(({ angle, ray, opacity }) => (
          <path
            key={angle}
            d={ray}
            transform={`rotate(${angle})`}
            fill="var(--accent)"
            opacity={opacity}
          />
        ))}
        <circle r="2.4" fill="var(--accent)" />
      </g>
    </svg>
  );
}

// `data-tauri-drag-region` hijacks the mouse at mousedown regardless of
// movement, so a real click never reaches onClick — it and a click handler
// can't share the same element. Instead we track movement manually and
// only call startDragging() once the pointer has actually moved past a
// small threshold; a click with no movement falls through to onClick.
const DRAG_THRESHOLD_PX = 4;

function Bubble() {
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const didDrag = useRef(false);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    startPos.current = { x: e.screenX, y: e.screenY };
    isDragging.current = false;
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!startPos.current || e.buttons !== 1 || isDragging.current) return;
    const dx = e.screenX - startPos.current.x;
    const dy = e.screenY - startPos.current.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      isDragging.current = true;
      didDrag.current = true;
      getCurrentWindow().startDragging();
    }
  }

  function onMouseUp() {
    startPos.current = null;
    isDragging.current = false;
  }

  function onClick() {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    invoke("toggle_chat_window");
  }

  return (
    <div className="bubble-stage">
      <div
        className="bubble"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onClick}
      >
        <BubbleMark />
      </div>
    </div>
  );
}

export default Bubble;
