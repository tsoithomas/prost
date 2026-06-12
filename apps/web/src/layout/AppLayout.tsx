import { useState } from 'react';
import type { ReactNode } from 'react';
import { ConnectionModal } from '../connection/ConnectionModal';
import { useIsMobile } from '../hooks/useMediaQuery';
import { MobileShell } from '../mobile/MobileShell';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

export interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const isMobile = useIsMobile();
  const openConnectionModal = () => setConnectionModalOpen(true);
  const connectionModal = <ConnectionModal open={connectionModalOpen} onClose={() => setConnectionModalOpen(false)} />;

  if (isMobile) {
    return (
      <>
        <MobileShell onOpenConnections={openConnectionModal} />
        {connectionModal}
      </>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onNewConnection={openConnectionModal} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <StatusBar />
      {connectionModal}
    </div>
  );
}
