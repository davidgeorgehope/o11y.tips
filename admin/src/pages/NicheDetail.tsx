import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, Niche, Schedule } from '../api/client';

export default function NicheDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [niche, setNiche] = useState<Niche | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    voiceGuidelines: '',
    targetAudience: '',
    keywords: '',
    isActive: true,
  });
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    sourceType: 'grounded_search',
    keywords: '',
    subreddits: '',
    tags: '',
    repositories: '',
  });

  useEffect(() => {
    if (id) {
      loadNiche();
      loadSchedules();
    }
  }, [id]);

  const loadNiche = async () => {
    try {
      const data = await api.getNiche(id!);
      setNiche(data);
      setFormData({
        name: data.name,
        description: data.description || '',
        voiceGuidelines: data.voiceGuidelines || '',
        targetAudience: data.targetAudience || '',
        keywords: data.keywords ? JSON.parse(data.keywords).join(', ') : '',
        isActive: data.isActive,
      });
    } catch (err) {
      setError('Failed to load niche');
    } finally {
      setLoading(false);
    }
  };

  const loadSchedules = async () => {
    try {
      const data = await api.getSchedules(id);
      setSchedules(data);
    } catch (err) {
      console.error('Failed to load schedules', err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      await api.updateNiche(id!, {
        ...formData,
        keywords: formData.keywords.split(',').map(k => k.trim()).filter(Boolean).join(', '),
      });
      navigate('/niches');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update niche');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();

    const config: Record<string, unknown> = {
      keywords: scheduleForm.keywords.split(',').map(k => k.trim()).filter(Boolean),
    };

    if (scheduleForm.sourceType === 'reddit' && scheduleForm.subreddits) {
      config.subreddits = scheduleForm.subreddits.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (scheduleForm.sourceType === 'stackoverflow' && scheduleForm.tags) {
      config.tags = scheduleForm.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (scheduleForm.sourceType === 'github' && scheduleForm.repositories) {
      config.repositories = scheduleForm.repositories.split(',').map(r => r.trim()).filter(Boolean);
    }

    try {
      await api.createSchedule({
        nicheId: id,
        sourceType: scheduleForm.sourceType,
        config: JSON.stringify(config),
      });
      setShowAddSchedule(false);
      setScheduleForm({ sourceType: 'grounded_search', keywords: '', subreddits: '', tags: '', repositories: '' });
      loadSchedules();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create schedule');
    }
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    if (!confirm('Delete this discovery schedule?')) return;

    try {
      await api.deleteSchedule(scheduleId);
      loadSchedules();
    } catch (err) {
      setError('Failed to delete schedule');
    }
  };

  const handleRunDiscovery = async (scheduleId: string) => {
    try {
      await api.runDiscovery(scheduleId);
      alert('Discovery started!');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run discovery');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!niche) {
    return <div className="text-red-600">Niche not found</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit Niche: {niche.name}</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Niche Settings */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Niche Settings</h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
              <input
                type="text"
                value={formData.targetAudience}
                onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Keywords (comma-separated)</label>
              <input
                type="text"
                value={formData.keywords}
                onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Voice Guidelines</label>
              <textarea
                value={formData.voiceGuidelines}
                onChange={(e) => setFormData({ ...formData, voiceGuidelines: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={4}
                placeholder="Describe the writing style and tone for this niche..."
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded border-gray-300"
              />
              <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Discovery Schedules */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Discovery Schedules</h2>
            <button
              onClick={() => setShowAddSchedule(true)}
              className="text-sm bg-gray-100 px-3 py-1 rounded hover:bg-gray-200 transition-colors"
            >
              Add Schedule
            </button>
          </div>

          {showAddSchedule && (
            <form onSubmit={handleAddSchedule} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source Type</label>
                <select
                  value={scheduleForm.sourceType}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, sourceType: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="grounded_search">Grounded Search</option>
                  <option value="reddit">Reddit</option>
                  <option value="stackoverflow">Stack Overflow</option>
                  <option value="hackernews">Hacker News</option>
                  <option value="github">GitHub Issues</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Keywords</label>
                <input
                  type="text"
                  value={scheduleForm.keywords}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, keywords: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  placeholder="observability, tracing, metrics"
                />
              </div>
              {scheduleForm.sourceType === 'reddit' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subreddits</label>
                  <input
                    type="text"
                    value={scheduleForm.subreddits}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, subreddits: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="devops, kubernetes"
                  />
                </div>
              )}
              {scheduleForm.sourceType === 'stackoverflow' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                  <input
                    type="text"
                    value={scheduleForm.tags}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, tags: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="prometheus, grafana"
                  />
                </div>
              )}
              {scheduleForm.sourceType === 'github' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Repositories</label>
                  <input
                    type="text"
                    value={scheduleForm.repositories}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, repositories: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                    placeholder="open-telemetry/opentelemetry-js"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddSchedule(false)}
                  className="px-3 py-1 border rounded text-sm hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {schedules.map((schedule) => {
              const config = JSON.parse(schedule.config);
              return (
                <div key={schedule.id} className="p-4 border rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-medium capitalize">{schedule.sourceType.replace('_', ' ')}</span>
                      <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                        schedule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {schedule.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRunDiscovery(schedule.id)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Run Now
                      </button>
                      <button
                        onClick={() => handleDeleteSchedule(schedule.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {config.keywords && (
                    <p className="text-sm text-gray-500 mt-1">
                      Keywords: {config.keywords.join(', ')}
                    </p>
                  )}
                  {schedule.lastRunAt && (
                    <p className="text-xs text-gray-400 mt-1">
                      Last run: {new Date(schedule.lastRunAt).toLocaleString()}
                    </p>
                  )}
                </div>
              );
            })}
            {schedules.length === 0 && (
              <p className="text-gray-500 text-sm">No discovery schedules configured.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
