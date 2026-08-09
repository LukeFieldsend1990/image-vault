import ReceiptClient from "./receipt-client";

export const metadata = {
  title: "Consent receipt — ImageVault",
  robots: { index: false, follow: false },
};

export default async function ConsentReceiptPage({
  params,
}: {
  params: Promise<{ acceptanceId: string }>;
}) {
  const { acceptanceId } = await params;
  return <ReceiptClient acceptanceId={acceptanceId} />;
}
