import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface AiUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  requestCount: number;
  byModel: Record<string, { inputTokens: number; outputTokens: number; requestCount: number }>;
}

interface SchedulerJob {
  name: string;
  cronExpression: string;
  nextRun: string | null;
}

export default function Settings() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);
  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    loadSettings();
    loadAiUsage();
    loadSchedulerStatus();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getSettings();
      setSettings(data.global);
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const loadAiUsage = async () => {
    try {
      const data = await api.getAiUsage();
      setAiUsage(data);
    } catch (err) {
      console.error('Failed to load AI usage', err);
    }
  };

  const loadSchedulerStatus = async () => {
    try {
      const data = await api.getSchedulerStatus();
      setSchedulerJobs(data.jobs);
    } catch (err) {
      console.error('Failed to load scheduler status', err);
    }
  };

  const handleReloadScheduler = async () => {
    setReloading(true);
    try {
      const data = await api.reloadScheduler();
      setSchedulerJobs(data.jobs);
      setError('');
    } catch (err) {
      setError('Failed to reload scheduler');
    } finally {
      setReloading(false);
    }
  };

  const handleSave = async (key: string, value: string) => {
    setSaving(key);
    try {
      await api.setSetting(key, value);
      setSettings({ ...settings, [key]: value });
    } catch (err) {
      setError('Failed to save setting');
    } finally {
      setSaving(null);
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quality Thresholds */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Quality Thresholds</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Minimum SEO Score
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={settings.min_seo_score || '70'}
                  onChange={(e) => setSettings({ ...settings, min_seo_score: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  min="0"
                  max="100"
                />
                <button
                  onClick={() => handleSave('min_seo_score', settings.min_seo_score || '70')}
                  disabled={saving === 'min_seo_score'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'min_seo_score' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Content must score above this threshold to be published</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Maximum Slop Score
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={settings.max_slop_score || '5'}
                  onChange={(e) => setSettings({ ...settings, max_slop_score: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  min="0"
                  max="10"
                  step="0.5"
                />
                <button
                  onClick={() => handleSave('max_slop_score', settings.max_slop_score || '5')}
                  disabled={saving === 'max_slop_score'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'max_slop_score' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Content must score below this threshold (lower is better)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Minimum Pain Score for Discovery
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={settings.min_pain_score || '60'}
                  onChange={(e) => setSettings({ ...settings, min_pain_score: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  min="0"
                  max="100"
                />
                <button
                  onClick={() => handleSave('min_pain_score', settings.min_pain_score || '60')}
                  disabled={saving === 'min_pain_score'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'min_pain_score' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Only posts scoring above this will be stored</p>
            </div>
          </div>
        </div>

        {/* AI Usage */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">AI Usage (This Session)</h2>
          {aiUsage ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatNumber(aiUsage.totalTokens)}
                  </div>
                  <div className="text-sm text-gray-500">Total Tokens</div>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatNumber(aiUsage.requestCount)}
                  </div>
                  <div className="text-sm text-gray-500">API Requests</div>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">By Model</h3>
                <div className="space-y-2">
                  {Object.entries(aiUsage.byModel).map(([model, stats]) => (
                    <div key={model} className="flex justify-between text-sm p-2 bg-gray-50 rounded">
                      <span className="font-mono">{model}</span>
                      <span className="text-gray-500">
                        {formatNumber(stats.inputTokens + stats.outputTokens)} tokens / {stats.requestCount} requests
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={loadAiUsage}
                className="text-sm text-blue-600 hover:underline"
              >
                Refresh Stats
              </button>
            </div>
          ) : (
            <p className="text-gray-500">No usage data available</p>
          )}
        </div>

        {/* Job Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Job Processing</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Concurrent Jobs
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={settings.max_concurrent_jobs || '3'}
                  onChange={(e) => setSettings({ ...settings, max_concurrent_jobs: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  min="1"
                  max="10"
                />
                <button
                  onClick={() => handleSave('max_concurrent_jobs', settings.max_concurrent_jobs || '3')}
                  disabled={saving === 'max_concurrent_jobs'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'max_concurrent_jobs' ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Retries
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={settings.max_retries || '3'}
                  onChange={(e) => setSettings({ ...settings, max_retries: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  min="0"
                  max="10"
                />
                <button
                  onClick={() => handleSave('max_retries', settings.max_retries || '3')}
                  disabled={saving === 'max_retries'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'max_retries' ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Cron Schedules */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Cron Schedules</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discovery Cron
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.discovery_cron || '0 */4 * * *'}
                  onChange={(e) => setSettings({ ...settings, discovery_cron: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                  placeholder="0 */4 * * *"
                />
                <button
                  onClick={() => handleSave('discovery_cron', settings.discovery_cron || '0 */4 * * *')}
                  disabled={saving === 'discovery_cron'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'discovery_cron' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">When to discover new pain points (default: every 4 hours)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Generation Cron
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.generation_cron || '*/15 * * * *'}
                  onChange={(e) => setSettings({ ...settings, generation_cron: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                  placeholder="*/15 * * * *"
                />
                <button
                  onClick={() => handleSave('generation_cron', settings.generation_cron || '*/15 * * * *')}
                  disabled={saving === 'generation_cron'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'generation_cron' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">When to process generation queue (default: every 15 min)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cleanup Cron
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.cleanup_cron || '0 3 * * *'}
                  onChange={(e) => setSettings({ ...settings, cleanup_cron: e.target.value })}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-mono text-sm"
                  placeholder="0 3 * * *"
                />
                <button
                  onClick={() => handleSave('cleanup_cron', settings.cleanup_cron || '0 3 * * *')}
                  disabled={saving === 'cleanup_cron'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === 'cleanup_cron' ? 'Saving...' : 'Save'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">When to clean up old data (default: 3am daily)</p>
            </div>

            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={handleReloadScheduler}
                disabled={reloading}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {reloading ? 'Reloading...' : 'Apply & Reload Scheduler'}
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Click to apply saved cron settings without restarting the server
              </p>
            </div>

            {schedulerJobs.length > 0 && (
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-700 mb-2">Active Schedules</h3>
                <div className="space-y-1">
                  {schedulerJobs.map((job) => (
                    <div key={job.name} className="flex justify-between text-sm p-2 bg-gray-50 rounded">
                      <span className="capitalize">{job.name}</span>
                      <span className="font-mono text-gray-500">{job.cronExpression}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-gray-400 mt-2">
              Format: minute hour day month weekday (e.g., "0 */4 * * *" = every 4 hours)
            </p>
          </div>
        </div>

        {/* Environment Info */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Environment</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">API Base URL</span>
              <span className="font-mono">/api</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Admin Path</span>
              <span className="font-mono">/admin</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
