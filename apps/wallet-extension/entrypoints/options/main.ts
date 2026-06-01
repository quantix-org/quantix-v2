import "../../styles/wallet.css";
import { mountWalletApp } from "../../utils/wallet-ui";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Options root element not found");
}

void mountWalletApp(root, "settings");