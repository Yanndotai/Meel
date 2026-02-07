import { Card, CardHeader } from "./cards";

interface InfoCardProps {
  title: string;
  items: { label: string; value: string }[];
}

export function InfoCard({ title, items }: InfoCardProps) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="info-items">
        {items.map((item) => (
          <div key={item.label} className="info-row">
            <span className="info-label">{item.label}</span>
            <span className="info-value">{item.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
