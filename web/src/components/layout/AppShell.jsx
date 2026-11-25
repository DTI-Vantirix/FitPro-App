import { NavLink, Link, Outlet } from 'react-router-dom';
import {
  Home as HomeIcon,
  Route as RouteIcon,
  BarChart3,
  Gauge,
  Play,
  Settings,
  Trophy,
  Users,
  UsersRound,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: 'Today', icon: HomeIcon, end: true },
  { to: '/feed', label: 'Feed', icon: Users },
  { to: '/friends', label: 'Friends', icon: UsersRound },
  { to: '/challenges', label: 'Challenges', icon: Trophy },
  { to: '/routes', label: 'Routes', icon: RouteIcon },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/zones', label: 'Pace zones', icon: Gauge },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const MOBILE_NAV = [NAV[0], NAV[1], NAV[4], NAV[5]];

function Mark({ compact }) {
  return (
    <Link to="/" className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_24px_hsl(73_96%_62%/0.35)]">
        <Zap className="h-[18px] w-[18px]" strokeWidth={2.5} />
      </span>
      {!compact && (
        <span className="leading-none">
          <span className="block font-heading text-[17px] font-extrabold tracking-tight">FitPro</span>
          <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
            run · recover · repeat
          </span>
        </span>
      )}
    </Link>
  );
}

export default function AppShell() {
  const linkClass = ({ isActive }) =>
    cn(
      'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
      isActive
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
    );

  return (
    <div className="min-h-screen lg:pl-[244px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[244px] flex-col border-r border-border bg-[hsl(var(--sidebar-background))]/70 px-4 py-6 backdrop-blur-xl lg:flex">
        <Mark />
        <nav className="mt-9 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {({ isActive }) => (
                <>
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.2 : 1.8} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <Link
            to="/run"
            className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.98]"
          >
            <Play className="h-4 w-4" strokeWidth={2.5} />
            Start a run
          </Link>
          <p className="mt-4 font-mono text-[9px] leading-relaxed uppercase tracking-[0.18em] text-muted-foreground/60">
            miles · min/mi
          </p>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:pb-16 lg:pt-10">
        <div className="mb-6 flex items-center justify-between lg:hidden">
          <Mark />
          <div className="flex items-center gap-2">
            <NavLink
              to="/challenges"
              aria-label="Challenges"
              className={({ isActive }) =>
                cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              <Trophy className="h-4 w-4" />
            </NavLink>
            <NavLink
              to="/settings"
              aria-label="Settings"
              className={({ isActive }) =>
                cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border border-border transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              <Settings className="h-4 w-4" />
            </NavLink>
          </div>
        </div>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="grid grid-cols-5 items-end px-2 py-2">
          {MOBILE_NAV.slice(0, 2).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              <item.icon className="h-5 w-5" strokeWidth={1.9} />
              {item.label}
            </NavLink>
          ))}
          <Link
            to="/run"
            aria-label="Start a run"
            className="mx-auto -mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_hsl(73_96%_62%/0.35)] transition active:scale-95"
          >
            <Play className="h-5 w-5" strokeWidth={2.5} />
          </Link>
          {MOBILE_NAV.slice(2).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              <item.icon className="h-5 w-5" strokeWidth={1.9} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}