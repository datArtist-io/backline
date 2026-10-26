"use client";

import { Component, memo, useCallback, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

// Start fetching the 3D code as soon as this module loads, not when React gets round to it.
const loadScene = () => import("./Scene");
if (typeof window !== "undefined") void loadScene();
const Scene = dynamic(loadScene, { ssr: false });

// If WebGL fails on a device, show nothing: the page's own gradient still looks finished.
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Background() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className={`stage${ready ? " is-ready" : ""}`} aria-hidden="true">
      {/* Nothing is shown until the 3D scene has drawn its first frame; then it fades in once. */}
      <div className="stage-canvas">
        <Quiet>
          <Scene onReady={onReady} />
        </Quiet>
      </div>
    </div>
  );
}

// Memoised so state changes elsewhere on the page never touch the 3D canvas.
export default memo(Background);
