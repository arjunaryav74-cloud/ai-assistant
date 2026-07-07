import { motion } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { orbBoxPosition, MINI_ORB_VISUAL_SIZE } from "@shared/orb-geometry";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
import { appleSpring, jellySpring } from "../../motion/springs";
import { useWiggleState } from "../../hooks/useOrbDragWiggle";
import { useDraggableOrb } from "../../hooks/useDraggableOrb";

function toVisualMode(name: OrbStateName): VoiceVisualMode {
  switch (name) {
    case "listening": return "listening";
    case "bargeIn": return "barge_in";
    case "processing": return "processing";
    case "responding": return "speaking";
    case "working": return "thinking";
    default: return "idle";
  }
}

interface MiniOrbProps {
  state: OrbState;
  level: number;
  onClick: () => void;
}

const ORB_POS = orbBoxPosition(false);

/**
 * The idle Siri-style orb: just the animated orb floating in the corner —
 * no panel, no chrome. Click to open the chat panel; click-and-drag anywhere
 * on it to move it wherever you want (a fully custom JS-driven drag, not a
 * native OS window-drag region — see useDraggableOrb for why).
 */
export function MiniOrb({ state, level, onClick }: MiniOrbProps) {
  const { wiggle, reportVelocity } = useWiggleState();
  const { onMouseDown } = useDraggableOrb(onClick, reportVelocity);

  return (
    <motion.div
      onMouseDown={onMouseDown}
      title="Nova — click to open, drag to move"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        cursor: "pointer",
        // No app-region here — dragging is handled entirely in JS (see
        // useDraggableOrb) so the click handler stays reliable.
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      {/* Fixed pixel position (not flex/percentage-centered): the window
          animates between the mini and panel sizes while this component may
          still be mounted, and a centered layout would visibly drift toward
          the middle of whatever the window's current (intermediate) size is.
          Pinning to the exact spot main.ts's resizeOrb math assumes keeps
          the orb rock-steady regardless of the window's current size. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.08 }}
        transition={appleSpring}
        style={{
          position: "absolute",
          top: ORB_POS.top,
          left: ORB_POS.left,
          width: MINI_ORB_VISUAL_SIZE,
          height: MINI_ORB_VISUAL_SIZE,
        }}
      >
        <motion.div
          animate={{ scaleX: wiggle.scaleX, scaleY: wiggle.scaleY, rotate: wiggle.rotate }}
          transition={jellySpring}
        >
          <VoiceOrb visualMode={toVisualMode(state.name)} audioLevel={level} size={MINI_ORB_VISUAL_SIZE} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
