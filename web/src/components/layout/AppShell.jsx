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
} from 'lucide-react';
import logoHorizontal from '@/assets/brand/vantrarun-horizontal-full-colour.svg';
import logoMark from '@/assets/brand/vantrarun-mark-neon.svg';
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
  // The logo files carry the name; padding keeps the clear space around them.
  return (
    <Link to="/" className="inline-flex items-center p-1.5">
      {compact ? (
        <img src={logoMark} alt="VantraRun" className="h-8 w-auto" />
      ) : (
        <img src={logoHorizontal} alt="VantraRun" className="h-7 w-auto" />
      )}
    </Link>
  );
}

export default function AppShell() {
  const linkClass = ({ isActive }) =>
    cn(
      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
      isActive
        ? "text-primary before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary before:content-['']"
        : 'text-steel hover:bg-card hover:text-foreground'
    );

  return (
    <div className="min-h-screen lg:pl-[244px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[244px] flex-col border-r border-border bg-background px-4 py-6 lg:flex">
        <Mark />
        <nav className="mt-9 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {({ isActive }) => (
                <>
                  <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <Link
            to="/run"
            className="flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95 active:scale-[0.98]"
          >
            <Play className="h-4 w-4" strokeWidth={2} />
            Start a run
          </Link>
          <p className="mt-4 vr-label text-[9px] leading-relaxed">
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
                  'flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
                  isActive ? 'border-primary text-primary' : 'border-border text-steel'
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
                  'flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
                  isActive ? 'border-primary text-primary' : 'border-border text-steel'
                )
              }
            >
              <Settings className="h-4 w-4" />
            </NavLink>
          </div>
        </div>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid grid-cols-5 items-end px-2 py-2">
          {MOBILE_NAV.slice(0, 2).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors',
                  isActive
                    ? "text-primary after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-['']"
                    : 'text-steel'
                )
              }
            >
              <item.icon className="h-5 w-5" strokeWidth={1.75} />
              {item.label}
            </NavLink>
          ))}
          <Link
            to="/run"
            aria-label="Start a run"
            className="mx-auto -mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-background transition active:scale-95"
          >
            <Play className="h-5 w-5" strokeWidth={2} />
          </Link>
          {MOBILE_NAV.slice(2).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors',
                  isActive
                    ? "text-primary after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-4 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-['']"
                    : 'text-steel'
                )
              }
            >
              <item.icon className="h-5 w-5" strokeWidth={1.75} />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}