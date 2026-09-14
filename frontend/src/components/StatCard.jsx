import {
  Activity,
  MoveUpRight,
  MoveDownRight,
  Radio,
  Waves,
  Gauge
} from "lucide-react";

const icons = {
  displacement: Activity,
  tilt: Gauge,
  vibration: Waves,
  ultrasonic: Radio
};

export default function StatCard({
  type,
  title,
  value,
  unit,
  change,
  positive = true
}) {

  const Icon = icons[type] || Activity;

  return (
    <div className={`stat-card ${type}`}>

      <div className="stat-top">

        <div className="stat-icon">
          <Icon size={20} />
        </div>

        <span className="live-dot">
          LIVE
        </span>

      </div>

      <div className="stat-title">
        {title}
      </div>

      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>

      <div className={`stat-change ${positive ? "positive" : "negative"}`}>

        {positive ? (
          <MoveUpRight size={15} />
        ) : (
          <MoveDownRight size={15} />
        )}

        {change}

        <span>vs previous period</span>

      </div>

    </div>
  );
}