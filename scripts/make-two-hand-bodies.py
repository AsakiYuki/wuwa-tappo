"""
Builds each character's `body4.png`, both hands down, and adds it to assets/catalog.json.

The game ships three body poses per character: body1 (idle, both hands up), body2 (left hand down)
and body3 (right hand down). Holding keys on both sides with the "adaptive" hand mode shows both
hands down, which is body1 with the left hand's move taken from body2 and the right hand's from body3.

Which changed pixel belongs to which hand:
- A pixel "changed" for a pose when it differs visibly from body1 (premultiplied, so colour noise
  under transparent pixels and palette dithering below THRESHOLD do not count).
- Changes are grouped into connected regions. A region dominated by one pose's changes belongs
  wholly to that hand: some characters (the "spinning" ones) also nudge the other hand a few
  pixels in each pose, which would otherwise leave a ghost outline of the raised hand.
- Where both hands' changes touch (an arm crossing the body), each pixel goes to the hand whose
  core, its exclusive and thick changes, is nearest.

Run it again after adding characters (it rewrites every body4.png):
    nix-shell -p 'python3.withPackages(p: [p.pillow p.numpy p.scipy])' pngquant \
        --run 'python3 scripts/make-two-hand-bodies.py'
"""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "assets" / "catalog.json"
# Differences up to this (0–255) are re-encoding noise between the poses, not movement.
THRESHOLD = 24
# Erosion steps that strip thin slivers (outlines, small shifts) off a hand's core.
CORE = 4
# A region belongs to one hand outright when its changes outnumber the other's this many times.
DOMINANT = 3.0


def load(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert("RGBA"))


def changed(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a, b = a.astype(int), b.astype(int)
    premultiplied_a = a[..., :3] * a[..., 3:] // 255
    premultiplied_b = b[..., :3] * b[..., 3:] // 255
    colour = np.abs(premultiplied_a - premultiplied_b).max(-1)
    return np.maximum(colour, np.abs(a[..., 3] - b[..., 3])) > THRESHOLD


def core(exclusive: np.ndarray) -> np.ndarray:
    thick = ndimage.binary_opening(exclusive, iterations=CORE)
    return thick if thick.any() else exclusive


def distance_to(mask: np.ndarray) -> np.ndarray:
    return ndimage.distance_transform_edt(~mask) if mask.any() else np.full(mask.shape, np.inf)


def left_hand_pixels(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """The changed pixels that belong to the left hand's move; the rest belong to the right's."""
    nearest_left = distance_to(core(left & ~right)) <= distance_to(core(right & ~left))
    regions, count = ndimage.label(left | right, structure=np.ones((3, 3)))
    result = np.zeros_like(left)
    for index in range(1, count + 1):
        region = regions == index
        left_only = (region & left & ~right).sum()
        right_only = (region & right & ~left).sum()
        if left_only >= DOMINANT * right_only:
            result |= region
        elif right_only < DOMINANT * left_only:
            result |= region & nearest_left
    return result


def both_hands_down(body1: np.ndarray, body2: np.ndarray, body3: np.ndarray) -> np.ndarray:
    left, right = changed(body1, body2), changed(body1, body3)
    from_left = left_hand_pixels(left, right)
    from_right = (left | right) & ~from_left
    result = body1.copy()
    result[from_left] = body2[from_left]
    result[from_right] = body3[from_right]
    return result


def main() -> None:
    pngquant = shutil.which("pngquant")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    characters = [item for item in catalog["items"] if item["type"] == "character"]
    for index, item in enumerate(characters, 1):
        layers = item["layers"]
        body1, body2, body3 = (load(ROOT / layers[name]) for name in ("body1", "body2", "body3"))
        target = ROOT / Path(layers["body1"]).with_name("body4.png")
        Image.fromarray(both_hands_down(body1, body2, body3)).save(target)
        if pngquant:
            # Palette PNGs like the game's own layers; exit codes 98/99 keep the full-colour file.
            subprocess.run(
                [pngquant, "--quality", "85-100", "--speed", "1", "--strip", "--force", "--output", target, target],
                check=False,
            )
        # Keep the layers in order: body1…body4, then the heads.
        relative = target.relative_to(ROOT).as_posix()
        item["layers"] = {
            **{name: layers[name] for name in ("body1", "body2", "body3")},
            "body4": relative,
            **{name: path for name, path in layers.items() if name not in ("body1", "body2", "body3", "body4")},
        }
        if index % 50 == 0:
            print(f"{index}/{len(characters)}")
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote body4.png for {len(characters)} characters" + ("" if pngquant else " (pngquant not found: not compressed)"))


if __name__ == "__main__":
    main()
