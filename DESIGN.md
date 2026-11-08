# Visual direction

Reference: https://webtactics.org/ — inspected 2026-11-08 using Firecrawl branding capture and desktop browser screenshots before/after scrolling.

Observed: near-black background, lavender accent (#D8B4FE in branding capture), oversized heavy sans headings, glowing geometry behind content, persistent ambient scene and fine rules. Capture identifies Syncopate headings and Rajdhani body. The reference is a much longer agency site.

Adaptation: Manrope for Cyrillic, a graphite/lavender palette, compact 1440px container, pill navigation and rounded form panels. Original Renault image is retained; skyline/trees are original lightweight SVG. Scene movement follows scrolling without a dedicated tall animation section. Background gradient shifts through the page. Reduced-motion disables scene transforms.

Four compact content areas: hero, three-step calculator, vehicle specifications, MAX handoff. The open wizard step controls form height. Copy uses the current data from every step; no automatic sending. A vehicle image with scenery gives depth rather than a true 3D mesh. Four or five screenfuls is a desktop layout target; physical mouse wheel counts depend on device settings, and mobile form content naturally requires more scrolling.

Routing starts at the fixed depot: улица Пески Набережные, 1, Александров (56.3992489, 38.7328341; OpenStreetMap building way/169667848, confirmed by Nominatim and Photon). OSRM receives depot → pickup → delivery; both leg distances contribute to the total at 50 RUB/km. Return to depot is excluded. Reverse swaps pickup/delivery, preserves depot and requests a fresh road route; it does not reverse the geometry array or append a return leg.
