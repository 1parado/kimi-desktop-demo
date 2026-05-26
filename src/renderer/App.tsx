import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';

export function App() {
  return (
    <div className="app-shell flex h-screen overflow-hidden text-slate-950">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <ChatView />
      </main>
    </div>
  );
}
