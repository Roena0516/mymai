import { startWebServer, setBaseUrl } from "./index";
import { CONFIG, PORT } from "../config";

if (CONFIG.baseUrl) setBaseUrl(CONFIG.baseUrl);
startWebServer(PORT);
console.log("[dev] web-only mode (no Discord bot)");
