# Gallery thumbnails

Project images and link screenshots for `gallery.html`.

- Drop a JPG/PNG/WebP in here, then add a matching row to `gallery-data.js`
  (`title`, `meta`, `href`, `image`) — that file is the gallery's index,
  because static hosting can't list a folder.
- Roughly square crops read best: the curve gallery scatters them as small
  planes and the index cards are square.
- ~1200–1600 px on the long edge is plenty. The thumbnail effect downsamples
  to the electrode grid, so bigger files only cost load time.
- A row whose `image` is missing still renders — it falls back to a generated
  pink lattice card with the project title on it.
