# PADI portrait direction

Reference direction: natural African portraits with clear eyes and lips,
traditional fabrics, braids or headwraps, a friendly expression, and a face that
looks toward the person using the app. Keep the existing three female and three
male voice identities.

User references:

- https://www.pinterest.com/pin/348747564902516387/
- https://pngtree.com/freepng/beautiful-african-woman-in-traditional-headwrap-smiling-portrait-isolated-on-transparent-background_23972068.html
- https://www.pexels.com/photo/elegant-african-woman-in-traditional-attire-33588240/
- https://www.magnific.com/premium-photo/portrait-pretty-african-lady-traditional-clothes_53349447.htm

## Original portrait prompts, ready for image generation

Shared prompt for each portrait:

> Use case: photorealistic-natural. Asset type: PADI interactive voice portrait.
> Create an original fictional African adult looking directly at the camera,
> with a warm, relaxed, closed-mouth smile and naturally textured skin. Use a
> centered head-and-shoulders studio composition, eye-level camera, soft frontal
> lighting and a plain warm neutral background. Keep the full hair/headwrap
> inside the frame. The eyes and lips must be unobstructed and easy to animate.
> Traditional clothing should be visible at the shoulders. Square photograph;
> no text, watermark, logos, extra people, or resemblance to a specific person
> in the references. Use the references for clothing and photographic mood.

Add the corresponding subject to that shared prompt:

| Voice | Subject |
| --- | --- |
| PADI | African man with short natural hair, a friendly expression and a simple traditional shirt. |
| Ada | African woman wearing a traditional headwrap and matching attire, with understated earrings. |
| Chidi | African woman with neat braids and patterned traditional clothing. |
| Zainab | African woman in a softly draped headwrap and traditional clothing. |
| Tunde | African man wearing a traditional cap and matching shirt, with an easygoing expression. |
| Amara | African man with short natural hair and a traditional embroidered shirt, with a calm expression. |

The user will supply downloaded portrait files. Use those files when available;
the prompt set above is an optional reference for later original artwork. No
image-generation API is needed for the selected workflow.

The publicly available Pexels photograph supplied by the user can be used for
Ada immediately. Other supplied pages are references; their preview images are
not licensed project assets merely because they can be viewed.

## Animation requirements

- Each touch visibly blinks/nods and plays a public spoken greeting.
- The caption uses the words actually returned with the audio.
- Mouth motion follows the selected speaker's played audio energy, including
  closing during silence, cancellation and clip end.
- The resting eyes blink between replies. Listening does not move the mouth.
- New portrait crops require recalibrating eye/lip landmarks before use.

The current face rig is a two-dimensional photo animation. It is not a rendered
video person or phoneme-based lip-sync system.
