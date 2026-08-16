import { NavLink, Route, Routes } from 'react-router-dom';
import { connectSocket } from './socket.js';
import { useEffect } from 'react';
import Dashboard from './pages/Dashboard.js';
import Settings from './pages/Settings.js';
import Arena from './pages/Arena.js';
import Chat from './pages/Chat.js';

const links = [
  { to: '/', label: '仪表盘', end: true },
  { to: '/arena', label: 'AvA 竞技场' },
  { to: '/chat', label: 'AI 对话室' },
  { to: '/settings', label: '模型池与设置' },
];

export default function App() {
  useEffect(() => {
    connectSocket();
  }, []);

  return (
    <div className="app">
      <nav className="navbar">
        <div className="logo">
          <span className="logo-dot" />
          AIchess 竞技场
        </div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
        <div className="nav-foot">多模型竞技场 · 动作编码驱动</div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/arena" element={<Arena />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
