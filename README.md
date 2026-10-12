# TFC Forge Helper

Finds the shortest click sequence for the TerraFirmaCraft (1.20.x) anvil, as used in the TerraFirmaGreg-Modern modpack.

**Live:** https://fabianrossmann.com/tfcForge/

## Use

1. Paste a screenshot of the anvil screen (Ctrl+V), drop it on the page, or choose it with **Choose screenshot**.
   Target (red marker), Start (green marker) and the rules are filled in automatically.
   Alternatively, enter them by hand.
2. Follow the chips left to right; repeat each `×N` exactly. Finish with the last three steps in the order shown.

Screenshots must be unscaled (as captured) and show the whole anvil window. Recognition expects the
"Perfected Anvil Helper" resource pack.

## Develop

Requires Node 24+.

```sh
npm install
npm run build      # type-check + bundle src/app.ts into dist/app.js
npm test           # solver + screenshot recognition tests
npm run icons      # regenerate icons/ and src/texture.ts from the resource pack
```

Open `index.html` directly after building; no server needed. Pushes to `master` deploy to GitHub Pages
via `.github/workflows/pages.yml`.

| Path | Purpose |
|---|---|
| `src/solver.ts` | Breadth-first search over work value and last three steps |
| `src/recognize.ts` | Reads markers and rules from a screenshot |
| `src/app.ts` | Page UI |
| `tools/extract-icons.ts` | Extracts icons and the anvil texture from the resource pack |

## Credits

Icons: "Perfected Anvil Helper" by Vizzy, derived from "Anvil GUI" by Simon, CC BY 4.0.
