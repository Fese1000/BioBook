# Third-party notices

BioBook itself is released under the [MIT License](LICENSE). It includes or uses the following third-party material, which keeps its own license. Please refer to each project for the full license text and copyright holders.

## Bundled code (`web/vendor/`)

| Component | Used for | License |
| --- | --- | --- |
| [SmilesDrawer](https://github.com/reymond-group/smiles-drawer) 2.4.1 (`smiles-drawer.min.js`) | Chemical structure drawing | MIT, copyright GDB / Reymond Research Group. The license text is included as `web/vendor/smiles-drawer.LICENSE.md`. |
| [TipTap](https://tiptap.dev) and the extensions listed in `tools/package.json` (`tiptap.js`, bundled with esbuild) | Block editor | MIT |
| [ProseMirror](https://prosemirror.net) modules (`prosemirror-model`, `prosemirror-view`, …), part of the editor bundle | Editor core | MIT |
| [KaTeX](https://katex.org) (part of the editor bundle) | Formula rendering | MIT |
| [linkifyjs](https://linkify.js.org) (part of the editor bundle) | Link detection | MIT |

The editor bundle is produced from the packages in `tools/package.json` and their dependencies (`cd tools && npm install && npm run bundle`). Each of these packages ships its own license file in `tools/node_modules/` after installation.

## Test data (`tests/fixtures/`)

| File | Origin |
| --- | --- |
| `310.ab1`, `3730.ab1`, `abi-expected.json` | Sanger sequencing trace files and expected values from the [Biopython](https://biopython.org) project (`Tests/Abi`), used to check the `.ab1` reader. Biopython is distributed under the Biopython License Agreement / BSD 3-Clause license. |
| `pUC19.gb` | GenBank/NCBI record L09137 (cloning vector pUC19c), public sequence data. |
| `crossref-*.json`, `pubmed-*.json` | Responses of the public Crossref and PubMed APIs for single records. |
| Other files | Small synthetic examples created for the tests. |

## Reference implementations used only in tests

Melting temperatures are compared with [Primer3](https://primer3.org) (primer3-py) and statistics with [SciPy](https://scipy.org). They are not distributed with BioBook.
