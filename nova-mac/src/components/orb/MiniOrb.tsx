import { motion } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
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
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.08 }}
      transition={appleSpring}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        // No app-region here — dragging is handled entirely in JS (see
        // useDraggableOrb) so the click handler stays reliable.
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <motion.div
        animate={{ scaleX: wiggle.scaleX, scaleY: wiggle.scaleY, rotate: wiggle.rotate }}
        transition={jellySpring}
      >
        <VoiceOrb visualMode={toVisualMode(state.name)} audioLevel={level} size={76} />
      </motion.div>
    </motion.div>
  );
}
