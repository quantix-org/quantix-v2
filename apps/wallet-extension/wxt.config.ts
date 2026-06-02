import { defineConfig } from "wxt";

export default defineConfig({
	manifest: {
		name: "Quantix Wallet",
		icons: {
			16: "wallet-logo.png",
			32: "wallet-logo.png",
			48: "wallet-logo.png",
			96: "wallet-logo.png",
			128: "wallet-logo.png",
		},
		action: {
			default_icon: {
				16: "wallet-logo.png",
				32: "wallet-logo.png",
				48: "wallet-logo.png",
				128: "wallet-logo.png",
			},
		},
		permissions: ["storage", "clipboardWrite"],
		host_permissions: ["http://*/*", "https://*/*"],
	},
});
