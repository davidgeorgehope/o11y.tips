import { useState, useEffect } from 'react';
import { api, Job, Niche } from '../api/client';

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [niches, setNiches] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    nicheId: '',
    status: '',
  });
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  useEffect(() => {
    loadNiches();
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [filters]);

  const loadNiches = async () => {
    try {
      const data = await api.getNiches();
      setNiches(data);
    } catch (err) {
      console.error('Failed to load niches', err);
    }
  };

  const loadJobs = async () => {
    try {
      const data = await api.getJobs({
        nicheId: filters.nicheId || undefined,
        status: filters.status || undefined,
        limit: 50,
      });
      setJobs(data.jobs);
    } catch (err) {
      setError('Failed to load jobs');
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (jobId: string) => {
    try {
      await api.startJob(jobId);
      loadJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start job');
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      await api.retryJob(jobId);
      loadJobs();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retry job');
    }
  };

  const handleCancel = async (jobId: string) => {
    if (!confirm('Cancel this job?')) return;
    try {
      await api.cancelJob(jobId);
      loadJobs();
    } catch (err) {
      setError('Failed to cancel job');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-gray-100 text-gray-700';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  };

  const getNicheName = (nicheId: string) => {
    return niches.find(n => n.id === nicheId)?.name || 'Unknown';
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Generation Jobs</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Niche</label>
            <select
              value={filters.nicheId}
              onChange={(e) => setFilters({ ...filters, nicheId: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All Niches</option>
              {niches.map(niche => (
                <option key={niche.id} value={niche.id}>{niche.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="voice">Voice Analysis</option>
              <option value="research">Research</option>
              <option value="outline">Outline</option>
              <option value="content">Content</option>
              <option value="components">Components</option>
              <option value="images">Images</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Jobs List */}
        <div className="flex-1 bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Job ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Niche
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map(job => (
                  <tr
                    key={job.id}
                    className={`hover:bg-gray-50 cursor-pointer ${
                      selectedJob?.id === job.id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => setSelectedJob(job)}
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm">{job.id.slice(0, 12)}...</span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {getNicheName(job.nicheId)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500">{job.progress}%</span>
                    </td>
                    <td className="px-4 py-3">
                      {job.status === 'pending' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStart(job.id); }}
                          className="text-sm text-blue-600 hover:underline mr-2"
                        >
                          Start
                        </button>
                      )}
                      {job.status === 'failed' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRetry(job.id); }}
                          className="text-sm text-blue-600 hover:underline mr-2"
                        >
                          Retry
                        </button>
                      )}
                      {!['completed', 'failed', 'pending'].includes(job.status) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCancel(job.id); }}
                          className="text-sm text-red-600 hover:underline"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No jobs found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Job Detail */}
        {selectedJob && (
          <div className="w-96 bg-white rounded-lg shadow p-4 h-fit sticky top-4">
            <h3 className="font-semibold mb-2">Job Details</h3>
            <div className="text-sm space-y-2 mb-4">
              <p><span className="text-gray-500">ID:</span> <span className="font-mono">{selectedJob.id}</span></p>
              <p><span className="text-gray-500">Status:</span> {selectedJob.status}</p>
              <p><span className="text-gray-500">Step:</span> {selectedJob.currentStep || 'N/A'}</p>
              <p><span className="text-gray-500">Progress:</span> {selectedJob.progress}%</p>
              <p><span className="text-gray-500">Retries:</span> {selectedJob.retryCount}</p>
              {selectedJob.startedAt && (
                <p><span className="text-gray-500">Started:</span> {new Date(selectedJob.startedAt).toLocaleString()}</p>
              )}
              {selectedJob.completedAt && (
                <p><span className="text-gray-500">Completed:</span> {new Date(selectedJob.completedAt).toLocaleString()}</p>
              )}
            </div>

            {selectedJob.errorMessage && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-red-600 mb-2">Error</h4>
                <pre className="text-xs bg-red-50 p-2 rounded overflow-x-auto text-red-700">
                  {selectedJob.errorMessage}
                </pre>
              </div>
            )}

            {selectedJob.voiceAnalysis && (
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium mb-2">Voice Analysis</h4>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-32">
                  {JSON.stringify(JSON.parse(selectedJob.voiceAnalysis), null, 2)}
                </pre>
              </div>
            )}

            {selectedJob.outline && (
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium mb-2">Outline</h4>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-32">
                  {JSON.stringify(JSON.parse(selectedJob.outline), null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
