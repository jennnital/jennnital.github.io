// Gallery manifest.
//
// Static hosting can't list a directory, so this file is the index of the
// gallery folder: drop an image into images/gallery/ and add a row here.
//
//   title   project name, shown under the thumbnail
//   meta    small line above the title (venue, year, kind of work)
//   href    where the thumbnail points — a page on this site or an external link
//   image   path to the thumbnail inside images/gallery/
//
// A missing image is not an error: the thumbnail falls back to a generated
// pink lattice card carrying the project title, so the gallery still works
// before every screenshot is in place.

export const projects = [
  {
    title: 'UE-CL1-API',
    meta: 'Open-source tooling · Unreal Engine plugin',
    href: 'ue-cl1-api.html',
    image: 'images/gallery/ue-cl1-api.jpg',
  },
  {
    title: 'Assembloid Agency',
    meta: '2025 · NeurIPS Creative AI Track',
    href: 'https://openreview.net/pdf?id=BroaBkQAGa',
    image: 'images/gallery/assembloid-agency.jpg',
  },
  {
    title: 'Organoid Array Computing',
    meta: '2025 · Antikythera Digital Journal',
    href: 'https://doi.org/10.1162/anti.5czm',
    image: 'images/gallery/organoid-array-computing.jpg',
  },
  {
    title: 'Thoughtforms: Homeworlds Encode Intelligences',
    meta: '2026 · Rhizome 7 × 7',
    href: 'https://rhizome.org/editorial/2026/jun/12/3-home-worlds-encode-intelligences/',
    image: 'images/gallery/rhizome-thoughtforms.jpg',
  },
  {
    title: 'Research Revival Fund',
    meta: 'Supported by The Analogue Group',
    href: 'https://www.therevivalfund.com/portfolio/jenn-leung-chloe-loewith',
    image: 'images/gallery/research-revival-fund.jpg',
  },
  {
    title: 'Meaningful Signal-Scaffolding',
    meta: '2026 · ALife Conference, Waterloo',
    href: 'https://2026.alife.org/workshops-sessions/',
    image: 'images/gallery/alife-waterloo.jpg',
  },
  {
    title: 'Designing with Living Neural Cultures',
    meta: '2025 · HERVISIONS',
    href: 'https://www.hervisions.world/portal/assembloid-agency-interview',
    image: 'images/gallery/hervisions.jpg',
  },
  {
    title: 'Discussing Actual Intelligence',
    meta: 'National Communication Museum',
    href: 'https://ncm.org.au/knowledge/discussing-actual-intelligence-with-dr-brett-kagan-and-jenn-leung',
    image: 'images/gallery/ncm-actual-intelligence.jpg',
  },
];
