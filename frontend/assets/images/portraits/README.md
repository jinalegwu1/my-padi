These are the six voice catalog photos, bundled as calibrated 600 × 600 crops.
Bundling keeps the crop aligned with the expression patches and lets portrait
reactions work without downloading images during playback.

Ada uses the Pexels photograph supplied by the user:
https://www.pexels.com/photo/elegant-african-woman-in-traditional-attire-33588240/
Source image: https://images.pexels.com/photos/33588240/pexels-photo-33588240.jpeg
Usage terms: https://www.pexels.com/license/
The downloaded 1200 × 1800 image is cropped at (0, 140, 1200, 1340), then resized
to 600 × 600. Her eyes and lips are calibrated for this crop. Her wider framing
keeps the headwrap and traditional attire visible.

The other five photos retain the existing catalog's Unsplash sources, with a
centered 600 × 600 crop (`auto=format&fit=crop&w=600&h=600&q=90`). Their source
URLs remain in `src/data/languages.ts`. The new six-person style brief is in
`docs/portrait-style-brief.md`.

The transparent mouth patches contain the original lips with feathered edges.
The opened-mouth patches separate the lips; blink patches expand the adjacent
eyelid texture over the eyes. Mouth opacity follows the actual played audio's
energy, closing during silence and when playback stops. These are photo
animations, not video people or phoneme lip sync.

To regenerate the patches from the source JPEGs with Pillow installed:

```sh
python3 scripts/prepare-portrait-rigs.py /path/to/source-jpegs
```

The source directory must be separate from the output directory. Each person's
600px eye landmarks and mouth rectangle are in the script. Keep the mouth
rectangles in `src/data/portrait-rigs.ts` in sync when recalibrating a crop.
