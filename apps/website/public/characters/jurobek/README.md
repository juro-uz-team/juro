# Jurobek 2D web asset

Reference-based layered mascot. The original face, hair, doppa embroidery and pointing artwork are preserved in `reference.png` (supplied image) and its lossless WebP. Blink, smile, wave and idle PNGs are image edits derived from that reference. The SVG uses original head pixels in every pose, with local soft-masked facial overlays.

## Run
Serve this folder over HTTP and open `preview.html`. ES modules require an HTTP server, not a `file://` tab.

```html
<div id="jurobek" style="width:420px;height:640px"></div>
<script type="module">
import { createJurobek } from './jurobek.mjs';
const character = createJurobek(document.querySelector('#jurobek'), {
  assetBase: './', state: 'point'
});
character.setState('wave'); // idle | wave | point | guide | smile
character.setPaused(true);
// On unmount:
// character.destroy();
</script>
```

`jurobek.svg`: editable named raster layers, masks and pivots; keep WebP siblings alongside it. `rig.json`: rig coordinates and clip names. `jurobek.mjs`: dependency-free browser player. PNG files: editable source plates with alpha. No WebGL, canvas, external fonts or third-party runtime.

Idle: breathing and head motion. Wave: articulated hand around wrist. Point: restrained presentation gesture. Guide: head nod, presentation lean, brow emphasis and smile. The pointing arm retains its original shape; it moves with the torso to avoid cutout seams. Smile: local closed-mouth expression blend. Blink: irregular 3.6–6.2-second intervals, 240 ms duration. Pause retains the current pose; reduced motion selects static poses. Touch devices use lower amplitudes. IntersectionObserver and page visibility stop the frame loop offscreen; destroy removes listeners and animation frames.

## Scope and constraints
This is a layered raster puppet, not a fully redrawn vector/Lottie asset or phoneme rig. Some hidden body areas and the waving hand were reconstructed from the single reference; these pixels cannot be claimed as identical to an unavailable original layered file. The original head remains authoritative. Do not apply large joint rotations: the supplied layers and reconstruction are designed for the small amplitudes in the player. No gaze displacement is applied, to preserve eye identity and avoid artifacts. Test new motions at actual display size before publishing.
