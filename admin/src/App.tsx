import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Niches from './pages/Niches';
import NicheDetail from './pages/NicheDetail';
import Discovery from './pages/Discovery';
import Jobs from './pages/Jobs';
import ContentList from './pages/ContentList';
import ContentReview from './pages/ContentReview';
import CreateContent from './pages/CreateContent';
import Settings from './pages/Settings';
import { api } from './api/client';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if user has a valid token
    const token = api.getToken();
    if (token) {
      // Verify token by making a test request
      api.getStats()
        .then(() => setIsAuthenticated(true))
        .catch(() => {
          api.clearToken();
          setIsAuthenticated(false);
        });
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={() => setIsAuthenticated(true)} />;
  }

  return (
    <Layout onLogout={() => { api.clearToken(); setIsAuthenticated(false); }}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/niches" element={<Niches />} />
        <Route path="/niches/:id" element={<NicheDetail />} />
        <Route path="/discovery" element={<Discovery />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/create" element={<CreateContent />} />
        <Route path="/content" element={<ContentList />} />
        <Route path="/content/:id" element={<ContentReview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default App;
