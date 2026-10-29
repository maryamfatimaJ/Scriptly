# Homepage images

    client/public/images/

Everything here is served from the site root, so a file at
`images/foo.gif` is requested at runtime as `/images/foo.gif`.

## capsule-hero.gif — PRESENT BUT DELIBERATELY NOT USED

This file is not referenced anywhere in the application, on purpose.

It is a Dribbble shot: two hands pull a capsule apart and the spilled
beads spell out "Hello dribbble", followed by a credit to another
designer. Shipping it would put a third party's wordmark and personal
attribution on a medical product, and its magenta palette is unrelated
to the brand system in `tailwind.config.ts`.

It is still bundled into `dist/` (~427 KB) simply because everything in
`public/` is copied verbatim. **Delete the file if you don't intend to
replace it** — nothing in the code will break.

To use a licensed hero animation later, drop it in as
`capsule-hero.gif` and wire it into the homepage hero.
