import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, Niche } from '../api/client';

interface Stats {
  niches: { total: number; active: number };
  discovery: { total: number; pending: number };
  jobs: { total: number; running: number };
  content: { total: number; published: number };
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsData, nichesData] = await Promise.all([
        api.getStats(),
        api.getNiches(),
      ]);
      setStats(statsData);
      setNiches(nichesData.filter(n => n.isActive));
    } catch (err) {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleRunDiscovery = async (nicheId?: string) => {
    setRunningDiscovery(true);
    setDiscoveryMessage('');
    try {
      const result = await api.runAllDiscovery(nicheId) as { totalDiscovered?: number };
      setDiscoveryMessage(`Discovery complete! Found ${result.totalDiscovered || 0} posts.`);
      loadData(); // Refresh stats
    } catch (err: unknown) {
      setDiscoveryMessage(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setRunningDiscovery(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
        {error}
      </div>
    );
  }

  const statCards = [
    {
      title: 'Niches',
      value: stats?.niches.active || 0,
      subtitle: `${stats?.niches.total || 0} total`,
      link: '/niches',
      color: 'blue',
    },
    {
      title: 'Discovered Posts',
      value: stats?.discovery.pending || 0,
      subtitle: `${stats?.discovery.total || 0} total, ${stats?.discovery.pending || 0} pending`,
      link: '/discovery',
      color: 'green',
    },
    {
      title: 'Generation Jobs',
      value: stats?.jobs.running || 0,
      subtitle: `${stats?.jobs.total || 0} total, ${stats?.jobs.running || 0} running`,
      link: '/jobs',
      color: 'purple',
    },
    {
      title: 'Published Content',
      value: stats?.content.published || 0,
      subtitle: `${stats?.content.total || 0} total`,
      link: '/content',
      color: 'orange',
    },
  ];

  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
    green: 'bg-green-50 border-green-200 text-green-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
    orange: 'bg-orange-50 border-orange-200 text-orange-600',
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map((card) => (
          <Link
            key={card.title}
            to={card.link}
            className={`block p-6 rounded-lg border-2 hover:shadow-lg transition-shadow ${colorClasses[card.color]}`}
          >
            <h2 className="text-sm font-medium uppercase tracking-wide opacity-75">
              {card.title}
            </h2>
            <p className="text-4xl font-bold mt-2">{card.value}</p>
            <p className="text-sm mt-1 opacity-75">{card.subtitle}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link
              to="/niches"
              className="block w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Create New Niche
            </Link>
            <Link
              to="/discovery"
              className="block w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
            >
              View Discovery Queue
            </Link>
            <Link
              to="/content?status=review"
              className="block w-full text-left px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Review Pending Content
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Run Discovery</h2>
          {discoveryMessage && (
            <div className={`mb-4 px-4 py-2 rounded ${discoveryMessage.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {discoveryMessage}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => handleRunDiscovery()}
              disabled={runningDiscovery}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {runningDiscovery ? 'Running...' : 'Run All Discovery Sources'}
            </button>
            {niches.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-sm text-gray-500 mb-2">Or run for specific niche:</p>
                <div className="flex flex-wrap gap-2">
                  {niches.map(niche => (
                    <button
                      key={niche.id}
                      onClick={() => handleRunDiscovery(niche.id)}
                      disabled={runningDiscovery}
                      className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm disabled:opacity-50"
                    >
                      {niche.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">System Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
            <span className="text-gray-600">API Status</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
              Healthy
            </span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
            <span className="text-gray-600">Scheduler</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
              Running
            </span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
            <span className="text-gray-600">Active Jobs</span>
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-sm">
              {stats?.jobs.running || 0}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
