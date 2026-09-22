import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

// The shell is two columns on a laptop and one on a phone. Below `lg` the
// sidebar leaves the flow entirely and becomes a slide-over drawer, because
// a fixed 16rem rail on a 375px screen left barely 7rem for the actual page.
//
// The open/closed state lives here rather than in either child: the Topbar
// button opens it and the Sidebar closes it, so it belongs to their common
// parent.
export default function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-canvas">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setNavOpen(true)} />
        {/* min-w-0 above and here is what lets a wide table scroll inside its
            own container instead of stretching the whole page sideways. */}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
