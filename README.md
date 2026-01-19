# Unfluffify

Chrome extension (Manifest V3) to label what's non-meaningful text content to help AI find the meaningful text content.

## Install (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder: `/path/to/repositories/Unfluffify`.
4. Pin the extension for quick access.

## Use

1. Open a page under the site you want to label.
2. Open the **Unfluffify** extension and set a **Base URL scope** (picks up the current URL by default).
3. Click **Enable on this tab**.
4. Hover to see the segment target highlight.
5. Click to toggle whether **exclude** a segment.
6. Navigate to other pages under the base URL to see inferred highlights.
7. Use the selector list in the extension to manage the **exclude**s.
