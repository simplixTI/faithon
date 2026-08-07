import { Card, CardSub, CardTitle, CardValue } from "@/components/ui/card";

export function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card>
      <CardTitle>{label}</CardTitle>
      <CardValue>{value}</CardValue>
      {sub && <CardSub>{sub}</CardSub>}
    </Card>
  );
}
