import { ArrowRight, Activity, Brain, Radio, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="landing-page">

      <div className="landing-glow glow-one"></div>
      <div className="landing-glow glow-two"></div>

      <nav className="landing-nav">
        <div className="brand">
          <div className="brand-mark">
            <Activity size={22} />
          </div>

          <div>
            <strong>GeoGuard AI</strong>
            <span>Subsidence Intelligence</span>
          </div>
        </div>

        <Link to="/dashboard" className="nav-dashboard-btn">
          Dashboard <ArrowRight size={17} />
        </Link>
      </nav>

      <main className="hero">

        <div className="hero-content">

          <div className="status-pill">
            <span></span>
            AI-POWERED GROUND MONITORING
          </div>

          <h1>
            Detect Ground Movement
            <br />
            <span>Before It Becomes Critical.</span>
          </h1>

          <p>
            Real-time subsidence monitoring powered by hardware sensors,
            intelligent analytics and AI-driven risk prediction.
          </p>

          <div className="hero-actions">

            <Link to="/dashboard" className="primary-btn">
              Open Dashboard
              <ArrowRight size={18} />
            </Link>

            <button className="secondary-btn">
              Explore Platform
            </button>

          </div>

          <div className="hero-stats">

            <div>
              <strong>4</strong>
              <span>Sensor Parameters</span>
            </div>

            <div>
              <strong>24/7</strong>
              <span>Monitoring</span>
            </div>

            <div>
              <strong>AI</strong>
              <span>Risk Analysis</span>
            </div>

          </div>

        </div>

        <div className="hero-visual">

          <div className="monitor-card">

            <div className="monitor-header">
              <div>
                <span>LIVE MONITORING</span>
                <h3>Mine Sector B</h3>
              </div>

              <div className="online">
                <span></span>
                Online
              </div>
            </div>

            <div className="risk-circle">
              <div>
                <strong>42</strong>
                <span>Risk Score</span>
              </div>
            </div>

            <div className="sensor-grid">

              <Sensor
                icon={<Activity />}
                name="Displacement"
                value="12.4"
                unit="mm"
              />

              <Sensor
                icon={<Radio />}
                name="Tilt"
                value="0.36"
                unit="°"
              />

              <Sensor
                icon={<Activity />}
                name="Vibration"
                value="0.12"
                unit="g"
              />

              <Sensor
                icon={<Radio />}
                name="Ultrasonic"
                value="2.1"
                unit="m"
              />

            </div>

            <div className="ai-status">
              <Brain size={20} />

              <div>
                <strong>AI Analysis</strong>
                <p>
                  Ground conditions currently appear stable.
                </p>
              </div>

              <ShieldCheck size={22} />
            </div>

          </div>

        </div>

      </main>

      <footer className="landing-footer">
        <span>GeoGuard AI</span>
        <span>Real-time Subsidence Intelligence Platform</span>
        <span>Hardware → AI → Action</span>
      </footer>

    </div>
  );
}

function Sensor({ icon, name, value, unit }) {
  return (
    <div className="hero-sensor">
      <div className="sensor-icon">{icon}</div>

      <div>
        <span>{name}</span>
        <strong>
          {value} <small>{unit}</small>
        </strong>
      </div>
    </div>
  );
}