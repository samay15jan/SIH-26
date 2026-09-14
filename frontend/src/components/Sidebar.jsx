import {
  LayoutDashboard,
  Radio,
  Map,
  Bell,
  BarChart3,
  FileText,
  Bot,
  Settings,
  Activity,
  ChevronRight
} from "lucide-react";

import { NavLink } from "react-router-dom";

const menu = [
  {
    section: "MONITORING",
    items: [
      {
        name: "Dashboard",
        icon: LayoutDashboard,
        path: "/dashboard"
      },
      {
        name: "Live Monitoring",
        icon: Radio,
        path: "#"
      },
      {
        name: "Sites",
        icon: Map,
        path: "#"
      },
      {
        name: "Alerts",
        icon: Bell,
        path: "#",
        badge: "3"
      }
    ]
  },
  {
    section: "ANALYSIS",
    items: [
      {
        name: "Analytics",
        icon: BarChart3,
        path: "#"
      },
      {
        name: "Reports",
        icon: FileText,
        path: "#"
      },
      {
        name: "AI Assistant",
        icon: Bot,
        path: "#"
      }
    ]
  }
];

export default function Sidebar() {
  return (
    <aside className="sidebar">

      <div className="sidebar-brand">

        <div className="sidebar-logo">
          <Activity size={23} />
        </div>

        <div>
          <strong>GeoGuard</strong>
          <span>AI Monitoring</span>
        </div>

      </div>

      <div className="sidebar-content">

        {menu.map((group) => (
          <div className="menu-group" key={group.section}>

            <div className="menu-label">
              {group.section}
            </div>

            {group.items.map((item) => {

              const Icon = item.icon;

              return (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={({ isActive }) =>
                    `sidebar-link ${isActive ? "active" : ""}`
                  }
                >

                  <Icon size={19} />

                  <span>{item.name}</span>

                  {item.badge && (
                    <span className="alert-badge">
                      {item.badge}
                    </span>
                  )}

                </NavLink>
              );
            })}

          </div>
        ))}

        <div className="menu-group bottom-menu">

          <div className="menu-label">
            SYSTEM
          </div>

          <a className="sidebar-link" href="#">
            <Settings size={19} />
            <span>Settings</span>
          </a>

        </div>

      </div>

      <div className="sidebar-footer">

        <div className="system-status">
          <span></span>

          <div>
            <strong>System Online</strong>
            <small>All services operational</small>
          </div>

          <ChevronRight size={16} />

        </div>

        <div className="copyright">
          © 2026 GeoGuard AI
        </div>

      </div>

    </aside>
  );
}