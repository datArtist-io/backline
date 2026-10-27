import ReceiptView from "./ReceiptView";

export const metadata = { title: "Receipt · Backline" };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptView id={id} />;
}
