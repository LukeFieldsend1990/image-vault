export const runtime = "edge";

import DemoClient from "./demo-client";

export const metadata = {
  title: "Image Vault — Product Tour",
};

export default function DemoPage() {
  return <DemoClient />;
}
