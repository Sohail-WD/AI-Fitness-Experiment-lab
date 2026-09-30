import type { ComponentType } from 'react';
import { BackendStatus } from './components/BackendStatus';
import { useHashRoute } from './lib/useHashRoute';
import { AdaptationPage } from './pages/AdaptationPage';
import { CvLabPage } from './pages/CvLabPage';
import { ExperimentsPage } from './pages/ExperimentsPage';
import { FollowAlongPage } from './pages/FollowAlongPage';
import { HistoryPage } from './pages/HistoryPage';
import { InsightsPage } from './pages/InsightsPage';
import { ProfilePage } from './pages/ProfilePage';
import { WorkoutPage } from './pages/WorkoutPage';

interface RouteDef {
  path: string;
  label: string;
  Page: ComponentType;
}

/** Order follows the product loop (spec §2.2); CV Lab is the working M0 demo. */
const ROUTES: RouteDef[] = [
  { path: 'profile', label: 'Profile', Page: ProfilePage },
  { path: 'workout', label: 'Workout', Page: WorkoutPage },
  { path: 'follow-along', label: 'Follow-Along', Page: FollowAlongPage },
  { path: 'history', label: 'History', Page: HistoryPage },
  { path: 'experiments', label: 'Experiments', Page: ExperimentsPage },
  { path: 'insights', label: 'Insights', Page: InsightsPage },
  { path: 'adaptation', label: 'Adaptation', Page: AdaptationPage },
  { path: 'cv-lab', label: 'CV Lab', Page: CvLabPage },
];
const DEFAULT_ROUTE = 'cv-lab';

export function App() {
  const route = useHashRoute(DEFAULT_ROUTE);
  const current = ROUTES.find((r) => r.path === route) ?? ROUTES.find((r) => r.path === DEFAULT_ROUTE)!;

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Fitness Experiment Lab</h1>
        <BackendStatus />
      </header>

      <nav aria-label="Main" className="main-nav">
        {ROUTES.map((r) => (
          <a key={r.path} href={`#/${r.path}`} aria-current={r.path === current.path ? 'page' : undefined}>
            {r.label}
          </a>
        ))}
      </nav>

      <main>
        <current.Page />
      </main>
    </div>
  );
}
