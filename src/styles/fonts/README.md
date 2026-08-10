# Bundled fonts

Self-hosted rather than linked from a font CDN, for three reasons: the app is an
installable PWA and its offline shell has to include its own typefaces; a
third-party request on every page load is a third party watching every page
load; and a font that arrives late re-flows the page after you have started
reading it.

| File | Family | Used for | Licence |
| --- | --- | --- | --- |
| `caveat-var.woff2` | Caveat (variable, 400–700) | `--font-hand` — the written hand: prose, labels, buttons, nav | [OFL 1.1](OFL-Caveat.txt) |
| `imfell-400.woff2` | IM Fell English | `--font-book` — the printed hand: headings and the masthead | [OFL 1.1](OFL-IMFellEnglish.txt) |

Both are SIL Open Font License 1.1; the licence text is bundled beside them, as
the OFL requires. Neither is renamed, so the Reserved Font Name clause is not
engaged.

Caveat is a VARIABLE font: one file covers 400 through 700, which is why there
is no separate bold. `@font-face` declares `font-weight: 400 700` — narrowing
that to a single value would make the browser synthesise a fake bold from a
weight it already has.

Latin subset only (`U+0000-00FF` and friends), which is what the css2 endpoint
serves for these. A realm needing Cyrillic or Greek would need the other
subsets adding; the fallbacks in `--font-hand` cover the gap meanwhile.

There is deliberately NO bundled font for data. `--font-data` is the reader's
own system UI face with tabular figures turned on — it is the one place the app
wants to look like a form rather than a book, it costs nothing to download, and
a number typed in the font the rest of the operating system uses is the most
legible number available on any given machine.
