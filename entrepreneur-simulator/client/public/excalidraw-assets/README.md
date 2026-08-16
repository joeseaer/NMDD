# Excalidraw runtime assets

The files under `fonts/` are unmodified runtime assets copied from
`@excalidraw/excalidraw@0.18.1/dist/prod/fonts`. They are served from the
same origin through `window.EXCALIDRAW_ASSET_PATH` so the whiteboard remains
usable without a third-party CDN.

Excalidraw is distributed under the MIT license. Individual bundled fonts
retain the licenses and attribution published by the Excalidraw project:
https://github.com/excalidraw/excalidraw

Do not rename the hashed font files; Excalidraw's generated CSS references
those exact names.
