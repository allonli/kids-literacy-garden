# Design QA

- source visual truth path: `source-captures/source-desktop-top.png`
- implementation screenshot path: unavailable; the in-app browser blocked local-loopback navigation
- viewport: source desktop 1440 x 900; requested mobile 390 x 844 did not take effect in the browser backend
- state: home, parent center, and child-mode review entry

**Full-view comparison evidence**

- The live production page was captured successfully at 1440 x 900.
- The restored local source passed its production build and rendered-HTML tests.
- A browser-rendered local screenshot could not be captured because the in-app browser rejected the local loopback page even though Windows returned HTTP 200.

**Focused region comparison evidence**

- Not available. Without a browser-rendered local screenshot, focused visual comparison would be speculative.

**Findings**

- [P1] Local visual comparison is blocked
  - Location: local browser preview.
  - Evidence: the local development endpoint returned HTTP 200 from Windows, while the in-app browser refused local-loopback navigation.
  - Impact: exact pixel-level comparison between the recovered local build and production cannot be certified in this run.
  - Fix: open the local development URL in a browser surface that can reach the Windows loopback endpoint, then capture desktop and 390 x 844 states.

**Verified user operation script**

1. Entry: open `https://z.allon.me/`.
2. Visible result: the home page shows two learning modes, learning counts, a parent-center entry, and the primary start button.
3. Action: open parent center.
4. Feedback: learning settings, add-character input, search, and stage filters are shown.
5. Action: return home, choose child mode, and start learning.
6. Success signal: the interface enters `到期复习 · 1/5` and shows the target character with `再学一下` and `我会` actions.
7. Recovery: use the page navigation controls to return home; learning state remains in browser storage.

**Required fidelity surfaces**

- Fonts and typography: source captured; local visual comparison blocked.
- Spacing and layout rhythm: source captured; local visual comparison blocked.
- Colors and visual tokens: source captured; restored CSS is byte-for-byte from the deployed repository, but browser comparison is blocked.
- Image quality and asset fidelity: the source home page uses no raster images; project SVG assets were restored from the server.
- Copy and content: source DOM and restored component copy agree for the verified home, parent-center, and review-entry states.

**Comparison history**

- Initial pass: source desktop capture succeeded; local capture failed on loopback access.
- Retry: local endpoint was exposed on an alternate port and confirmed HTTP 200; browser navigation remained blocked.
- Final state: no visual fixes were made because the blocker is browser access, not an observed design mismatch.

**Implementation checklist**

- Re-run desktop and mobile screenshot comparison in a browser that can reach the local endpoint.
- Check browser console errors during that run.
- Mark the report passed only after no P0/P1/P2 mismatch remains.

**Follow-up polish**

- None identified without a valid local visual comparison.

final result: blocked
