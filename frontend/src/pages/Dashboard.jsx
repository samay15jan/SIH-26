import {
  AlertTriangle,
  CheckCircle2,
  Brain,
  ArrowUpRight,
  MapPin,
  Clock3
} from "lucide-react";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area
} from "recharts";

import Sidebar from "../components/Sidebar";
import StatCard from "../components/StatCard";
import ChartCard from "../components/ChartCard";
import JhanjharMap from "../components/JhanjharMap";

const displacementData = [
  { time: "00:00", value: 7 },
  { time: "02:00", value: 8 },
  { time: "04:00", value: 9 },
  { time: "06:00", value: 8 },
  { time: "08:00", value: 11 },
  { time: "10:00", value: 10 },
  { time: "12:00", value: 13 },
  { time: "14:00", value: 12 },
  { time: "16:00", value: 15 },
  { time: "18:00", value: 14 },
  { time: "20:00", value: 17 },
  { time: "22:00", value: 18 }
];

const weeklyData = [
  { day: "Mon", value: 8 },
  { day: "Tue", value: 10 },
  { day: "Wed", value: 9 },
  { day: "Thu", value: 13 },
  { day: "Fri", value: 15 },
  { day: "Sat", value: 16 },
  { day: "Sun", value: 18 }
];

export default function Dashboard() {
  return (
    <div className="dashboard-layout">

      <Sidebar />

      <main className="dashboard-main">

        {/* PAGE HEADER */}

        <div className="page-header">

          <div>

            <div className="breadcrumb">
              Monitoring <span>/</span> Overview
            </div>

            <h1>Dashboard</h1>

            <p>
              Real-time overview of ground stability and subsidence risk.
            </p>

          </div>

          <div className="header-actions">

            <div className="connection-status">
              <span></span>
              Hardware Connected
            </div>

            <div className="time-display">
              <Clock3 size={16} />
              Updated 10:24 AM
            </div>

          </div>

        </div>

        {/* FILTERS */}

        <div className="filter-bar">

          <div className="filter-group">

            <label>Monitoring Site</label>

            <select>
              <option>Mine Sector B</option>
              <option>Mine Sector A</option>
              <option>Mine Sector C</option>
            </select>

          </div>

          <div className="filter-group">

            <label>Period</label>

            <select>
              <option>Last 24 Hours</option>
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
            </select>

          </div>

          <button className="filter-btn">
            Apply Filters
          </button>

        </div>


    <section>
      <div style={{ marginBottom: 12 }}>
        <h2>Jhanjhar Region</h2>
        <p>Satellite view for the mine-monitoring demonstration.</p>
      </div>

      <JhanjharMap apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY} />
    </section>


        {/* JHARKHAND MAP */}
        <section className="jharkhand-map-card">

          <div className="jharkhand-map">
            <img
              src="/Jharkhand.png"
              alt="Jharkhand map showing Jharia Coalfield"
            />
          </div>

          <div className="section-heading">
            <div>
              <h2>Jharkhand Monitoring Map</h2>
              <p>Monitoring region and active coalfield location</p>
            </div>
          </div>

        </section>

        {/* KPI CARDS */}

        <section className="stats-grid">

          <StatCard
            type="displacement"
            title="Displacement"
            value="12.4"
            unit="mm"
            change="↑ 6.3%"
          />

          <StatCard
            type="tilt"
            title="Tilt"
            value="0.36"
            unit="°"
            change="↑ 2.1%"
          />

          <StatCard
            type="vibration"
            title="Vibration"
            value="0.12"
            unit="g"
            change="↑ 1.4%"
          />

          <StatCard
            type="ultrasonic"
            title="Ultrasonic"
            value="2.10"
            unit="m"
            change="↑ 0.8%"
          />

        </section>

        {/* STATUS ROW */}

        <section className="overview-grid">

          <div className="risk-card">

            <div className="section-heading">

              <div>
                <h2>Current Risk Level</h2>
                <p>AI assessment based on live sensor data</p>
              </div>

              <Brain size={22} />

            </div>

            <div className="risk-content">

              <div className="risk-score">

                <div className="score-ring">

                  <div>
                    <strong>42</strong>
                    <span>/ 100</span>
                  </div>

                </div>

                <div>
                  <div className="risk-label">
                    MODERATE
                  </div>

                  <p>
                    Conditions require continued monitoring.
                  </p>
                </div>

              </div>

              <div className="risk-factors">

                <div>
                  <span>Displacement trend</span>
                  <strong className="warning">Elevated</strong>
                </div>

                <div>
                  <span>Ground tilt</span>
                  <strong className="normal">Normal</strong>
                </div>

                <div>
                  <span>Vibration</span>
                  <strong className="normal">Normal</strong>
                </div>

              </div>

            </div>

          </div>

          <div className="health-card">

            <div className="section-heading">

              <div>
                <h2>System Health</h2>
                <p>Hardware and sensor network</p>
              </div>

              <CheckCircle2 size={22} />

            </div>

            <div className="health-number">
              <strong>24</strong>
              <span>/ 26 Sensors Online</span>
            </div>

            <div className="progress">
              <div style={{ width: "92%" }}></div>
            </div>

            <div className="health-details">

              <span>
                <i></i>
                24 Online
              </span>

              <span>
                <i className="offline"></i>
                2 Offline
              </span>

            </div>

          </div>

        </section>

        {/* CHARTS */}

        <section className="charts-main-grid">

          <ChartCard
            title="Live Displacement"
            subtitle="Sensor S-08 • Millimetres"
          >

            <div className="chart-legend">
              <span className="legend-line"></span>
              Displacement
              <span className="threshold-line"></span>
              Critical Threshold
            </div>

            <ResponsiveContainer width="100%" height={300}>

              <LineChart data={displacementData}>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                />

                <Tooltip />

                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#0d8f91"
                  strokeWidth={3}
                  dot={false}
                />

              </LineChart>

            </ResponsiveContainer>

          </ChartCard>

          <ChartCard
            title="7-Day Subsidence Trend"
            subtitle="AI monitored displacement"
          >

            <ResponsiveContainer width="100%" height={300}>

              <AreaChart data={weeklyData}>

                <defs>
                  <linearGradient
                    id="riskGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#0d8f91"
                      stopOpacity={0.35}
                    />

                    <stop
                      offset="100%"
                      stopColor="#0d8f91"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                />

                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                />

                <Tooltip />

                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#0d8f91"
                  strokeWidth={3}
                  fill="url(#riskGradient)"
                />

              </AreaChart>

            </ResponsiveContainer>

          </ChartCard>

        </section>

        {/* BOTTOM GRID */}

        <section className="bottom-grid">

          {/* ALERTS */}

          <div className="panel">

            <div className="panel-header">

              <div>
                <h2>Recent Alerts</h2>
                <p>AI-generated monitoring events</p>
              </div>

              <button>View All</button>

            </div>

            <Alert
              level="critical"
              title="Rapid displacement detected"
              description="Sensor S-08 • 28.4 mm"
              time="10:24 AM"
            />

            <Alert
              level="warning"
              title="Unusual vibration pattern"
              description="Sensor S-15 • 0.18 g"
              time="10:18 AM"
            />

            <Alert
              level="warning"
              title="Tilt approaching threshold"
              description="Sensor S-03 • 0.36°"
              time="09:42 AM"
            />

          </div>

          {/* AI INSIGHT */}

          <div className="ai-insight">

            <div className="ai-title">

              <div className="ai-icon">
                <Brain size={21} />
              </div>

              <div>
                <h2>AI Insight</h2>
                <span>Generated from live sensor data</span>
              </div>

            </div>

            <p className="ai-message">
              Displacement at <strong>Mine Sector B</strong> has
              increased by 6.3% over the last 24 hours.
              Current readings remain below the critical threshold,
              but the trend is increasing.
            </p>

            <div className="recommendation">

              <ArrowUpRight size={19} />

              <div>
                <strong>Recommendation</strong>

                <p>
                  Continue close monitoring of Sensor S-08
                  and inspect the surrounding zone if displacement
                  exceeds 20 mm.
                </p>
              </div>

            </div>

            <button className="ai-button">
              Ask AI Assistant
              <ArrowUpRight size={17} />
            </button>

          </div>

          {/* SITE STATUS */}

          <div className="panel">

            <div className="panel-header">

              <div>
                <h2>Site Status</h2>
                <p>Monitoring zones</p>
              </div>

              <MapPin size={19} />

            </div>

            <Site
              name="North Ridge"
              status="Normal"
              value="12 sensors"
              type="normal"
            />

            <Site
              name="Central Block"
              status="Moderate"
              value="8 sensors"
              type="moderate"
            />

            <Site
              name="South Zone"
              status="High Risk"
              value="6 sensors"
              type="high"
            />

          </div>

        </section>

      </main>

    </div>
  );
}

function Alert({ level, title, description, time }) {

  return (
    <div className="alert-row">

      <div className={`alert-icon ${level}`}>
        <AlertTriangle size={17} />
      </div>

      <div className="alert-info">

        <strong>{title}</strong>

        <span>
          {description}
        </span>

      </div>

      <div className="alert-time">
        {time}
      </div>

    </div>
  );
}

function Site({ name, status, value, type }) {

  return (
    <div className="site-row">

      <div className="site-location">
        <MapPin size={17} />

        <div>
          <strong>{name}</strong>
          <span>{value}</span>
        </div>
      </div>

      <span className={`site-status ${type}`}>
        {status}
      </span>

    </div>
  );
}