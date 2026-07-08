import { defineBackground } from "wxt/utils/define-background";
import { startRewriteBackground } from "../background/index";

export default defineBackground(() => {
  startRewriteBackground();
});
