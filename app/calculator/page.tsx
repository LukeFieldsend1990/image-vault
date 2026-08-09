import type { Metadata } from "next";
import CalculatorClient from "./calculator-client";

const TITLE = "What is your scan worth? — ImageVault";
const DESCRIPTION =
  "Pull your last ten years of credits, mark the productions that scanned you, and see what re-licensing that scan would have been worth. Nothing you enter is stored.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://imagevault.ai/calculator",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function CalculatorPage() {
  return <CalculatorClient />;
}
