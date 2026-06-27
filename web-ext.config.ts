import { defineWebExtConfig } from 'wxt';

const disableBrowserAutoOpen = process.env.UNFLUFFIFY_NO_BROWSER === '1';

export default defineWebExtConfig({
  disabled: disableBrowserAutoOpen,
  chromiumArgs: ['--user-data-dir=./.wxt/browser-profile'],
});