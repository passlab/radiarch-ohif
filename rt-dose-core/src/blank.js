// Whether a viewport drew anything: some browser and GPU combinations (Chrome's default OpenGL backend on Linux) draw
// every 3D volume black without an error. Research use only; not for clinical use.

/**
 * True when an RGBA sample of a viewport is black: no pixel brighter than `threshold` (0-255) in any channel.
 *
 * @param {Uint8ClampedArray | number[]} rgba pixels, 4 values each
 * @param {number} [threshold]
 */
export function isBlankImage(rgba, threshold = 12) {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i] > threshold || rgba[i + 1] > threshold || rgba[i + 2] > threshold) {
      return false;
    }
  }
  return true;
}
