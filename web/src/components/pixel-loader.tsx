/**
 * PixelLoader — 3×3 pixel-art indicator.
 *
 * Pure-CSS animation cycling through patterns:
 *   center → horizontal line → corners → frame → center
 *
 * status="loading" → blue animated cycle
 * status="done"    → green static checkmark
 * status="error"   → red static X
 */

export function PixelLoader({ status }: { status: "loading" | "done" | "error" }) {
  // For "done", light up pixels that form a check: (1,0) (2,1) (1,2)
  // Grid positions (row, col) → indices 0-8:
  //   0 1 2
  //   3 4 5
  //   6 7 8
  // Check shape: index 6, 4, 2  (bottom-left → center → top-right)
  const checkPixels = new Set([6, 4, 2]);

  // X shape: corners + center → 0, 2, 4, 6, 8
  const xPixels = new Set([0, 2, 4, 6, 8]);

  const className = [
    "pixel-loader",
    status === "loading" && "pixel-loader--loading",
    status === "done" && "pixel-loader--done",
    status === "error" && "pixel-loader--error",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="pixel-grid">
        {Array.from({ length: 9 }, (_, i) => {
          const isCheck = status === "done" && checkPixels.has(i);
          const isX = status === "error" && xPixels.has(i);

          return (
            <div
              key={i}
              className={[
                "pixel",
                `pixel-${i}`,
                isCheck && "pixel--check",
                isX && "pixel--x",
              ]
                .filter(Boolean)
                .join(" ")}
            />
          );
        })}
      </div>
    </div>
  );
}
