import { defineConfig } from "wxt";

export default defineConfig({
	manifest: {
		name: "Quantix Wallet",
		permissions: ["storage", "clipboardWrite"],
		host_permissions: ["http://*/*", "https://*/*"],
	},
});
