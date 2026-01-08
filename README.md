# MarkContIt

Chrome extension (Manifest V3) to label meaningful text content using include/exclude CSS selectors that persist under a base URL.

## Install (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder: `/home/rojan/Documents/Git/GitHub/MarkContIt`.
4. Pin the extension for quick access.

## Use

1. Open a page under the site you want to label.
2. Open the MarkContIt popup and set a **Base URL scope** (can include a subdirectory).
3. Click **Enable on this tab**.
4. Hover to see the segment target highlight (border only).
5. Left click to **include** a segment. Right click to **exclude** a segment.
6. Navigate to other pages under the base URL to see inferred highlights.
7. Use the selector list in the popup to open the creation page or remove a selector.
8. Click **Export JSON** to download a flat JSON payload.

## Behavior Notes

- Explicitly marked elements are strongly highlighted; inferred matches are subtle.
- Exclusions override inclusions when both match an element.
- Parent/child rule: if a parent is explicitly included, children can only be excluded (and vice versa). Attempts are blocked with a toast message.
- The page is visually frozen while enabled (hover/active effects suppressed, animations stopped, and page interactions blocked).

## Files

- `manifest.json`
- `background.js` (service worker)
- `contentScript.js` (hover, selection, selector generation, highlights)
- `popup.html` / `popup.js` / `popup.css`
